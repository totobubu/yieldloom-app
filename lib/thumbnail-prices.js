import {
    normalizeSymbol,
    symbolKey,
    priceFreshness,
    validDate,
    sha256,
    jsonBytes,
} from './thumbnail-projection.js';
import { createTransportCache } from './request-cache.js';

export class PriceError extends Error {
    constructor(message, statusCode = 503) {
        super(message);
        this.statusCode = statusCode;
    }
}
export async function fetchJson(url, fetcher = fetch, timeoutMs = 4000) {
    const response = await fetcher(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
    });
    if (!response.ok)
        throw new PriceError(
            `Data request HTTP ${response.status}`,
            response.status === 404 ? 404 : 503
        );
    return response.json();
}

const directories = createTransportCache({ ttlMs: 60_000, maxEntries: 10 });
const verifiedObjects = createTransportCache({ ttlMs: 180_000 });
async function loadDirectory(root, fetcher) {
    return directories(fetcher)(root, async () => {
        const pointer = await fetchJson(
            `${root}/thumbnail/v1/current.json`,
            fetcher
        );
        if (
            pointer.schemaVersion !== 1 ||
            !/^thumbnail\/v1\/releases\/[a-f0-9]+\/manifest\.json$/.test(
                pointer.manifestKey ?? ''
            )
        )
            throw new Error('Invalid projection pointer');
        const manifest = await fetchJson(
            `${root}/${pointer.manifestKey}`,
            fetcher
        );
        if (
            manifest.schemaVersion !== 1 ||
            sha256(jsonBytes(manifest)) !== pointer.releaseId
        )
            throw new Error('Projection manifest hash mismatch');
        return manifest;
    });
}

export async function loadProjection(
    symbol,
    baseUrl,
    fetcher = fetch,
    kind = 'entry-efficiency'
) {
    if (!baseUrl) return null;
    const root = baseUrl.replace(/\/$/, '');
    const manifest = await loadDirectory(root, fetcher);
    const entry = manifest.tickers?.[symbol];
    if (!entry) return null;
    if (
        !/^thumbnail\/v1\/objects\/[^/]+\/[a-f0-9]+$/.test(entry.root ?? '') ||
        entry.root.split('/')[3] !== symbolKey(symbol)
    )
        throw new Error('Invalid projection object path');
    const [summary, history] = await Promise.all(
        ['summary', kind].map((name) => {
            const url = `${root}/${entry.root}/${name}.json`;
            return verifiedObjects(fetcher)(
                `${url}|${entry.hashes?.[name]}`,
                async () => {
                    const payload = await fetchJson(url, fetcher);
                    if (sha256(jsonBytes(payload)) !== entry.hashes?.[name])
                        throw new Error('Projection object hash mismatch');
                    return payload;
                }
            );
        })
    );
    if (
        sha256(jsonBytes(summary)) !== entry.hashes?.summary ||
        sha256(jsonBytes(history)) !== entry.hashes?.[kind]
    )
        throw new Error('Projection object hash mismatch');
    if (
        summary.schemaVersion !== 1 ||
        summary.symbol !== symbol ||
        history.symbol !== symbol ||
        !Array.isArray(history.backtestData)
    )
        throw new Error('Invalid projection payload');
    return {
        ...history,
        tickerInfo: {
            ...summary.tickerInfo,
            events: { splits: summary.splits ?? [] },
        },
        priceDate: summary.priceDate,
        price: summary.tickerInfo?.price,
        freshness: priceFreshness(summary.priceDate),
        source: 'thumbnail_projection',
        adjustmentBasis: summary.adjustmentBasis,
    };
}

// Yahoo is a recent-quote supplement. It never writes to or replaces the long-term source history.
export async function loadYahooQuote(symbol, fetcher = fetch) {
    const yahooSymbol = /^[A-Z]+\.[AB]$/.test(symbol)
        ? symbol.replace('.', '-')
        : symbol;
    const payload = await fetchJson(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1d`,
        fetcher
    );
    const result = payload.chart?.result?.[0];
    if (!result)
        throw new PriceError(
            payload.chart?.error?.description ?? 'Ticker not found',
            payload.chart?.error?.code === 'Not Found' ? 404 : 503
        );
    const meta = result.meta ?? {};
    const price = Number(meta.regularMarketPrice);
    if (
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(meta.regularMarketTime)
    )
        throw new PriceError('Yahoo price unavailable');
    const priceDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: meta.exchangeTimezoneName ?? 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(meta.regularMarketTime * 1000));
    if (!validDate(priceDate)) throw new PriceError('Invalid Yahoo price date');
    return {
        backtestData: [],
        tickerInfo: {
            symbol: normalizeSymbol(symbol),
            longName: meta.longName ?? meta.shortName ?? symbol,
            currency: meta.currency ?? null,
            market: meta.exchangeName ?? null,
        },
        price,
        priceDate,
        quoteTime: new Date(meta.regularMarketTime * 1000).toISOString(),
        freshness: priceFreshness(priceDate),
        source: 'yahoo_quote',
    };
}
