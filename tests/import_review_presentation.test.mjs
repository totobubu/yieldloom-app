import test from 'node:test';
import assert from 'node:assert/strict';
import {
    reviewMoney,
    reviewNumber,
    reviewDividendSummary,
    reviewSecurityLabel,
} from '../src/services/importReviewPresentation.js';

test('domestic labels use names without changing codes; currencies stay attached to amounts', () => {
    assert.equal(
        reviewSecurityLabel({ symbol: 'A039980', securityName: '폴라리스AI' }),
        '폴라리스AI'
    );
    assert.equal(
        reviewSecurityLabel({ symbol: '039980', securityName: '폴라리스AI' }),
        '폴라리스AI'
    );
    assert.equal(
        reviewSecurityLabel({
            symbol: 'YMAX',
            securityName: 'YieldMax Universe',
        }),
        'YMAX'
    );
    assert.equal(reviewSecurityLabel({ symbol: 'CASH' }), '현금·환전');
    assert.equal(reviewNumber(0.110754), '0.110754');
    assert.equal(reviewNumber(null), '—');
    assert.equal(reviewMoney(9.999968, 'USD', -1), '−$10.00');
    assert.equal(reviewMoney(14775, 'KRW'), '₩14,775');
    assert.equal(reviewMoney(null, 'USD'), '—');
    assert.equal(reviewMoney(0, 'USD'), '$0.00');
});

test('dividend display keeps currencies separate, subtracts reversals, and preserves missing amounts', () => {
    const rows = [
        { type: 'dividend', amount: 100, currency: 'USD', date: '2026-03-01' },
        {
            type: 'dividend_reversal',
            amount: 20,
            currency: 'USD',
            date: '2026-03-02',
        },
        { type: 'dividend', amount: 3000, currency: 'KRW', date: '2026-04-01' },
        { type: 'dividend', amount: null, currency: 'USD', date: '2026-04-01' },
        { type: 'buy', amount: 1000, currency: 'USD', date: '2026-04-01' },
    ];
    const result = reviewDividendSummary(rows);
    assert.equal(result.missing, 1);
    assert.deepEqual(
        result.totals.map(({ currency, amount, count }) => ({
            currency,
            amount,
            count,
        })),
        [
            { currency: 'USD', amount: 80, count: 2 },
            { currency: 'KRW', amount: 3000, count: 1 },
        ]
    );
    assert.equal(result.totals[0].months[2], 80);
    assert.equal(result.totals[1].months[3], 3000);
    assert.equal(rows[1].amount, 20);
});
