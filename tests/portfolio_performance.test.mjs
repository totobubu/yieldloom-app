import test from 'node:test';
import assert from 'node:assert/strict';
import { closedPositionPerformance } from '../src/services/portfolioPerformance.js';

const closed = (transactions) => ({
    portfolioPriority: 'historical',
    transactions,
});

test('closed position uses settled cash without charging fees twice and adds net dividends', () => {
    const result = closedPositionPerformance(
        closed([
            {
                type: 'buy',
                quantity: 10,
                amount: 1000,
                settlementAmount: 1002,
                commission: 2,
            },
            {
                type: 'sell',
                quantity: 10,
                amount: 1100,
                settlementAmount: 1098,
                commission: 1,
                tax: 1,
            },
            { type: 'dividend', amount: 10 },
            { type: 'dividend_reversal', amount: 2 },
        ])
    );
    assert.equal(result.available, true);
    assert.equal(result.purchaseCost, 1002);
    assert.equal(result.saleProceeds, 1098);
    assert.equal(result.tradingProfit, 96);
    assert.equal(result.dividends, 8);
    assert.equal(result.totalProfit, 104);
    assert.equal(result.totalReturnPercent, (104 / 1002) * 100);
});

test('older rows fall back to trade amounts and fees and preserve losses', () => {
    const result = closedPositionPerformance(
        closed([
            { type: 'buy', quantity: 0.144987, amount: 1000, commission: 2 },
            {
                type: 'sell',
                quantity: 0.144987,
                amount: 900,
                commission: 2,
                tax: 1,
            },
        ])
    );
    assert.equal(result.tradingProfit, -105);
    assert.equal(result.totalProfit, -105);
});

test('multiple closed cycles need no assumed lot ordering', () => {
    const result = closedPositionPerformance(
        closed([
            { type: 'sell', quantity: 0.2, amount: 300 },
            { type: 'buy', quantity: 0.1, amount: 100 },
            { type: 'buy', quantity: 0.1, amount: 120 },
        ])
    );
    assert.equal(result.available, true);
    assert.equal(result.tradingProfit, 80);
});

test('missing basis, stock events and incomplete or failed ledgers never produce a profit', () => {
    for (const asset of [
        closed([{ type: 'sell', quantity: 1, amount: 500 }]),
        closed([
            { type: 'buy', quantity: 1, amount: 100 },
            { type: 'sell', quantity: 0.9, amount: 200 },
        ]),
        closed([
            { type: 'buy', quantity: 1, amount: 100 },
            { type: 'sell', quantity: 1, amount: 200 },
            { type: 'unknown', rawType: '타사대체입고', quantity: 1 },
        ]),
        closed([{ type: 'unknown', rawType: '주식병합입고', quantity: 0 }]),
        { ...closed([]), ledgerUnavailable: true },
        { portfolioPriority: 'current', transactions: [] },
        closed([]),
    ]) {
        const result = closedPositionPerformance(asset);
        assert.equal(result.available, false);
        assert.equal(result.totalProfit, undefined);
        assert.ok(result.reason);
    }
});

test('KRW profit and USD profit use their own settled cash amounts, even with opposite signs', () => {
    const asset = closed([
        {
            type: 'buy',
            quantity: 1,
            amount: 100000,
            settlementAmount: 100000,
            nativeAmount: 100,
            nativeSettlementAmount: 100,
        },
        {
            type: 'sell',
            quantity: 1,
            amount: 120000,
            settlementAmount: 120000,
            nativeAmount: 90,
            nativeSettlementAmount: 90,
        },
        { type: 'dividend', amount: 2000, nativeAmount: 2 },
    ]);
    assert.equal(closedPositionPerformance(asset).totalProfit, 22000);
    assert.equal(closedPositionPerformance(asset, 'USD').totalProfit, -8);
    const incomplete = closed([
        { type: 'buy', quantity: 1, amount: 100 },
        { type: 'sell', quantity: 1, amount: 200 },
    ]);
    assert.equal(closedPositionPerformance(incomplete, 'USD').available, false);
});
