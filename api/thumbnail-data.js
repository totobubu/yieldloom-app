import catalog from '../public/thumbnail-catalog.json' with { type: 'json' };
import coreCatalog from '../data-v2/catalog-seed.json' with { type: 'json' };
import discoveredStocks from '../public/us-dividend-stocks.json' with { type: 'json' };
import { mergeDiscoveredStocks } from '../lib/discovered-stocks.js';
import { verifiedUnderlying } from '../lib/security-underlyings.js';
import distributionIndex from '../public/content-studio/distribution-index.json' with { type: 'json' };
import priceIndex from '../public/content-studio/price-index.json' with { type: 'json' };
import nav from '../public/nav.json' with { type: 'json' };
import { createApiHandler } from '../lib/api-handler.js';
import { createTransportCache } from '../lib/request-cache.js';
import { readTickerSnapshot, writeTickerSnapshot } from '../lib/r2-snapshot.js';
import { loadProjection, loadYahooQuote, PriceError } from '../lib/thumbnail-prices.js';
import { normalizeSymbol, validSymbol, priceFreshness, actualPrices } from '../lib/thumbnail-projection.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const inFlight = new Map();
const sourceCache = createTransportCache({ ttlMs: 60_000 });
const normalize = normalizeSymbol;
const instruments = new Map(mergeDiscoveredStocks(coreCatalog.instruments, discoveredStocks).map((instrument) => [normalize(instrument.symbol), instrument]));
const distributions = new Map((distributionIndex.tickers ?? []).map((row) => [normalize(row.ticker), row]));
const prices = new Map(Object.entries(priceIndex.prices ?? {}).map(([symbol, row]) => [normalize(symbol), row]));
const pricePaths = new Map((nav.nav ?? []).map((row) => [normalize(row.symbol), row]));
const priceDataBaseUrl = () => String(process.env.DIVGROW_DATA_BASE_URL ?? process.env.THUMBNAIL_PRICE_DATA_BASE_URL ?? process.env.VITE_R2_PUBLIC_URL ?? '').replace(/\/$/, '');
const officialDataFallbackOrigin = 'https://totobubu.github.io/yieldloom-app';

export function catalogEntry(symbol) {
    const normalized = normalize(symbol);
    const verified = verifiedUnderlying(normalized);
    for (const [underlying, symbols] of Object.entries(catalog.relationships)) {
        if (symbols.includes(normalized)) return { symbol: normalized, underlying: verified?.underlying ?? underlying, comparisonEligible: !verified || verified.underlying === underlying };
    }
    return { symbol: normalized, underlying: verified?.underlying ?? null, comparisonEligible: false };
}

export function rivalOptions(entry) {
    if (!entry.underlying || !entry.comparisonEligible) return [];
    return (catalog.relationships[entry.underlying] ?? []).filter((symbol) => symbol !== entry.symbol);
}

const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
export function toBacktestData(events) {
    return (events ?? [])
        .map((event) => {
            const date = isoDate(event?.ex_date ?? event?.exDate);
            const amount = Number(event?.distribution_per_share ?? event?.amount?.raw ?? event?.amount);
            // An explicitly review-only record is not a confirmed dividend and must not power public share copy.
            const status = event?.verification_status ?? event?.verificationStatus;
            if (status && !['official', 'cross_checked'].includes(status)) return null;
            if (!date || !Number.isFinite(amount) || amount <= 0) return null;
            return { date, amount, amountFixed: amount };
        })
        .filter(Boolean)
        .sort((left, right) => left.date.localeCompare(right.date));
}

function requestOrigin(req) {
    const protocol = String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0];
    if (!host) throw new Error('공식 배당 원장 주소를 확인할 수 없습니다.');
    return `${protocol}://${host}`;
}

async function loadOfficialHistory(symbol, origin, fetcher = fetch) {
    const coreBase =
        process.env.DATA_RELEASE_BASE_URL ??
        process.env.VITE_DATA_RELEASE_BASE_URL;
    if (coreBase) {
        const { loadCoreHistory } = await import('../lib/core-release.js');
        return loadCoreHistory(symbol, coreBase, fetcher);
    }
    const indexRow = distributions.get(symbol);
    if (
        !indexRow?.historyUrl ||
        !/^\/content-studio\/distribution-ticker-[a-z0-9.-]+\.json$/i.test(
            indexRow.historyUrl
        )
    )
        return [];
    const origins = [
        ...new Set(
            [
                origin,
                process.env.THUMBNAIL_OFFICIAL_DATA_BASE_URL,
                officialDataFallbackOrigin,
            ].filter(Boolean)
        ),
    ];
    let lastError;
    for (const dataOrigin of origins) {
        try {
            const url = new URL(
                indexRow.historyUrl.replace(/^\//, ''),
                `${String(dataOrigin).replace(/\/$/, '')}/`
            ).href;
            return await sourceCache(fetcher)(url, async () => {
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

function toPriceRows(history, events) {
    const officialAmounts = new Map(toBacktestData(events).map((event) => [event.date, event]));
    const rows = (history?.backtestData ?? [])
        .filter((row) => isoDate(row?.date) && !row.forecasted && Number.isFinite(Number(row.close)) && Number(row.close) > 0)
        .map((row) => {
            const date = isoDate(row.date);
            const event = officialAmounts.get(date);
            officialAmounts.delete(date);
            return { date, close: Number(row.close), ...(event ? { amount: event.amount, amountFixed: event.amountFixed } : {}) };
        });
    return [...rows, ...officialAmounts.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function loadPriceHistory(symbol, fetcher, baseUrl, historyKind, asOf) {
    const price = prices.get(symbol);
    const dataPath = price?.dataPath ?? pricePaths.get(symbol)?.dataPaths?.[0];
    if (
        !baseUrl ||
        !dataPath ||
        !/^data\/[a-z0-9_-]+\/[a-z0-9.-]+\.json$/i.test(dataPath)
    )
        return null;
    const url = new URL(dataPath, `${baseUrl}/`).href;
    const payload = await sourceCache(fetcher)(url, async () => {
        const response = await fetcher(url, {
            signal: AbortSignal.timeout(4000),
            headers: { Accept: 'application/json' },
        });
        if (!response.ok)
            throw new Error(`가격 projection을 불러오지 못했습니다: ${symbol}`);
        const payload = await response.json();
        if (!Array.isArray(payload.backtestData))
            throw new Error('Invalid price history');
        return payload;
    });
    const rows = actualPrices(payload, asOf);
    const cutoff = new Date(`${asOf.slice(0, 7)}-01T00:00:00Z`);
    cutoff.setUTCMonth(
        cutoff.getUTCMonth() - (historyKind === 'comparison-1y' ? 13 : 37)
    );
    const marketCap =
        payload.tickerInfo?.marketCap ??
        [...(payload.backtestData ?? [])]
            .reverse()
            .find(
                (row) =>
                    !row.forecasted &&
                    row.date <= asOf &&
                    Number(row.marketCap) > 0
            )?.marketCap;
    return {
        ...payload,
        tickerInfo: { ...payload.tickerInfo, marketCap },
        backtestData: rows.filter(
            (row) => row.date >= cutoff.toISOString().slice(0, 10)
        ),
    };
}

const latestClose = (rows) => [...rows].reverse().find((row) => Number.isFinite(Number(row.close)) && Number(row.close) > 0) ?? null;

async function fetchTicker(symbol, origin, options = {}) {
    const key = normalize(symbol);
    const fetcher = options.fetcher ?? fetch;
    const baseUrl = options.priceDataBaseUrl ?? priceDataBaseUrl();
    const projectionBase = options.projectionBaseUrl ?? process.env.THUMBNAIL_PROJECTION_BASE_URL ?? '';
    const historyKind = options.historyKind ?? 'entry-efficiency';
    const cacheKey = `${key}|${origin}|${baseUrl}|${projectionBase}|${historyKind}`;
    const cached = fetcher === fetch && cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const instrument = instruments.get(key) ?? pricePaths.get(key);
    const indexRow = distributions.get(key);
    let priceError;
    const [historyResult, priceResult] = await Promise.allSettled([
        loadOfficialHistory(key, origin, fetcher),
        (async () => {
            const projection = await loadProjection(key, projectionBase, fetcher, historyKind).catch(() => null);
            if (projection) {
                if (!projection.tickerInfo?.marketCap) {
                    const legacy = await loadPriceHistory(key, fetcher, baseUrl, historyKind, options.asOfDate ?? new Date().toISOString().slice(0, 10)).catch(() => null);
                    projection.tickerInfo.marketCap = legacy?.tickerInfo?.marketCap ?? null;
                }
                return projection;
            }
            const legacy = await loadPriceHistory(key, fetcher, baseUrl, historyKind, options.asOfDate ?? new Date().toISOString().slice(0, 10)).catch(() => null);
            if (legacy?.backtestData?.some(row => !row.forecasted && Number(row.close) > 0)) return { ...legacy, source: 'r2_projection' };
            return loadYahooQuote(key, fetcher);
        })(),
    ]);
    const history = historyResult.status === 'fulfilled' ? historyResult.value : [];
    const priceHistory = priceResult.status === 'fulfilled' ? priceResult.value : null;
    if (priceResult.status === 'rejected') priceError = priceResult.reason;
    const backtestData = priceHistory ? toPriceRows(priceHistory, history) : toBacktestData(history);
    const latest = latestClose(backtestData);
    const currentPrice = priceHistory?.price ?? latest?.close ?? null;
    const priceDate = priceHistory?.priceDate ?? latest?.date ?? null;
    const reviewSplits = (priceHistory?.tickerInfo?.events?.splits ?? []).some(event => event.date >= priceHistory?.backtestData?.[0]?.date && event.date <= (options.asOfDate ?? new Date().toISOString().slice(0, 10)));
    const value = {
        symbol: key,
        tickerInfo: {
            symbol: key,
            longName: instrument?.longName ?? instrument?.koName ?? priceHistory?.tickerInfo?.longName ?? null,
            currency: instrument?.currency ?? priceHistory?.tickerInfo?.currency ?? indexRow?.latest?.currency ?? null,
            market: instrument?.market ?? priceHistory?.tickerInfo?.market ?? null,
            marketCap: priceHistory?.tickerInfo?.marketCap ?? null,
            regularMarketPrice: currentPrice,
            price: currentPrice,
        },
        backtestData,
        sourceStatus: {
            dividends: historyResult.status === 'rejected' ? 'unavailable' : history.length ? 'official_projection' : 'none',
            dividendSourceUrl: indexRow?.historyUrl ?? null,
            price: priceHistory?.source ?? 'unavailable',
            priceDate,
            quoteTime: priceHistory?.quoteTime ?? null,
            priceErrorCode: priceError?.statusCode ?? null,
            corporateActionReview: reviewSplits,
            adjustmentBasis: priceHistory?.adjustmentBasis ?? 'upstream_unverified',
            asOf: new Date().toISOString(),
            freshness: currentPrice ? (historyResult.status === 'rejected' ? 'partial' : priceFreshness(priceDate, options.asOfDate)) : 'partial',
        },
    };
    if (fetcher === fetch) {
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value;
}

export function loadTicker(symbol, origin, options = {}) {
    if (options.fetcher && options.fetcher !== fetch) return fetchTicker(symbol, origin, options);
    const key = JSON.stringify([normalize(symbol), origin, options.priceDataBaseUrl, options.projectionBaseUrl, options.historyKind]);
    if (!inFlight.has(key)) {
        const pending = fetchTicker(symbol, origin, options).finally(() => inFlight.delete(key));
        inFlight.set(key, pending);
    }
    return inFlight.get(key);
}

export async function loadTickerWithSnapshot(symbol, origin, options = {}) {
    const readSnapshot = options.readSnapshot ?? readTickerSnapshot;
    const writeSnapshot = options.writeSnapshot ?? writeTickerSnapshot;
    try {
        const value = await loadTicker(symbol, origin, options);
        if (value.sourceStatus.price === 'unavailable') {
            const snapshot = await readSnapshot(symbol).catch((error) => {
                console.warn(`Snapshot read failed for ${symbol}`, error.message);
                return null;
            });
            if (snapshot?.value && ['r2_projection', 'thumbnail_projection', 'yahoo_quote'].includes(snapshot.value.sourceStatus?.price)) {
                return { ...snapshot.value, sourceStatus: { ...(snapshot.value.sourceStatus ?? {}), freshness: 'stale', staleSince: snapshot.savedAt, reason: 'price_source_unavailable' } };
            }
        }
        // Snapshot persistence is optional locally, but mandatory where R2 credentials exist.
        await writeSnapshot(symbol, value).catch((error) => console.warn(`Snapshot write failed for ${symbol}`, error.message));
        return value;
    } catch (error) {
        const snapshot = await readSnapshot(symbol).catch((snapshotError) => {
            console.warn(`Snapshot read failed for ${symbol}`, snapshotError.message);
            return null;
        });
        if (!snapshot?.value) throw error;
        return {
            ...snapshot.value,
            sourceStatus: {
                ...(snapshot.value.sourceStatus ?? {}),
                freshness: 'stale',
                staleSince: snapshot.savedAt,
                reason: 'live_source_unavailable',
            },
        };
    }
}

export async function buildThumbnailPayload(ticker, requestedRivals, loader) {
    const entry = catalogEntry(ticker);
    const allowed = new Set(rivalOptions(entry));
    const activeLoader = loader ?? ((symbol) => loadTickerWithSnapshot(symbol, 'http://localhost'));
    const candidates = new Map();
    let defaults = [...allowed];
    if (requestedRivals == null && defaults.length > 3) {
        await Promise.all(defaults.map(async symbol => {
            candidates.set(symbol, await activeLoader(symbol).catch(() => null));
        }));
        const cap = symbol => {
            const value = Number(candidates.get(symbol)?.tickerInfo?.marketCap);
            return Number.isFinite(value) && value > 0 ? value : 0;
        };
        defaults.sort((a, b) => cap(b) - cap(a));
    }
    const rivals = [...new Set((requestedRivals ?? defaults).map(normalize))].filter((symbol) => allowed.has(symbol)).slice(0, 3);
    const symbols = [entry.symbol, ...rivals, ...(entry.underlying && rivals.length ? [entry.underlying] : [])];
    const settled = await Promise.allSettled(symbols.map(symbol => candidates.has(symbol) ? Promise.resolve(candidates.get(symbol)) : activeLoader(symbol)));
    const loaded = Object.fromEntries(symbols.map((symbol, index) => [symbol, settled[index].status === 'fulfilled' ? settled[index].value : null]));
    const unavailable = symbols.filter((symbol) => !loaded[symbol] || (loaded[symbol].tickerInfo?.price == null && !(loaded[symbol].backtestData ?? []).some(row => row.amount)));
    if (!loaded[entry.symbol]) throw new PriceError(`종목 데이터를 불러올 수 없습니다: ${entry.symbol}`);
    if (loaded[entry.symbol].sourceStatus?.price === 'unavailable' && !loaded[entry.symbol].backtestData?.length) {
        throw new PriceError('종목 시세를 확인할 수 없습니다.', loaded[entry.symbol].sourceStatus.priceErrorCode ?? 503);
    }
    const instrument = instruments.get(entry.symbol);
    const seriesStatus = Object.fromEntries(symbols.map((symbol) => [symbol, loaded[symbol]?.sourceStatus ?? { freshness: 'unavailable' }]));
    const freshness = Object.values(seriesStatus).some((status) => status.freshness === 'stale') ? 'stale' : unavailable.length ? 'partial' : loaded[entry.symbol].sourceStatus?.freshness ?? 'fresh';
    return { ticker: loaded[entry.symbol], catalog: { ...entry, company: instrument?.officialProvider ?? null }, rivalOptions: rivalOptions(entry), rivals, series: Object.fromEntries(Object.entries(loaded).filter(([symbol]) => symbol !== entry.symbol)), partial: unavailable.length > 0, unavailable, dataStatus: freshness, seriesStatus };
}

async function handler(req, res) {
    const ticker = normalize(req.query.ticker);
    if (!validSymbol(ticker)) return res.status(400).json({ error: 'A valid ticker is required.' });
    const rivals = req.query.rivals == null ? undefined : String(req.query.rivals).split(',').filter(Boolean);
    const origin = requestOrigin(req);
    let payload;
    try {
        payload = await buildThumbnailPayload(ticker, rivals, (symbol) => loadTickerWithSnapshot(symbol, origin, { historyKind: symbol === ticker ? 'entry-efficiency' : 'comparison-1y' }));
    } catch (error) {
        if (error instanceof PriceError) return res.status(error.statusCode).json({ error: error.message });
        throw error;
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(payload);
}

// This endpoint only returns public market data; it never reads a session or
// returns account data. Stable anonymous CORS also applies to cached responses.
export default createApiHandler(handler, { publicCors: true });
