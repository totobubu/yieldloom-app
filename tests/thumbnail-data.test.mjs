import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThumbnailPayload, catalogEntry, loadTicker, rivalOptions, toBacktestData } from '../api/thumbnail-data.js';

test('catalog limits rivals to the same verified underlying', () => {
    const entry = catalogEntry('tsly');
    assert.equal(entry.underlying, 'TSLA');
    assert.ok(rivalOptions(entry).includes('TSII'));
    assert.ok(!rivalOptions(entry).includes('NVDY'));
});

test('payload removes invalid rivals and reports partial loads', async () => {
    const payload = await buildThumbnailPayload('TSLY', ['TSII', 'NVDY'], async (symbol) => symbol === 'TSII' ? Promise.reject(new Error('missing')) : { symbol, tickerInfo: {}, backtestData: [] });
    assert.deepEqual(payload.rivals, ['TSII']);
    assert.equal(payload.partial, true);
    assert.deepEqual(payload.unavailable, ['TSII']);
});

test('official events retain exact ex-date and distribution amount without a price', () => {
    assert.deepEqual(toBacktestData([
        { ex_date: '2026-01-02', distribution_per_share: '0.2000' },
        { ex_date: '2026-01-03', distribution_per_share: null },
    ]), [{ date: '2026-01-02', amount: 0.2, amountFixed: 0.2 }]);
});

test('an approved catalog ticker can render when it has no published dividend history yet', async () => {
    const payload = await buildThumbnailPayload('AMDY', [], async (symbol) => ({ symbol, tickerInfo: {}, backtestData: [] }));
    assert.equal(payload.ticker.symbol, 'AMDY');
    assert.deepEqual(payload.ticker.backtestData, []);
});

test('AMDY joins its official ledger to its R2 price projection', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('distribution-ticker-amdy.json')) {
                return { ok: true, json: async () => ({ history: [{ ex_date: '2026-10-08', distribution_per_share: '1.0254' }] }) };
            }
            assert.match(String(url), /data\/nyse\/amdy\.json$/);
            return { ok: true, json: async () => ({ backtestData: [{ date: '2026-10-07', close: 46.5 }, { date: '2026-10-08', close: 47.04 }, { date: '2027-04-08', forecasted: true }] }) };
        };
        const ticker = await loadTicker('AMDY', 'https://yieldloom-app.vercel.app', { priceDataBaseUrl: 'https://prices.example' });
        assert.equal(ticker.tickerInfo.regularMarketPrice, 47.04);
        assert.deepEqual(ticker.backtestData, [
            { date: '2026-10-07', close: 46.5 },
            { date: '2026-10-08', close: 47.04, amount: 1.0254, amountFixed: 1.0254 },
        ]);
        assert.equal(ticker.sourceStatus.dividends, 'official_projection');
        assert.equal(ticker.sourceStatus.price, 'r2_projection');
    } finally {
        globalThis.fetch = originalFetch;
    }
});
