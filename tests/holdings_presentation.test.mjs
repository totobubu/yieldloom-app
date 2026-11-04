import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStoredPositions } from '../src/services/holdingsPresentation.js';
const row = (amount, currency = 'USD', quantity = 1) => ({
    symbol: 'TEST',
    currency,
    quantity,
    amount,
});
test('all missing snapshot values remain unknown rather than an empty sum of zero', () => {
    const [r] = groupStoredPositions([
        row(null),
        row(undefined),
        row(''),
        row(NaN),
    ]);
    assert.equal(r.amount, null);
    assert.equal(r.quantity, 4);
    assert.equal(r.complete, false);
});
test('an actual zero stays zero even when a different position has an unknown amount', () => {
    assert.deepEqual(groupStoredPositions([row(0)])[0], {
        symbol: 'TEST',
        currency: 'USD',
        quantity: 1,
        amount: 0,
        complete: true,
    });
    assert.equal(groupStoredPositions([row(0), row(null)])[0].amount, 0);
    assert.equal(groupStoredPositions([row(0), row(null)])[0].complete, false);
});
test('known partial values and the existing quantities are retained without filling missing amounts', () => {
    assert.deepEqual(
        groupStoredPositions([row(10, 'USD', 2), row(null, 'USD', 3)])[0],
        {
            symbol: 'TEST',
            currency: 'USD',
            quantity: 5,
            amount: 10,
            complete: false,
        }
    );
});
test('a symbol in two currencies retains separate groups and never converts or combines money', () => {
    const r = groupStoredPositions([
        row(100, 'KRW'),
        row(2, 'USD'),
        row(3, 'USD'),
    ]);
    assert.equal(r.length, 2);
    assert.equal(r.find((x) => x.currency === 'KRW').amount, 100);
    assert.equal(r.find((x) => x.currency === 'USD').amount, 5);
});
