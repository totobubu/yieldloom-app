import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioActivity } from '../src/services/portfolioActivity.js';
import { summarizePortfolio } from '../src/services/portfolioSummary.js';
import {
    transactionAmountRows,
    transactionMoney,
} from '../src/services/transactionAmount.js';

const assets = [
    {
        id: 'A',
        symbol: 'TEST',
        transactions: [
            {
                id: 'B',
                type: 'buy',
                date: '20261014',
                amount: 100000,
                nativeAmount: 70,
            },
            {
                id: 'D',
                type: 'dividend',
                date: '20261001',
                amount: 10000,
                nativeAmount: 7,
            },
        ],
    },
];
const dashboard = summarizePortfolio(assets);
const state = {
    entries: [
        {
            id: 'W',
            date: '2026-10-15',
            currency: 'KRW',
            amount: 3000,
            rawType: '원화출금',
            suggestedKind: 'external_withdrawal',
        },
        {
            id: 'F',
            date: '20261014',
            currency: 'USD',
            amount: 10,
            rawType: '환전외화입금',
            suggestedKind: 'exchange',
        },
        {
            id: 'OLD',
            date: '20251231',
            currency: 'KRW',
            amount: 10000,
            suggestedKind: 'external_deposit',
        },
    ],
    classifications: [{ id: 'W', classification: 'dividend_withdrawal' }],
};
test('timeline includes withdrawal and exchange at inclusive dates, without changing dividend receipts', () => {
    const original = structuredClone(assets);
    const rows = portfolioActivity(dashboard.transactions, state, {
        start: '2026-10-01',
        end: '2026-10-15',
    });
    assert.equal(rows.length, 4);
    assert.equal(rows[0].type, 'dividend_withdrawal');
    assert.equal(rows[0].amount, -3000);
    assert.ok(rows[0].cashDetail.includes('배당 사용 ₩3,000'));
    assert.equal(rows[0].asset, null);
    assert.equal(dashboard.summary.dividendTotal, 10000);
    assert.deepEqual(assets, original);
});
test('stock filters exclude account events, while withdrawal source filters include mixed withdrawals', () => {
    assert.equal(
        portfolioActivity(dashboard.transactions, state, { ticker: 'TEST' })
            .length,
        2
    );
    assert.equal(
        portfolioActivity(dashboard.transactions, state, { type: 'cash_out' })
            .length,
        1
    );
    assert.equal(
        portfolioActivity(dashboard.transactions, state, { type: 'exchange' })
            .length,
        1
    );
    const mixed = {
        ...state,
        classifications: [
            {
                id: 'W',
                classification: 'mixed_withdrawal',
                withdrawalParts: { principal: 1000, dividend: 2000 },
            },
        ],
    };
    assert.equal(
        portfolioActivity(dashboard.transactions, mixed, {
            type: 'dividend_withdrawal',
        }).length,
        1
    );
    assert.equal(
        portfolioActivity(dashboard.transactions, mixed, {
            type: 'principal_withdrawal',
        }).length,
        1
    );
    assert.equal(
        portfolioActivity(dashboard.transactions, mixed, {
            type: 'profit_withdrawal',
        }).length,
        0
    );
});
test('unconfirmed withdrawals are visible but never silently labeled dividend spending', () => {
    const rows = portfolioActivity(
        [],
        { ...state, classifications: [] },
        { type: 'cash_out' }
    );
    assert.equal(rows[0].type, 'external_withdrawal');
    assert.equal(rows[0].withdrawalParts, null);
    assert.equal(rows[0].cashNote, '계좌 분류 확인 필요');
});

test('a manual withdrawal reset to unknown stays in the withdrawal filter and foreign cash is not relabeled as KRW', () => {
    const state = {
        entries: [
            {
                id: 'M',
                date: '20261015',
                currency: 'EUR',
                amount: 30,
                rawType: '사용자 입력',
                suggestedKind: 'dividend_withdrawal',
            },
        ],
        classifications: [{ id: 'M', classification: 'unknown' }],
    };
    const rows = portfolioActivity([], state, { type: 'cash_out' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cashNote, '출금 출처 확인 필요');
    const amount = transactionAmountRows(rows[0])[0];
    assert.equal(amount.currency, 'EUR');
    assert.equal(amount.amount, -30);
    assert.ok(!transactionMoney(amount.amount, amount.currency).includes('₩'));
});
