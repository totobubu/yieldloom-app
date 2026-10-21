import { getAssetUrl } from '@/utils/dataUrl';
import { readPublicJson } from './publicJson.js';
import {
    isDataReleaseConfigured,
    loadDataReleaseIndex,
    loadDataReleaseHistory,
} from './dataRelease.js';

// All screens use one ledger selection and the existing URL cache. A configured
// core release fails visibly; it never silently mixes with the legacy ledger.
export function loadDividendIndex(options = {}) {
    if (isDataReleaseConfigured()) return loadDataReleaseIndex(options);
    return readPublicJson(
        getAssetUrl('content-studio/distribution-index.json'),
        {
            ...options,
            ttlMs: 180_000,
            validate: (value) => Array.isArray(value?.tickers),
        }
    );
}

export function loadDividendHistory(url, options = {}) {
    if (isDataReleaseConfigured()) return loadDataReleaseHistory(url, options);
    if (
        !/^\/content-studio\/distribution-ticker-[a-z0-9.-]+\.json$/i.test(url)
    ) {
        return Promise.reject(new Error('Invalid dividend history path'));
    }
    return readPublicJson(getAssetUrl(url.slice(1)), {
        ...options,
        ttlMs: 180_000,
        validate: (value) => Array.isArray(value?.history),
    });
}
