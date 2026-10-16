import test from 'node:test';
import assert from 'node:assert/strict';
import {
    valuePortfolio,
    loadValuationQuotes,
} from '../src/services/portfolioValuation.js';

const today = '2026-10-16';
const position = (extra = {}) => ({
    accountId: 'a',
    symbol: 'AAPL',
    quantity: 2,
    amount: 100,
    currency: 'USD',
    asOf: '2026-10-01',
    ...extra,
});
const quote = (extra = {}) => ({
    price: 60,
    date: today,
    currency: 'USD',
    splits: [],
    ...extra,
});
const value = (rows, quotes = { AAPL: quote() }) =>
    valuePortfolio(rows, quotes, { today });

test('currency totals and differences include only eligible matching pairs, never missing values or cash', () => {
    const result = value(
        [
            position(),
            position({ accountId: 'b', amount: null }),
            position({ symbol: 'MISSING' }),
            position({ symbol: 'CASH', amount: 999 }),
            position({ symbol: 'KR', currency: 'KRW', amount: 1000 }),
        ],
        { AAPL: quote(), KR: quote({ price: 600, currency: 'KRW' }) }
    );
    assert.equal(result.currencies[0].total, 240);
    assert.equal(result.currencies[0].difference, 20);
    assert.equal(result.currencies[0].compared, 1);
    assert.equal(result.currencies[0].count, 3);
    assert.equal(result.currencies[1].total, 1200);
    assert.equal(result.excluded, 1);
    assert.equal(result.rows[3].value, null);
});

test('invalid dates, stale/future quotes, mismatched currencies, splits and invalid quantities are excluded', () => {
    for (const [row, price] of [
        [position(), quote({ currency: 'KRW' })],
        [position(), quote({ date: '2026-10-08' })],
        [position(), quote({ date: '2026-10-17' })],
        [position(), quote({ date: '2026-02-30' })],
        [position({ asOf: '2026-10-17' }), quote()],
        [position({ asOf: null }), quote()],
        [position(), quote({ splits: [{ date: '2026-10-10' }] })],
        [position({ quantity: null }), quote()],
        [position({ quantity: -1 }), quote()],
        [position({ quantity: true }), quote()],
        [position(), quote({ price: null })],
        [position({ quantity: 1e308 }), quote()],
    ]) {
        const result = value([row], { AAPL: price });
        assert.equal(result.rows[0].value, null, JSON.stringify([row, price]));
        assert.equal(result.currencies[0].total, null);
        assert.equal(result.currencies[0].difference, null);
        assert.ok(result.rows[0].reason);
    }
});

test('weekend quotes within 7 days are usable, old holdings flagged, zero remains a known value', () => {
    const result = value(
        [position({ asOf: '2026-08-01', quantity: 0, amount: 0 })],
        {
            AAPL: quote({
                date: '2026-10-09',
                splits: [{ date: '2026-07-01' }],
            }),
        }
    );
    assert.equal(result.currencies[0].total, 0);
    assert.equal(result.currencies[0].difference, 0);
    assert.equal(result.oldSnapshots, 1);
});

test('quote loader deduplicates, bounds concurrency/limit, and isolates upstream failures', async () => {
    let active = 0,
        peak = 0;
    const urls = [];
    const result = await loadValuationQuotes(
        ['aapl', 'AAPL', 'CASH', '../bad', 'B', 'C', 'D', 'E', 'F', 'G'],
        {
            limit: 6,
            fetcher: async (url) => {
                urls.push(url);
                peak = Math.max(peak, ++active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active--;
                const symbol = new URL(
                    url,
                    'http://localhost'
                ).searchParams.get('ticker');
                return {
                    ok: symbol !== 'B',
                    json: async () => ({
                        symbol,
                        currency: 'USD',
                        source: 'fixture',
                        candles: [{ date: today, close: 60 }],
                        events: [],
                    }),
                };
            },
        }
    );
    assert.equal(urls.length, 6);
    assert.equal(peak, 4);
    assert.deepEqual(result.omitted, ['G']);
    assert.equal(result.quotes.AAPL.price, 60);
    assert.match(result.quotes.B.error, /실패/);
    assert.ok(
        urls.every(
            (url) => !url.includes('quantity') && !url.includes('account')
        )
    );
});

test('aborted batches do not publish or start more requests; wrong symbols are rejected', async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const result = await loadValuationQuotes(['AAPL'], {
        signal: controller.signal,
        fetcher: () => {
            calls++;
        },
    });
    assert.equal(calls, 0);
    assert.deepEqual(result.quotes, {});
    const wrong = await loadValuationQuotes(['AAPL'], {
        fetcher: async () => ({
            ok: true,
            json: async () => ({ symbol: 'OTHER' }),
        }),
    });
    assert.match(wrong.quotes.AAPL.error, /실패/);
});
