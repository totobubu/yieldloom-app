import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetReportClient } from '../src/services/sheetReports.js';
const payload = () => ({
    schemaVersion: 1,
    section: 'assets',
    accountId: 'family',
    readOnly: true,
    input: { ledgerRevision: 'a'.repeat(64), accounts: [], events: [] },
    adjustments: { revision: 0, history: [], active: [] },
});
const user = () => ({
    getIdToken: async (force) => {
        assert.equal(force, undefined);
        return 'synthetic';
    },
});
const ok = (value) => ({ ok: true, json: async () => value });

test('assets requests coalesce only while pending and reauthorize each explicit reopening', async () => {
    let requests = 0,
        resolve;
    const client = createSheetReportClient({
        fetchImpl: async () => {
            requests++;
            return new Promise((r) => {
                resolve = () => r(ok(payload()));
            });
        },
    });
    const u = user(),
        a = client.load(u, 'family', 'assets'),
        b = client.load(u, 'family', 'assets');
    await Promise.resolve();
    resolve();
    await Promise.all([a, b]);
    assert.equal(requests, 1);
    const c = client.load(u, 'family', 'assets');
    await Promise.resolve();
    resolve();
    await c;
    assert.equal(requests, 2);
});

test('a correction invalidates pending reads, never coalesces writes and preserves exact request IDs', async () => {
    let resolve,
        posts = [];
    const client = createSheetReportClient({
        fetchImpl: async (_url, options) => {
            if (options.method === 'POST') {
                posts.push(JSON.parse(options.body));
                return ok({ revision: posts.length });
            }
            return new Promise((r) => {
                resolve = () => r(ok(payload()));
            });
        },
    });
    const u = user(),
        p = client.load(u, 'family', 'assets');
    const rejected = assert.rejects(p, /폐기/);
    await Promise.resolve();
    const body = { requestId: 'synthetic-request-00001' };
    await client.saveFifoCorrection(u, body);
    resolve();
    await rejected;
    await client.saveFifoCorrection(u, body);
    assert.deepEqual(posts, [body, body]);
});

test('logout or identity changes discard late reads and saves; SDK revocation is an auth failure', async () => {
    let resolve;
    const client = createSheetReportClient({
        fetchImpl: async () =>
            new Promise((r) => {
                resolve = () => r(ok(payload()));
            }),
    });
    const u = user(),
        p = client.saveFifoCorrection(u, {}),
        rejected = assert.rejects(p, /로그인 상태/);
    await Promise.resolve();
    client.clear();
    resolve();
    await rejected;
    await assert.rejects(
        client.saveFifoCorrection(
            {
                getIdToken: async () => {
                    throw Object.assign(Error('revoked'), {
                        code: 'auth/user-token-expired',
                    });
                },
            },
            {}
        ),
        (e) => e.status === 401
    );
    const read = client.load(u, 'family', 'assets'),
        discard = assert.rejects(read, /폐기/);
    await Promise.resolve();
    client.clear();
    resolve();
    await discard;
});
