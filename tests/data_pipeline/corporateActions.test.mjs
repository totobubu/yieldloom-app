import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSplit, mergeSplits } from '../../lib/corporateActions.js';
import { eventValues } from '../../lib/yahooChartEvents.js';
import { processSymbolData } from '../../src/services/backtester/dataProcessor.js';

test('forward and reverse splits have consistent share directions', () => {
    assert.equal(normalizeSplit({ ratio: '2:1' }).type, 'split');
    assert.equal(normalizeSplit({ ratio: '1:8' }).type, 'reverse-split');
});
test('correcting a label never doubles the financial event', () => {
    const old = { date: '2024-02-26', ratio: '1:2', type: 'split' };
    assert.deepEqual(mergeSplits([old], [{ ...old, type: 'reverse-split' }]),
        [{ ...old, type: 'reverse-split' }]);
});
test('Yahoo timestamp maps preserve dividends and split events', () => {
    assert.deepEqual(eventValues({ '123': { amount: 0.5 } }), [{ amount: 0.5 }]);
    assert.deepEqual(eventValues(undefined), []);
});
test('provider-adjusted history is never split-adjusted twice', () => {
    const data = { symbol: 'TEST', priceBasis: 'split_adjusted', dividendBasis: 'split_adjusted',
        prices: [{date: '2000-01-01', open: 100, close: 100}], dividends: [{date: '2000-01-01', amount: 1}],
        splits: [{date: '2024-01-01', ratio: '1:2'}] };
    const adjusted = processSymbolData(data);
    assert.equal(adjusted.priceMap.get('2000-01-01').close, 100);
    assert.equal(adjusted.dividendMap.get('2000-01-01'), 1);
    const raw = processSymbolData({...data, priceBasis: 'raw', dividendBasis: 'raw'});
    assert.equal(raw.priceMap.get('2000-01-01').close, 200);
    assert.equal(raw.dividendMap.get('2000-01-01'), 2);
});
