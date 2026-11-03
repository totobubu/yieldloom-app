import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    cashReviewDateKey,
    cashReviewEntries,
    primaryCashKinds,
} from '../src/services/cashReview.js';
const entries = [
    {
        id: 'a',
        date: '20261001',
        currency: 'KRW',
        amount: 100,
        suggestedKind: 'external_deposit',
    },
    {
        id: 'b',
        date: '2026-10-02',
        currency: 'USD',
        amount: 20,
        suggestedKind: 'external_withdrawal',
    },
    {
        id: 'c',
        date: '20261003',
        currency: 'KRW',
        amount: 30,
        suggestedKind: 'exchange',
        purchaseExchange: true,
    },
    { id: 'bad', date: '20260230', currency: 'USD', amount: 40 },
];
const classifications = [
    { id: 'a', classification: 'external_deposit', revision: 1 },
];
test('review dates preserve local calendar days and reject malformed dates', () => {
    assert.equal(cashReviewDateKey(new Date(2026, 9, 2, 0, 0)), '20261002');
    assert.equal(cashReviewDateKey('2026-10-02'), '20261002');
    for (const value of ['20260230', '20261301', '2026', new Date(NaN)])
        assert.equal(cashReviewDateKey(value), '');
});
test('range endpoints are inclusive; currency and review state combine without mutating the ledger', () => {
    const original = structuredClone(entries);
    assert.deepEqual(
        cashReviewEntries(entries, classifications, {
            status: 'all',
            start: new Date(2026, 9, 1),
            end: new Date(2026, 9, 2),
        }).map((x) => x.id),
        ['b', 'a']
    );
    assert.deepEqual(
        cashReviewEntries(entries, classifications, {
            status: 'pending',
            currency: 'USD',
            start: '20261002',
            end: '20261002',
        }).map((x) => x.id),
        ['b']
    );
    assert.deepEqual(
        cashReviewEntries(entries, classifications, {
            status: 'confirmed',
        }).map((x) => x.id),
        ['a']
    );
    assert.deepEqual(
        cashReviewEntries(entries, classifications, {
            status: 'all',
            start: '20261004',
        }),
        []
    );
    assert.deepEqual(entries, original);
});
test('primary classification buttons use the existing meanings; withdrawal ambiguity stays explicit', () => {
    assert.deepEqual(primaryCashKinds(entries[1]), [
        'principal_withdrawal',
        'dividend_withdrawal',
        'external_withdrawal',
    ]);
    assert.deepEqual(primaryCashKinds(entries[0]), [
        'external_deposit',
        'transfer',
        'unknown',
    ]);
    assert.deepEqual(primaryCashKinds({ suggestedKind: 'not-a-kind' }), [
        'external_deposit',
        'external_withdrawal',
        'transfer',
    ]);
});
