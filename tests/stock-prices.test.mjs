import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { loadStockCandles } from '../api/stock-prices.js';
test('anonymous price responses keep public CORS consistent for CDN and Pages', async () => {
    for (const origin of [
        undefined,
        'https://totobubu.github.io',
        'https://yieldloom-app.vercel.app',
    ]) {
        const headers = {};
        const res = {
            setHeader: (key, value) => {
                headers[key] = value;
            },
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(body) {
                this.body = body;
                return this;
            },
        };
        await handler(
            {
                method: 'GET',
                query: { ticker: '../invalid' },
                headers: { origin },
            },
            res
        );
        assert.equal(res.statusCode, 400);
        assert.equal(headers['Access-Control-Allow-Origin'], '*');
        assert.equal(headers['Access-Control-Allow-Credentials'], undefined);
        assert.equal(headers.Vary, undefined);
    }
});
const response = (quote, timestamps = [1767272400, 1767358800]) => ({
    chart: {
        result: [
            {
                meta: {
                    currency: 'USD',
                    exchangeTimezoneName: 'America/New_York',
                },
                timestamp: timestamps,
                indicators: { quote: [quote] },
            },
        ],
    },
});

test('concurrent server requests for the same ticker make one upstream request', async () => {
    let calls = 0;
    const fetcher = async () => {
        calls++;
        return {
            ok: true,
            json: async () =>
                response({
                    open: [100, 101],
                    high: [110, 111],
                    low: [99, 100],
                    close: [105, 106],
                    volume: [1, 2],
                }),
        };
    };
    const [a, b] = await Promise.all([
        loadStockCandles('AAPL', fetcher),
        loadStockCandles('aapl', fetcher),
    ]);
    a.candles[0].close = 999;
    assert.equal(b.candles[0].close, 105);
    assert.equal(calls, 1);
    await loadStockCandles('AAPL', fetcher);
    assert.equal(calls, 1);
});
test('candles retain actual OHLC and volume and normalize dotted share classes', async () => {
    let url;
    const result = await loadStockCandles('brk.b', async (value) => {
        url = value;
        return {
            ok: true,
            json: async () =>
                response({
                    open: [100, 101],
                    high: [110, 111],
                    low: [99, 100],
                    close: [105, 106],
                    volume: [1234, 0],
                }),
        };
    });
    assert.match(url, /BRK-B\?range=2y&interval=1d/);
    assert.equal(result.symbol, 'BRK.B');
    assert.equal(result.candles.length, 2);
    assert.deepEqual(result.candles[0], {
        date: '2026-01-01',
        open: 100,
        high: 110,
        low: 99,
        close: 105,
        volume: 1234,
    });
    assert.equal(result.candles[1].volume, 0);
});
test('missing or inconsistent OHLC is excluded instead of fabricating candles', async () => {
    const result = await loadStockCandles('TOPW', async () => ({
        ok: true,
        json: async () =>
            response({
                open: [null, 100],
                high: [110, 110],
                low: [99, 99],
                close: [105, 105],
                volume: [123, 456],
            }),
    }));
    assert.equal(result.candles.length, 1);
    await assert.rejects(
        loadStockCandles('TOPW', async () => ({
            ok: true,
            json: async () =>
                response({
                    open: [100, 100],
                    high: [99, 99],
                    low: [99, 99],
                    close: [105, 105],
                }),
        })),
        /일봉/
    );
});
test('invalid tickers never request upstream and upstream failures remain retryable', async () => {
    await assert.rejects(
        loadStockCandles('../TOPW', () => {
            throw new Error('must not fetch');
        }),
        (e) => e.statusCode === 400
    );
    await assert.rejects(
        loadStockCandles('TOPW', async () => ({ ok: false, status: 429 })),
        (e) => e.statusCode === 503
    );
});

test('split markers retain source ratios and exclude future events', async () => {
    const payload = response({
        open: [100, 101],
        high: [110, 111],
        low: [99, 100],
        close: [105, 106],
        volume: [10, 20],
    });
    payload.chart.result[0].events = {
        splits: {
            past: { date: 1767272400, splitRatio: '2:1' },
            future: { date: 4102444800, splitRatio: '3:1' },
        },
    };
    const result = await loadStockCandles('SPLT', async () => ({
        ok: true,
        json: async () => payload,
    }));
    assert.deepEqual(result.events, [
        { date: '2026-01-01', kind: 'split', label: '분할 2:1' },
    ]);
});
