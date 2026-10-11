import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateHoldingDividend } from '../src/services/thumbnail/holdingDividend.js';

test('uses FIFO remaining cost and actual recorded dividends only', () => {
    const result = calculateHoldingDividend({
        portfolioPriority: 'current', holdingShares: 5,
        transactions: [
            { date: '20240101', type: 'buy', quantity: 10, amount: 1000 },
            { date: '20240201', type: 'buy', quantity: 10, amount: 3000 },
            { date: '20240301', type: 'sell', quantity: 15, amount: 4000 },
            { date: '20240401', type: 'dividend', amount: 100 },
        ],
    }, { current: { amount: 0.5, exDate: '2026-10-30' } });
    assert.equal(result.remainingCost, 1500);
    assert.equal(result.dividends, 100);
    assert.equal(result.recoveryRate, 100 / 1500 * 100);
    assert.equal(result.nextCashFlow, 2.5);
});

test('does not display for historical assets', () => {
    assert.equal(calculateHoldingDividend({ portfolioPriority: 'historical' }).supported, false);
});
