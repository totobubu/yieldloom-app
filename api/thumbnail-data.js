import yahooFinance from '../lib/yahooFinanceClient.js';
import catalog from '../public/thumbnail-catalog.json' with { type: 'json' };
import { createApiHandler } from './_utils/api-handler.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const normalize = (value) => String(value ?? '').trim().toUpperCase().replace(/\./g, '-');
const yahooSymbol = (value) => String(value ?? '').trim().toUpperCase().replace(/-/g, '.');

export function catalogEntry(symbol) {
    const normalized = normalize(symbol);
    for (const [underlying, symbols] of Object.entries(catalog.relationships)) {
        if (symbols.includes(normalized)) return { symbol: normalized, underlying, comparisonEligible: true };
    }
    return { symbol: normalized, underlying: null, comparisonEligible: false };
}

export function rivalOptions(entry) {
    if (!entry.underlying || !entry.comparisonEligible) return [];
    return (catalog.relationships[entry.underlying] ?? []).filter((symbol) => symbol !== entry.symbol);
}

const day = (value) => new Date(value).toISOString().slice(0, 10);
export function toBacktestData(prices, dividends) {
    const amounts = new Map((dividends ?? []).filter((row) => row?.date && Number(row.dividends) > 0).map((row) => [day(row.date), Number(row.dividends)]));
    return (prices ?? []).filter((row) => row?.date && Number(row.close) > 0).map((row) => {
        const date = day(row.date);
        const amount = amounts.get(date);
        return { date, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, ...(amount == null ? {} : { amount, amountFixed: amount }) };
    });
}

async function loadTicker(symbol) {
    const key = normalize(symbol);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const yahoo = yahooSymbol(key);
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const [quoteResult, pricesResult, dividendsResult] = await Promise.allSettled([
        yahooFinance.quote(yahoo),
        yahooFinance.historical(yahoo, { period1: fiveYearsAgo.toISOString().slice(0, 10), interval: '1d' }),
        yahooFinance.historical(yahoo, { period1: fiveYearsAgo.toISOString().slice(0, 10), events: 'dividends' }),
    ]);
    const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
    const prices = pricesResult.status === 'fulfilled' ? pricesResult.value : [];
    const dividends = dividendsResult.status === 'fulfilled' ? dividendsResult.value : [];
    if (!quote && !prices.length) throw new Error(`Yahoo returned no usable data for ${key}`);
    const value = { symbol: key, tickerInfo: { symbol: quote?.symbol ?? key, longName: quote?.longName ?? quote?.shortName ?? null, currency: quote?.currency ?? null, market: quote?.exchange ?? null, regularMarketPrice: quote?.regularMarketPrice ?? null, price: quote?.regularMarketPrice ?? null }, backtestData: toBacktestData(prices, dividends), sourceStatus: { quote: quoteResult.status, prices: pricesResult.status, dividends: dividendsResult.status } };
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
}

export async function buildThumbnailPayload(ticker, requestedRivals = [], loader = loadTicker) {
    const entry = catalogEntry(ticker);
    const allowed = new Set(rivalOptions(entry));
    const rivals = requestedRivals.map(normalize).filter((symbol) => allowed.has(symbol)).slice(0, 3);
    const symbols = [entry.symbol, ...rivals, ...(entry.underlying ? [entry.underlying] : [])];
    const settled = await Promise.allSettled(symbols.map(loader));
    const loaded = Object.fromEntries(symbols.map((symbol, index) => [symbol, settled[index].status === 'fulfilled' ? settled[index].value : null]));
    const unavailable = symbols.filter((symbol) => !loaded[symbol]);
    if (!loaded[entry.symbol]) throw new Error(`Yahoo 데이터를 불러올 수 없습니다: ${entry.symbol}`);
    return { ticker: loaded[entry.symbol], catalog: entry, rivalOptions: rivalOptions(entry), rivals, series: loaded, partial: unavailable.length > 0, unavailable };
}

async function handler(req, res) {
    const ticker = normalize(req.query.ticker);
    if (!/^[A-Z0-9.-]{1,15}$/.test(ticker)) return res.status(400).json({ error: 'A valid ticker is required.' });
    const rivals = String(req.query.rivals ?? '').split(',').filter(Boolean);
    const payload = await buildThumbnailPayload(ticker, rivals);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(payload);
}

export default createApiHandler(handler);
