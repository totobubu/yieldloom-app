import { createHash } from 'node:crypto';
import { createRequestCache } from './request-cache.js';
import {
    GetObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';

const configured = () =>
    Boolean(
        process.env.R2_ACCOUNT_ID &&
            process.env.R2_ACCESS_KEY_ID &&
            process.env.R2_SECRET_ACCESS_KEY &&
            process.env.R2_BUCKET_NAME
    );
let client;

function r2() {
    if (!configured()) return null;
    if (!client)
        client = new S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID,
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
            },
        });
    return client;
}

const keyFor = (symbol) =>
    `yieldloom/thumbnail-snapshots/v1/${String(symbol).toUpperCase()}.json`;
const bodyText = async (body) =>
    typeof body?.transformToString === 'function'
        ? body.transformToString()
        : Buffer.concat(await body.transformToByteArray()).toString('utf8');

// Public snapshots only; reuse is limited to this process and bucket.
export function createTickerSnapshotStore({
    getStorage = r2,
    getBucket = () => process.env.R2_BUCKET_NAME,
    now = Date.now,
    maxEntries = 128,
    readTtlMs = 30_000,
    writeTtlMs = 300_000,
} = {}) {
    const reads = createRequestCache({ now, maxEntries, ttlMs: readTtlMs });
    const writes = new Map();
    const trim = () => {
        for (const [key, entry] of writes) {
            if (writes.size <= maxEntries) break;
            if (!entry.tail) writes.delete(key);
        }
    };
    const address = (symbol) => ({ Bucket: getBucket(), Key: keyFor(symbol) });
    const cacheKey = (target) => JSON.stringify([target.Bucket, target.Key]);
    async function read(symbol) {
        const storage = getStorage();
        if (!storage) return null;
        const target = address(symbol);
        return reads(cacheKey(target), async () => {
            try {
                const result = await storage.send(new GetObjectCommand(target));
                return JSON.parse(await bodyText(result.Body));
            } catch (error) {
                if (
                    error?.$metadata?.httpStatusCode === 404 ||
                    error?.name === 'NoSuchKey'
                )
                    return null;
                throw error;
            }
        });
    }
    async function write(symbol, value) {
        const storage = getStorage();
        if (!storage) return false;
        const target = address(symbol);
        const key = cacheKey(target);
        // Capture bytes before queuing: callers cannot change the pending payload.
        const serialized = JSON.stringify(value);
        const hash = createHash('sha256').update(serialized).digest('hex');
        let entry = writes.get(key);
        if (!entry) {
            entry = {};
            writes.set(key, entry);
        }
        if (entry.tail && entry.tailHash === hash) return entry.tail;
        const previous = entry.tail;
        const task = Promise.resolve(previous)
            .catch(() => {})
            .then(async () => {
                if (entry.savedHash === hash && entry.expires > now())
                    return true;
                reads.invalidate(key);
                delete entry.savedHash;
                try {
                    await storage.send(
                        new PutObjectCommand({
                            ...target,
                            Body: `{"schemaVersion":1,"savedAt":${JSON.stringify(new Date(now()).toISOString())},"value":${serialized}}`,
                            ContentType: 'application/json',
                            CacheControl: 'no-store',
                        })
                    );
                } finally {
                    reads.invalidate(key);
                }
                entry.savedHash = hash;
                entry.expires = now() + writeTtlMs;
                return true;
            });
        entry.tail = task;
        entry.tailHash = hash;
        const cleanup = () => {
            if (entry.tail === task) delete entry.tail;
            trim();
        };
        task.then(cleanup, cleanup);
        trim();
        return task;
    }
    return { read, write };
}

const snapshots = createTickerSnapshotStore();
export const readTickerSnapshot = (symbol) => snapshots.read(symbol);
export const writeTickerSnapshot = (symbol, value) =>
    snapshots.write(symbol, value);
