import test from 'node:test';
import assert from 'node:assert/strict';
import { corporateActionReviewForPeriod } from '../lib/corporate-action-review.js';
import { calculationCoverage } from '../src/services/thumbnail/calculationCoverage.js';

const start = '2026-10-22', end = '2026-10-29';
const status = (dates) => ({ corporateActionReview: true, corporateActionDates: dates });
test('same-basis dividends are comparable after historical splits', () => {
    for (const dates of [['2025-12-01'], [start], ['2026-11-01'], []]) {
        assert.equal(corporateActionReviewForPeriod(status(dates), start, end, { includeStart: false }), false);
    }
});
test('splits between payments, including current ex-date, require review', () => {
    for (const dates of [['2026-10-23'], [end], [null], ['invalid']]) {
        assert.equal(corporateActionReviewForPeriod(status(dates), start, end, { includeStart: false }), true);
    }
});
test('legacy responses retain conservative review and price periods include their first day', () => {
    assert.equal(corporateActionReviewForPeriod({ corporateActionReview: true }, start, end), true);
    assert.equal(corporateActionReviewForPeriod({}, start, end), false);
    assert.equal(corporateActionReviewForPeriod(status([start]), start, end), true);
});
test('historical splits outside calculation interval do not mark partial data conflicted', () => {
    assert.equal(calculationCoverage({ sourceStatus: status(['2025-01-01']) }, start, end).status, 'partial');
    assert.equal(calculationCoverage({ sourceStatus: status([start]) }, start, end).status, 'conflict');
});
