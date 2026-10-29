import { loadStockEvidence } from '../lib/load-stock-evidence.js';
import { corporateActionReviewForPeriod } from '../lib/corporate-action-review.js';
import { mergeStockReference } from '../lib/stock-evidence.js';
import {
    applySecurityStatus,
    archiveTicker,
    isDelisted,
} from '../lib/security-status.js';
import {
    loadOfficialHistory,
    officialReleaseBase,
    officialHistoryReference,
} from '../lib/official-dividends.js';
import catalog from '../public/thumbnail-catalog.json' with { type: 'json' };
import coreCatalog from '../data-v2/catalog-seed.json' with { type: 'json' };
import discoveredStocks from '../public/us-dividend-stocks.json' with { type: 'json' };
import { mergeDiscoveredStocks } from '../lib/discovered-stocks.js';
import { verifiedUnderlying } from '../lib/security-underlyings.js';
import priceIndex from '../public/content-studio/price-index.json' with { type: 'json' };
import marketSources from '../data-v2/market-sources.json' with { type: 'json' };
import { createApiHandler } from '../lib/api-handler.js';
import { createTransportCache } from '../lib/request-cache.js';
import { readTickerSnapshot, writeTickerSnapshot } from '../lib/r2-snapshot.js';
import {
    loadProjection,
    loadYahooQuote,
    PriceError,
} from '../lib/thumbnail-prices.js';
import {
    normalizeSymbol,
    validSymbol,
    priceFreshness,
    actualPrices,
} from '../lib/thumbnail-projection.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const inFlight = new Map();
const sourceCache = createTransportCache({ ttlMs: 60_000 });
const normalize = normalizeSymbol;
const instruments = new Map(
    mergeDiscoveredStocks(coreCatalog.instruments, discoveredStocks).map(
        (instrument) => [normalize(instrument.symbol), instrument]
    )
);
const prices = new Map(
    Object.entries(priceIndex.prices ?? {}).map(([symbol, row]) => [
        normalize(symbol),
        row,
    ])
);
const pricePaths = new Map(
    marketSources.instruments.map((row) => [normalize(row.symbol), row])
);
const priceDataBaseUrl = () =>
    String(
        process.env.DIVGROW_DATA_BASE_URL ??
            process.env.THUMBNAIL_PRICE_DATA_BASE_URL ??
            process.env.VITE_R2_PUBLIC_URL ??
            ''
    ).replace(/\/$/, '');

export function catalogEntry(symbol) {
    const normalized = normalize(symbol);
    const verified = verifiedUnderlying(normalized);
    for (const [underlying, symbols] of Object.entries(catalog.relationships)) {
        if (symbols.includes(normalized))
            return {
                symbol: normalized,
                underlying: verified?.underlying ?? underlying,
                comparisonEligible:
                    !verified || verified.underlying === underlying,
            };
    }
    return {
        symbol: normalized,
        underlying: verified?.underlying ?? null,
        comparisonEligible: false,
    };
}

export function rivalOptions(entry) {
    if (isDelisted(entry) || !entry.underlying || !entry.comparisonEligible)
        return [];
    return (catalog.relationships[entry.underlying] ?? []).filter(
        (symbol) => symbol !== entry.symbol && !isDelisted(symbol)
    );
}

const isoDate = (value) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? value
        : null;
export function toBacktestData(events) {
    const selected = new Map();
    const rank = (status) =>
        status === 'cross_checked'
            ? 3
            : status === 'official'
              ? 2
              : status === 'needs_review'
                ? 0
                : 1;
    for (const event of events ?? []) {
        const date = isoDate(event?.ex_date ?? event?.exDate ?? event?.date);
        const raw =
            event?.distribution_per_share ??
            event?.amount?.raw ??
            event?.amount;
        const amount = raw == null || raw === '' ? NaN : Number(raw);
        const status = event?.verification_status ?? event?.verificationStatus;
        if (
            status &&
            !['official', 'cross_checked', 'needs_review'].includes(status)
        )
            continue;
        if (
            !date ||
            !Number.isFinite(amount) ||
            amount <= 0 ||
            event.forecasted
        )
            continue;
        const previous = selected.get(date);
        // Duplicate issuer captures are one payment. A verified capture wins;
        // otherwise retain the most recently declared capture, preserving first on ties.
        const declared =
            isoDate(event.declared_date ?? event.declaredDate) || '';
        if (
            previous &&
            (rank(previous.status) > rank(status) ||
                (rank(previous.status) === rank(status) &&
                    previous.declared >= declared))
        )
            continue;
        selected.set(date, {
            status,
            declared,
            row: {
                date,
                amount,
                amountFixed: amount,
                ...(status === 'needs_review'
                    ? {
                          verificationStatus: 'needs_review',
                          ...(event.source_class === 'public_aggregator'
                              ? { isReference: true }
                              : {}),
                          officialUrl:
                              event.official_url ?? event.officialUrl ?? null,
                          payableDate: isoDate(
                              event.payable_date ?? event.payableDate
                          ),
                      }
                    : {}),
            },
        });
    }
    return [...selected.values()]
        .map((value) => value.row)
        .sort((left, right) => left.date.localeCompare(right.date));
}

function requestOrigin(req) {
    const protocol = String(req.headers['x-forwarded-proto'] ?? 'https').split(
        ','
    )[0];
    const host = String(
        req.headers['x-forwarded-host'] ?? req.headers.host ?? ''
    ).split(',')[0];
    if (!host) throw new Error('공식 배당 원장 주소를 확인할 수 없습니다.');
    return `${protocol}://${host}`;
}

function toPriceRows(history, events) {
    const officialAmounts = new Map(
        toBacktestData(events).map((event) => [event.date, event])
    );
    const rows = (history?.backtestData ?? [])
        .filter(
            (row) =>
                isoDate(row?.date) &&
                !row.forecasted &&
                Number.isFinite(Number(row.close)) &&
                Number(row.close) > 0
        )
        .map((row) => {
            const date = isoDate(row.date);
            const event = officialAmounts.get(date);
            officialAmounts.delete(date);
            return {
                date,
                close: Number(row.close),
                ...(event || {}),
            };
        });
    return [...rows, ...officialAmounts.values()].sort((left, right) =>
        left.date.localeCompare(right.date)
    );
}

async function loadPriceHistory(symbol, fetcher, baseUrl, historyKind, asOf) {
    const price = prices.get(symbol);
    const dataPath = price?.dataPath ?? pricePaths.get(symbol)?.dataPath;
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
            (row) =>
                isDelisted(symbol) ||
                row.date >= cutoff.toISOString().slice(0, 10)
        ),
    };
}

const latestClose = (rows) =>
    [...rows]
        .reverse()
        .find(
            (row) => Number.isFinite(Number(row.close)) && Number(row.close) > 0
        ) ?? null;

async function fetchTicker(symbol, origin, options = {}) {
    const key = normalize(symbol);
    const fetcher = options.fetcher ?? fetch;
    const baseUrl = options.priceDataBaseUrl ?? priceDataBaseUrl();
    const projectionBase =
        options.projectionBaseUrl ??
        process.env.THUMBNAIL_PROJECTION_BASE_URL ??
        '';
    const historyKind = options.historyKind ?? 'entry-efficiency';
    const cacheKey = `${key}|${origin}|${baseUrl}|${projectionBase}|${historyKind}|${officialReleaseBase()}`;
    const cached = fetcher === fetch && cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const instrument = instruments.get(key) ?? pricePaths.get(key);
    let priceError;
    const [historyResult, priceResult, evidenceResult] =
        await Promise.allSettled([
            loadOfficialHistory(key, origin, fetcher),
            (async () => {
                if (isDelisted(key)) {
                    const archive = await loadPriceHistory(
                        key,
                        fetcher,
                        baseUrl,
                        historyKind,
                        options.asOfDate ??
                            new Date().toISOString().slice(0, 10)
                    ).catch(() => null);
                    if (archive) return { ...archive, source: 'r2_projection' };
                    return loadProjection(
                        key,
                        projectionBase,
                        fetcher,
                        historyKind
                    ).catch(() => null);
                }
                const projection = await loadProjection(
                    key,
                    projectionBase,
                    fetcher,
                    historyKind
                ).catch(() => null);
                if (projection) {
                    if (!projection.tickerInfo?.marketCap) {
                        const legacy = await loadPriceHistory(
                            key,
                            fetcher,
                            baseUrl,
                            historyKind,
                            options.asOfDate ??
                                new Date().toISOString().slice(0, 10)
                        ).catch(() => null);
                        projection.tickerInfo.marketCap =
                            legacy?.tickerInfo?.marketCap ?? null;
                    }
                    return projection;
                }
                const legacy = await loadPriceHistory(
                    key,
                    fetcher,
                    baseUrl,
                    historyKind,
                    options.asOfDate ?? new Date().toISOString().slice(0, 10)
                ).catch(() => null);
                if (
                    legacy?.backtestData?.some(
                        (row) => !row.forecasted && Number(row.close) > 0
                    )
                )
                    return { ...legacy, source: 'r2_projection' };
                return loadYahooQuote(key, fetcher);
            })(),
            (options.stockEvidenceLoader ?? loadStockEvidence)(
                key,
                origin,
                fetcher
            ),
        ]);
    const evidence =
        evidenceResult.status === 'fulfilled' ? evidenceResult.value : null;
    const history =
        historyResult.status === 'fulfilled'
            ? mergeStockReference(historyResult.value, evidence?.history)
            : [];
    let priceHistory =
        priceResult.status === 'fulfilled' ? priceResult.value : null;
    if (priceResult.status === 'rejected') priceError = priceResult.reason;
    const stockPrice = evidence?.candles?.at(-1);
    const existingPriceDate =
        priceHistory?.priceDate ??
        latestClose(priceHistory?.backtestData ?? [])?.date;
    if (
        stockPrice &&
        (!existingPriceDate || stockPrice.date >= existingPriceDate)
    ) {
        const rows = new Map(
            (priceHistory?.backtestData ?? []).map((row) => [row.date, row])
        );
        for (const row of evidence.candles)
            rows.set(row.date, { ...row, close: Number(row.close) });
        priceHistory = {
            ...priceHistory,
            backtestData: [...rows.values()].sort((a, b) =>
                a.date.localeCompare(b.date)
            ),
            tickerInfo: {
                ...priceHistory?.tickerInfo,
                currency: evidence.currency,
            },
            price: Number(stockPrice.close),
            priceDate: stockPrice.date,
            source: 'stock_reference',
            adjustmentBasis: 'upstream_unverified',
        };
    }

    const backtestData = priceHistory
        ? toPriceRows(priceHistory, history)
        : toBacktestData(history);
    const latest = latestClose(backtestData);
    const currentPrice = priceHistory?.price ?? latest?.close ?? null;
    const priceDate = priceHistory?.priceDate ?? latest?.date ?? null;
    const corporateActionDates = [
        ...new Set(
            [
                ...(priceHistory?.tickerInfo?.events?.splits ?? []),
                ...(evidence?.splits ?? []),
            ].map((event) => event.date ?? null)
        ),
    ].sort();
    const reviewSplits = corporateActionReviewForPeriod(
        { corporateActionDates },
        priceHistory?.backtestData?.[0]?.date ?? backtestData[0]?.date,
        options.asOfDate ?? new Date().toISOString().slice(0, 10)
    );
    const value = {
        symbol: key,
        tickerInfo: {
            symbol: key,
            longName:
                instrument?.longName ??
                instrument?.koName ??
                priceHistory?.tickerInfo?.longName ??
                null,
            currency:
                instrument?.currency ??
                priceHistory?.tickerInfo?.currency ??
                null,
            market:
                instrument?.market ?? priceHistory?.tickerInfo?.market ?? null,
            marketCap: priceHistory?.tickerInfo?.marketCap ?? null,
            regularMarketPrice: currentPrice,
            price: currentPrice,
        },
        backtestData,
        collectionCoverage: priceHistory?.collectionCoverage ?? null,
        issuerAnnouncements: evidence?.announcements ?? [],
        stockReferenceHistory: evidence?.history ?? null,
        stockCollection: evidence?.result ?? null,
        sourceStatus: {
            dividends:
                historyResult.status === 'rejected' ||
                evidenceResult.status === 'rejected'
                    ? 'unavailable'
                    : evidence?.history?.length && !historyResult.value.length
                      ? 'reference_observations'
                      : history.length
                        ? 'official_projection'
                        : 'none',
            dividendSourceUrl:
                officialHistoryReference(key) ?? evidence?.sourceUrl,
            stockEvidence:
                evidenceResult.status === 'rejected'
                    ? 'unavailable'
                    : evidence
                      ? 'collected'
                      : 'none',
            dividendReviewCount: backtestData.filter(
                (row) => row.verificationStatus === 'needs_review'
            ).length,
            price: priceHistory?.source ?? 'unavailable',
            priceDate,
            quoteTime: priceHistory?.quoteTime ?? null,
            priceErrorCode: priceError?.statusCode ?? null,
            corporateActionReview: reviewSplits,
            corporateActionDates,
            adjustmentBasis:
                priceHistory?.adjustmentBasis ?? 'upstream_unverified',
            asOf: new Date().toISOString(),
            freshness: currentPrice
                ? historyResult.status === 'rejected' ||
                  evidenceResult.status === 'rejected' ||
                  (evidence && evidence.result?.status !== 'success')
                    ? 'partial'
                    : priceFreshness(priceDate, options.asOfDate)
                : 'partial',
        },
    };
    if (fetcher === fetch) {
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value;
}

export function loadTicker(symbol, origin, options = {}) {
    if (options.fetcher && options.fetcher !== fetch)
        return fetchTicker(symbol, origin, options).then(archiveTicker);
    const key = JSON.stringify([
        normalize(symbol),
        origin,
        options.priceDataBaseUrl,
        options.projectionBaseUrl,
        options.historyKind,
        officialReleaseBase(),
    ]);
    if (!inFlight.has(key)) {
        const pending = fetchTicker(symbol, origin, options).finally(() =>
            inFlight.delete(key)
        );
        inFlight.set(key, pending);
    }
    return inFlight.get(key).then(archiveTicker);
}

function mergeArchiveRows(previous = [], current = []) {
    const rows = new Map();
    for (const row of [...previous, ...current]) {
        if (!row.forecasted)
            rows.set(row.date, { ...rows.get(row.date), ...row });
    }
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function tickerWithSnapshot(symbol, origin, options = {}) {
    const readSnapshot = options.readSnapshot ?? readTickerSnapshot;
    const writeSnapshot = options.writeSnapshot ?? writeTickerSnapshot;
    try {
        const value = await loadTicker(symbol, origin, options);
        if (
            value.sourceStatus.price === 'unavailable' ||
            (isDelisted(symbol) && value.tickerInfo.price == null)
        ) {
            const snapshot = await readSnapshot(symbol).catch((error) => {
                console.warn(
                    `Snapshot read failed for ${symbol}`,
                    error.message
                );
                return null;
            });
            if (
                snapshot?.value &&
                (isDelisted(symbol) ||
                    [
                        'r2_projection',
                        'thumbnail_projection',
                        'yahoo_quote',
                        'stock_reference',
                    ].includes(snapshot.value.sourceStatus?.price))
            ) {
                return {
                    ...snapshot.value,
                    backtestData: isDelisted(symbol)
                        ? mergeArchiveRows(
                              snapshot.value.backtestData,
                              value.backtestData
                          )
                        : value.sourceStatus.dividends !== 'unavailable'
                          ? toPriceRows(snapshot.value, value.backtestData)
                          : snapshot.value.backtestData,
                    sourceStatus: {
                        ...(snapshot.value.sourceStatus ?? {}),
                        ...(value.sourceStatus.dividends !== 'unavailable'
                            ? {
                                  dividends: value.sourceStatus.dividends,
                                  dividendSourceUrl:
                                      value.sourceStatus.dividendSourceUrl,
                                  dividendReviewCount:
                                      value.sourceStatus.dividendReviewCount,
                              }
                            : {}),
                        freshness: 'stale',
                        staleSince: snapshot.savedAt,
                        reason: 'price_source_unavailable',
                    },
                };
            }
        }
        // Snapshot persistence is optional locally, but mandatory where R2 credentials exist.
        if (!isDelisted(symbol))
            await writeSnapshot(symbol, value).catch((error) =>
                console.warn(
                    `Snapshot write failed for ${symbol}`,
                    error.message
                )
            );
        return value;
    } catch (error) {
        const snapshot = await readSnapshot(symbol).catch((snapshotError) => {
            console.warn(
                `Snapshot read failed for ${symbol}`,
                snapshotError.message
            );
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

export async function loadTickerWithSnapshot(symbol, origin, options = {}) {
    return archiveTicker(await tickerWithSnapshot(symbol, origin, options));
}

export async function buildThumbnailPayload(ticker, requestedRivals, loader) {
    const entry = catalogEntry(ticker);
    const allowed = new Set(rivalOptions(entry));
    const activeLoader =
        loader ??
        ((symbol) => loadTickerWithSnapshot(symbol, 'http://localhost'));
    const candidates = new Map();
    let defaults = [...allowed];
    if (requestedRivals == null && defaults.length > 3) {
        await Promise.all(
            defaults.map(async (symbol) => {
                candidates.set(
                    symbol,
                    await activeLoader(symbol).catch(() => null)
                );
            })
        );
        const cap = (symbol) => {
            const value = Number(candidates.get(symbol)?.tickerInfo?.marketCap);
            return Number.isFinite(value) && value > 0 ? value : 0;
        };
        defaults.sort((a, b) => cap(b) - cap(a));
    }
    const rivals = [...new Set((requestedRivals ?? defaults).map(normalize))]
        .filter((symbol) => allowed.has(symbol))
        .slice(0, 3);
    const symbols = [
        entry.symbol,
        ...rivals,
        ...(entry.underlying && rivals.length ? [entry.underlying] : []),
    ];
    const settled = await Promise.allSettled(
        symbols.map((symbol) =>
            candidates.has(symbol)
                ? Promise.resolve(candidates.get(symbol))
                : activeLoader(symbol)
        )
    );
    const loaded = Object.fromEntries(
        symbols.map((symbol, index) => [
            symbol,
            settled[index].status === 'fulfilled' && settled[index].value
                ? archiveTicker(settled[index].value)
                : null,
        ])
    );
    const unavailable = symbols.filter(
        (symbol) =>
            !loaded[symbol] ||
            (loaded[symbol].tickerInfo?.price == null &&
                !(loaded[symbol].backtestData ?? []).some((row) => row.amount))
    );
    if (!loaded[entry.symbol])
        throw new PriceError(
            `종목 데이터를 불러올 수 없습니다: ${entry.symbol}`
        );
    if (
        !isDelisted(entry) &&
        loaded[entry.symbol].sourceStatus?.price === 'unavailable' &&
        !loaded[entry.symbol].backtestData?.length
    ) {
        throw new PriceError(
            '종목 시세를 확인할 수 없습니다.',
            loaded[entry.symbol].sourceStatus.priceErrorCode ?? 503
        );
    }
    const instrument = instruments.get(entry.symbol);
    const seriesStatus = Object.fromEntries(
        symbols.map((symbol) => [
            symbol,
            loaded[symbol]?.sourceStatus ?? { freshness: 'unavailable' },
        ])
    );
    const freshness = Object.values(seriesStatus).some(
        (status) => status.freshness === 'stale'
    )
        ? 'stale'
        : unavailable.length
          ? 'partial'
          : (loaded[entry.symbol].sourceStatus?.freshness ?? 'fresh');
    return {
        ticker: loaded[entry.symbol],
        catalog: applySecurityStatus({
            ...instrument,
            ...entry,
            company: instrument?.officialProvider ?? null,
        }),
        rivalOptions: rivalOptions(entry),
        rivals,
        series: Object.fromEntries(
            Object.entries(loaded).filter(([symbol]) => symbol !== entry.symbol)
        ),
        partial: unavailable.length > 0,
        unavailable,
        dataStatus: isDelisted(entry) ? 'archived' : freshness,
        seriesStatus,
    };
}

async function handler(req, res) {
    const ticker = normalize(req.query.ticker);
    if (!validSymbol(ticker))
        return res.status(400).json({ error: 'A valid ticker is required.' });
    const rivals =
        req.query.rivals == null
            ? undefined
            : String(req.query.rivals).split(',').filter(Boolean);
    const origin = requestOrigin(req);
    let payload;
    try {
        payload = await buildThumbnailPayload(ticker, rivals, (symbol) =>
            loadTickerWithSnapshot(symbol, origin, {
                historyKind:
                    symbol === ticker ? 'entry-efficiency' : 'comparison-1y',
            })
        );
    } catch (error) {
        if (error instanceof PriceError)
            return res.status(error.statusCode).json({ error: error.message });
        throw error;
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(payload);
}

// This endpoint only returns public market data; it never reads a session or
// returns account data. Stable anonymous CORS also applies to cached responses.
export default createApiHandler(handler, { publicCors: true });
