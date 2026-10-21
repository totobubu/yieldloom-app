import legacyIndex from '../public/content-studio/distribution-index.json' with { type: 'json' };
import { loadCoreHistory, loadCoreIndex } from './core-release.js';
import { mapCoreDividend } from './dividend-contract.js';
import { createTransportCache } from './request-cache.js';

const cache = createTransportCache({ ttlMs: 180_000 });
const legacyRows = new Map(legacyIndex.tickers.map((row) => [row.ticker, row]));
export const officialReleaseBase = () =>
    process.env.DATA_RELEASE_BASE_URL ??
    process.env.VITE_DATA_RELEASE_BASE_URL ??
    '';

export function officialHistoryReference(symbol) {
    const base = officialReleaseBase();
    return base
        ? `${base.replace(/\/+$/, '')}/core/current.json`
        : (legacyRows.get(symbol)?.historyUrl ?? null);
}

export async function loadOfficialIndex({
    base = officialReleaseBase(),
    fetcher = fetch,
} = {}) {
    if (!base) return legacyIndex;
    const index = await loadCoreIndex(base, fetcher);
    return {
        providers: index.providers.map((slug) => ({ slug, displayName: slug })),
        tickers: index.tickers.map((row) => ({
            ...row,
            latest: mapCoreDividend(row.latest),
        })),
    };
}

export async function loadOfficialHistory(
    symbol,
    origin,
    fetcher = fetch,
    base = officialReleaseBase()
) {
    if (base) return loadCoreHistory(symbol, base, fetcher);
    const historyUrl = legacyRows.get(symbol)?.historyUrl;
    if (
        !historyUrl ||
        !/^\/content-studio\/distribution-ticker-[a-z0-9.-]+\.json$/i.test(
            historyUrl
        )
    )
        return [];
    const origins = [
        ...new Set(
            [
                origin,
                process.env.THUMBNAIL_OFFICIAL_DATA_BASE_URL,
                'https://totobubu.github.io/yieldloom-app',
            ].filter(Boolean)
        ),
    ];
    let lastError;
    for (const dataOrigin of origins) {
        try {
            const url = new URL(
                historyUrl.slice(1),
                `${String(dataOrigin).replace(/\/$/, '')}/`
            ).href;
            return await cache(fetcher)(url, async () => {
                const response = await fetcher(url, {
                    signal: AbortSignal.timeout(4000),
                    headers: { Accept: 'application/json' },
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const payload = await response.json();
                if (!Array.isArray(payload.history))
                    throw new Error('Invalid official history');
                return payload.history;
            });
        } catch (error) {
            lastError = error;
        }
    }
    throw new Error(`공식 배당 원장을 불러오지 못했습니다: ${symbol}`, {
        cause: lastError,
    });
}
