import index from '../public/content-studio/stock-evidence-index.json' with { type: 'json' };
import { validateStockEvidence } from './stock-evidence.js';
import { createTransportCache } from './request-cache.js';
export function createStockEvidenceLoader(entries = index.tickers) {
    const cache = createTransportCache({ ttlMs: 180_000, maxEntries: 200 });
    const paths = new Map(entries.map((row) => [row.ticker, row]));
    return async (symbol, origin, fetcher = fetch) => {
        const entry = paths.get(symbol);
        if (!entry) return null;
        const path = entry.historyUrl;
        if (!/^\/content-studio\/stock-evidence-[a-z0-9.-]+\.json$/.test(path))
            throw Error('Invalid stock evidence path');
        const target = new URL(path, origin);
        if (entry.updatedAt)
            target.searchParams.set('version', entry.updatedAt);
        const url = target.href;
        return cache(fetcher)(url, async () => {
            const response = await fetcher(url, {
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw Error('Stock evidence unavailable');
            const value = await response.json();
            if (
                !validateStockEvidence(value, symbol) ||
                (entry.requestId && value.requestId !== entry.requestId)
            )
                throw Error('Invalid stock evidence');
            return value;
        });
    };
}
export const loadStockEvidence = createStockEvidenceLoader();
