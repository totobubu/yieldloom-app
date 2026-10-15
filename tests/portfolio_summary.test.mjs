import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePortfolio } from '../src/services/portfolioSummary.js';

test('summarizes holdings and orders all ledger rows by date', () => {
    const dashboard = summarizePortfolio([
        {
            id: 'B',
            symbol: 'BETA',
            name: '베타',
            portfolioPriority: 'historical',
            transactions: [{ type: 'sell', date: '20240102', amount: 20 }],
        },
        {
            id: 'A',
            symbol: 'ALPHA',
            portfolioPriority: 'current',
            transactions: [
                { type: 'buy', date: '20240101', amount: 100 },
                { type: 'dividend', date: '20240301', amount: -12 },
            ],
        },
    ]);
    assert.equal(dashboard.summary.currentCount, 1);
    assert.equal(dashboard.summary.historicalCount, 1);
    assert.equal(dashboard.summary.dividendTotal, 12);
    assert.equal(dashboard.assets[0].ticker, 'ALPHA');
    assert.equal(dashboard.transactions[0].date, '20240301');
});

test('normalizes legacy PDF ledger fields for dividends, counts, and recent activity', () => {
    const dashboard = summarizePortfolio([
        {
            id: 'A',
            symbol: 'TOPW',
            portfolioPriority: 'current',
            transactions: [
                {
                    type: '해외주식매수',
                    date: '2026.09.01',
                    transaction_amount_krw: '10,000',
                },
                {
                    type: '배당금입금',
                    date: '2026.10.01',
                    transaction_amount_krw: '1,250',
                    tax_krw: '150',
                },
            ],
        },
    ]);
    assert.equal(dashboard.summary.dividendTotal, 1250);
    assert.equal(dashboard.assets[0].transactionCounts.buy, 1);
    assert.equal(dashboard.assets[0].transactionCounts.dividend, 1);
    assert.equal(dashboard.transactions[0].tax, 150);
    assert.equal(dashboard.summary.latestTransactionDate, '2026.10.01');
});

test('Toss purchase and sale labels are counted even for previously unknown imports', () => {
    const dashboard = summarizePortfolio([
        {
            id: 'A',
            symbol: 'TOPW',
            transactions: [
                {
                    type: 'unknown',
                    rawType: '구매',
                    date: '20261001',
                    amount: 100,
                },
                { type: '판매', date: '20261002', amount: 50 },
                { type: '외화증권배당금입금', date: '20261003', amount: 12 },
            ],
        },
    ]);
    assert.deepEqual(dashboard.assets[0].transactionCounts, {
        buy: 1,
        sell: 1,
        dividend: 1,
    });
    assert.equal(dashboard.summary.dividendTotal, 12);
});

test('dividend cancellations reduce receipts instead of adding another payment', () => {
    const dashboard = summarizePortfolio([
        {
            id: 'A',
            transactions: [
                {
                    type: 'dividend',
                    rawType: '외화증권배당금입금',
                    amount: 100,
                },
                { type: 'dividend', rawType: '외화배당금취소출금', amount: 20 },
            ],
        },
    ]);
    assert.equal(dashboard.summary.dividendTotal, 80);
    assert.equal(dashboard.assets[0].transactionCounts.dividend, 1);
    assert.equal(dashboard.transactions[1].type, 'dividend_reversal');
});
