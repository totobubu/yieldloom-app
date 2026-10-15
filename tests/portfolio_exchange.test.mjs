import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionExchangeRate } from '../src/services/portfolioPerformance.js';
test('recorded statement rates take priority and an inferred rate is explicitly distinguished', () => {
    assert.deepEqual(
        transactionExchangeRate({
            exchangeRate: 1338.6,
            amount: 6692,
            nativeAmount: 4.999993,
        }),
        { value: 1338.6, recorded: true }
    );
    assert.deepEqual(
        transactionExchangeRate({ amount: 14000, nativeAmount: 10 }),
        { value: 1400, recorded: false }
    );
    assert.equal(
        transactionExchangeRate({ amount: 100, nativeAmount: 0 }),
        null
    );
});
