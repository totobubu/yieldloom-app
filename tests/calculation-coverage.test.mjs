import test from 'node:test';
import assert from 'node:assert/strict';
import { calculationCoverage } from '../src/services/thumbnail/calculationCoverage.js';
import { calculateRivalComparison } from '../src/services/thumbnail/rivalComparison.js';
const start = '2025-01-01', end = '2026-01-01';
const complete = { complete: true, start, end, gaps: [] };
const ticker = { symbol: 'A', backtestData: [{date:start,close:10},{date:end,close:11}],
    collectionCoverage: {'market-prices': complete, dividends: complete} };
test('coverage checks exact requested interval, absent evidence and conflicts', () => {
    assert.equal(calculationCoverage(ticker,start,end).complete,true);
    assert.equal(calculationCoverage({},start,end).status,'partial');
    assert.equal(calculationCoverage(ticker,'2024-01-01',end).status,'partial');
    assert.equal(calculationCoverage({...ticker,coverage:{conflictingDates:['2025-07-01']}},start,end).status,'conflict');
    assert.equal(calculationCoverage({...ticker,coverage:{conflictingDates:['2024-01-01']}},start,end).complete,true);
});
test('actual rival entry point labels partial data and withholds conflicted calculations', () => {
    const partial = {...ticker,collectionCoverage:undefined};
    assert.equal(calculateRivalComparison([ticker,partial],ticker,end).quality.status,'partial');
    const conflict = {...ticker,coverage:{conflictingDates:['2025-07-01']}};
    const result = calculateRivalComparison([ticker,conflict],ticker,end);
    assert.equal(result.available,false);
    assert.equal(result.metrics,undefined);
});
