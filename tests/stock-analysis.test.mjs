import test from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateCandles,
    monthlyDividendSeries,
    stockHoldingMetrics,
} from '../src/services/stockAnalysis.js';
test('weekly and monthly candles preserve OHLC order, sum volume, and expose actual period end', () => {
    const rows = [
        {
            date: '2026-01-02',
            open: 10,
            high: 14,
            low: 9,
            close: 12,
            volume: 100,
        },
        {
            date: '2026-01-05',
            open: 12,
            high: 15,
            low: 11,
            close: 14,
            volume: 200,
        },
        {
            date: '2026-01-06',
            open: 14,
            high: 16,
            low: 10,
            close: 11,
            volume: 300,
        },
    ];
    assert.equal(aggregateCandles(rows, 'week').length, 2);
    assert.deepEqual(aggregateCandles(rows, 'week')[1], {
        date: '2026-01-05',
        endDate: '2026-01-06',
        open: 12,
        high: 16,
        low: 10,
        close: 11,
        volume: 500,
    });
    assert.deepEqual(aggregateCandles(rows, 'month')[0], {
        date: '2026-01-02',
        endDate: '2026-01-06',
        open: 10,
        high: 16,
        low: 9,
        close: 11,
        volume: 600,
    });
    assert.equal(
        aggregateCandles([{ ...rows[0], volume: null }, rows[1]], 'month')[0]
            .volume,
        null
    );
});
test('monthly dividends distinguish missing data from zero and exclude future forecasts', () => {
    const result = monthlyDividendSeries(
        [
            { date: '2024-01-01', amount: 0.1 },
            { date: '2025-02-02', amount: 0.5 },
            { date: '2026-02-02', amount: 0.4 },
            { date: '2026-02-09', amount: 0.4, amountFixed: 0.6 },
            { date: '2026-03-02', amount: 999, forecasted: true },
            { date: '2027-03-02', amount: 999 },
        ],
        '2026-03-15',
        3
    );
    assert.equal(result[0].total, null);
    assert.equal(result[1].total, 1);
    assert.equal(result[1].count, 2);
    assert.equal(result[1].average, 0.5);
    assert.equal(result[1].growth, 100);
    assert.equal(result[2].total, null);
    assert.equal(result[2].partial, true);
});
const asset = {
    holdingShares: 5,
    transactions: [
        {
            date: '20240101',
            type: 'buy',
            quantity: 10,
            amount: 1300000,
            nativeAmount: 1000,
            currency: 'USD',
        },
        {
            date: '20240201',
            type: 'buy',
            quantity: 10,
            amount: 2600000,
            nativeAmount: 2000,
            currency: 'USD',
        },
        {
            date: '20240301',
            type: 'sell',
            quantity: 15,
            amount: 2925000,
            nativeAmount: 2250,
            currency: 'USD',
        },
        {
            date: '20240401',
            type: 'dividend',
            amount: 130000,
            nativeAmount: 100,
            currency: 'USD',
        },
    ],
};
test('holding metrics keep KRW dividends separate and reconcile FIFO and total cash flows', () => {
    const result = stockHoldingMetrics(asset, 250, 'USD');
    assert.equal(result.averageCost, 200);
    assert.equal(result.wonDividends, 130000);
    assert.equal(result.totalProfit, 600);
    assert.equal(result.totalReturn, 20);
    assert.equal(result.firstBuy, '2024-01-01');
});
test('incomplete or inconsistent ledgers never create fabricated returns', () => {
    assert.equal(
        stockHoldingMetrics({ ...asset, holdingShares: 6 }, 250).totalProfit,
        null
    );
    const incomplete = {
        ...asset,
        transactions: asset.transactions.map((row) => ({
            ...row,
            nativeAmount: undefined,
        })),
    };
    assert.equal(stockHoldingMetrics(incomplete, 250).averageCost, null);
    assert.equal(stockHoldingMetrics(incomplete, 250).totalProfit, null);
    assert.equal(
        stockHoldingMetrics({ holdingShares: 5, transactions: [] }, 250)
            .wonDividends,
        null
    );
});
