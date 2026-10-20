import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyIsinResolutions,
    importReviewGroups,
    inferExchangeFunding,
    markPurchaseExchangeCash,
    purchaseExchangeWithdrawalIndices,
    transactionTypeLabel,
    unresolvedIsins,
} from '../src/services/tossImportReview.js';
import {
    capitalSummary,
    capitalRecovery,
    validateFunding,
    MAX_FUNDING_EVIDENCE,
} from '../lib/portfolio-capital.js';

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

const exchangeDay = '2026-10-15';
const poolRows = () => [
    {
        date: exchangeDay,
        symbol: 'CASH',
        type: 'cash_out',
        currency: 'KRW',
        amount: 14000,
        exchangeRate: 1400,
        cashKind: 'exchange',
        rawType: '환전원화출금',
        externalId: 'won',
    },
    {
        date: exchangeDay,
        symbol: 'CASH',
        type: 'cash_in',
        currency: 'USD',
        amount: 10,
        exchangeRate: 1400,
        cashKind: 'exchange',
        rawType: '환전외화입금',
        externalId: 'usd',
    },
    {
        date: exchangeDay,
        symbol: 'AAA',
        type: 'buy',
        currency: 'USD',
        nativeSettlementAmount: 6,
        settlementAmount: 8500,
        externalId: 'buy-a',
    },
    {
        date: exchangeDay,
        symbol: 'BBB',
        type: 'buy',
        currency: 'USD',
        nativeSettlementAmount: 7,
        settlementAmount: 9900,
        externalId: 'buy-b',
    },
];

test('same-day conversion pool links multiple purchases despite different reference KRW values, without inventing the shortfall', () => {
    const input = poolRows(),
        output = inferExchangeFunding(input);
    assert.equal(output[2]._fundingSuggestion.convertedAmount, 6);
    assert.equal(output[3]._fundingSuggestion.convertedAmount, 4);
    assert.equal(output[3]._fundingSuggestion.unconfirmedAmount, 3);
    assert.equal(
        output[2]._fundingSuggestion.paidKrw +
            output[3]._fundingSuggestion.paidKrw,
        14000
    );
    assert.equal(input[2]._fundingSuggestion, undefined);
    const reordered = inferExchangeFunding([...input].reverse());
    assert.equal(
        reordered.find((r) => r.externalId === 'buy-a')._fundingSuggestion
            .convertedAmount,
        6
    );
    assert.equal(
        reordered.find((r) => r.externalId === 'buy-b')._fundingSuggestion
            .convertedAmount,
        4
    );
});

test('balanced repeated conversions are paired once; cancelled conversion and another date/account cannot supply a purchase', () => {
    const input = poolRows();
    const repeated = inferExchangeFunding([
        ...input.slice(0, 2),
        ...input
            .slice(0, 2)
            .map((r) => ({ ...r, externalId: r.externalId + '-2' })),
        ...input.slice(2),
    ]);
    assert.equal(repeated[5]._fundingSuggestion.convertedAmount, 7);
    const cancelled = inferExchangeFunding([
        ...input,
        {
            ...input[1],
            type: 'cash_out',
            cashKind: 'unknown',
            rawType: '환전외화입금취소',
            externalId: 'cancel',
        },
    ]);
    assert.equal(cancelled[2]._fundingStatus, 'needs_review');
    assert.equal(cancelled[2]._fundingSuggestion, undefined);
    const differentDay = inferExchangeFunding(
        input.map((r, i) => (i >= 2 ? { ...r, date: '2026-10-16' } : r))
    );
    assert.equal(differentDay[2]._fundingSuggestion, undefined);
    const differentAccount = inferExchangeFunding(
        input.map((r, i) => ({ ...r, accountId: i >= 2 ? 'other' : 'owner' }))
    );
    assert.equal(differentAccount[2]._fundingSuggestion, undefined);
});

test('overlapping PDFs do not duplicate pool money, and cash edits clear derived links', () => {
    const input = poolRows();
    const output = inferExchangeFunding([
        ...input,
        ...input.map((r) => ({ ...r })),
    ]);
    assert.equal(
        output.filter((r) => r._fundingStatus === 'matched_exchange').length,
        2
    );
    assert.equal(output[3]._fundingSuggestion.convertedAmount, 4);
    const edited = inferExchangeFunding(
        output.map((r, i) => (i === 0 ? { ...r, amount: 20000 } : r))
    );
    assert.equal(edited[2]._fundingSuggestion, undefined);
});

test('cash registration excludes funded conversion withdrawals while retaining raw evidence and owner annotations', () => {
    const input = poolRows();
    const importedCash = input.slice(0, 2).map((row, index) => ({
        ...row,
        id: `cash-${index}`,
        suggestedKind: row.cashKind,
    }));
    const trades = input
        .slice(2)
        .map((row, index) => ({ ...row, id: `trade-${index}` }));
    const source = {
        entries: importedCash,
        importedCash,
        trades,
        allocations: [],
        classifications: [],
    };
    const state = markPurchaseExchangeCash(source);
    assert.equal(source.entries[0].purchaseExchange, undefined);
    assert.equal(state.entries.length, 2);
    assert.equal(state.entries[0].purchaseExchange, true);
    assert.equal(state.entries[1].purchaseExchange, undefined);
    assert.equal(capitalSummary(state.entries, []).pending, 1);
    const mistaken = [
        {
            id: 'cash-0',
            classification: 'principal_withdrawal',
            withdrawalParts: {
                principal: 14000,
                dividend: 0,
                profit: 0,
                unknown: 0,
            },
        },
    ];
    assert.equal(capitalSummary(state.entries, mistaken).KRW.withdrawals, 0);
    assert.equal(capitalRecovery(state.entries, mistaken)[0].recovered, 0);
    assert.equal(state.allocations.length, 2);
    for (const allocation of state.allocations)
        validateFunding(
            allocation,
            trades.find((t) => t.id === allocation.transactionId)
        );
    const saved = {
        ...state.allocations[0],
        derived: undefined,
        revision: 3,
        note: 'owner annotation',
    };
    const refreshed = markPurchaseExchangeCash({
        ...source,
        allocations: [saved],
    });
    assert.equal(
        refreshed.allocations.find(
            (a) => a.transactionId === saved.transactionId
        ).note,
        'owner annotation'
    );
    assert.equal(
        purchaseExchangeWithdrawalIndices(inferExchangeFunding(input)).size,
        1
    );
});

test('a purchase can use more than five conversion pairs, with a bounded evidence list', () => {
    const template = poolRows();
    const input = Array.from({ length: 7 }, (_, i) =>
        template
            .slice(0, 2)
            .map((r) => ({ ...r, externalId: r.externalId + i }))
    ).flat();
    input.push({ ...template[2], nativeSettlementAmount: 70 });
    const result = inferExchangeFunding(input);
    const suggestion = result.at(-1)._fundingSuggestion;
    assert.equal(suggestion.convertedAmount, 70);
    assert.equal(suggestion.legs.length, 7);
    const importedCash = input
        .slice(0, -1)
        .map((r, i) => ({ ...r, id: `cash-${i}`, suggestedKind: r.cashKind }));
    const trade = { ...input.at(-1), id: 'buy' };
    const state = markPurchaseExchangeCash({
        entries: importedCash,
        importedCash,
        trades: [trade],
        allocations: [],
    });
    assert.equal(state.allocations[0].evidenceIds.length, 14);
    validateFunding(state.allocations[0], trade);
    assert.throws(() =>
        validateFunding(
            {
                ...state.allocations[0],
                evidenceIds: Array.from(
                    { length: MAX_FUNDING_EVIDENCE + 1 },
                    (_, i) => 'cash-' + i
                ),
            },
            trade
        )
    );
});

test('both currency legs of forward/reverse conversions are linked and cleared after edits', () => {
    const forward = inferExchangeFunding(poolRows());
    assert.equal(forward[0]._exchangePeerIndex, 1);
    assert.equal(forward[1]._exchangePeerIndex, 0);
    const reversed = poolRows()
        .slice(0, 2)
        .map((row) => ({
            ...row,
            type: row.type === 'cash_in' ? 'cash_out' : 'cash_in',
            rawType: row.currency === 'USD' ? '환전외화출금' : '환전원화입금',
        }));
    const result = inferExchangeFunding(reversed);
    assert.equal(result[0]._exchangePeerIndex, 1);
    assert.equal(result[1]._exchangeStatus, 'matched');
    const changed = inferExchangeFunding(
        result.map((row, i) => (i === 0 ? { ...row, date: '2026-10-16' } : row))
    );
    assert.equal(changed[0]._exchangePeerIndex, undefined);
    assert.equal(changed[1]._exchangePeerIndex, undefined);
});

test('legacy exact matches also keep accounts separate', () => {
    const input = poolRows();
    input[1].exchangeRate = undefined;
    input[2].nativeSettlementAmount = 10;
    input[2].settlementAmount = 14000;
    const result = inferExchangeFunding(
        input.map((row, index) => ({
            ...row,
            accountId: index < 2 ? 'owner' : 'other',
        }))
    );
    assert.equal(result[2]._fundingSuggestion, undefined);
});
