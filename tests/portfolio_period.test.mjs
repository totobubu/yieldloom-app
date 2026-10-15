import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatPortfolioQuantity,
    portfolioAssetsInPeriod,
} from '../src/services/portfolioPeriod.js';
import { summarizePortfolio } from '../src/services/portfolioSummary.js';

test('six decimal share precision survives formatting, including a millionth of a share', () => {
    assert.equal(formatPortfolioQuantity(0.144987), '0.144987');
    assert.equal(formatPortfolioQuantity(0.000001), '0.000001');
    assert.equal(formatPortfolioQuantity(15.813845), '15.813845');
    assert.equal(formatPortfolioQuantity(0), '0');
    assert.equal(formatPortfolioQuantity(null), '—');
});

const assets = [
    {
        id: 'A',
        portfolioPriority: 'current',
        holdingShares: 15.813845,
        transactions: [
            { date: '20241231', type: 'dividend', amount: 90 },
            { date: '2025-01-01', type: 'dividend', amount: 100 },
            { date: '2025.12.31', type: 'dividend_reversal', amount: 20 },
            { date: '20260101', type: 'dividend', amount: 200 },
        ],
    },
];

test('a year includes both boundaries and subtracts dividend cancellations without changing holdings', () => {
    const scoped = portfolioAssetsInPeriod(assets, '2025-01-01', '2025-12-31');
    const result = summarizePortfolio(scoped);
    assert.equal(result.summary.dividendTotal, 80);
    assert.equal(result.transactions.length, 2);
    assert.equal(scoped[0].holdingShares, 15.813845);
    assert.equal(result.summary.currentCount, 1);
    assert.equal(assets[0].transactions.length, 4);
});

test('all periods, single-day ranges and empty periods are distinct', () => {
    assert.equal(
        summarizePortfolio(portfolioAssetsInPeriod(assets)).summary
            .dividendTotal,
        370
    );
    assert.equal(
        summarizePortfolio(
            portfolioAssetsInPeriod(assets, '2026-01-01', '2026-01-01')
        ).summary.dividendTotal,
        200
    );
    assert.equal(
        summarizePortfolio(
            portfolioAssetsInPeriod(assets, '2023-01-01', '2023-12-31')
        ).transactions.length,
        0
    );
});
