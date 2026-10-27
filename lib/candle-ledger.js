// Private append-preserving candle ledger. Conditional writes protect independent API instances.
import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { validDate, normalizeSymbol, validSymbol } from './thumbnail-projection.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const missing = error => error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
const conflict = error => [409, 412].includes(error?.$metadata?.httpStatusCode);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const candle = row => validDate(row?.date) && ['open', 'high', 'low', 'close'].every(k => Number.isFinite(row[k]) && row[k] > 0)
    && row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close)
    && (row.volume === null || (Number.isFinite(row.volume) && row.volume >= 0));

export function mergeCandles(previous, incoming, identity, observationId) {
    if (!incoming.candles?.length || incoming.candles.some(row => !candle(row))) throw Error('Invalid or empty candles');
    if (incoming.symbol !== identity.symbol || incoming.currency !== identity.currency) throw Error('Candle identity mismatch');
    if (previous && (!same(previous.identity, identity) || previous.schemaVersion !== 1 || !Array.isArray(previous.candles))) throw Error('Stored candle identity mismatch');
    const rows = new Map((previous?.candles ?? []).map(row => [row.date, row]));
    const revisions = [...(previous?.revisions ?? [])];
    const seen = new Set();
    for (const row of incoming.candles) {
        if (seen.has(row.date)) throw Error('Duplicate candle date');
        seen.add(row.date);
        const old = rows.get(row.date);
        if (old && !same(old, row)) {
            // Provider rebasing is not proof that our historic execution basis was wrong.
            const revision = { date: row.date, previous: old, observed: row, observationId };
            if (!revisions.some(r => r.observationId === observationId && r.date === row.date)) revisions.push(revision);
        } else rows.set(row.date, row);
    }
    const events = [...new Map([...(previous?.events ?? []), ...(incoming.events ?? [])].map(row => [JSON.stringify(row), row])).values()];
    return { schemaVersion: 1, identity, symbol: identity.symbol, currency: identity.currency,
        candles: [...rows.values()].sort((a,b) => a.date.localeCompare(b.date)), events, revisions,
        coverage: { ...previous?.coverage, status: 'partial', targetStart: identity.ipoDate ?? null,
            reason: revisions.length || previous?.coverage?.conflictingDates?.length ? 'corrections_require_review' : 'historical_completeness_unverified' },
        collectionRequest: previous?.collectionRequest ?? { dataset: 'market-prices', status: 'pending',
            targetStart: identity.ipoDate ?? null, reason: identity.ipoDate ? 'inception_backfill' : 'inception_required' },
        observationId, asOf: incoming.asOf, timezone: incoming.timezone, source: 'Yahoo Finance' };
}

export function createCandleLedger({ storage, bucket, readPrefix = 'market/v1/candles' }) {
    if (!['market/v1/candles', 'market/v1/read-models'].includes(readPrefix)) throw Error('Invalid ledger prefix');
    const address = symbol => {
        const normalized = normalizeSymbol(symbol);
        if (!validSymbol(normalized)) throw Error('Invalid candle symbol');
        return { Bucket: bucket, Key: `${readPrefix}/${encodeURIComponent(normalized)}.json` };
    };
    async function read(symbol) {
        try {
            const result = await storage.send(new GetObjectCommand(address(symbol)));
            const value = JSON.parse(await result.Body.transformToString());
            if (!result.ETag || value.schemaVersion !== 1 || value.symbol !== normalizeSymbol(symbol)
                || !Array.isArray(value.candles) || value.candles.some(row => !candle(row))) throw Error('Corrupt candle ledger');
            return { value, etag: result.ETag };
        } catch (error) { if (missing(error)) return null; throw error; }
    }
    async function publishRequest(identity, value) {
        const target = { Bucket: bucket, Key: `market/v1/requests/${encodeURIComponent(identity.symbol)}.json` };
        const end = value.asOf?.slice(0, 10);
        if (!validDate(end)) throw Error('Invalid request date');
        for (let attempt = 0; attempt < 4; attempt++) {
            let previous;
            try {
                const result = await storage.send(new GetObjectCommand(target));
                previous = { value: JSON.parse(await result.Body.transformToString()), etag: result.ETag };
                if (!previous.etag || previous.value.schemaVersion !== 1 || !same(previous.value.identity, identity)
                    || !validDate(previous.value.requestedThrough)) throw Error('Corrupt collection request');
                if (previous.value.requestedThrough >= end) return;
            } catch (error) { if (!missing(error)) throw error; }
            try {
                await storage.send(new PutObjectCommand({ ...target,
                    Body: JSON.stringify({ schemaVersion: 1, identity, requestedThrough: end }),
                    ContentType: 'application/json', CacheControl: 'no-store',
                    ...(previous ? { IfMatch: previous.etag } : { IfNoneMatch: '*' }) }));
                return;
            } catch (error) { if (!conflict(error)) throw error; }
        }
        throw Error('Concurrent request writers; retry required');
    }
    async function append(value, identity, raw) {
        if (readPrefix !== 'market/v1/candles') throw Error('Read model is read-only');
        const body = JSON.stringify({ identity, source: 'yahoo-chart', raw });
        const observationId = hash(body);
        // Validate before writing any object, and retain the source response for later review.
        mergeCandles(null, value, identity, observationId);
        try {
            await storage.send(new PutObjectCommand({ Bucket: bucket,
                Key: `market/v1/observations/${observationId}.json`, Body: body,
                ContentType: 'application/json', IfNoneMatch: '*' }));
        } catch (error) { if (!conflict(error)) throw error; }
        for (let attempt = 0; attempt < 4; attempt++) {
            const previous = await read(identity.symbol);
            const merged = mergeCandles(previous?.value, value, identity, observationId);
            if (previous && same(previous.value, merged)) {
                await publishRequest(identity, value);
                return merged;
            }
            try {
                await storage.send(new PutObjectCommand({ ...address(identity.symbol),
                    Body: JSON.stringify(merged), ContentType: 'application/json', CacheControl: 'no-store',
                    ...(previous ? { IfMatch: previous.etag } : { IfNoneMatch: '*' }) }));
                await publishRequest(identity, value);
                return merged;
            } catch (error) { if (!conflict(error)) throw error; }
        }
        throw Error('Concurrent candle writers; retry required');
    }
    return { read, append };
}

const configured = new Map();
function privateStore(prefix) {
    const keys = ['DATA_PRIVATE_R2_ACCOUNT_ID','DATA_PRIVATE_R2_ACCESS_KEY_ID','DATA_PRIVATE_R2_SECRET_ACCESS_KEY','DATA_PRIVATE_R2_BUCKET'];
    if (keys.some(key => !process.env[key])) throw Error('Private candle persistence is not configured');
    if (!configured.has(prefix)) configured.set(prefix, createCandleLedger({ bucket: process.env.DATA_PRIVATE_R2_BUCKET, readPrefix: prefix,
        storage: new S3Client({ region: 'auto', endpoint: `https://${process.env.DATA_PRIVATE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: process.env.DATA_PRIVATE_R2_ACCESS_KEY_ID, secretAccessKey: process.env.DATA_PRIVATE_R2_SECRET_ACCESS_KEY } }) }));
    return configured.get(prefix);
}
export function configuredCandleLedger() {
    return process.env.DATA_CANDLE_PERSISTENCE === 'true' ? privateStore('market/v1/candles') : null;
}
export function configuredOwnedCandleReader() {
    return process.env.DATA_CANDLE_READ_OWNED === 'true' ? privateStore('market/v1/read-models') : null;
}
