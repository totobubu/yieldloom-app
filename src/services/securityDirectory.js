import { readPublicJson } from './publicJson.js';
import { getDataUrl, getR2Url, getAssetUrl } from '@/utils/dataUrl';
import {
    isDivgrowReleaseConfigured,
    loadDivgrowTickerIndex,
} from './divgrowRelease';
import { loadCoreDirectory } from './coreRelease';
import { loadDataReleaseIndex } from './dataRelease';
import { mergeDiscoveredStocks } from '../../lib/discovered-stocks.js';
import { applyVerifiedUnderlyings } from '../../lib/security-underlyings.js';
export async function readDirectoryAsset(path, options = {}) {
    const local = getDataUrl(path);
    try {
        return await readPublicJson(local, { ttlMs: 180_000, ...options });
    } catch (error) {
        if (options.signal?.aborted) throw error;
        const fallback = getR2Url(path);
        if (!fallback || fallback === local) throw error;
        return readPublicJson(fallback, { ttlMs: 180_000, ...options });
    }
}
export async function loadSecurityDirectory() {
    const core = Boolean(import.meta.env.VITE_DATA_RELEASE_BASE_URL);
    const indexTask = core
        ? loadCoreDirectory().then((nav) => ({ nav }))
        : isDivgrowReleaseConfigured()
          ? loadDivgrowTickerIndex()
          : readDirectoryAsset('ticker-index.json');
    const [index, discovered, dividends] = await Promise.allSettled([
        indexTask,
        readDirectoryAsset('us-dividend-stocks.json'),
        core
            ? loadDataReleaseIndex()
            : readDirectoryAsset('content-studio/distribution-index.json'),
    ]);
    if (index.status !== 'fulfilled') throw index.reason;
    const rows = applyVerifiedUnderlyings(
        mergeDiscoveredStocks(
            index.value.nav || [],
            discovered.status === 'fulfilled' ? discovered.value : {}
        )
    )
        .filter((row) => row.symbol && row.active !== false)
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
