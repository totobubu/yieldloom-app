import test from 'node:test';
import assert from 'node:assert/strict';
import { purchaseBasis } from '../lib/portfolio-capital.js';
import {
    transactionAmountRows,
    transactionMoney,
    transactionRate,
} from '../src/services/transactionAmount.js';

const trade = {
    type: 'buy',
    rawType: '구매',
    date: '20261015',
    amount: 140000,
    nativeAmount: 100,
    settlementAmount: 140140,
    nativeSettlementAmount: 100.1,
    exchangeRate: 1400,
};
const allocation = (parts) => ({
    status: 'confirmed',
    basisKey: purchaseBasis(trade).basisKey,
    parts,
    evidenceIds: [],
});
test('statement dollars remain primary with original won value, recorded FX and six decimals', () => {
    const rows = transactionAmountRows({
        ...trade,
        nativeAmount: 4.999993,
        amount: 6692,
        exchangeRate: 1338.6,
    });
    assert.equal(rows.length, 1);
    assert.equal(
        transactionMoney(rows[0].amount, rows[0].currency),
        '$4.999993'
    );
    assert.equal(rows[0].secondary.amount, 6692);
    assert.equal(transactionRate(rows[0].rate), '1,338.60');
    assert.equal(rows[0].note, '결제 구성 확인 필요');
});
test('confirmed mixed funding yields USD then actual KRW, without charging the conversion twice', () => {
    const saved = allocation([
        {
            method: 'krw_conversion',
            amount: 30.1,
            paidKrw: 42140,
            source: 'principal',
        },
        { method: 'usd_balance', amount: 70, source: 'dividend' },
    ]);
    const rows = transactionAmountRows(trade, saved);
    assert.deepEqual(
        rows.map((row) => [row.currency, row.amount]),
        [
            ['USD', 70],
            ['KRW', 42140],
        ]
    );
    assert.equal(rows[0].secondary.amount, 98000);
    assert.equal(rows[1].secondary.amount, 30.1);
    assert.equal(rows[1].rate.value, 1400);
    assert.equal(rows[1].rate.kind, 'confirmed');
    assert.equal(saved.parts[0].amount, 30.1);
    assert.equal(trade.amount, 140000);
});
test('different source allocations of the same currency combine into one payment row', () => {
    const saved = allocation([
        { method: 'usd_balance', amount: 60, source: 'principal' },
        { method: 'usd_balance', amount: 40.1, source: 'dividend' },
    ]);
    assert.equal(transactionAmountRows(trade, saved).length, 1);
    assert.equal(transactionAmountRows(trade, saved)[0].amount, 100.1);
    const split = allocation([
        {
            method: 'krw_conversion',
            amount: 50,
            paidKrw: 70000,
            source: 'principal',
        },
        {
            method: 'krw_conversion',
            amount: 50.1,
            paidKrw: 71142,
            source: 'principal',
        },
    ]);
    const rows = transactionAmountRows(trade, split);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount, 141142);
    assert.equal(rows[0].rate.kind, 'weighted');
});
test('stale, reset, incomplete and unknown-method funding fall back to statement amounts', () => {
    const saved = allocation([
        { method: 'usd_balance', amount: 70, source: 'dividend' },
        {
            method: 'krw_conversion',
            amount: 30.1,
            paidKrw: 42140,
            source: 'principal',
        },
    ]);
    for (const bad of [
        { ...saved, basisKey: 'old' },
        { ...saved, status: 'reset' },
        { ...saved, parts: [saved.parts[0]] },
        {
            ...saved,
            parts: [{ method: 'unknown', amount: 100.1, source: 'unknown' }],
        },
    ]) {
        const rows = transactionAmountRows(trade, bad);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].amount, 100);
        assert.equal(rows[0].note, '결제 구성 확인 필요');
    }
    const partial = {
        ...saved,
        status: 'partial',
        parts: saved.parts.map((p) => ({ ...p, source: 'unknown' })),
    };
    const rows = transactionAmountRows(trade, partial);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].note, '자금 출처 확인 필요');
});
test('zero fees and amounts display a hyphen while negative values and a millionth dollar survive', () => {
    for (const currency of ['USD', 'KRW'])
        for (const amount of [0, -0, null, undefined, NaN, '0'])
            assert.equal(transactionMoney(amount, currency), '-');
    assert.equal(transactionMoney(0.000001, 'USD'), '$0.000001');
    assert.equal(transactionMoney(-5, 'USD'), '$-5.00');
    assert.equal(transactionMoney(103), '₩103');
    assert.equal(
        transactionAmountRows({ ...trade, type: 'dividend' })[0].note,
        ''
    );
});
