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

test('instant conversion links observed KRW and USD settlements even without a cash-side rate', () => {
    const rows = [
        {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_out',
            currency: 'KRW',
            amount: 14775,
            cashKind: 'exchange',
        },
        {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_in',
            currency: 'USD',
            amount: 10,
            cashKind: 'exchange',
        },
        {
            date: '2026-10-15',
            symbol: 'YMAX',
            type: 'buy',
            currency: 'USD',
            nativeSettlementAmount: 10,
            settlementAmount: 14775,
        },
    ];
    const result = inferExchangeFunding(rows);
    assert.deepEqual(result[2]._fundingSuggestion, {
        buyIndex: 2,
        krwIndex: 0,
        usdIndex: 1,
        amount: 10,
        paidKrw: 14775,
        basis: 'settlement',
    });
    const edited = inferExchangeFunding(
        result.map((row, index) =>
            index === 2 ? { ...row, date: '2026-10-16' } : row
        )
    );
    assert.equal(edited[2]._fundingStatus, 'needs_review');
    assert.equal(edited[2]._fundingSuggestion, undefined);
    const changedType = inferExchangeFunding(
        result.map((row, index) =>
            index === 2 ? { ...row, type: 'sell' } : row
        )
    );
    assert.equal(changedType[2]._fundingStatus, undefined);
    assert.equal(changedType[2]._fundingSuggestion, undefined);
    assert.equal(
        rows[2]._fundingSuggestion,
        undefined,
        'input rows remain unchanged'
    );
});

test('rate rounding is bounded and a cash leg cannot fund multiple buys', () => {
    const rows = [
        {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_out',
            currency: 'KRW',
            amount: 14775,
            exchangeRate: 1477.48,
            cashKind: 'exchange',
        },
        {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_in',
            currency: 'USD',
            amount: 10,
            cashKind: 'exchange',
        },
        {
            date: '2026-10-15',
            symbol: 'YMAX',
            type: 'buy',
            currency: 'USD',
            nativeSettlementAmount: 10,
        },
    ];
    assert.equal(
        inferExchangeFunding(rows)[2]._fundingStatus,
        'matched_exchange'
    );
    assert.equal(
        inferExchangeFunding(
            rows.map((row, index) =>
                index === 0 ? { ...row, amount: 14777 } : row
            )
        )[2]._fundingStatus,
        'needs_review'
    );
    const repeatedBuy = inferExchangeFunding([
        ...rows,
        { ...rows[2], symbol: 'TSLY' },
    ]);
    assert.equal(repeatedBuy[2]._fundingStatus, 'needs_review');
    assert.equal(repeatedBuy[3]._fundingStatus, 'needs_review');
    assert.equal(
        inferExchangeFunding([...rows, { ...rows[1] }])[2]._fundingStatus,
        'needs_review',
        'duplicate USD deposits are ambiguous'
    );
    assert.equal(
        inferExchangeFunding([...rows, { ...rows[0] }])[2]._fundingStatus,
        'needs_review',
        'duplicate KRW withdrawals are ambiguous'
    );
    assert.equal(
        inferExchangeFunding(
            rows.map((row, index) =>
                index === 2 ? { ...row, currency: 'KRW' } : row
            )
        )[2]._fundingStatus,
        undefined
    );
});
