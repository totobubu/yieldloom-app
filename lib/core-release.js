import { createHash } from 'node:crypto';
import { fetchJson } from './thumbnail-prices.js';

export async function loadCoreHistory(symbol, base, fetcher = fetch) {
    base = base.replace(/\/$/, '');
    const pointer = await fetchJson(`${base}/core/current.json`, fetcher);
    if (pointer.schemaVersion !== 2 || !/^core\/releases\/[A-Za-z0-9._-]+\/manifest\.json$/.test(pointer.manifestKey ?? '')) throw new Error('Invalid core pointer');
    const manifest = await fetchJson(`${base}/${pointer.manifestKey}`, fetcher);
    if (manifest.schemaVersion !== 2 || manifest.releaseId !== pointer.releaseId || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid core manifest');
    const key = `tickers/${symbol}.json`;
    const entry = manifest.files.find(file => file.path === key);
    if (!entry) return [];
    const root = pointer.manifestKey.slice(0, -'manifest.json'.length);
    const response = await fetcher(`${base}/${root}${key}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Core history HTTP ${response.status}`);
    const text = await response.text();
    if (createHash('sha256').update(text).digest('hex') !== entry.sha256) throw new Error('Core history hash mismatch');
    const payload = JSON.parse(text);
    if (payload.ticker !== symbol || !Array.isArray(payload.events)) throw new Error('Core history identity mismatch');
    return payload.events;
}
