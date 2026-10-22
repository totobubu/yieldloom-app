import { mapCoreDividend as mapEvent } from '../../lib/dividend-contract.js';
import { readPublicJson } from './publicJson.js';
import { releaseCacheOptions } from './releaseCache.js';
const baseUrl = (import.meta.env?.VITE_DATA_RELEASE_BASE_URL || '').replace(
    /\/+$/,
    ''
);

const fetchJson = (url, options = {}) =>
    readPublicJson(url, releaseCacheOptions(url, options));

export const isDataReleaseConfigured = () => Boolean(baseUrl);

export async function loadDataReleaseIndex(options = {}) {
    const pointer = await fetchJson(`${baseUrl}/core/current.json`, {
        ...options,
        validate: (value) =>
            value?.schemaVersion === 2 &&
            /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.releaseId || '') &&
            value.manifestKey ===
                `core/releases/${value.releaseId}/manifest.json`,
    });
    if (
        pointer.schemaVersion !== 2 ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pointer.releaseId || '') ||
        pointer.manifestKey !==
            `core/releases/${pointer.releaseId}/manifest.json`
    )
        throw new Error('Invalid core release pointer');
    const manifest = await fetchJson(`${baseUrl}/${pointer.manifestKey}`, {
        ...options,
        validate: (value) =>
            value?.schemaVersion === 2 &&
            value.releaseId === pointer.releaseId &&
            value.indexPath === 'index.json',
    });
    if (
        manifest.schemaVersion !== 2 ||
        manifest.releaseId !== pointer.releaseId ||
        manifest.indexPath !== 'index.json'
    )
        throw new Error('Invalid core release manifest');
    const index = await fetchJson(
        `${baseUrl}/${pointer.manifestKey.replace(/manifest\.json$/, manifest.indexPath)}`,
        {
            ...options,
            validate: (value) =>
                Array.isArray(value?.providers) &&
                Array.isArray(value?.tickers) &&
                value.tickers.every(
                    (row) => row?.latest?.amount && row.latest.source
                ),
        }
    );
    return {
        releaseId: manifest.releaseId,
        providers: index.providers.map((slug) => ({ slug, displayName: slug })),
        tickers: index.tickers.map((row) => ({
            ticker: row.ticker,
            providerSlug: row.provider,
            latest: mapEvent(row.latest),
            historyUrl: `${baseUrl}/${pointer.manifestKey.replace(/manifest\.json$/, row.historyPath)}`,
            historyCount: row.historyCount,
        })),
    };
}

export async function loadDataReleaseHistory(url, options = {}) {
    const payload = await fetchJson(url, {
        ...options,
        validate: (value) =>
            Array.isArray(value?.events) &&
            value.events.every((event) => event?.amount && event.source),
    });
    return { ticker: payload.ticker, history: payload.events.map(mapEvent) };
}
