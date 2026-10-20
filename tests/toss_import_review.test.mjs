import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyIsinResolutions,
    importReviewGroups,
    inferExchangeFunding,
    transactionTypeLabel,
    unresolvedIsins,
} from '../src/services/tossImportReview.js';

test('cross-checked ISINs become symbols while unresolved identifiers stay reviewable', () => {
    const rows = [
        {
            symbol: 'US88636X8801',
            originalCode: 'US88636X8801',
            type: 'buy',
        },
        {
            symbol: 'US88636X8561',
            originalCode: 'US88636X8561',
            type: 'buy',
        },
    ];
    assert.deepEqual(unresolvedIsins(rows), ['US88636X8801', 'US88636X8561']);
    const result = applyIsinResolutions(rows, [
        {
            isin: 'US88636X8801',
            confirmed: { symbol: 'TSLY', name: 'YieldMax TSLY' },
            candidates: [],
        },
        {
            isin: 'US88636X8561',
            confirmed: null,
            candidates: [{ symbol: 'CONY' }],
        },
    ]);
    assert.equal(result[0].symbol, 'TSLY');
    assert.equal(result[0]._mappingStatus, 'verified');
    assert.equal(result[1].symbol, 'US88636X8561');
    assert.equal(result[1]._mappingStatus, 'unresolved');
    assert.equal(importReviewGroups(result).unresolved.length, 1);
});

test('only an unambiguous exact exchange and USD settlement are linked', () => {
    const rows = [
        {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_out',
            currency: 'KRW',
            amount: 140140,
            exchangeRate: 1400,
            cashKind: 'exchange',
        },
        {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_in',
            currency: 'USD',
            amount: 100.1,
            cashKind: 'exchange',
        },
        {
            date: '2026-10-15',
            symbol: 'TSLY',
            type: 'buy',
            currency: 'USD',
            nativeSettlementAmount: 100.1,
        },
    ];
    const result = inferExchangeFunding(rows);
    assert.equal(result[2]._fundingStatus, 'matched_exchange');
    assert.equal(result[2]._fundingSuggestion.paidKrw, 140140);
    assert.equal(transactionTypeLabel('buy'), '매수');
    assert.equal(transactionTypeLabel('unknown'), '확인 필요');
    assert.equal(
        inferExchangeFunding([...rows, { ...rows[2] }])[2]._fundingStatus,
        'needs_review'
    );
});
