import assert from 'node:assert/strict';
import test from 'node:test';
import {
    dividendAvailability,
    hasDividendInformation,
} from '../lib/dividend-availability.js';

test('dividend availability distinguishes confirmed none, evidence and missing data', () => {
    assert.equal(
        dividendAvailability({
            security: {
                noDividends: true,
                dividendEvidence: { latestAmount: 1 },
            },
        }),
        'none'
    );
    assert.equal(
        dividendAvailability({
            security: { dividendEvidence: { latestExDate: '2026-10-01' } },
        }),
        'available'
    );
    assert.equal(
        dividendAvailability({
            sourceStatus: { dividends: 'official_projection' },
        }),
        'available'
    );
    assert.equal(
        dividendAvailability({
            sourceStatus: { dividends: 'unavailable' },
        }),
        'unavailable'
    );
    assert.equal(hasDividendInformation({ security: {} }), false);
});
