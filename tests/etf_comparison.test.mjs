import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getComparisonSignals,
    getStabilitySignal,
} from '../src/services/etfComparison.ts';

const priceIndex = (quote) => ({
    generatedAt: '2026-09-28',
    source: 'yahoo_eod',
    prices: quote ? { TEST: quote } : {},
});
const row = (overrides = {}) => ({
    ticker: 'TEST',
    providerSlug: 'yieldmax',
    historyCount: 12,
    latest: {
        distribution_per_share: '1.00',
        ex_date: '2026-09-01',
        payable_date: null,
        frequency: 'monthly',
        verification_status: 'official',
        official_url: 'https://example.test',
        previous_amount: '1.00',
        average4: 1.1,
        average12: 1.1,
    },
    ...overrides,
});

test('marks a verified long-history distribution with small average differences as stable', () => {
    assert.equal(getStabilitySignal(row()).stability, 'stable');
});

test('marks short history or large distribution changes as caution', () => {
    assert.equal(
        getStabilitySignal(row({ historyCount: 6 })).stability,
        'caution'
    );
    assert.equal(
        getStabilitySignal(row({ latest: { ...row().latest, average12: 1.5 } }))
            .stability,
        'caution'
    );
});

test('requires review for corporate actions, unverified data, and insufficient history', () => {
    assert.equal(
        getStabilitySignal(
            row({
                latest: {
                    ...row().latest,
                    comparisonBasis: 'corporate_action_or_frequency_change',
                },
            })
        ).stability,
        'review'
    );
    assert.equal(
        getStabilitySignal(
            row({
                latest: {
                    ...row().latest,
                    verification_status: 'needs_review',
                },
            })
        ).stability,
        'review'
    );
    assert.equal(
        getStabilitySignal(row({ historyCount: 3 })).stability,
        'review'
    );
});

test('only exposes annual yield with a fresh price', () => {
    assert.equal(
        getComparisonSignals(
            row(),
            priceIndex({
                close: 100,
                priceDate: '2026-09-28',
                stale: false,
                currency: 'USD',
                source: 'yahoo_eod',
                dataPath: '/data',
            })
        ).annualYield,
        0.12
    );
    assert.equal(
        getComparisonSignals(
            row(),
            priceIndex({
                close: 100,
                priceDate: '2026-09-01',
                stale: true,
                currency: 'USD',
                source: 'yahoo_eod',
                dataPath: '/data',
            })
        ).annualYield,
        null
    );
    assert.equal(
        getComparisonSignals(row(), priceIndex()).priceQuality,
        'missing'
    );
});
