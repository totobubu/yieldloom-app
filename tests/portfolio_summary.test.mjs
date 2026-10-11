import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePortfolio } from '../src/services/portfolioSummary.js';

test('summarizes holdings and orders all ledger rows by date', () => {
    const dashboard = summarizePortfolio([
        { id: 'B', symbol: 'BETA', name: '베타', portfolioPriority: 'historical', transactions: [{ type: 'sell', date: '20240102', amount: 20 }] },
        { id: 'A', symbol: 'ALPHA', portfolioPriority: 'current', transactions: [{ type: 'buy', date: '20240101', amount: 100 }, { type: 'dividend', date: '20240301', amount: -12 }] },
    ]);
    assert.equal(dashboard.summary.currentCount, 1);
    assert.equal(dashboard.summary.historicalCount, 1);
    assert.equal(dashboard.summary.dividendTotal, 12);
    assert.equal(dashboard.assets[0].ticker, 'ALPHA');
    assert.equal(dashboard.transactions[0].date, '20240301');
});
