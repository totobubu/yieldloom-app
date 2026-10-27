import { isDelisted, securityStatus } from '../lib/security-status.js';
import { loadTickerWithSnapshot } from './thumbnail-data.js';
import { createApiHandler } from '../lib/api-handler.js';
import { normalizeSymbol, validSymbol } from '../lib/thumbnail-projection.js';
import { fetchJson, PriceError } from '../lib/thumbnail-prices.js';
import { createTransportCache } from '../lib/request-cache.js';
import { configuredCandleLedger } from '../lib/candle-ledger.js';
import catalog from '../data-v2/catalog-seed.json' with { type: 'json' };

const identities = new Map(catalog.instruments.map(row => [row.symbol, row]));
const exchangeMarkets = { NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ', NYQ: 'NYSE', PCX: 'NYSEARCA', ASE: 'NYSEAMERICAN', BATS: 'BATS' };
export function verifiedCandleIdentity(symbol, meta, instrument = identities.get(symbol)) {
    const equivalent = value => normalizeSymbol(value).replace(/\.([AB])$/, '-$1');
    if (!instrument?.isin || instrument.active === false || equivalent(meta?.symbol) !== equivalent(symbol)
        || meta.currency !== instrument.currency || exchangeMarkets[meta.exchangeName] !== instrument.market) return null;
    return { symbol, isin: instrument.isin, market: instrument.market, currency: instrument.currency,
        ipoDate: instrument.ipoDate ?? null };
}

const publicLedger = (value, stale = false) => ({
    symbol: value.symbol, currency: value.currency, timezone: value.timezone, source: value.source,
    candles: value.candles, events: value.events, asOf: value.asOf,
    persistence: 'stored', stale, coverage: value.coverage,
    collection: value.collectionRequest,
});

export function createStockCandleLoader({ getLedger = configuredCandleLedger, resolveIdentity = verifiedCandleIdentity } = {}) {
    const cache = createTransportCache({ ttlMs: 300_000, maxEntries: 200 });
    return (symbol, fetcher = fetch) => {
        const ticker = normalizeSymbol(symbol);
        if (!validSymbol(ticker)) return Promise.reject(new PriceError('올바른 티커를 입력해 주세요.', 400));
        return cache(fetcher)(ticker, async () => {
            const ledger = isDelisted(ticker) ? null : getLedger();
            let saved;
            if (ledger) saved = await ledger.read(ticker);
            let live;
            try { live = await fetchStockCandles(ticker, fetcher); }
            catch (error) {
                if (saved?.value?.candles?.length) return publicLedger(saved.value, true);
                throw error;
            }
            const { rawObservation, ...value } = live;
            if (!ledger) return { ...value, persistence: 'disabled' };
            const identity = resolveIdentity(ticker, rawObservation?.chart?.result?.[0]?.meta);
            if (!identity) {
                if (saved?.value?.candles?.length) return { ...publicLedger(saved.value, true), collectionError: 'identity_unverified' };
                return { ...value, persistence: 'identity_unverified' };
            }
            try { return publicLedger(await ledger.append(value, identity, rawObservation)); }
            catch {
                return { ...(saved?.value ? publicLedger(saved.value, true) : value), persistence: 'write_failed' };
            }
        });
    };
}

export const loadStockCandles = createStockCandleLoader();
async function fetchStockCandles(symbol, fetcher) {
    const ticker = normalizeSymbol(symbol);
    if (!validSymbol(ticker))
        throw new PriceError('올바른 티커를 입력해 주세요.', 400);
    if (isDelisted(ticker)) {
        const archive = await loadTickerWithSnapshot(ticker, process.env.THUMBNAIL_OFFICIAL_DATA_BASE_URL ?? 'https://totobubu.github.io/yieldloom-app', { fetcher });
        return {
            symbol: ticker, currency: archive.tickerInfo.currency, source: '상장폐지 · 과거 자료',
            listingStatus: securityStatus(ticker),
            candles: archive.backtestData.filter(row => Number(row.close) > 0),
            events: [], asOf: archive.sourceStatus.priceDate,
        };
    }
    const yahooSymbol = /^[A-Z]+\.[AB]$/.test(ticker)
        ? ticker.replace('.', '-')
        : ticker;
    let payload;
    for (const host of [
        'query1.finance.yahoo.com',
        'query2.finance.yahoo.com',
    ]) {
        try {
            payload = await fetchJson(
                `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=2y&interval=1d&events=div%2Csplits`,
                (url, init) =>
                    fetcher(url, {
                        ...init,
                        headers: {
                            ...init.headers,
                            'User-Agent': 'Mozilla/5.0',
                        },
                    }),
                6000
            );
            break;
        } catch (error) {
            if (error.statusCode === 404)
                throw new PriceError('일봉 데이터를 찾을 수 없습니다.', 404);
            if (host.startsWith('query2'))
                throw new PriceError(
                    '일봉 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
                );
        }
    }
    const result = payload.chart?.result?.[0];
    if (!result) throw new PriceError('일봉 데이터를 찾을 수 없습니다.', 404);
    const quote = result.indicators?.quote?.[0] ?? {};
    const zone = result.meta?.exchangeTimezoneName ?? 'America/New_York';
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const byDate = new Map();
    (result.timestamp ?? []).forEach((timestamp, index) => {
        if (!Number.isFinite(timestamp) || timestamp * 1000 > Date.now())
            return;
        const values = ['open', 'high', 'low', 'close'].map(
            (key) => quote[key]?.[index]
        );
        if (
            values.some(
                (value) =>
                    value == null || !Number.isFinite(value) || value <= 0
            )
        )
            return;
        const [open, high, low, close] = values;
        if (
            high < Math.max(open, close) ||
            low > Math.min(open, close) ||
            low > high
        )
            return;
        const date = formatter.format(new Date(timestamp * 1000));
        const volume = quote.volume?.[index];
        byDate.set(date, {
            date,
            open,
            high,
            low,
            close,
            volume: Number.isFinite(volume) && volume >= 0 ? volume : null,
        });
    });
    const candles = [...byDate.values()].sort((a, b) =>
        a.date.localeCompare(b.date)
    );
    if (!candles.length)
        throw new PriceError('확인 가능한 일봉 데이터가 없습니다.');
    const value = {
        symbol: ticker,
        currency: result.meta?.currency ?? null,
        timezone: zone,
        source: 'Yahoo Finance',
        candles,
        events: [
            ...Object.values(result.events?.splits ?? {})
                .filter(
                    (row) =>
                        Number.isFinite(row.date) &&
                        row.date * 1000 <= Date.now()
                )
                .map((row) => ({
                    date: formatter.format(new Date(row.date * 1000)),
                    kind: 'split',
                    label: `분할 ${row.splitRatio || `${row.numerator}:${row.denominator}`}`,
                })),
        ],
        asOf: new Date().toISOString(),
    };
    return { ...value, rawObservation: payload };
}

export default createApiHandler(
    async (req, res) => {
        try {
            const payload = await loadStockCandles(req.query.ticker);
            res.setHeader(
                'Cache-Control',
                's-maxage=300, stale-while-revalidate=600'
            );
            return res.status(200).json(payload);
        } catch (error) {
            return res
                .status(error instanceof PriceError ? error.statusCode : 503)
                .json({
                    error:
                        error instanceof PriceError
                            ? error.message
                            : '일봉 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
                });
        }
    },
    { publicCors: true }
);
