import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizePortfolio } from '../src/services/portfolioSummary.js';

test('dashboard loader reads holdings and ledger through its real entry point', async () => {
    const source = (
        await readFile(
            new URL('../src/services/portfolio.js', import.meta.url),
            'utf8'
        )
    ).replace(/^import .*;$/gm, '');
    const fixture = {
        db: {},
        summarizePortfolio,
        apiUrl: (path) => path,
        collection: (...path) => path.slice(1).join('/'),
        query: (path) => path,
        getDocs: async (path) => {
            if (path === 'portfolios/owner/assets')
                return {
                    docs: [
                        {
                            id: 'A',
                            data: () => ({
                                symbol: 'TOPW',
                                portfolioPriority: 'current',
                            }),
                        },
                    ],
                };
            if (path === 'portfolios/owner/assets/A/transactions')
                return {
                    empty: false,
                    docs: [
                        {
                            id: 'T',
                            data: () => ({
                                type: 'dividend',
                                date: '20261001',
                                amount: 1250,
                            }),
                        },
                    ],
                };
            throw new Error(`Unexpected query: ${path}`);
        },
    };
    globalThis.__portfolioFixture = fixture;
    try {
        const prelude =
            'const { db, summarizePortfolio, apiUrl, collection, query, getDocs } = globalThis.__portfolioFixture;\n';
        const module = await import(
            `data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}`
        );
        const result = await module.loadPortfolioDashboard('owner');
        assert.equal(result.summary.currentCount, 1);
        assert.equal(result.summary.dividendTotal, 1250);
        assert.equal(result.transactions.length, 1);
        assert.equal((await module.loadPortfolioAssets('owner'))[0].id, 'A');
        assert.equal(
            module.portfolioTickerStates(result.assets).get('TOPW'),
            'current'
        );
    } finally {
        delete globalThis.__portfolioFixture;
    }
});
