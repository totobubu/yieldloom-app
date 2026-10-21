import { createHash } from 'node:crypto';
import { fetchJson } from './thumbnail-prices.js';
import { createTransportCache } from './request-cache.js';

const directoryCache = createTransportCache({ ttlMs: 60_000, maxEntries: 16 });
const historyCache = createTransportCache({ ttlMs: 180_000 });

async function currentRelease(base, fetcher) {
    base = base.replace(/\/+$/, '');
    const { pointer, manifest } = await directoryCache(fetcher)(
        base,
        async () => {
            const pointer = await fetchJson(
                `${base}/core/current.json`,
                fetcher
            );
            if (
                pointer.schemaVersion !== 2 ||
                !/^core\/releases\/[A-Za-z0-9._-]+\/manifest\.json$/.test(
                    pointer.manifestKey ?? ''
                )
            )
                throw new Error('Invalid core pointer');
            const manifest = await fetchJson(
                `${base}/${pointer.manifestKey}`,
                fetcher
            );
            if (
                manifest.schemaVersion !== 2 ||
                manifest.releaseId !== pointer.releaseId ||
                !Array.isArray(manifest.files) ||
                !manifest.files.length
            )
                throw new Error('Invalid core manifest');
            return { pointer, manifest };
        }
    );
    return { pointer, manifest };
}

async function releaseFile(key, base, fetcher, pointer, manifest) {
    base = base.replace(/\/+$/, '');
    const entry = manifest.files.find((file) => file.path === key);
    if (!entry) throw new Error(`Core manifest missing ${key}`);
    const root = pointer.manifestKey.slice(0, -'manifest.json'.length);
    return historyCache(fetcher)(
        `${base}/${root}${key}|${entry.sha256}`,
        async () => {
            const response = await fetcher(`${base}/${root}${key}`, {
                signal: AbortSignal.timeout(4000),
            });
            if (!response.ok)
                throw new Error(`Core history HTTP ${response.status}`);
            const text = await response.text();
            if (
                createHash('sha256').update(text).digest('hex') !== entry.sha256
            )
                throw new Error('Core history hash mismatch');
            const payload = JSON.parse(text);
            return payload;
        }
    );
}

export async function loadCoreHistory(symbol, base, fetcher = fetch) {
    const { pointer, manifest } = await currentRelease(base, fetcher);
    const key = `tickers/${symbol}.json`;
    if (!manifest.files.some((file) => file.path === key)) return [];
    const payload = await releaseFile(key, base, fetcher, pointer, manifest);
    if (payload.ticker !== symbol || !Array.isArray(payload.events))
        throw new Error('Core history identity mismatch');
    return payload.events;
}

export async function loadCoreIndex(base, fetcher = fetch) {
    const { pointer, manifest } = await currentRelease(base, fetcher);
    if (manifest.indexPath !== 'index.json')
        throw new Error('Invalid core index path');
    const index = await releaseFile(
        'index.json',
        base,
        fetcher,
        pointer,
        manifest
    );
    if (!Array.isArray(index.tickers) || !Array.isArray(index.providers))
        throw new Error('Invalid core index');
    return index;
}
