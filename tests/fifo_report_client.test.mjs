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

const diagnostic = {
    version: 1,
    code: 'INC_RECEIPT_DIGEST',
    stage: 'receipt',
    requestId: '12345678-1234-4234-8234-123456789abc',
};
const privateResponse = () => ({
    error: 'SYNTHETIC_PRIVATE_SOURCE',
    diagnostic: {
        ...diagnostic,
        key: 'SYNTHETIC_PRIVATE_SOURCE',
        expectedHash: 'b'.repeat(64),
    },
});
const failed = (status, value = privateResponse()) => ({
    ok: false,
    status,
    json: async () => value,
});
test('assets errors expose only validated diagnostics and static messages; failures are not cached and retry recovers', async () => {
    let calls = 0;
    const c = createSheetReportClient({
        fetchImpl: async () => (++calls <= 2 ? failed(409) : ok(payload())),
    });
    const u = user();
    for (let i = 0; i < 2; i++)
        await assert.rejects(c.load(u, 'family', 'assets'), (e) => {
            assert.deepEqual(e.diagnostic, diagnostic);
            assert(!e.message.includes('SYNTHETIC_PRIVATE_SOURCE'));
            assert(!JSON.stringify(e).includes('SYNTHETIC_PRIVATE_SOURCE'));
            return true;
        });
    assert.deepEqual(await c.load(u, 'family', 'assets'), payload());
    assert.equal(calls, 3);
    for (const status of [401, 403]) {
        const denied = createSheetReportClient({
            fetchImpl: async () => failed(status),
        });
        await assert.rejects(
            denied.load(u, 'family', 'assets'),
            (e) =>
                e.status === status &&
                !e.diagnostic &&
                !e.message.includes('SYNTHETIC_PRIVATE_SOURCE')
        );
    }
});
test('untrusted response diagnostics and transport errors never become displayed error text', async () => {
    for (const fetchImpl of [
        async () =>
            failed(409, {
                ...privateResponse(),
                diagnostic: {
                    ...diagnostic,
                    stage: 'SYNTHETIC_PRIVATE_SOURCE',
                },
            }),
        async () => {
            throw Error('SYNTHETIC_PRIVATE_SOURCE');
        },
        async () => ({
            ok: false,
            status: 502,
            json: async () => {
                throw Error('SYNTHETIC_PRIVATE_SOURCE');
            },
        }),
    ]) {
        const c = createSheetReportClient({ fetchImpl });
        await assert.rejects(
            c.load(user(), 'family', 'assets'),
            (e) =>
                !e.diagnostic && !e.message.includes('SYNTHETIC_PRIVATE_SOURCE')
        );
        await assert.rejects(
            c.saveFifoCorrection(user(), {}),
            (e) =>
                !e.diagnostic && !e.message.includes('SYNTHETIC_PRIVATE_SOURCE')
        );
    }
});
test('late failed response after account/session change cannot disclose prior diagnostics or clear the new request', async () => {
    for (const method of ['load', 'saveFifoCorrection']) {
        let finish;
        const c = createSheetReportClient({
            fetchImpl: async () =>
                new Promise((r) => {
                    finish = () => r(failed(409));
                }),
        });
        const old =
            method === 'load'
                ? c.load(user(), 'family', 'assets')
                : c.saveFifoCorrection(user(), {});
        const rejected = assert.rejects(
            old,
            (e) => !e.diagnostic && /폐기/.test(e.message)
        );
        await Promise.resolve();
        c.clear();
        finish();
        await rejected;
    }
});

test('legacy detail requests keep stale-response status semantics so another session is not purged', async () => {
    for (const status of [200, 401, 409]) {
        let finish;
        const c = createSheetReportClient({
            fetchImpl: async () =>
                new Promise((r) => {
                    finish = () =>
                        r({
                            ok: status === 200,
                            status,
                            json: async () => privateResponse(),
                        });
                }),
        });
        const old = c.load(user(), 'wife', 'details');
        const discarded = assert.rejects(
            old,
            (e) =>
                /폐기/.test(e.message) &&
                e.status === undefined &&
                e.diagnostic === undefined
        );
        await Promise.resolve();
        c.clear();
        finish();
        await discarded;
    }
});
