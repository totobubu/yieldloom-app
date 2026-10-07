import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRivalComparison } from '../src/services/thumbnail/rivalComparison.js';

const ticker = (symbol, rows, frequency = '매월') => ({
    symbol,
    tickerInfo: { frequency },
    backtestData: rows,
});

test('rival comparison uses common dates and reinvests cash distributions', () => {
    const focal = ticker('FOCAL', [
        { date: '2026-01-02', close: 100 },
        { date: '2026-06-02', close: 100, amount: 10 },
        { date: '2026-10-02', close: 110 },
        { date: '2026-12-02', close: 200, forecasted: true },
    ]);
    const rival = ticker('RIVAL', [
        { date: '2026-01-02', close: 100 },
        { date: '2026-06-02', close: 90, amountFixed: 1 },
        { date: '2026-10-02', close: 100 },
    ]);
    const underlying = ticker('BASE', [
        { date: '2026-01-02', close: 100 },
        { date: '2026-06-02', close: 105 },
        { date: '2026-10-02', close: 120 },
    ]);

    const result = calculateRivalComparison(
        [focal, rival],
        underlying,
        '2026-10-03'
    );

    assert.equal(result.startDate, '2026-01-02');
    assert.equal(result.endDate, '2026-10-02');
    assert.equal(result.initialInvestment, 10_000);
    assert.equal(result.metrics[0].cumulativeDividends, 1_000);
    assert.equal(result.metrics[0].finalValue, 12_100);
    assert.ok(Math.abs(result.metrics[0].totalReturn - 0.21) < 1e-12);
    assert.ok(Math.abs(result.metrics[0].vsUnderlying - 0.01) < 1e-12);
    assert.deepEqual([...result.crowns.totalReturn], ['FOCAL']);
});

test('rival comparison requires at least two common non-forecast price dates', () => {
    const focal = ticker('FOCAL', [
        { date: '2026-01-02', close: 100 },
        { date: '2026-06-02', close: 110, forecasted: true },
    ]);
    const rival = ticker('RIVAL', [
        { date: '2026-01-02', close: 100 },
        { date: '2026-06-02', close: 100 },
    ]);
    const underlying = ticker('BASE', [
        { date: '2026-01-02', close: 100 },
        { date: '2026-06-02', close: 120 },
    ]);

    assert.equal(
        calculateRivalComparison([focal, rival], underlying, '2026-06-03'),
        null
    );
});
