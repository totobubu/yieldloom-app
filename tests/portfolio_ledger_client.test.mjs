import test from 'node:test';
import assert from 'node:assert/strict';
import { createFamilyPortfolioClient } from '../src/services/familyPortfolioClient.js';
import { createPortfolioLedgerClient } from '../src/services/portfolioLedgerClient.js';

function fixture() {
    const state = {
        user: { uid: 'u', getIdToken: async () => 'fixture' },
        revision: 1,
        allowed: true,
        role: 'viewer',
        calls: [],
        pages: 0,
        fail: false,
    };
    state.request = createFamilyPortfolioClient({
        getUser: () => state.user,
        fetcher: async (url, options) => {
            const query = new URL(url, 'http://localhost').searchParams;
            state.calls.push(query);
            const headers = {
                'X-Portfolio-Document-Reads': '2',
                'X-Portfolio-Read-Operations': '1',
            };
            if (options.method === 'POST')
                return Response.json({ ok: true }, { headers });
            if (query.has('familyId')) {
                state.onOverview?.();
                return Response.json(
                    {
                        accounts: state.allowed
                            ? ['a', 'b'].map((id) => ({
                                  id,
                                  entriesRevision: state.revision,
                                  permissions: { u: state.role },
                              }))
                            : [],
                    },
                    { headers }
                );
            }
            state.pages++;
            if (state.waitPage) await state.waitPage;
            if (state.fail)
                return Response.json(
                    { error: 'failure' },
                    { status: 503, headers }
                );
            return Response.json(
                {
                    entries: [
                        {
                            id: query.get('cursor') || 'first',
                            row: { amount: state.revision },
                        },
                    ],
                    nextCursor: query.has('cursor') ? null : 'second',
                },
                { headers }
            );
        },
    });
    state.load = createPortfolioLedgerClient({
        getUser: () => state.user,
        request: state.request,
    });
    state.options = { familyId: 'f', accounts: [{ id: 'a' }] };
    return state;
}

test('tab remounts and account subsets reuse validated pages, but every load revalidates access twice', async () => {
    const f = fixture();
    const initial = await f.load({
        ...f.options,
        accounts: [{ id: 'a' }, { id: 'b' }],
    });
    initial[0].row.amount = 999;
    const entries = await f.load(f.options);
    assert.equal(entries[0].row.amount, 1);
    assert.equal(f.pages, 4);
    assert.equal(f.calls.filter((q) => q.has('familyId')).length, 4);
    assert.ok(
        f.calls
            .filter((q) => q.has('familyId'))
            .every((q) => q.get('view') === 'ledger')
    );
    assert.equal(f.load.metrics().cacheHits, 2);
    assert.deepEqual(f.request.metrics(), {
        apiRequests: 8,
        sharedRequests: 0,
        firestoreDocumentsRead: 16,
        firestoreReadOperations: 8,
        measuredResponses: 8,
    });
});

test('revision changes, manual force and mutations reload pages', async () => {
    const f = fixture();
    await f.load(f.options);
    f.revision++;
    assert.equal((await f.load(f.options))[0].row.amount, 2);
    await f.load({ ...f.options, force: true });
    await f.request('commit', {});
    await f.load(f.options);
    assert.equal(f.pages, 8);
});

test('revocation and role changes during validation discard private results and the cache', async () => {
    for (const change of [
        (f) => {
            f.allowed = false;
        },
        (f) => {
            f.role = 'editor';
        },
    ]) {
        const f = fixture();
        await f.load(f.options);
        let reads = 0;
        f.onOverview = () => {
            if (++reads === 2) change(f);
        };
        await assert.rejects(f.load(f.options), /변경/);
        assert.equal(f.load.metrics(), null);
    }
});

test('a changed revision midway through pagination is never cached', async () => {
    const f = fixture();
    let reads = 0;
    f.onOverview = () => {
        if (++reads === 2) f.revision++;
    };
    await assert.rejects(f.load(f.options), /변경/);
    f.onOverview = undefined;
    await f.load(f.options);
    assert.equal(f.pages, 4);
});

test('simultaneous components share network pages; cancellation only detaches its caller', async () => {
    const f = fixture();
    let release;
    f.waitPage = new Promise((resolve) => {
        release = resolve;
    });
    const controller = new AbortController();
    const first = f.load({ ...f.options, signal: controller.signal });
    const second = f.load(f.options);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await assert.rejects(first, { name: 'AbortError' });
    release();
    assert.equal((await second).length, 2);
    assert.equal(f.pages, 2);
    assert.ok(f.request.metrics().sharedRequests >= 2);
});

test('logout with the same user object clears memory, and old login responses cannot repopulate it', async () => {
    const f = fixture();
    const user = f.user;
    await f.load(f.options);
    f.user = null;
    f.request.clear(); // synchronous auth observer
    assert.equal(f.load.metrics(), null);
    f.user = user;
    await f.load(f.options);
    assert.equal(f.pages, 4);
    let release;
    f.waitPage = new Promise((resolve) => {
        release = resolve;
    });
    const old = f.load({ ...f.options, force: true });
    await new Promise((resolve) => setImmediate(resolve));
    f.user = { uid: 'new', getIdToken: async () => 'new-fixture' };
    f.waitPage = null;
    const next = f.load(f.options);
    release();
    await assert.rejects(old, { name: 'AbortError' });
    assert.equal((await next).length, 2);
});

test('failed reloads and missing revisions cannot turn into successful cached reads', async () => {
    const f = fixture();
    await f.load(f.options);
    f.fail = true;
    await assert.rejects(f.load({ ...f.options, force: true }), /failure/);
    assert.equal(f.load.metrics(), null);
    f.fail = false;
    f.revision = undefined;
    await f.load(f.options);
    const pages = f.pages;
    await f.load(f.options);
    assert.equal(f.pages, pages + 2);
});

test('many accounts cannot leave more than the bounded number of pages in memory', async () => {
    const user = { uid: 'u' };
    const accounts = Array.from({ length: 101 }, (_, id) => ({
        id: String(id),
        entriesRevision: 1,
    }));
    const load = createPortfolioLedgerClient({
        getUser: () => user,
        request: async (_a, _b, query) =>
            query.accountId ? { entries: [], nextCursor: null } : { accounts },
    });
    await load({ familyId: 'f', accounts });
    assert.equal(load.metrics().cachedPages, 100);
});

test('separate account loads evict old data before the total row limit is exceeded', async () => {
    const user = { uid: 'u' };
    const accounts = ['a', 'b'].map((id) => ({ id, entriesRevision: 1 }));
    let reads = 0;
    const load = createPortfolioLedgerClient({
        getUser: () => user,
        request: async (_a, _b, query) => {
            if (!query.accountId) return { accounts };
            reads++;
            return {
                entries: Array.from({ length: 6000 }, (_, id) => ({
                    id: String(id),
                })),
            };
        },
    });
    for (const account of [accounts[0], accounts[1], accounts[0]])
        await load({ familyId: 'f', accounts: [account] });
    assert.equal(load.metrics().cachedRows, 6000);
    assert.equal(reads, 3);
});
