import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import fs from 'node:fs/promises';
import pLimit from 'p-limit';
import { pathToFileURL } from 'node:url';
import {
    buildProjection,
    validateProjection,
    projectionPrefix,
    sha256,
    jsonBytes,
    symbolKey,
    generatorVersion,
} from '../../lib/thumbnail-projection.js';

const missing = (error) =>
    error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
export async function readJson(storage, bucket, key) {
    try {
        const object = await storage.send(
            new GetObjectCommand({ Bucket: bucket, Key: key })
        );
        return JSON.parse(await object.Body.transformToString());
    } catch (error) {
        if (missing(error)) return null;
        throw error;
    }
}
export async function putJson(storage, bucket, key, value, immutable = true) {
    if (!key.startsWith(`${projectionPrefix}/`))
        throw new Error('Writes outside thumbnail/v1 are forbidden');
    await storage.send(
        new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: jsonBytes(value),
            ContentType: 'application/json',
            CacheControl: immutable
                ? 'public, max-age=31536000, immutable'
                : 'public, max-age=60',
        })
    );
}

export async function refresh({
    nav,
    sourceBase,
    storage,
    bucket,
    asOf,
    symbols,
    fetcher = fetch,
    dryRun = false,
    concurrency = 8,
}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
        throw new Error('Concurrency must be an integer between 1 and 8');
    if (!sourceBase?.startsWith('https://'))
        throw new Error('An HTTPS source R2 URL is required');
    if (
        !Array.isArray(nav?.nav) ||
        nav.nav.some((row) => typeof row?.symbol !== 'string')
    )
        throw new Error('Invalid source directory');
    if (new Set(nav.nav.map((row) => row.symbol)).size !== nav.nav.length)
        throw new Error('Source directory has duplicate symbols');
    const pointer = storage
        ? await readJson(storage, bucket, `${projectionPrefix}/current.json`)
        : null;
    if (
        pointer &&
        !/^thumbnail\/v1\/releases\/[a-f0-9]+\/manifest\.json$/.test(
            pointer.manifestKey ?? ''
        )
    )
        throw new Error('Invalid thumbnail pointer');
    const previous = pointer
        ? await readJson(storage, bucket, pointer.manifestKey)
        : null;
    if (
        pointer &&
        (!previous || sha256(jsonBytes(previous)) !== pointer.releaseId)
    )
        throw new Error(
            'Previous manifest missing or corrupt; refusing to replace current'
        );
    const entries = { ...(previous?.tickers ?? {}) };
    const report = {
        asOf,
        dryRun,
        changed: [],
        unchanged: [],
        rejected: [],
        measurements: [],
    };
    const selected = symbols ? new Set(symbols) : null;
    const limit = pLimit(concurrency);
    await Promise.all(
        nav.nav
            .filter((row) => !selected || selected.has(row.symbol))
            .map((item) =>
                limit(async () => {
                    const symbol = item.symbol;
                    const sourceKey = item.dataPaths?.[0];
                    try {
                        if (
                            !/^data\/[a-z0-9_-]+\/[a-z0-9.-]+\.json$/i.test(
                                sourceKey ?? ''
                            )
                        )
                            throw new Error('Invalid source path');
                        const old = entries[symbol];
                        const response = await fetcher(
                            new URL(
                                sourceKey,
                                `${sourceBase.replace(/\/$/, '')}/`
                            ),
                            {
                                signal: AbortSignal.timeout(15000),
                                headers: {
                                    ...(old?.etag &&
                                    old.generatorVersion === generatorVersion
                                        ? { 'If-None-Match': old.etag }
                                        : {}),
                                    Accept: 'application/json',
                                },
                            }
                        );
                        if (response.status === 304) {
                            report.unchanged.push(symbol);
                            return;
                        }
                        if (!response.ok)
                            throw new Error(`Source HTTP ${response.status}`);
                        const bytes = Buffer.from(await response.arrayBuffer());
                        const hash = sha256(bytes);
                        if (
                            old?.sourceSha256 === hash &&
                            old.generatorVersion === generatorVersion
                        ) {
                            report.unchanged.push(symbol);
                            return;
                        }
                        const coverage =
                            old && storage
                                ? await readJson(
                                      storage,
                                      bucket,
                                      `${old.root}/source-coverage.json`
                                  )
                                : null;
                        if (old && !coverage)
                            throw new Error('Previous source coverage missing');
                        const models = validateProjection(
                            buildProjection({
                                symbol,
                                payload: JSON.parse(bytes),
                                sourceBytes: bytes,
                                sourceKey,
                                asOf,
                                previousDates: coverage?.dates,
                            })
                        );
                        const version = sha256(
                            jsonBytes({ generatorVersion, models })
                        );
                        const root = `${projectionPrefix}/objects/${symbolKey(symbol)}/${version}`;
                        if (!dryRun) {
                            // Complete and verify all read models before exposing them through the manifest.
                            for (const [name, model] of Object.entries(models))
                                await putJson(
                                    storage,
                                    bucket,
                                    `${root}/${name}.json`,
                                    model
                                );
                            for (const name of Object.keys(models)) {
                                const uploaded = await readJson(
                                    storage,
                                    bucket,
                                    `${root}/${name}.json`
                                );
                                if (
                                    sha256(jsonBytes(uploaded)) !==
                                    sha256(jsonBytes(models[name]))
                                )
                                    throw new Error(
                                        'Uploaded projection hash mismatch'
                                    );
                            }
                        }
                        entries[symbol] = {
                            root,
                            generatorVersion,
                            hashes: Object.fromEntries(
                                Object.entries(models).map(([name, model]) => [
                                    name,
                                    sha256(jsonBytes(model)),
                                ])
                            ),
                            sourceSha256: hash,
                            etag: response.headers.get('etag'),
                            sourceKey,
                            asOf,
                            priceDate: models.summary.priceDate,
                        };
                        report.changed.push(symbol);
                        report.measurements.push({
                            symbol,
                            sourceBytes: bytes.length,
                            summaryBytes: jsonBytes(models.summary).length,
                            historyBytes: jsonBytes(models['entry-efficiency'])
                                .length,
                            firstPriceDate:
                                models.summary.source.firstPriceDate,
                            lastPriceDate: models.summary.priceDate,
                        });
                    } catch (error) {
                        // Keep the old immutable entry on source failure or history loss.
                        report.rejected.push({
                            symbol,
                            reason: error.message,
                            retainedPrevious: Boolean(entries[symbol]),
                        });
                    }
                })
            )
    );
    if (selected)
        for (const symbol of selected)
            if (!nav.nav.some((row) => row.symbol === symbol))
                report.rejected.push({
                    symbol,
                    reason: 'Symbol missing from source directory',
                    retainedPrevious: Boolean(entries[symbol]),
                });
    if (!dryRun && report.changed.length) {
        const manifest = {
            schemaVersion: 1,
            asOf,
            tickers: Object.fromEntries(
                Object.entries(entries).sort(([left], [right]) =>
                    left < right ? -1 : left > right ? 1 : 0
                )
            ),
        };
        const releaseId = sha256(jsonBytes(manifest));
        const key = `${projectionPrefix}/releases/${releaseId}/manifest.json`;
        await putJson(storage, bucket, key, manifest);
        const uploaded = await readJson(storage, bucket, key);
        if (sha256(jsonBytes(uploaded)) !== releaseId)
            throw new Error('Manifest verification failed');
        // A rejected source never points to its new objects. Previous versions stay available.
        await putJson(
            storage,
            bucket,
            `${projectionPrefix}/current.json`,
            { schemaVersion: 1, releaseId, manifestKey: key },
            false
        );
    }
    report.changed.sort();
    report.unchanged.sort();
    report.rejected.sort((left, right) =>
        left.symbol.localeCompare(right.symbol)
    );
    report.measurements.sort((left, right) =>
        left.symbol.localeCompare(right.symbol)
    );
    return report;
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const value = (flag) => {
        const index = args.indexOf(flag);
        return index < 0 ? undefined : args[index + 1];
    };
    const symbols = value('--symbols')
        ?.split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    const sourceBase =
        process.env.THUMBNAIL_SOURCE_BASE_URL ?? process.env.VITE_R2_PUBLIC_URL;
    if (!sourceBase?.startsWith('https://'))
        throw new Error(
            'THUMBNAIL_SOURCE_BASE_URL (or VITE_R2_PUBLIC_URL) must be an HTTPS R2 root'
        );
    let storage, bucket;
    if (!dryRun) {
        for (const key of [
            'R2_ACCOUNT_ID',
            'R2_ACCESS_KEY_ID',
            'R2_SECRET_ACCESS_KEY',
            'R2_BUCKET_NAME',
        ])
            if (!process.env[key])
                throw new Error(
                    `Missing ${key}; use --dry-run for read-only validation`
                );
        bucket = process.env.R2_BUCKET_NAME;
        storage = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
        });
    }
    const navPath = value('--nav');
    let nav;
    if (navPath) nav = JSON.parse(await fs.readFile(navPath));
    else {
        const response = await fetch(
            `${String(sourceBase).replace(/\/$/, '')}/nav.json`,
            { signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok)
            throw new Error(
                `Source directory HTTP ${response.status}; pass --nav for an explicit reviewed directory`
            );
        nav = await response.json();
    }
    if (!Array.isArray(nav.nav))
        throw new Error('Source directory requires nav array');
    const report = await refresh({
        nav,
        sourceBase,
        storage,
        bucket,
        symbols,
        dryRun,
        concurrency: Number(value('--concurrency') ?? 8),
        asOf: value('--as-of') ?? new Date().toISOString().slice(0, 10),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.rejected.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
