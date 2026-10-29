import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
    readAccountOrders,
    validateManualOptions,
} from '../scripts/toss/read-account-orders.mjs';
import { page, order } from './support/toss-orders-fixture.mjs';

const options = {
    accountSuffix: '0042',
    status: 'BOTH',
    from: '2026-01-01',
    to: '2026-01-03',
};
const credentials = {
    TOSS_ACCESS_TOKEN: 'fixture-manual-token',
    TOSS_CLIENT_ID: 'fixture-client',
    TOSS_CLIENT_SECRET: 'fixture-secret',
};
const accounts = JSON.stringify({
    result: [
        { accountNo: '00000000042', accountSeq: 42, accountType: 'BROKERAGE' },
    ],
});
async function setup(t) {
    const root = await mkdtemp(join(tmpdir(), 'yieldloom-manual-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}
function mock(responses) {
    const calls = [];
    return {
        calls,
        sleep: async () => {},
        fetchImpl: async (url, request) => {
            calls.push({ url: new URL(url), request });
            assert.ok(responses.length, 'Unexpected request');
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return typeof response === 'string'
                ? new Response(response)
                : response;
        },
    };
}

test('manual BOTH reuses token, reads all OPEN and every CLOSED cursor page with separate scope outcomes', async (t) => {
    const root = await setup(t);
    const io = mock([
        accounts,
        page([order('current', { status: 'PARTIAL_FILLED' })]),
        page([order()], 'opaque'),
        page([order('last')]),
    ]);
    const result = await readAccountOrders(options, {
        credentials,
        root,
        ...io,
    });
    assert.equal(result.apiStatus, 'complete');
    assert.equal(result.browserStatus, 'not_run');
    assert.deepEqual(result.requests, { token: 0, accounts: 1, orders: 3 });
    assert.equal(result.scopes.OPEN.uniqueOrders, 1);
    assert.equal(result.scopes.CLOSED.uniqueOrders, 2);
    assert.equal(io.calls[1].url.searchParams.get('status'), 'OPEN');
    assert.equal(io.calls[1].url.searchParams.has('from'), false);
    assert.equal(io.calls[2].url.searchParams.get('from'), options.from);
    assert.equal(io.calls[3].url.searchParams.get('cursor'), 'opaque');
    assert.ok(
        io.calls.every(
            ({ request }) =>
                request.method === 'GET' && request.redirect === 'error'
        )
    );
    assert.ok(!JSON.stringify(result).includes(credentials.TOSS_ACCESS_TOKEN));
    assert.ok(!JSON.stringify(result).includes('00000000042'));
});

test('two manual invocations with the same scope both perform fresh reads and preserve both archives', async (t) => {
    const root = await setup(t);
    const io = mock([accounts, page([]), accounts, page([])]);
    const request = { accountSuffix: options.accountSuffix, status: 'OPEN' };
    const one = await readAccountOrders(request, { credentials, root, ...io });
    const two = await readAccountOrders(request, { credentials, root, ...io });
    assert.notEqual(one.invocationId, two.invocationId);
    assert.equal(io.calls.length, 4);
    const accountFolders = await readdir(root);
    const runs = await readdir(join(root, accountFolders[0]));
    assert.equal(
        runs.filter((run) => run.startsWith('open-manual-')).length,
        2
    );
});

test('CLOSED without requested period or explicit all-history never calls auth or reads a provider', async (t) => {
    const root = await setup(t);
    const io = mock([]);
    const result = await readAccountOrders(
        { accountSuffix: '0042', status: 'CLOSED', issueToken: true },
        { credentials, root, ...io }
    );
    assert.equal(result.reason, 'invalid_scope_or_account_selection');
    assert.equal(io.calls.length, 0);
    assert.equal(
        validateManualOptions({ ...options, allHistory: true }),
        false
    );
    assert.equal(
        validateManualOptions({ ...options, from: '2026-02-30' }),
        false
    );
    assert.equal(
        validateManualOptions({ ...options, accountSuffix: '12345678' }),
        false
    );
});

test('explicit all-history omits date filters and still requires selected account', async (t) => {
    const root = await setup(t);
    const io = mock([accounts, page([])]);
    const result = await readAccountOrders(
        { accountSuffix: '0042', status: 'CLOSED', allHistory: true },
        { credentials, root, ...io }
    );
    assert.equal(result.apiStatus, 'complete');
    assert.equal(result.scopes.OPEN.status, 'not_requested');
    assert.equal(io.calls[1].url.searchParams.has('from'), false);
    assert.equal(io.calls[1].url.searchParams.has('to'), false);
});

test('missing token requires explicit issuance, and existing token wins even when issuance allowed', async (t) => {
    const root = await setup(t);
    const noToken = { ...credentials, TOSS_ACCESS_TOKEN: undefined };
    const io = mock([]);
    assert.equal(
        (
            await readAccountOrders(options, {
                credentials: noToken,
                root,
                ...io,
            })
        ).reason,
        'authentication_required'
    );
    assert.equal(io.calls.length, 0);
    const existing = mock([accounts, page([]), page([])]);
    const result = await readAccountOrders(
        { ...options, issueToken: true },
        { credentials, root, ...existing }
    );
    assert.equal(result.requests.token, 0);
});

test('explicit existing-key authentication occurs once; token never appears in summaries or archived raw', async (t) => {
    const root = await setup(t);
    const io = mock([
        JSON.stringify({ access_token: 'fixture-issued-token' }),
        accounts,
        page([]),
    ]);
    const result = await readAccountOrders(
        { accountSuffix: '0042', status: 'OPEN', issueToken: true },
        {
            credentials: { ...credentials, TOSS_ACCESS_TOKEN: undefined },
            root,
            ...io,
        }
    );
    assert.equal(result.apiStatus, 'complete');
    assert.equal(result.requests.token, 1);
    assert.equal(io.calls[0].request.method, 'POST');
    assert.equal(io.calls[0].url.pathname, '/oauth2/token');
    assert.equal(
        io.calls[1].request.headers.Authorization,
        'Bearer fixture-issued-token'
    );
    assert.ok(!JSON.stringify(result).includes('fixture-issued-token'));
    const accountFolder = (await readdir(root))[0];
    const runFolder = (await readdir(join(root, accountFolder)))[0];
    for (const file of await readdir(join(root, accountFolder, runFolder))) {
        const text = await readFile(
            join(root, accountFolder, runFolder, file),
            'utf8'
        );
        for (const secret of [
            'fixture-issued-token',
            credentials.TOSS_CLIENT_SECRET,
            credentials.TOSS_CLIENT_ID,
        ])
            assert.ok(!text.includes(secret));
    }
});

test('ambiguous account, account 401 and token errors stop without retry or provider body disclosure', async (t) => {
    const root = await setup(t);
    const ambiguous = mock([
        JSON.stringify({
            result: [
                JSON.parse(accounts).result[0],
                JSON.parse(accounts).result[0],
            ],
        }),
    ]);
    assert.equal(
        (await readAccountOrders(options, { credentials, root, ...ambiguous }))
            .reason,
        'account_selection_not_unique'
    );
    assert.equal(ambiguous.calls.length, 1);
    const rejected = mock([
        new Response('private provider error', { status: 401 }),
    ]);
    const result = await readAccountOrders(
        { ...options, issueToken: true },
        { credentials, root, ...rejected }
    );
    assert.equal(result.reason, 'authentication_failed');
    assert.equal(rejected.calls.length, 1);
    assert.ok(!JSON.stringify(result).includes('private provider error'));
});

test('partial API scope does not claim overall success or falsely mark browser complete', async (t) => {
    const root = await setup(t);
    const io = mock([
        accounts,
        page([]),
        new Response('private', { status: 403 }),
    ]);
    const result = await readAccountOrders(options, {
        credentials,
        root,
        ...io,
    });
    assert.equal(result.apiStatus, 'partial');
    assert.equal(result.scopes.OPEN.status, 'complete');
    assert.equal(result.scopes.CLOSED.status, 'partial');
    assert.equal(result.browserStatus, 'not_run');
    assert.equal(result.reason, 'authentication_failed');
});

test('help and invalid scope do not read credentials and never echo malformed arguments', () => {
    for (const args of [
        ['--help'],
        ['--live', '--account-suffix', '0042', '--status', 'CLOSED'],
        ['--unknown=fixture-do-not-echo'],
    ]) {
        const result = spawnSync(
            process.execPath,
            ['scripts/toss/read-account-orders.mjs', ...args],
            { encoding: 'utf8' }
        );
        assert.equal(result.status, args[0] === '--help' ? 0 : 1);
        assert.ok(
            !(result.stdout + result.stderr).includes('fixture-do-not-echo')
        );
    }
});
