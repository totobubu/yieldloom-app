import { getAssetUrl } from '@/utils/dataUrl';
import { readPublicJson } from './publicJson.js';
import {
    validateStockEvidence,
    mergeStockReference,
} from '../../lib/stock-evidence.js';
import {
    isDataReleaseConfigured,
    loadDataReleaseIndex,
    loadDataReleaseHistory,
} from './dataRelease.js';

// Public observations received in the existing ticker response; no extra GET is needed
// after collection, including a Preview client reading a new Production snapshot.
const receivedStocks = new Map();
export function seedStockReference(ticker) {
    if (!Array.isArray(ticker?.stockReferenceHistory)) return;
    const value = {
        schemaVersion: 1,
        symbol: ticker.symbol,
        currency: ticker.tickerInfo?.currency,
        history: ticker.stockReferenceHistory,
        announcements: ticker.issuerAnnouncements || [],
        candles: [],
    };
    if (!validateStockEvidence(value, ticker.symbol)) return;
    if (receivedStocks.size >= 200 && !receivedStocks.has(ticker.symbol))
        receivedStocks.delete(receivedStocks.keys().next().value);
    receivedStocks.set(ticker.symbol, {
        ...value,
        ticker: ticker.symbol,
        historyUrl: `/content-studio/stock-evidence-${ticker.symbol.toLowerCase()}.json`,
        latest: value.history.at(-1),
    });
}
let stockEvidenceEntries = [];
const stockEntries = () => [
    ...new Map(
        [...stockEvidenceEntries, ...receivedStocks.values()].map((row) => [
            row.ticker,
            row,
        ])
    ).values(),
];

// Keep official failures visible. Supplemental observations never replace a failing ledger.
export async function loadDividendIndex(options = {}) {
    const [officialResult, stockResult] = await Promise.allSettled([
        isDataReleaseConfigured()
            ? loadDataReleaseIndex(options)
            : readPublicJson(
                  getAssetUrl('content-studio/distribution-index.json'),
                  {
                      ...options,
                      ttlMs: 180_000,
                      validate: (value) => Array.isArray(value?.tickers),
                  }
              ),
        readPublicJson(
            getAssetUrl('content-studio/stock-evidence-index.json'),
            {
                ...options,
                ttlMs: 180_000,
                validate: (value) =>
                    value?.schemaVersion === 1 && Array.isArray(value.tickers),
            }
        ),
    ]);
    if (officialResult.status === 'rejected') throw officialResult.reason;
    if (options.signal?.aborted) throw options.signal.reason;
    if (stockResult.status === 'fulfilled')
        stockEvidenceEntries = stockResult.value.tickers;
    const value = officialResult.value;
    const existing = new Set(value.tickers.map((row) => row.ticker));
    return {
        ...value,
        stockReferenceUnavailable: stockResult.status === 'rejected',
        tickers: [
            ...value.tickers,
            ...stockEntries()
                .filter((row) => row.latest && !existing.has(row.ticker))
                .map((row) => ({
                    ...row,
                    providerSlug: 'stock-reference',
                    latest: {
                        ...row.latest,
                        verification_status: 'needs_review',
                        official_url: null,
                    },
                })),
        ],
    };
}

async function readStock(row, options) {
    if (receivedStocks.has(row.ticker)) return receivedStocks.get(row.ticker);
    if (
        !/^\/content-studio\/stock-evidence-[a-z0-9.-]+\.json$/.test(
            row.historyUrl
        )
    )
        throw Error('Invalid stock evidence path');
    const version = row.updatedAt
        ? `?version=${encodeURIComponent(row.updatedAt)}`
        : '';
    return readPublicJson(getAssetUrl(row.historyUrl.slice(1)) + version, {
        ...options,
        ttlMs: 180_000,
        validate: (value) => validateStockEvidence(value, row.ticker),
    });
}
export async function loadDividendHistory(url, options = {}) {
    const reference = stockEntries().find((row) => row.historyUrl === url);
    if (reference) {
        const value = await readStock(reference, options);
        return {
            ticker: reference.ticker,
            history: mergeStockReference([], value.history),
        };
    }
    let value;
    if (isDataReleaseConfigured())
        value = await loadDataReleaseHistory(url, options);
    else {
        if (
            !/^\/content-studio\/distribution-ticker-[a-z0-9.-]+\.json$/i.test(
                url
            )
        )
            throw Error('Invalid dividend history path');
        value = await readPublicJson(getAssetUrl(url.slice(1)), {
            ...options,
            ttlMs: 180_000,
            validate: (value) => Array.isArray(value?.history),
        });
    }
    const stock = stockEntries().find((row) => row.ticker === value.ticker);
    if (!stock) return value;
    const observations = await readStock(stock, options);
    return {
        ...value,
        history: mergeStockReference(value.history, observations.history),
    };
}
