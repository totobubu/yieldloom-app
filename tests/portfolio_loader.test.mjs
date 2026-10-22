import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizePortfolio } from '../src/services/portfolioSummary.js';

const user = {
    uid: 'owner',
    getIdToken: async () => 'token',
};

async function portfolioModule(tag, getDocs = async () => ({ docs: [] })) {
    const source = (
        await readFile(
            new URL('../src/services/portfolio.js', import.meta.url),
            'utf8'
        )
    ).replace(/^import .*;$/gm, '');
    globalThis.__portfolioFixture = {
        db: {},
        firebaseUser: { value: user },
        summarizePortfolio,
        apiUrl: (path) => path,
        collection: (...path) => path.slice(1).join('/'),
        query: (path) => path,
        getDocs,
    };
    try {
        const prelude =
            'const { db, firebaseUser, summarizePortfolio, apiUrl, collection, query, getDocs } = globalThis.__portfolioFixture;\n';
        return await import(
            `data:text/javascript;base64,${Buffer.from(prelude + source + '\n//' + tag).toString('base64')}`
        );
    } finally {
        delete globalThis.__portfolioFixture;
    }
}

test('dashboard loader uses one authenticated API request and summarizes its assets', async () => {
    const module = await portfolioModule('dashboard-api');
    let request;
    const dashboard = await module.loadPortfolioDashboard('owner', {
        user,
        fetcher: async (url, options) => {
            request = { url, options };
            return {
                ok: true,
                json: async () => ({
                    assets: [
                        {
                            id: 'A',
                            symbol: 'TOPW',
                            portfolioPriority: 'current',
                            transactions: [
                                {
                                    id: 'T',
                                    type: 'dividend',
                                    date: '20261001',
                                    amount: 1250,
                                },
                            ],
                        },
                    ],
                }),
            };
        },
    });
    assert.equal(request.url, '/api/portfolio-capital?view=dashboard');
    assert.equal(request.options.headers.Authorization, 'Bearer token');
    assert.equal(request.options.cache, 'no-store');
    assert.equal(dashboard.summary.currentCount, 1);
    assert.equal(dashboard.summary.dividendTotal, 1250);
    assert.equal(dashboard.transactions.length, 1);
});

test('concurrent dashboard loads for one owner share one API request', async () => {
    const module = await portfolioModule('shared-dashboard');
    let calls = 0,
        release;
    const waiting = new Promise((resolve) => {
        release = resolve;
    });
    const fetcher = async () => {
        calls++;
        await waiting;
        return { ok: true, json: async () => ({ assets: [] }) };
    };
    const first = module.loadPortfolioDashboard('owner', { user, fetcher });
    const second = module.loadPortfolioDashboard('owner', { user, fetcher });
    release();
    await Promise.all([first, second]);
    assert.equal(calls, 1);
});

test('dashboard API errors preserve quota status and code', async () => {
    const module = await portfolioModule('dashboard-error');
    await assert.rejects(
        module.loadPortfolioDashboard('owner', {
            user,
            fetcher: async () => ({
                ok: false,
                status: 429,
                json: async () => ({
                    code: 'DATA_RESOURCE_EXHAUSTED',
                    error: '데이터베이스 요청이 제한되었습니다.',
                }),
            }),
        }),
        (error) =>
            error.status === 429 && error.code === 'DATA_RESOURCE_EXHAUSTED'
    );
});

test('legacy API warnings keep the unknown history state', async () => {
    const module = await portfolioModule('dashboard-warning');
    const dashboard = await module.loadPortfolioDashboard('owner', {
        user,
        fetcher: async () => ({
            ok: true,
            json: async () => ({
                assets: [
                    {
                        id: 'A',
                        symbol: 'TOPW',
                        portfolioPriority: 'current',
                        holdingShares: 10,
                        transactions: [],
                        ledgerUnavailable: true,
                    },
                ],
                warnings: [{ stage: 'legacy', code: 'permission-denied' }],
            }),
        }),
    });
    assert.equal(dashboard.assets[0].holdingShares, 10);
    assert.equal(dashboard.summary.historicalCount, null);
    assert.equal(dashboard.warnings[0].stage, 'legacy');
});

test('asset-only lookup remains a direct single collection query', async () => {
    let reads = 0;
    const module = await portfolioModule('asset-lookup', async (path) => {
        reads++;
        assert.equal(path, 'portfolios/owner/assets');
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
    });
    const assets = await module.loadPortfolioAssets('owner');
    assert.equal(reads, 1);
    assert.equal(assets[0].id, 'A');
    assert.equal(module.portfolioTickerStates(assets).get('TOPW'), 'current');
});
