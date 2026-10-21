import {
    applySecurityStatuses,
    isSearchableSecurity,
} from '../../lib/security-status.js';
import { readPublicJson } from './publicJson.js';
import { getDataUrl, getAssetUrl } from '@/utils/dataUrl';
import { loadCoreDirectory } from './coreRelease';
import { loadDividendIndex } from './dividendLedger.js';
import { mergeDiscoveredStocks } from '../../lib/discovered-stocks.js';
import { applyVerifiedUnderlyings } from '../../lib/security-underlyings.js';
export async function readDirectoryAsset(path, options = {}) {
    return readPublicJson(getDataUrl(path), { ttlMs: 180_000, ...options });
}
export async function loadSecurityDirectory({ includeDelisted = false } = {}) {
    const core = Boolean(import.meta.env.VITE_DATA_RELEASE_BASE_URL);
    const indexTask = core
        ? loadCoreDirectory().then((nav) => ({ nav }))
        : readDirectoryAsset('ticker-index.json');
    const [index, discovered, dividends] = await Promise.allSettled([
        indexTask,
        readDirectoryAsset('us-dividend-stocks.json'),
        loadDividendIndex(),
    ]);
    if (index.status !== 'fulfilled') throw index.reason;
    const rows = applySecurityStatuses(
        applyVerifiedUnderlyings(
            mergeDiscoveredStocks(
                index.value.nav || [],
                discovered.status === 'fulfilled' ? discovered.value : {}
            )
        )
    )
        .filter(
            (row) => row.symbol && isSearchableSecurity(row, includeDelisted)
        )
        .map((row) => ({
            ...row,
            company: row.officialProvider || row.company,
        }));
    return {
        rows,
        distributions:
            dividends.status === 'fulfilled' ? dividends.value : null,
        dividendUnavailable: dividends.status !== 'fulfilled',
    };
}
export function loadSecurityInsights(symbol, { signal } = {}) {
    const ticker = String(symbol).toUpperCase().replaceAll('.', '-');
    const bucket =
        [...ticker].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 64;
    return readPublicJson(getAssetUrl(`security-insights/${bucket}.json`), {
        signal,
        ttlMs: 180_000,
        validate: (value) =>
            value?.securities && typeof value.securities === 'object',
    }).then((value) => value.securities[ticker] || null);
}
