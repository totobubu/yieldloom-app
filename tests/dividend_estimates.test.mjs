import assert from 'node:assert/strict';
import test from 'node:test';

import {
    annualized,
    nextExpectedDate,
} from '../src/composables/studio/useDividendPortfolio.ts';

test('calculates estimates for a stable, known distribution frequency', () => {
    const event = {
        distribution_per_share: '0.25',
        ex_date: '2026-09-01',
        frequency: 'monthly',
    };
    assert.equal(annualized(event), 3);
    assert.equal(nextExpectedDate(event), '2026-10-01');
});

test('does not estimate across a corporate action or frequency change', () => {
    const event = {
        distribution_per_share: '0.25',
        ex_date: '2026-09-01',
        frequency: 'monthly',
        comparisonBasis: 'corporate_action_or_frequency_change',
    };
    assert.equal(annualized(event), null);
    assert.equal(nextExpectedDate(event), null);
});
