import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createFamilyPortfolioClient,
    retryDeadline,
} from '../src/services/familyPortfolioClient.js';

test('retry deadlines support seconds, HTTP dates, zero and a safe fallback', () => {
    const now = Date.UTC(2026, 9, 16);
    assert.equal(retryDeadline('120', now), now + 120000);
    assert.equal(
        retryDeadline(new Date(now + 90000).toUTCString(), now),
        now + 90000
    );
    assert.equal(retryDeadline(new Date(now - 90000).toUTCString(), now), now);
    assert.equal(retryDeadline('0', now), now);
    for (const value of [null, '', 'invalid', '9'.repeat(400)])
        assert.equal(retryDeadline(value, now), now + 60000);
});

test('429 exposes the same retry deadline and suppresses GET and mutations until it expires', async () => {
    let clock = 1000,
        calls = 0;
    const user = { getIdToken: async () => 'fixture' };
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        now: () => clock,
        fetcher: async () => {
            calls++;
            return calls === 1
                ? new Response(
                      JSON.stringify({
                          code: 'DATA_RESOURCE_EXHAUSTED',
                          error: '제한',
                          retryTiming: 'recommended',
                          limitType: 'unknown',
                      }),
                      { status: 429, headers: { 'Retry-After': '60' } }
                  )
                : new Response(JSON.stringify({ families: [] }));
        },
    });
    let first;
    await assert.rejects(request(), (error) => {
        first = error;
        return (
            error.status === 429 &&
            error.retryAt === 61000 &&
            error.limitType === 'unknown'
        );
    });
    clock = 21000;
    await assert.rejects(
        request('createAccount', {}),
        (error) => error === first && error.retryAt === 61000
    );
    assert.equal(calls, 1);
    clock = 61000;
    assert.deepEqual(await request(), { families: [] });
    assert.equal(calls, 2);
});

test('a new 429 restarts the interval without inventing a daily quota reset', async () => {
    let clock = 0;
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        now: () => clock,
        fetcher: async () =>
            new Response('{}', {
                status: 429,
                headers: { 'Retry-After': '2' },
            }),
    });
    const user = { getIdToken: async () => 'fixture' };
    await assert.rejects(
        request(),
        (e) => e.retryAt === 2000 && e.limitType === 'unknown'
    );
    clock = 3000;
    await assert.rejects(
        request(),
        (e) => e.retryAt === 5000 && e.retryTiming === 'recommended'
    );
});

test('different login identities have independent cooldowns; non-429 errors remain retryable', async () => {
    const a = { getIdToken: async () => 'a' },
        b = { getIdToken: async () => 'b' };
    let user = a,
        calls = 0;
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        now: () => 0,
        fetcher: async () => {
            calls++;
            return new Response('{}', { status: calls === 1 ? 429 : 503 });
        },
    });
    await assert.rejects(request(), (e) => e.retryAt === 60000);
    user = b;
    await assert.rejects(
        request(),
        (e) => e.status === 503 && e.retryAt === undefined
    );
    await assert.rejects(request(), (e) => e.status === 503);
    assert.equal(calls, 3);
});

test('a non-JSON rate-limit response still exposes a deadline and respects cancellation', async () => {
    const user = { getIdToken: async () => 'fixture' };
    let calls = 0;
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        now: () => 0,
        fetcher: async () => {
            calls++;
            return new Response('limit', { status: 429 });
        },
    });
    await assert.rejects(request(), (e) => e.retryAt === 60000);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        request('', undefined, {}, { signal: controller.signal }),
        { name: 'AbortError' }
    );
    assert.equal(calls, 1);
});

test('identical GETs with reordered parameters share one request and return independent values', async () => {
    const user = { getIdToken: async () => 'fixture' };
    let calls = 0;
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        fetcher: async () => {
            calls++;
            return Response.json({ entries: [{ id: 'a' }] });
        },
    });
    const [a, b] = await Promise.all([
        request('', undefined, { accountId: 'a', legacy: 'false' }),
        request('', undefined, { legacy: 'false', accountId: 'a' }),
    ]);
    a.entries[0].id = 'changed';
    assert.equal(b.entries[0].id, 'a');
    assert.equal(calls, 1);
    await request('', undefined, { accountId: 'a', legacy: 'false' });
    assert.equal(calls, 2); // Permission checks are never served from a response cache.
});

test('permission invalidation still returns the original error to its caller', async () => {
    const user = { getIdToken: async () => 'fixture' };
    const reasons = [];
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        fetcher: async () =>
            Response.json({ error: '권한 없음' }, { status: 403 }),
    });
    request.onInvalidate((_user, reason) => reasons.push(reason));
    await assert.rejects(
        request(),
        (error) => error.status === 403 && error.message === '권한 없음'
    );
    assert.deepEqual(reasons, ['access']);
});

test('all callers cancelling aborts the transport; a later caller starts a fresh request', async () => {
    const user = { getIdToken: async () => 'fixture' };
    let calls = 0,
        transport;
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        fetcher: async (_url, { signal }) => {
            calls++;
            transport = signal;
            if (calls === 1)
                await new Promise((_resolve, reject) =>
                    signal.addEventListener('abort', () =>
                        reject(new DOMException('abort', 'AbortError'))
                    )
                );
            return Response.json({ ok: true });
        },
    });
    const controller = new AbortController();
    const pending = request('', undefined, {}, { signal: controller.signal });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(transport.aborted, true);
    assert.deepEqual(await request(), { ok: true });
    assert.equal(calls, 2);
});

test('mutations discard older reads even when a transport ignores cancellation', async () => {
    const user = { getIdToken: async () => 'fixture' };
    let release;
    const held = new Promise((resolve) => {
        release = resolve;
    });
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        fetcher: async (_url, options) => {
            if (options.method === 'GET') await held;
            return Response.json({ ok: true });
        },
    });
    const old = request();
    await new Promise((resolve) => setImmediate(resolve));
    await request('grant', { role: 'viewer' });
    release();
    await assert.rejects(old, { name: 'AbortError' });
});

test("an older successful response cannot clear another request's 429 cooldown", async () => {
    const user = { getIdToken: async () => 'fixture' };
    let release,
        calls = 0;
    const held = new Promise((resolve) => {
        release = resolve;
    });
    const request = createFamilyPortfolioClient({
        getUser: () => user,
        now: () => 0,
        fetcher: async (url) => {
            calls++;
            if (url.includes('accountId=slow')) {
                await held;
                return Response.json({ entries: [] });
            }
            return Response.json({}, { status: 429 });
        },
    });
    const slow = request('', undefined, { accountId: 'slow' });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(
        request('', undefined, { accountId: 'limited' }),
        (e) => e.status === 429
    );
    release();
    await slow;
    await assert.rejects(request(), (e) => e.status === 429);
    assert.equal(calls, 2);
});
