// Synthetic records only. Never import the private production report fixtures here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { sheetReportHandler } from '../lib/sheet-report-handler.js';
import {
    createPrivateReportStore,
    reportDigest,
    reportIndexKey,
} from '../lib/private-report-store.js';
import { createSheetReportClient } from '../src/services/sheetReports.js';

function fixture({
    claims,
    workbook = 'fictional-workbook',
    corrupt = false,
    crossAccount = false,
} = {}) {
    let storeReads = [],
        dbReads = 0;
    const index = {
        schemaVersion: 1,
        runId: 'synthetic-run',
        sourceBinding: {
            spreadsheetIdSha256: reportDigest('fictional-workbook'),
        },
        accounts: Object.fromEntries(
            ['wife', 'husband'].map((accountId) => [
                accountId,
                Object.fromEntries(
                    ['summary', 'details'].map((section) => [
                        section,
                        {
                            key: `reconciliation/dashboard/v1/synthetic/${accountId}/${section}.json`,
                            sha256: 'a'.repeat(64),
                        },
                    ])
                ),
            ])
        ),
    };
    const report = (key) => {
        const accountId = key.includes('/wife/') ? 'wife' : 'husband',
            section = key.endsWith('details.json') ? 'details' : 'summary';
        return {
            schemaVersion: 1,
            runId: 'synthetic-run',
            accountId: crossAccount ? 'other' : accountId,
            section,
            metrics: [],
            items: [],
            ...(corrupt ? { runId: 'other-run' } : {}),
        };
    };
    const db = {
        collection: () => ({
            doc: () => ({
                get: async () => {
                    dbReads++;
                    return { exists: true, data: () => ({ pageCount: 1 }) };
                },
                collection: () => ({
                    doc: () => ({
                        get: async () => {
                            dbReads++;
                            return {
                                data: () => ({
                                    rows: [
                                        {
                                            accountId: 'wife',
                                            source: { spreadsheetId: workbook },
                                        },
                                    ],
                                }),
                            };
                        },
                    }),
                }),
            }),
        }),
    };
    const handler = sheetReportHandler({
        verify: async () =>
            claims || {
                uid: 'fictional-admin',
                email: 'jomalkeun@gmail.com',
                email_verified: true,
            },
        database: () => db,
        store: {
            read: async (key) => {
                storeReads.push(key);
                return key === reportIndexKey ? index : report(key);
            },
        },
    });
    const invoke = async (query = {}, method = 'GET') => {
        const res = {
            headers: {},
            setHeader(k, v) {
                this.headers[k] = v;
            },
            status(s) {
                this.statusCode = s;
                return this;
            },
            json(body) {
                this.body = body;
                return this;
            },
        };
        await handler({ method, query }, res);
        return res;
    };
    return { invoke, usage: () => ({ storeReads, dbReads }) };
}
test('summary reads only index + summary and two owner documents; private no-store', async () => {
    const f = fixture(),
        r = await f.invoke({ accountId: 'wife' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.readOnly, true);
    assert.equal(r.body.adoptionAvailable, false);
    assert.equal(f.usage().storeReads.length, 2);
    assert.equal(f.usage().dbReads, 2);
    assert.equal(r.headers['Vercel-CDN-Cache-Control'], 'no-store');
});
test('non-admin denied before any report/storage/database read', async () => {
    const f = fixture({
        claims: { email: 'unapproved@example.test', email_verified: true },
    });
    assert.equal((await f.invoke()).statusCode, 403);
    assert.deepEqual(f.usage(), { storeReads: [], dbReads: 0 });
});
test('unverified email is not enough', async () => {
    assert.equal(
        (await fixture({ claims: { email: 'jomalkeun@gmail.com' } }).invoke())
            .statusCode,
        403
    );
});
test('another administrator workbook is denied before reading report financial data', async () => {
    const f = fixture({ workbook: 'different-source' });
    assert.equal((await f.invoke()).statusCode, 403);
    assert.equal(f.usage().storeReads.length, 1);
});
for (const query of [
    { accountId: '../husband' },
    { accountId: ['wife', 'husband'] },
    { section: 'raw' },
])
    test(`invalid selector rejected ${JSON.stringify(query)}`, async () => {
        const f = fixture();
        assert.equal((await f.invoke(query)).statusCode, 400);
        assert.equal(f.usage().storeReads.length, 0);
    });
test('POST cannot adopt or change any financial values', async () => {
    const f = fixture();
    assert.equal((await f.invoke({}, 'POST')).statusCode, 405);
    assert.equal(f.usage().storeReads.length, 0);
});
test('cross-account payload rejected', async () => {
    assert.equal(
        (await fixture({ crossAccount: true }).invoke()).statusCode,
        503
    );
});
test('mixed report versions rejected', async () => {
    assert.equal((await fixture({ corrupt: true }).invoke()).statusCode, 503);
});
test('private storage uses fixed private bucket and SHA256 verification', async () => {
    const text = JSON.stringify({ fictional: true });
    let input;
    const store = createPrivateReportStore({
        getStorage: () => ({
            send: async (command) => {
                input = command.input;
                return {
                    ContentLength: text.length,
                    Body: Readable.from([text]),
                };
            },
        }),
    });
    const key = 'reconciliation/dashboard/v1/fictional/wife/summary.json';
    assert.deepEqual(await store.read(key, { sha256: reportDigest(text) }), {
        fictional: true,
    });
    assert.equal(input.Bucket, 'yieldloom-data-private');
    await assert.rejects(store.read(key, { sha256: '0'.repeat(64) }), /digest/);
    await assert.rejects(store.read(key, { maxBytes: 1 }), /size/);
    await assert.rejects(
        store.read('reconciliation/dashboard/v1/../secret.json'),
        /경로/
    );
});
test('store enforces streaming limit even when content length absent', async () => {
    const store = createPrivateReportStore({
        getStorage: () => ({
            send: async () => ({ Body: Readable.from(['abc', 'def']) }),
        }),
    });
    await assert.rejects(store.read(reportIndexKey, { maxBytes: 4 }), /size/);
});
const fictionalUser = () => ({ getIdToken: async () => 'fictional-token' });
const response = (accountId = 'wife', section = 'summary') => ({
    ok: true,
    json: async () => ({
        accountId,
        section,
        runId: 'fictional-run',
        readOnly: true,
    }),
});
test('same user/account requests coalesce; cache reuse; explicit refresh and details are separate', async () => {
    let calls = 0;
    const c = createSheetReportClient({
        fetchImpl: async (url) => {
            calls++;
            const q = new URL(url, 'http://test').searchParams;
            return response(q.get('accountId'), q.get('section'));
        },
    });
    const u = fictionalUser();
    await Promise.all([c.load(u, 'wife'), c.load(u, 'wife')]);
    assert.equal(calls, 1);
    await c.load(u, 'wife');
    assert.equal(calls, 1);
    await c.load(u, 'husband');
    assert.equal(calls, 2);
    await c.load(u, 'wife', 'details');
    assert.equal(calls, 3);
    await c.load(u, 'wife', 'summary', { refresh: true });
    assert.equal(calls, 4);
});
test('logout/user change discards pending and cached financial responses', async () => {
    let release;
    const c = createSheetReportClient({
        fetchImpl: async () => {
            await new Promise((r) => {
                release = r;
            });
            return response();
        },
    });
    const first = c.load(fictionalUser(), 'wife');
    await new Promise((r) => setImmediate(r));
    c.clear();
    release();
    await assert.rejects(first, /폐기/);
});
test('authentication failure not cached; token SDK not force-refreshed', async () => {
    let calls = 0;
    const c = createSheetReportClient({
        fetchImpl: async () => {
            calls++;
            return {
                ok: false,
                status: 401,
                json: async () => ({ error: 'expired' }),
            };
        },
    });
    const u = {
        getIdToken: async (force) => {
            assert.equal(force, undefined);
            return 'synthetic';
        },
    };
    await assert.rejects(c.load(u, 'wife'), /expired/);
    await assert.rejects(c.load(u, 'wife'), /expired/);
    assert.equal(calls, 2);
});

test('permission status reaches UI so rendered report can be purged', async () => {
    const c = createSheetReportClient({
        fetchImpl: async () => ({
            ok: false,
            status: 403,
            json: async () => ({ error: 'forbidden' }),
        }),
    });
    await assert.rejects(
        c.load(fictionalUser(), 'wife'),
        (error) => error.status === 403
    );
});
test('token SDK revocation clears session and exposes authentication status', async () => {
    const c = createSheetReportClient({
        fetchImpl: async () => {
            throw new Error('must not fetch');
        },
    });
    const user = {
        getIdToken: async () => {
            throw Object.assign(new Error('revoked'), {
                code: 'auth/user-token-expired',
            });
        },
    };
    await assert.rejects(c.load(user, 'wife'), (error) => error.status === 401);
});
