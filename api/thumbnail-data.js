import catalog from '../public/thumbnail-catalog.json' with { type: 'json' };
import coreCatalog from '../data-v2/catalog-seed.json' with { type: 'json' };
import distributionIndex from '../public/content-studio/distribution-index.json' with { type: 'json' };
import { createApiHandler } from '../lib/api-handler.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();
const normalize = (value) => String(value ?? '').trim().toUpperCase().replace(/\./g, '-');
const instruments = new Map(coreCatalog.instruments.map((instrument) => [normalize(instrument.symbol), instrument]));
const distributions = new Map((distributionIndex.tickers ?? []).map((row) => [normalize(row.ticker), row]));

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

const isoDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
export function toBacktestData(events) {
    return (events ?? [])
        .map((event) => {
            const date = isoDate(event?.ex_date ?? event?.exDate);
            const amount = Number(event?.distribution_per_share ?? event?.amount?.raw ?? event?.amount);
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

async function loadOfficialHistory(symbol, origin) {
    const indexRow = distributions.get(symbol);
    if (!indexRow?.historyUrl || !/^\/content-studio\/distribution-ticker-[a-z0-9.-]+\.json$/i.test(indexRow.historyUrl)) return [];
    const response = await fetch(new URL(indexRow.historyUrl, origin), { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`공식 배당 원장을 불러오지 못했습니다: ${symbol}`);
    const payload = await response.json();
    return payload.history ?? [];
}

export async function loadTicker(symbol, origin) {
    const key = normalize(symbol);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const instrument = instruments.get(key);
    const indexRow = distributions.get(key);
    const history = await loadOfficialHistory(key, origin);
    const value = {
        symbol: key,
        tickerInfo: {
            symbol: key,
            longName: instrument?.longName ?? instrument?.koName ?? null,
            currency: instrument?.currency ?? indexRow?.latest?.currency ?? null,
            market: instrument?.market ?? null,
            regularMarketPrice: null,
            price: null,
        },
        backtestData: toBacktestData(history),
        sourceStatus: { dividends: indexRow ? 'official_projection' : 'unavailable', price: 'not_configured' },
    };
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
}

export async function buildThumbnailPayload(ticker, requestedRivals = [], loader) {
    const entry = catalogEntry(ticker);
    const allowed = new Set(rivalOptions(entry));
    const rivals = requestedRivals.map(normalize).filter((symbol) => allowed.has(symbol)).slice(0, 3);
    const symbols = [entry.symbol, ...rivals, ...(entry.underlying ? [entry.underlying] : [])];
    const activeLoader = loader ?? ((symbol) => loadTicker(symbol, 'http://localhost'));
    const settled = await Promise.allSettled(symbols.map(activeLoader));
    const loaded = Object.fromEntries(symbols.map((symbol, index) => [symbol, settled[index].status === 'fulfilled' ? settled[index].value : null]));
    const unavailable = symbols.filter((symbol) => !loaded[symbol]);
    if (!loaded[entry.symbol]) throw new Error(`공식 배당 원장을 불러올 수 없습니다: ${entry.symbol}`);
    const instrument = instruments.get(entry.symbol);
    return { ticker: loaded[entry.symbol], catalog: { ...entry, company: instrument?.officialProvider ?? null }, rivalOptions: rivalOptions(entry), rivals, series: loaded, partial: unavailable.length > 0, unavailable };
}

async function handler(req, res) {
    const ticker = normalize(req.query.ticker);
    if (!/^[A-Z0-9.-]{1,15}$/.test(ticker)) return res.status(400).json({ error: 'A valid ticker is required.' });
    const rivals = String(req.query.rivals ?? '').split(',').filter(Boolean);
    const origin = requestOrigin(req);
    const payload = await buildThumbnailPayload(ticker, rivals, (symbol) => loadTicker(symbol, origin));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(payload);
}

export default createApiHandler(handler);
