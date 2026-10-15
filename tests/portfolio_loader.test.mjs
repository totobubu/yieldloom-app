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

async function dashboardWith(getDocs, tag) {
    const source = (
        await readFile(
            new URL('../src/services/portfolio.js', import.meta.url),
            'utf8'
        )
    ).replace(/^import .*;$/gm, '');
    globalThis.__portfolioFixture = {
        db: {},
        summarizePortfolio,
        apiUrl: (p) => p,
        collection: (...path) => path.slice(1).join('/'),
        query: (p) => p,
        getDocs,
    };
    try {
        const prelude =
            'const { db, summarizePortfolio, apiUrl, collection, query, getDocs } = globalThis.__portfolioFixture;\n';
        const module = await import(
            `data:text/javascript;base64,${Buffer.from(prelude + source + '\n//' + tag).toString('base64')}`
        );
        return await module.loadPortfolioDashboard('owner');
    } finally {
        delete globalThis.__portfolioFixture;
    }
}
const holdingSnapshot = {
    docs: [
        {
            id: 'A',
            data: () => ({
                symbol: 'TOPW',
                portfolioPriority: 'current',
                holdingShares: 10,
            }),
        },
    ],
};
const denied = () =>
    Object.assign(new Error('Permission denied'), {
        code: 'permission-denied',
    });

test('denied legacy lookup preserves current holdings and reports a warning', async () => {
    const dashboard = await dashboardWith(async (path) => {
        if (path === 'portfolios/owner/assets') return holdingSnapshot;
        if (path === 'portfolios/owner/assets/A/transactions')
            return { empty: true, docs: [] };
        if (path === 'adminPortfolios/owner/assets') throw denied();
        throw new Error(path);
    }, 'legacy-denied');
    assert.equal(dashboard.summary.currentCount, 1);
    assert.equal(dashboard.assets[0].holdingShares, 10);
    assert.equal(dashboard.summary.historicalCount, null);
    assert.deepEqual(dashboard.warnings, [
        { stage: 'legacy', code: 'permission-denied' },
    ]);
});

test('denied transaction lookup preserves holdings but marks unavailable ledger', async () => {
    const dashboard = await dashboardWith(async (path) => {
        if (path === 'portfolios/owner/assets') return holdingSnapshot;
        if (path === 'portfolios/owner/assets/A/transactions') throw denied();
        throw new Error(path);
    }, 'transactions-denied');
    assert.equal(dashboard.summary.currentCount, 1);
    assert.equal(dashboard.assets[0].ledgerUnavailable, true);
    assert.deepEqual(dashboard.warnings, [
        { stage: 'transactions', code: 'permission-denied' },
    ]);
});

test('denied primary holdings lookup remains an error with its stage', async () => {
    await assert.rejects(
        dashboardWith(async () => {
            throw denied();
        }, 'assets-denied'),
        (error) =>
            error.code === 'permission-denied' &&
            error.portfolioStage === 'assets'
    );
});

test('successful empty legacy lookup reports a confirmed zero history count', async () => {
    const dashboard = await dashboardWith(async (path) => {
        if (path === 'portfolios/owner/assets') return holdingSnapshot;
        return { empty: true, docs: [] };
    }, 'legacy-empty');
    assert.equal(dashboard.summary.historicalCount, 0);
    assert.deepEqual(dashboard.warnings, []);
});
