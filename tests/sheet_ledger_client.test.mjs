import test from 'node:test';
import assert from 'node:assert/strict';
import { createSheetLedgerClient } from '../src/services/sheetLedger.js';

const user = { getIdToken: async () => 'synthetic-token' };
const ok = (payload = { rows: [], version: 0 }) => ({
    ok: true,
    status: 200,
    json: async () => payload,
});
test('concurrent ledger reads share a request; mutations are not suppressed', async () => {
    let resolve,
        calls = 0;
    const client = createSheetLedgerClient({
        fetchImpl: async () => {
            calls++;
            return new Promise((r) => {
                resolve = r;
            });
        },
    });
    const first = client.load(user),
        second = client.load(user);
    assert.equal(first, second);
    await Promise.resolve();
    resolve(ok());
    await first;
    assert.equal(calls, 1);
    const mutation = client.mutate(user, 'POST', { action: 'commit' });
    await Promise.resolve();
    resolve(ok());
    await mutation;
    assert.equal(calls, 2);
});
test('timeout, non-JSON, malformed preview and Google expiration produce visible actionable errors', async () => {
    const timed = createSheetLedgerClient({
        timeoutMs: 10,
        fetchImpl: async (_url, { signal }) =>
            new Promise((_resolve, reject) => {
                // Keep the event loop alive while testing AbortSignal.timeout's unref timer.
                const timer = setTimeout(
                    () => reject(new Error('timeout did not fire')),
                    1000
                );
                signal.addEventListener(
                    'abort',
                    () => {
                        clearTimeout(timer);
                        reject(signal.reason);
                    },
                    { once: true }
                );
            }),
    });
    await assert.rejects(timed.load(user), /응답 시간이 초과/);
    const html = createSheetLedgerClient({
        fetchImpl: async () => ({
            ok: false,
            status: 504,
            json: async () => {
                throw Error('html');
            },
        }),
    });
    await assert.rejects(html.load(user), /서버 응답을 읽지 못/);
    const malformed = createSheetLedgerClient({ fetchImpl: async () => ok() });
    await assert.rejects(
        malformed.mutate(user, 'POST', { action: 'preview' }),
        /분석 결과를 읽지 못/
    );
    const expired = createSheetLedgerClient({
        fetchImpl: async () => ({
            ok: false,
            status: 401,
            json: async () => ({
                error: 'expired',
                code: 'google_reconnect_required',
            }),
        }),
    });
    await assert.rejects(
        expired.mutate(user, 'POST', { action: 'preview' }),
        (e) => e.status === 401 && e.code === 'google_reconnect_required'
    );
});

test('all canonical and observation pages are assembled once for concurrent consumers; compact mutations preserve other pages', async () => {
    const calls = [];
    const client = createSheetLedgerClient({
        fetchImpl: async (url, options) => {
            const q = new URL(url, 'https://test.invalid').searchParams;
            calls.push([options.method, q.get('resource'), q.get('cursor')]);
            if (options.method === 'POST')
                return ok({
                    rows: [],
                    version: 4,
                    partial: true,
                    rowDelta: [{ id: 'b', quantity: 9 }],
                    observationDelta: [{ id: 'e2', reviewVersion: 1 }],
                });
            if (q.get('resource') === 'version')
                return ok({ rows: [], version: 3 });
            if (q.get('resource') === 'observations')
                return ok({
                    rows: [],
                    version: 3,
                    observations: [{ id: q.get('cursor') ? 'e2' : 'e1' }],
                    nextCursor: q.get('cursor') ? null : 'evidence-next',
                });
            if (q.get('cursor'))
                return ok({
                    rows: [{ id: 'b' }],
                    version: 3,
                    nextCursor: null,
                });
            return ok({
                rows: [{ id: 'a' }],
                version: 3,
                totalRows: 2,
                nextCursor: 'rows-next',
                observationPaging: true,
                observationStates: { wife: { recordCount: 2 } },
            });
        },
    });
    const a = client.load(user),
        b = client.load(user);
    assert.equal(a, b);
    const result = await a;
    assert.deepEqual(
        result.rows.map((r) => r.id),
        ['a', 'b']
    );
    assert.deepEqual(
        result.observations.map((r) => r.id),
        ['e1', 'e2']
    );
    assert.equal(calls.length, 5); // two rows, two evidence, final version; no per-row request.
    const saved = await client.mutate(user, 'POST', {
        action: 'accept-evidence',
    });
    assert.deepEqual(saved.rows, [{ id: 'a' }, { id: 'b', quantity: 9 }]);
    assert.equal(saved.observations.length, 2);
    assert.equal(saved.observations[1].reviewVersion, 1);
    assert.equal(calls.length, 6);
});

test('failed, repeated or incomplete pages never publish partial results, and a new load can recover', async () => {
    for (const mode of ['missing', 'repeat', 'conflict']) {
        let requests = 0;
        const client = createSheetLedgerClient({
            fetchImpl: async () => {
                requests++;
                if (requests === 1)
                    return ok({
                        rows: [{ id: 'a' }],
                        version: 1,
                        totalRows: 2,
                        nextCursor: 'next',
                    });
                if (mode === 'conflict')
                    return {
                        ok: false,
                        status: 409,
                        json: async () => ({ error: 'changed' }),
                    };
                return ok({
                    rows: [],
                    version: 1,
                    nextCursor: mode === 'repeat' ? 'next' : null,
                });
            },
        });
        await assert.rejects(client.load(user));
    }
});

test('logout/user switches and writes discard outstanding older reads rather than restoring stale private cache', async () => {
    const resolvers = [];
    const client = createSheetLedgerClient({
        fetchImpl: async () =>
            new Promise((resolve) => resolvers.push(resolve)),
    });
    const stale = client.load(user);
    await Promise.resolve();
    client.clear();
    const other = { getIdToken: async () => 'another-synthetic' };
    const fresh = client.load(other);
    await Promise.resolve();
    resolvers[1](ok({ rows: [{ id: 'new' }], version: 2 }));
    await fresh;
    resolvers[0](ok({ rows: [{ id: 'old' }], version: 1 }));
    await assert.rejects(stale, /로그인 상태/);
    const mutation = client.mutate(other, 'POST', { action: 'classify-cash' });
    await Promise.resolve();
    resolvers[2](ok({ rows: [], version: 3, partial: true, rowDelta: [] }));
    assert.deepEqual((await mutation).rows, [{ id: 'new' }]);
});

test('fixed-version row ranges load at most three concurrently, preserve order and fill byte-limited partial pages', async () => {
    const rows = Array.from({ length: 2285 }, (_, i) => ({
        id: `synthetic-${i}`,
    }));
    let active = 0,
        maximum = 0,
        calls = 0;
    const client = createSheetLedgerClient({
        fetchImpl: async (url) => {
            calls++;
            const q = new URL(url, 'https://test.invalid').searchParams;
            if (!q.has('offset'))
                return ok({
                    rows: rows.slice(0, 500),
                    version: 1,
                    totalRows: rows.length,
                    parallelRows: true,
                    nextCursor: 'continuation',
                });
            assert.equal(q.get('version'), '1');
            const offset = Number(q.get('offset')),
                limit = Number(q.get('limit'));
            active++;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) =>
                setTimeout(resolve, offset === 500 ? 8 : 2)
            );
            active--;
            const size = offset === 500 ? 200 : limit;
            return ok({ rows: rows.slice(offset, offset + size), version: 1 });
        },
    });
    const first = client.load(user),
        second = client.load(user);
    assert.equal(first, second);
    assert.deepEqual((await first).rows, rows);
    assert.equal(maximum, 3);
    assert.equal(calls, 6);
});

test('parallel range failures and malformed manifests never publish a partial ledger', async () => {
    const client = createSheetLedgerClient({
        fetchImpl: async (url) => {
            const q = new URL(url, 'https://test.invalid').searchParams;
            if (!q.has('offset'))
                return ok({
                    rows: [{ id: 'a' }],
                    version: 1,
                    totalRows: 1002,
                    parallelRows: true,
                    nextCursor: 'next',
                });
            return ok({ rows: [{ id: 'b' }], version: 2 });
        },
    });
    await assert.rejects(client.load(user), /버전/);
    const malformed = createSheetLedgerClient({
        fetchImpl: async () =>
            ok({
                rows: [],
                version: 1,
                parallelRows: true,
                nextCursor: 'next',
            }),
    });
    await assert.rejects(malformed.load(user), /전체 거래 수/);
});
