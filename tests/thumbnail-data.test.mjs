import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThumbnailPayload, catalogEntry, rivalOptions, toBacktestData } from '../api/thumbnail-data.js';

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

test('Yahoo rows keep actual dividends and discard invalid closes', () => {
    assert.deepEqual(toBacktestData([{ date: '2026-01-02T00:00:00Z', close: 10 }, { date: '2026-01-03T00:00:00Z', close: null }], [{ date: '2026-01-02T00:00:00Z', dividends: 0.2 }]), [{ date: '2026-01-02', open: undefined, high: undefined, low: undefined, close: 10, volume: undefined, amount: 0.2, amountFixed: 0.2 }]);
});
