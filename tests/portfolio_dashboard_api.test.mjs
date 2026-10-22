import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioDashboardHandler } from '../lib/portfolio-dashboard-handler.js';

function fixture(records, failTransactions = false) {
    const operations = [];
    const documents = [...records.entries()].map(([path, data]) => ({
        id: path.split('/').at(-1),
        ref: { path },
        data: () => data,
    }));
    const db = {
        doc: (path) => ({ path }),
        collection: (path) => ({
            get: async () => {
                operations.push(path);
                return {
                    docs: documents.filter(
                        (item) =>
                            item.ref.path.split('/').slice(0, -1).join('/') ===
                            path
                    ),
                };
            },
        }),
        collectionGroup: () => {
            let start, end;
            const query = {
                orderBy() {
                    return query;
                },
                startAt(ref) {
                    start = ref.path;
                    return query;
                },
                endAt(ref) {
                    end = ref.path;
                    return query;
                },
                async get() {
                    operations.push(`transactions:${start}:${end}`);
                    if (failTransactions)
                        throw Object.assign(new Error('denied'), {
                            code: 'permission-denied',
                        });
                    return {
                        docs: documents.filter(
                            (item) =>
                                item.ref.path.includes('/transactions/') &&
                                item.ref.path >= start &&
                                item.ref.path <= end
                        ),
                    };
                },
            };
            return query;
        },
    };
    return { db, operations };
}

async function invoke(
    records,
    { method = 'GET', uid = 'owner', failTransactions = false } = {}
) {
    const source = fixture(records, failTransactions);
    const headers = new Map();
    let status, body;
    const handler = portfolioDashboardHandler({
        verify: async () => ({ uid }),
        database: () => source.db,
        documentId: '__name__',
    });
    await handler(
        { method },
        {
            setHeader: (name, value) => headers.set(name, value),
            status(value) {
                status = value;
                return this;
            },
            json(value) {
                body = value;
                return this;
            },
        }
    );
    return { ...source, headers, status, body };
}

test('dashboard reads all current transactions with two Firestore queries', async () => {
    const result = await invoke(
        new Map([
            ['portfolios/owner/assets/A', { symbol: 'AAA' }],
            ['portfolios/owner/assets/B', { symbol: 'BBB' }],
            ['portfolios/owner/assets/A/transactions/T1', { type: 'buy' }],
            ['portfolios/owner/assets/B/transactions/T2', { type: 'sell' }],
            ['portfolios/other/assets/X/transactions/PRIVATE', { type: 'buy' }],
        ])
    );
    assert.equal(result.status, 200);
    assert.equal(result.operations.length, 2);
    assert.deepEqual(
        result.body.assets.map((asset) => [
            asset.id,
            asset.transactions.map((row) => row.id),
        ]),
        [
            ['A', ['T1']],
            ['B', ['T2']],
        ]
    );
    assert.equal(result.headers.get('X-Portfolio-Read-Operations'), '2');
    assert.equal(result.headers.get('X-Portfolio-Document-Reads'), '4');
});

test('empty current ledger merges legacy transactions with four queries', async () => {
    const result = await invoke(
        new Map([
            [
                'portfolios/owner/assets/A',
                { symbol: 'AAA', portfolioPriority: 'current' },
            ],
            ['adminPortfolios/owner/assets/A', { symbol: 'AAA' }],
            [
                'adminPortfolios/owner/assets/A/transactions/OLD',
                { type: 'dividend' },
            ],
        ])
    );
    assert.equal(result.status, 200);
    assert.equal(result.operations.length, 4);
    assert.equal(result.body.assets[0].portfolioPriority, 'current');
    assert.equal(result.body.assets[0].transactions[0].id, 'OLD');
    assert.equal(result.headers.get('X-Portfolio-Read-Operations'), '4');
});

test('dashboard rejects unsupported methods before reading Firestore', async () => {
    const result = await invoke(new Map(), { method: 'POST' });
    assert.equal(result.status, 405);
    assert.equal(result.operations.length, 0);
});

test('transaction query failures preserve holdings and report an incomplete ledger', async () => {
    const result = await invoke(
        new Map([
            ['portfolios/owner/assets/A', { symbol: 'AAA', holdingShares: 10 }],
        ]),
        { failTransactions: true }
    );
    assert.equal(result.status, 200);
    assert.equal(result.operations.length, 2);
    assert.equal(result.body.assets[0].holdingShares, 10);
    assert.equal(result.body.assets[0].ledgerUnavailable, true);
    assert.deepEqual(result.body.warnings, [
        { stage: 'transactions', code: 'permission-denied' },
    ]);
});
