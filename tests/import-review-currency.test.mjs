import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCurrencyBreakdown } from '../src/services/importReviewCurrency.js';
import { reviewRawAmount } from '../src/services/importReviewPresentation.js';
const row = (type, amount, currency = 'KRW') => ({ type, amount, currency });
test('reference six rows keep both currencies and review cash difference separate', () => {
    const actual = reviewCurrencyBreakdown([
        row('buy', 100000),
        row('buy', 200, 'USD'),
        row('sell', 24000),
        row('dividend', 10, 'USD'),
        row('cash_in', 1000000),
        row('cash_out', 50000),
    ]);
    assert.equal(actual.unknownCurrencyCount, 0);
    const [krw, usd] = actual.currencies;
    assert.equal(krw.count, 4);
    assert.equal(usd.count, 2);
    assert.deepEqual(
        krw.lines.map((v) => [v.type, v.amount]),
        [
            ['buy', '100000'],
            ['sell', '24000'],
            ['cash_in', '1000000'],
            ['cash_out', '50000'],
        ]
    );
    assert.equal(krw.netCash.amount, '950000');
    assert.equal(usd.netCash, null);
    assert.equal(usd.lines.find((v) => v.type === 'dividend').amount, '10');
});
test('genuine zero survives; a missing value blocks a complete group and cash difference', () => {
    const zero = reviewCurrencyBreakdown([row('buy', 0, 'USD')]).currencies[0]
        .lines[0];
    assert.equal(zero.amount, '0');
    assert.equal(reviewRawAmount(zero.amount, 'USD'), '0.00');
    const missing = reviewCurrencyBreakdown([
        row('cash_in', 100),
        row('cash_in', null),
        row('cash_out', 10),
    ]).currencies[0];
    assert.equal(missing.lines[0].amount, null);
    assert.equal(missing.lines[0].unknown, 1);
    assert.equal(missing.netCash.amount, null);
});
test('unknown currency is never inferred; other types are not cash or capital', () => {
    const actual = reviewCurrencyBreakdown([
        row('buy', 150000, ''),
        row('cash_in', 10, 'USD'),
        row('transfer_in', 200, 'USD'),
        row('unknown', 300, 'USD'),
    ]);
    assert.equal(actual.unknownCurrencyCount, 1);
    assert.equal(actual.currencies.length, 1);
    assert.equal(actual.currencies[0].currency, 'USD');
    assert.equal(actual.currencies[0].otherCount, 2);
    assert.equal(actual.currencies[0].netCash.amount, '10');
    assert.equal(actual.currencies[0].lines.length, 1);
});
test('existing exact arithmetic keeps decimal sums and scientific numeric input precise', () => {
    const actual = reviewCurrencyBreakdown([
        row('buy', '0.1', 'USD'),
        row('buy', '0.2', 'USD'),
        row('dividend', 1e-7, 'USD'),
    ]).currencies[0];
    assert.equal(actual.lines[0].amount, '0.3');
    assert.equal(actual.lines[1].amount, '0.0000001');
    assert.equal(reviewRawAmount('0.00000100', 'USD'), '0.00000100');
    assert.equal(reviewRawAmount('', 'USD'), '미제공');
});
test('invalid signed/boolean/out-of-range or unsupported precision values never become zero totals', () => {
    for (const amount of [-1, false, Infinity, '1000000000000000.1', '1e-31']) {
        const result = reviewCurrencyBreakdown([row('sell', amount)])
            .currencies[0].lines[0];
        assert.equal(result.amount, null, String(amount));
        assert.equal(result.unknown, 1);
    }
});
