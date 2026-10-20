import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioCapitalClient } from '../src/services/portfolioCapital.js';
const user = (uid = 'owner') => ({ uid, getIdToken: async () => uid });
const response = (data, status = 200) => ({
    ok: status === 200,
    status,
    headers: new Headers({ 'Retry-After': '60' }),
    json: async () => data,
});
const state = {
    version: 'v1:0:0',
    ledgerVersion: 'v1:0',
    entries: [{ id: 'imported' }],
    importedCash: [{ id: 'imported' }],
    trades: [{ id: 'buy' }],
    classifications: [],
    allocations: [],
};

test('concurrent and recent callers share one read and receive independent objects; force revalidates version', async () => {
    let calls = 0;
    const request = createPortfolioCapitalClient({
        fetcher: async (url) => {
            calls++;
            return response(
                url.includes('version=') ? { unchanged: true } : state
            );
        },
    });
    const actor = user();
    const [a, b] = await Promise.all([
        request(actor, undefined, 'AC'),
        request(actor, undefined, 'AC'),
    ]);
    assert.equal(calls, 1);
    a.entries.length = 0;
    assert.equal(b.entries.length, 1);
    await request(actor, undefined, 'AC');
    assert.equal(calls, 1);
    assert.deepEqual(await request(actor, undefined, 'AC', { force: true }), b);
    assert.equal(calls, 2);
    await request(user('other'), undefined, 'AC');
    assert.equal(calls, 3);
});

test('writes invalidate capital state but preserve unchanged imported cash and trades', async () => {
    const urls = [];
    const request = createPortfolioCapitalClient({
        fetcher: async (url, options) => {
            urls.push(url);
            if (options.method === 'POST') return response({ id: 'cash' });
            return response(
                url.includes('version=')
                    ? {
                          version: 'v1:0:1',
                          ledgerVersion: 'v1:0',
                          ledgerUnchanged: true,
                          entries: [{ id: 'manual' }],
                          classifications: [{ id: 'new' }],
                          allocations: [],
                      }
                    : state
            );
        },
    });
    const actor = user();
    await request(actor, undefined, 'AC');
    await request(actor, { action: 'classifyCash' }, 'AC');
    const updated = await request(actor, undefined, 'AC');
    assert.equal(urls.length, 3);
    assert.ok(urls[2].includes('ledgerVersion='));
    assert.deepEqual(updated.trades, state.trades);
    assert.deepEqual(
        updated.entries.map((x) => x.id),
        ['manual', 'imported']
    );
    assert.equal(updated.classifications[0].id, 'new');
});

test('429 backs off without returning stale success and retries after the server cooldown; failed reads are not cached as success', async () => {
    let clock = 0,
        calls = 0;
    const request = createPortfolioCapitalClient({
        now: () => clock,
        fetcher: async () => {
            calls++;
            return calls === 1
                ? response(state)
                : calls === 2
                  ? response(
                        { error: 'limited', code: 'DATA_RESOURCE_EXHAUSTED' },
                        429
                    )
                  : response(state);
        },
    });
    const actor = user();
    await request(actor, undefined, 'AC');
    clock = 6000;
    await assert.rejects(request(actor, undefined, 'AC'), /limited/);
    await assert.rejects(
        request(actor, undefined, 'AC', { force: true }),
        /limited/
    );
    assert.equal(calls, 2);
    clock = 66001;
    assert.equal((await request(actor, undefined, 'AC')).trades.length, 1);
    assert.equal(calls, 3);
});

test('a late GET cannot restore the pre-mutation snapshot for any concurrent caller', async () => {
    let finishRead, readStarted;
    const started = new Promise((resolve) => {
        readStarted = resolve;
    });
    let calls = 0;
    const request = createPortfolioCapitalClient({
        fetcher: async (url, options) => {
            if (options.method === 'POST') return response({ id: 'saved' });
            if (++calls === 1) {
                readStarted();
                await new Promise((resolve) => {
                    finishRead = resolve;
                });
                return response(state);
            }
            return response({
                ...state,
                version: 'v1:0:1',
                classifications: [{ id: 'saved' }],
            });
        },
    });
    const actor = user();
    const first = request(actor, undefined, 'AC');
    await started;
    const second = request(actor, undefined, 'AC');
    await request(actor, { action: 'classifyCash' }, 'AC');
    finishRead();
    for (const result of await Promise.all([first, second]))
        assert.equal(result.classifications[0].id, 'saved');
    assert.equal(calls, 2);
});

test('same-day purchase links and registration filtering reuse one shared read without automatic writes', async () => {
    let gets = 0,
        posts = 0;
    const cash = [
        {
            id: 'won',
            externalId: 'won',
            date: '2026-10-15',
            currency: 'KRW',
            amount: 14000,
            exchangeRate: 1400,
            rawType: '환전원화출금',
            suggestedKind: 'exchange',
        },
        {
            id: 'usd',
            externalId: 'usd',
            date: '2026-10-15',
            currency: 'USD',
            amount: 10,
            exchangeRate: 1400,
            rawType: '환전외화입금',
            suggestedKind: 'exchange',
        },
    ];
    const payload = {
        version: 'v2:1:0',
        ledgerVersion: 'v2:1',
        entries: cash,
        importedCash: cash,
        trades: [
            {
                id: 'buy',
                externalId: 'buy',
                date: '2026-10-15',
                symbol: 'AAA',
                type: 'buy',
                currency: 'USD',
                nativeSettlementAmount: 8,
                settlementAmount: 11400,
            },
        ],
        allocations: [],
        classifications: [],
    };
    const actor = user();
    const request = createPortfolioCapitalClient({
        fetcher: async (url, options) => {
            if (options.method === 'POST') posts++;
            else gets++;
            return response(
                url.includes('version=')
                    ? { unchanged: true, version: payload.version }
                    : payload
            );
        },
    });
    const [a, b] = await Promise.all([
        request(actor, undefined, 'AC'),
        request(actor, undefined, 'AC'),
    ]);
    assert.equal(gets, 1);
    assert.equal(posts, 0);
    assert.equal(a.entries[0].purchaseExchange, true);
    assert.equal(a.allocations[0].derived, true);
    assert.equal(a.allocations[0].parts[0].amount, 8);
    a.allocations.length = 0;
    assert.equal(b.allocations.length, 1);
    const reloaded = await request(actor, undefined, 'AC', { force: true });
    assert.equal(reloaded.allocations.length, 1);
    assert.equal(gets, 2);
    assert.equal(posts, 0);
});
