import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockCollectionHandler } from '../lib/stock-collection.js';
const admin = { email: 'jomalkeun@gmail.com', email_verified: true };
const id = 'QLDY_11111111-1111-4111-8111-111111111111';
const sha = 'a'.repeat(40);
const reply = (body, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status });
function setup({
    user = admin,
    token = 'test-token',
    fetcher = async () => reply({ workflow_runs: [] }),
    ...options
} = {}) {
    const calls = [];
    return {
        calls,
        handler: stockCollectionHandler({
            verify: async () => user,
            knownSymbol: (s) => ['QLDY', 'AAPL', 'COII'].includes(s),
            token: () => token,
            uuid: () => id.split('_')[1],
            fetcher: async (...args) => {
                calls.push(args);
                return fetcher(...args);
            },
            ...options,
        }),
    };
}
async function call(handler, method = 'POST', input = { symbol: 'QLDY' }) {
    const res = {
        code: 0,
        headers: {},
        setHeader(k, v) {
            this.headers[k] = v;
        },
        status(c) {
            this.code = c;
            return this;
        },
        json(b) {
            this.body = b;
            return this;
        },
    };
    await handler({ method, body: input, query: input }, res);
    return res;
}
test('anonymous, members and unverified admins cannot dispatch', async () => {
    for (const user of [
        null,
        { email: 'member@example.com', email_verified: true },
        { ...admin, email_verified: false },
    ]) {
        const { handler, calls } = setup({ user });
        const r = await call(handler);
        assert.equal(r.code, 403);
        assert.equal(calls.length, 0);
    }
});
test('invalid and archived tickers never reach GitHub', async () => {
    const { handler, calls } = setup();
    for (const symbol of ['bad/path', 'UNKNOWN', 'COII'])
        assert.equal((await call(handler, 'POST', { symbol })).code, 400);
    assert.equal(calls.length, 0);
});
test('missing connection is a visible error', async () => {
    const { handler } = setup({ token: '' });
    assert.equal((await call(handler)).code, 503);
});
test('dispatch is restricted to one ticker on main; concurrent clicks share one write', async () => {
    const { handler, calls } = setup({
        fetcher: async (_, options) =>
            options.method === 'POST'
                ? reply(null, 204)
                : reply({ workflow_runs: [] }),
    });
    const [a, b] = await Promise.all([call(handler), call(handler)]);
    assert.equal(a.code, 202);
    assert.equal(b.body.requestId, a.body.requestId);
    const posts = calls.filter(([, init]) => init.method === 'POST');
    assert.equal(posts.length, 1);
    assert.deepEqual(JSON.parse(posts[0][1].body), {
        ref: 'main',
        inputs: { scope: 'ticker', ticker: 'QLDY', requestId: id },
    });
});
test('existing same-ticker job is reused while other jobs are ignored', async () => {
    const { handler, calls } = setup({
        fetcher: async () =>
            reply({
                workflow_runs: [
                    {
                        display_title: 'content-refresh:ticker:AAPL_other',
                        status: 'in_progress',
                    },
                    {
                        display_title: `content-refresh:ticker:${id}`,
                        status: 'queued',
                    },
                ],
            }),
    });
    assert.equal((await call(handler)).body.requestId, id);
    assert.equal(calls.length, 1);
});
test('status validation rejects mismatched identifiers', async () => {
    const { handler, calls } = setup();
    assert.equal(
        (await call(handler, 'GET', { symbol: 'AAPL', requestId: id })).code,
        400
    );
    assert.equal(calls.length, 0);
});
function finished(conclusion = 'success', release = sha) {
    return async (url) => {
        if (url.includes('/actions/workflows/'))
            return reply({
                workflow_runs: [
                    {
                        display_title: `content-refresh:ticker:${id}`,
                        id: 123,
                        status: 'completed',
                        conclusion,
                        created_at: '2026-10-23T01:00:00Z',
                        run_started_at: '2026-10-23T01:01:00Z',
                        updated_at: '2026-10-23T01:05:00Z',
                    },
                ],
            });
        if (url.includes('/commits?'))
            return reply([
                {
                    sha,
                    commit: {
                        message: `update\n\nRefresh-Request: ${id}`,
                        committer: { date: '2026-10-23T01:06:00Z' },
                    },
                },
            ]);
        if (url.includes('/app-release.json'))
            return reply({ commit: release });
        if (url.includes('/compare/')) return reply({ status: 'behind' });
        if (url.includes('/api/thumbnail-data'))
            return reply({
                ticker: {
                    symbol: 'QLDY',
                    backtestData: [{ date: '2026-10-22', amount: 0.15 }],
                },
                dataStatus: 'fresh',
            });
        throw Error('Unexpected request');
    };
}
test('collection success waits for production publication before returning fresh data', async () => {
    const waiting = setup({ fetcher: finished('success', 'b'.repeat(40)) });
    assert.equal(
        (await call(waiting.handler, 'GET', { symbol: 'QLDY', requestId: id }))
            .body.state,
        'publishing'
    );
    assert(!waiting.calls.some(([url]) => url.includes('/api/thumbnail-data')));
    const ready = setup({ fetcher: finished() });
    const r = await call(ready.handler, 'GET', {
        symbol: 'QLDY',
        requestId: id,
    });
    assert.equal(r.body.state, 'ready');
    assert.equal(r.body.data.ticker.symbol, 'QLDY');
    assert.deepEqual(
        {
            workflowStatus: r.body.workflowStatus,
            conclusion: r.body.conclusion,
            requestedAt: r.body.requestedAt,
            startedAt: r.body.startedAt,
            completedAt: r.body.completedAt,
            endedAt: r.body.endedAt,
            publishedAt: r.body.publishedAt,
        },
        {
            workflowStatus: 'completed',
            conclusion: 'success',
            requestedAt: '2026-10-23T01:00:00Z',
            startedAt: '2026-10-23T01:01:00Z',
            completedAt: '2026-10-23T01:05:00Z',
            endedAt: '2026-10-23T01:05:00Z',
            publishedAt: '2026-10-23T01:06:00Z',
        }
    );
    assert.equal(r.headers['Cache-Control'], 'private, no-store');
});
test('failed, cancelled and timed out workflows expose end time without a successful completion time', async () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
        const { handler } = setup({ fetcher: finished(conclusion) });
        const result = await call(handler, 'GET', {
            symbol: 'QLDY',
            requestId: id,
        });
        assert.equal(
            result.body.state,
            conclusion === 'cancelled' ? 'cancelled' : 'failed'
        );
        assert.equal(result.body.workflowStatus, 'completed');
        assert.equal(result.body.conclusion, conclusion);
        assert.equal(result.body.completedAt, null);
        assert.equal(result.body.endedAt, '2026-10-23T01:05:00Z');
    }
});

test('in progress workflows expose request and start times but no end time', async () => {
    const { handler } = setup({
        fetcher: async () =>
            reply({
                workflow_runs: [
                    {
                        display_title: `content-refresh:ticker:${id}`,
                        id: 123,
                        status: 'in_progress',
                        conclusion: null,
                        created_at: '2026-10-23T01:00:00Z',
                        run_started_at: '2026-10-23T01:01:00Z',
                        updated_at: '2026-10-23T01:02:00Z',
                    },
                ],
            }),
    });
    const result = await call(handler, 'GET', {
        symbol: 'QLDY',
        requestId: id,
    });
    assert.equal(result.body.state, 'collecting');
    assert.equal(result.body.workflowStatus, 'in_progress');
    assert.equal(result.body.conclusion, null);
    assert.equal(result.body.requestedAt, '2026-10-23T01:00:00Z');
    assert.equal(result.body.startedAt, '2026-10-23T01:01:00Z');
    assert.equal(result.body.completedAt, null);
    assert.equal(result.body.endedAt, null);
});

test('collection rewrite preserves method and receipt while feedback stays separate', async () => {
    const { stockActionRouter } = await import('../lib/stock-actions.js');
    const config = JSON.parse(
        await (
            await import('node:fs/promises')
        ).readFile(new URL('../vercel.json', import.meta.url), 'utf8')
    );
    const rewrite = config.rewrites.find(
        (row) => row.source === '/api/stock-collection'
    );
    assert.equal(rewrite.destination, '/api/stock-feedback?action=collection');
    const calls = [];
    const router = stockActionRouter({
        collection: async (req, res) => calls.push(['collection', req, res]),
        feedback: async (req, res) => calls.push(['feedback', req, res]),
    });
    for (const method of ['POST', 'GET', 'OPTIONS']) {
        const req = {
            method,
            query: { action: 'collection', symbol: 'QLDY', requestId: id },
        };
        const res = {};
        await router(req, res);
        assert.deepEqual(calls.at(-1), ['collection', req, res]);
    }
    const feedback = {
        method: 'POST',
        query: {},
        body: { message: 'feedback' },
    };
    await router(feedback, {});
    assert.equal(calls.at(-1)[0], 'feedback');
    assert.equal(calls.at(-1)[1], feedback);
});

test('failed collection exposes curated reason and step links without leaking raw logs', async () => {
    let jobReads = 0,
        logReads = 0;
    const { handler } = setup({
        fetcher: async (url) => {
            if (url.includes('/actions/runs/123/jobs')) {
                jobReads++;
                return reply({
                    jobs: [
                        {
                            id: 456,
                            steps: [
                                {
                                    name: 'Refresh official data',
                                    number: 10,
                                    status: 'completed',
                                    conclusion: 'success',
                                    started_at: '2026-10-23T01:02:00Z',
                                    completed_at: '2026-10-23T01:03:00Z',
                                },
                                {
                                    name: 'Commit public Content Studio outputs',
                                    number: 17,
                                    conclusion: 'success',
                                },
                            ],
                        },
                    ],
                });
            }
            if (url.includes('/actions/jobs/456/logs')) {
                logReads++;
                return new Response(
                    'SECRET_EXAMPLE_VALUE\nrefresh.py: error: ticker is not present in the official distribution or catalog index'
                );
            }
            return finished('failure')(url);
        },
    });
    for (let i = 0; i < 2; i++) {
        const result = await call(handler, 'GET', {
            symbol: 'QLDY',
            requestId: id,
        });
        assert.equal(result.body.state, 'failed');
        assert.equal(result.body.diagnostics.code, 'unsupported_source');
        assert.equal(result.body.diagnostics.steps[0].state, 'failure');
        assert.equal(result.body.diagnostics.steps[1].state, 'success');
        assert.equal(
            result.body.diagnostics.steps[0].completedAt,
            '2026-10-23T01:03:00Z'
        );
        assert.match(
            result.body.diagnostics.steps[0].logUrl,
            /runs\/123\/job\/456#step:10:1$/
        );
        assert(!JSON.stringify(result.body).includes('SECRET_EXAMPLE_VALUE'));
    }
    assert.equal(jobReads, 1);
    assert.equal(logReads, 1);
});

test('unavailable diagnostic logs retain original failure and run link', async () => {
    const { handler } = setup({ fetcher: finished('failure') });
    const result = await call(handler, 'GET', {
        symbol: 'QLDY',
        requestId: id,
    });
    assert.equal(result.body.state, 'failed');
    assert.equal(result.body.diagnostics.code, 'workflow_failed');
    assert.equal(
        result.body.runUrl,
        'https://github.com/totobubu/yieldloom-app/actions/runs/123'
    );
});

test('latest history is read-only, scoped to ticker and reuses its run lookup', async () => {
    const { handler, calls } = setup({
        fetcher: async (url) => {
            if (url.includes('/actions/workflows/'))
                return reply({
                    workflow_runs: [
                        {
                            display_title: 'content-refresh:ticker:BAC_other',
                            id: 999,
                            status: 'completed',
                            conclusion: 'failure',
                        },
                        {
                            display_title: `content-refresh:ticker:${id}`,
                            id: 123,
                            status: 'completed',
                            conclusion: 'cancelled',
                        },
                    ],
                });
            if (url.includes('/actions/runs/123/jobs'))
                return reply({ jobs: [] });
            throw Error('Unexpected request');
        },
    });
    const result = await call(handler, 'GET', {
        symbol: 'QLDY',
        history: 'latest',
    });
    assert.equal(result.body.requestId, id);
    assert.equal(result.body.diagnostics.code, 'cancelled');
    assert.equal(
        calls.filter(([url]) => url.includes('/actions/workflows/')).length,
        1
    );
    assert(!calls.some(([, options]) => options.method === 'POST'));
    const empty = setup();
    assert.equal(
        (
            await call(empty.handler, 'GET', {
                symbol: 'QLDY',
                history: 'latest',
            })
        ).body.state,
        'idle'
    );
    const member = setup({
        user: { email: 'member@example.com', email_verified: true },
    });
    assert.equal(
        (
            await call(member.handler, 'GET', {
                symbol: 'QLDY',
                history: 'latest',
            })
        ).code,
        403
    );
    assert.equal(member.calls.length, 0);
});

test('partial stock evidence is returned with its limitations rather than full-success diagnostics', async () => {
    const base = finished();
    const { handler } = setup({
        fetcher: async (url) => {
            if (url.includes('/api/thumbnail-data'))
                return reply({
                    ticker: {
                        symbol: 'QLDY',
                        stockCollection: {
                            status: 'partial',
                            requestId: id,
                            message: '배당락일 미확인',
                            steps: [
                                {
                                    name: '기업 공식 공시 수집',
                                    state: 'partial',
                                },
                            ],
                        },
                    },
                    dataStatus: 'partial',
                });
            return base(url);
        },
    });
    const result = await call(handler, 'GET', {
        symbol: 'QLDY',
        requestId: id,
    });
    assert.equal(result.body.state, 'ready');
    assert.equal(result.body.data.dataStatus, 'partial');
    assert.equal(result.body.diagnostics.code, 'partial_evidence');
    assert.equal(result.body.diagnostics.reason, '배당락일 미확인');
});

test('admin history includes private collection status without dispatch and denies non-admin reads', async () => {
    let reads = 0;
    const collectionStatus = async () => { reads++; return { datasets: [{dataset:'dividends',status:'partial'}] }; };
    const {handler} = setup({collectionStatus});
    const response = await call(handler,'GET',{symbol:'AAPL',history:'latest'});
    assert.equal(reads,1);
    assert.equal(response.body.collection.datasets[0].status,'partial');
    const denied = setup({user:{email:'other@example.com'},collectionStatus});
    await call(denied.handler,'GET',{symbol:'AAPL',history:'latest'});
    assert.equal(reads,1);
});
