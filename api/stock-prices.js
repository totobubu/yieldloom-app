import { createApiHandler } from '../lib/api-handler.js';
import { normalizeSymbol, validSymbol } from '../lib/thumbnail-projection.js';
import { fetchJson, PriceError } from '../lib/thumbnail-prices.js';

const cache = new Map();
export async function loadStockCandles(symbol, fetcher = fetch) {
    const ticker = normalizeSymbol(symbol);
    if (!validSymbol(ticker))
        throw new PriceError('올바른 티커를 입력해 주세요.', 400);
    const stored = fetcher === fetch && cache.get(ticker);
    if (stored?.expires > Date.now()) return stored.value;
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
                `https://${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=2y&interval=1d`,
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
        asOf: new Date().toISOString(),
    };
    if (fetcher === fetch) {
        if (cache.size >= 200) cache.delete(cache.keys().next().value);
        cache.set(ticker, { expires: Date.now() + 300000, value });
    }
    return value;
}

export default createApiHandler(async (req, res) => {
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
});
