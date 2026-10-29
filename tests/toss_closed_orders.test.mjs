import test from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtemp,
    readFile,
    readdir,
    writeFile,
    unlink,
    rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    collectClosedOrders,
    issueCollectorToken,
    loadLocalCredentials,
} from '../scripts/toss/collect-closed-orders.mjs';
import { order, page } from './support/toss-orders-fixture.mjs';

const input = {
    accountSeq: '123456',
    token: 'fixture-sensitive-token-never-log',
    run: 'test',
};
const accountHash = (account = input.accountSeq) =>
    createHash('sha256').update(account).digest('hex');
async function setup(t) {
    const root = await mkdtemp(join(tmpdir(), 'yieldloom-orders-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return { root, directory: join(root, accountHash(), input.run) };
}
function mock(responses) {
    const calls = [];
    const waits = [];
    return {
        calls,
        waits,
        sleep: async (ms) => {
            waits.push(ms);
        },
        fetchImpl: async (url, options) => {
            calls.push({ url: String(url), options });
            assert.ok(responses.length, 'Unexpected request');
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return typeof response === 'string'
                ? new Response(response)
                : response;
        },
    };
}
const json = async (directory, name) =>
    JSON.parse(await readFile(join(directory, name), 'utf8'));

test('multiple pages: exact raw bytes, strings, time, currency and opaque cursor survive', async (t) => {
    const { root, directory } = await setup(t);
    const raw = `  ${page([order()], 'opaque+/=&cursor')}\n`;
    const io = mock([raw, page([order('fixture-order-2')])]);
    const result = await collectClosedOrders(input, { root, ...io });
    assert.equal(result.status, 'complete');
    assert.equal(result.uniqueOrders, 2);
    assert.equal(result.pages, 2);
    assert.equal(
        new URL(io.calls[1].url).searchParams.get('cursor'),
        'opaque+/=&cursor'
    );
    assert.equal(new URL(io.calls[0].url).searchParams.get('status'), 'CLOSED');
    assert.equal(new URL(io.calls[0].url).searchParams.get('limit'), '100');
    assert.equal(new URL(io.calls[0].url).searchParams.has('from'), false);
    assert.ok(
        io.calls.every(
            ({ options }) =>
                options.method === 'GET' && options.redirect === 'error'
        )
    );
    const receipt = await json(directory, 'page-00000001.json');
    assert.equal(
        Buffer.from(receipt.bodyBase64, 'base64').toString('utf8'),
        raw
    );
    assert.equal(
        receipt.sha256,
        createHash('sha256').update(raw).digest('hex')
    );
    const index = await json(directory, 'orders-index.json');
    assert.equal(index.orders[0].orderId, order().orderId);
    assert.equal(index.orders[0].observations[0].quantity, order().quantity);
    assert.equal(index.orders[0].observations[0].orderedAt, order().orderedAt);
    assert.equal(
        index.orders[0].observations[0].execution.filledAmount,
        order().execution.filledAmount
    );
    assert.equal(result.snapshotGuaranteed, false);
    assert.equal((await json(directory, 'checkpoint.json')).nextCursor, null);
});

test('empty final page is complete; empty intermediate page is followed', async (t) => {
    const { root } = await setup(t);
    const io = mock([page([], 'next'), page([])]);
    const result = await collectClosedOrders(input, { root, ...io });
    assert.equal(result.status, 'complete');
    assert.equal(result.uniqueOrders, 0);
    assert.equal(io.calls.length, 2);
});

test('same ID duplicates collapse; changed observations remain unresolved revisions', async (t) => {
    const { root, directory } = await setup(t);
    const changed = order('fixture-order-1', { status: 'CANCELED' });
    const io = mock([page([order(), order()], 'next'), page([changed])]);
    const result = await collectClosedOrders(input, { root, ...io });
    assert.equal(result.uniqueOrders, 1);
    assert.equal(result.duplicates, 1);
    assert.equal(result.conflicts, 1);
    assert.equal(
        (await json(directory, 'orders-index.json')).orders[0].observations
            .length,
        2
    );
});

test('partial fill followed by cancellation is retained separately from an unfilled cancellation', async (t) => {
    const { root, directory } = await setup(t);
    const canceled = order('partial-cancel', {
        status: 'CANCELED',
        canceledAt: '2026-01-02T03:10:00.001+09:00',
    });
    const noFill = order('no-fill', {
        status: 'CANCELED',
        execution: {
            ...order().execution,
            filledQuantity: '0.000000',
            filledAmount: null,
        },
    });
    await collectClosedOrders(input, {
        root,
        ...mock([
            page([
                canceled,
                noFill,
                order('partial', { status: 'PARTIAL_FILLED' }),
            ]),
        ]),
    });
    const rows = (await json(directory, 'orders-index.json')).orders;
    assert.equal(rows.length, 3);
    assert.equal(rows[0].observations[0].executionPresence, 'present');
    assert.equal(rows[1].observations[0].executionPresence, 'none');
    assert.equal(rows[2].observations[0].status, 'PARTIAL_FILLED');
});

test('cursor cycles stop with committed evidence and cannot resume the cycle', async (t) => {
    const { root, directory } = await setup(t);
    const io = mock([page([order()], 'A'), page([], 'B'), page([], 'A')]);
    const result = await collectClosedOrders(input, { root, ...io });
    assert.equal(result.status, 'partial');
    assert.equal(result.reason, 'cursor_repeated');
    assert.equal(result.pages, 3);
    const again = mock([]);
    assert.equal(
        (await collectClosedOrders(input, { root, ...again })).reason,
        'cursor_repeated'
    );
    assert.equal(again.calls.length, 0);
    assert.equal((await json(directory, 'checkpoint.json')).status, 'partial');
});

test('failure and resume use committed page, recover missing checkpoint, and do not reissue finished requests', async (t) => {
    const { root, directory } = await setup(t);
    const result = await collectClosedOrders(
        { ...input, maxRetries: 0 },
        {
            root,
            ...mock([
                page([order()], 'next'),
                new Error('secret network message'),
            ]),
        }
    );
    assert.equal(result.reason, 'retry_exhausted');
    assert.equal(result.pages, 1);
    await unlink(join(directory, 'checkpoint.json'));
    await writeFile(
        join(directory, 'page-00000002.json.orphan.tmp'),
        'incomplete'
    );
    const io = mock([page([order('next-order')])]);
    const resumed = await collectClosedOrders(input, { root, ...io });
    assert.equal(resumed.status, 'complete');
    assert.equal(resumed.uniqueOrders, 2);
    assert.equal(new URL(io.calls[0].url).searchParams.get('cursor'), 'next');
    let issued = false;
    assert.equal(
        (
            await collectClosedOrders(
                { ...input, token: undefined },
                {
                    root,
                    ...mock([]),
                    getToken: () => {
                        issued = true;
                    },
                }
            )
        ).status,
        'complete'
    );
    assert.equal(issued, false);
});

test('page budget leaves a resumable partial result', async (t) => {
    const { root } = await setup(t);
    const first = await collectClosedOrders(
        { ...input, maxPages: 1 },
        { root, ...mock([page([], 'next')]) }
    );
    assert.equal(first.reason, 'page_limit');
    assert.equal(first.status, 'partial');
    assert.equal(
        (await collectClosedOrders(input, { root, ...mock([page([])]) }))
            .status,
        'complete'
    );
});

test('429 respects Retry-After and rate reset, retries finitely and stores no error body', async (t) => {
    const { root, directory } = await setup(t);
    const io = mock([
        new Response('fixture secret error body', {
            status: 429,
            headers: { 'Retry-After': '2', 'X-RateLimit-Reset': '3' },
        }),
        page([]),
    ]);
    assert.equal(
        (await collectClosedOrders(input, { root, ...io })).status,
        'complete'
    );
    assert.equal(io.calls.length, 2);
    assert.ok(io.waits.some((ms) => ms >= 2800 && ms <= 3000));
    for (const name of await readdir(directory))
        assert.ok(
            !(await readFile(join(directory, name), 'utf8')).includes(
                'fixture secret error body'
            )
        );
});

test('long cooldown survives restart without issuing another request', async (t) => {
    const { root } = await setup(t);
    const first = await collectClosedOrders(input, {
        root,
        ...mock([
            new Response('', {
                status: 429,
                headers: { 'Retry-After': '3600' },
            }),
        ]),
    });
    assert.equal(first.reason, 'cooldown');
    const io = mock([]);
    assert.equal(
        (await collectClosedOrders(input, { root, ...io })).reason,
        'cooldown'
    );
    assert.equal(io.calls.length, 0);
});

test('5xx and network retries are limited; 400 and 401/403 stop immediately', async (t) => {
    const { root } = await setup(t);
    const retry = mock([
        new Response('', { status: 503 }),
        new Error('sensitive transport error'),
    ]);
    assert.equal(
        (
            await collectClosedOrders(
                { ...input, maxRetries: 1 },
                { root, ...retry }
            )
        ).reason,
        'retry_exhausted'
    );
    assert.equal(retry.calls.length, 2);
    for (const status of [400, 401, 403]) {
        const io = mock([new Response('sensitive error', { status })]);
        const result = await collectClosedOrders(
            { ...input, run: `status-${status}` },
            { root, ...io }
        );
        assert.equal(
            result.reason,
            status === 400 ? 'http_error' : 'authentication_failed'
        );
        assert.equal(io.calls.length, 1);
        assert.ok(!JSON.stringify(result).includes('sensitive'));
    }
});

test('schema problems never report exhaustion or save malformed/credential-bearing bodies', async (t) => {
    const { root } = await setup(t);
    const invalid = [
        'not-json',
        '{"result":{"orders":[]}}',
        '{"result":{"orders":[],"hasNext":true,"nextCursor":null}}',
        page([order('bad', { quantity: 0.1 })]),
        page([order('bad', { authorization: 'secret' })]),
        page([order('bad', { unknown: input.token })]),
    ];
    for (const [i, raw] of invalid.entries()) {
        const result = await collectClosedOrders(
            { ...input, run: `bad-${i}` },
            { root, ...mock([raw]) }
        );
        assert.equal(result.reason, 'invalid_response');
        assert.equal(result.pages, 0);
        assert.equal(result.status, 'partial');
    }
});

test('corrupt receipt is not overwritten and prevents further network requests', async (t) => {
    const { root, directory } = await setup(t);
    await collectClosedOrders(
        { ...input, maxPages: 1 },
        { root, ...mock([page([], 'next')]) }
    );
    const receipt = await json(directory, 'page-00000001.json');
    receipt.sha256 = 'incorrect';
    const damaged = JSON.stringify(receipt);
    await writeFile(join(directory, 'page-00000001.json'), damaged);
    const io = mock([]);
    assert.equal(
        (await collectClosedOrders(input, { root, ...io })).reason,
        'invalid_archive'
    );
    assert.equal(io.calls.length, 0);
    assert.equal(
        await readFile(join(directory, 'page-00000001.json'), 'utf8'),
        damaged
    );
});

test('account isolation, query identity and single writer protection', async (t) => {
    const { root, directory } = await setup(t);
    await collectClosedOrders(input, { root, ...mock([page([order()])]) });
    assert.equal(
        (
            await collectClosedOrders(
                { ...input, limit: 50 },
                { root, ...mock([]) }
            )
        ).reason,
        'configuration_mismatch'
    );
    await writeFile(join(directory, 'writer.lock'), 'existing writer');
    assert.equal(
        (await collectClosedOrders(input, { root, ...mock([]) })).reason,
        'locked'
    );
    assert.equal(
        await readFile(join(directory, 'writer.lock'), 'utf8'),
        'existing writer'
    );
    const second = await collectClosedOrders(
        { ...input, accountSeq: '654321' },
        { root, ...mock([page([])]) }
    );
    assert.equal(second.uniqueOrders, 0);
    assert.equal((await json(directory, 'orders-index.json')).uniqueOrders, 1);
});

test('abort is resumable and leaves no writer lock', async (t) => {
    const { root, directory } = await setup(t);
    const controller = new AbortController();
    const io = mock([page([], 'next')]);
    const fetchImpl = async (...args) => {
        const response = await io.fetchImpl(...args);
        controller.abort();
        return response;
    };
    const result = await collectClosedOrders(input, {
        root,
        ...io,
        fetchImpl,
        signal: controller.signal,
    });
    assert.equal(result.reason, 'interrupted');
    assert.equal(result.pages, 1);
    assert.ok(!(await readdir(directory)).includes('writer.lock'));
});

test('CLI help and missing live opt-in never read secrets, issue tokens or print malformed arguments', () => {
    for (const args of [
        ['--help'],
        ['--run', 'test'],
        ['--unknown=fixture-sensitive-argument'],
    ]) {
        const result = spawnSync(
            process.execPath,
            ['scripts/toss/collect-closed-orders.mjs', ...args],
            { encoding: 'utf8' }
        );
        const output = result.stdout + result.stderr;
        assert.ok(!output.includes('fixture-sensitive-argument'));
        assert.equal(result.status, args[0] === '--help' ? 0 : 1);
    }
});

test('credential file loads quoted literal values, environment wins, malformed input is not echoed', async (t) => {
    const { root } = await setup(t);
    const path = join(root, 'config.local');
    await writeFile(
        path,
        '\uFEFF# synthetic only\r\nTOSS_CLIENT_ID=fixture-id\r\nTOSS_CLIENT_SECRET="fixture-$secret=#literal"\r\nTOSS_ACCOUNT_SEQ=123456\r\n'
    );
    const credentials = await loadLocalCredentials(path, {
        TOSS_CLIENT_ID: 'environment-id',
    });
    assert.equal(credentials.TOSS_CLIENT_ID, 'environment-id');
    assert.equal(credentials.TOSS_CLIENT_SECRET, 'fixture-$secret=#literal');
    assert.equal(credentials.TOSS_ACCOUNT_SEQ, '123456');
    await writeFile(path, 'MALFORMED fixture-sensitive');
    await assert.rejects(
        loadLocalCredentials(path, {}),
        (error) => error.message === 'invalid_options'
    );
});

test('token issuance is explicit, once, not retried and never persists token or credentials', async (t) => {
    const { root, directory } = await setup(t);
    const credentials = {
        TOSS_CLIENT_ID: 'fixture-id',
        TOSS_CLIENT_SECRET: 'fixture-secret',
    };
    const auth = mock([
        JSON.stringify({ access_token: input.token, token_type: 'Bearer' }),
    ]);
    const io = mock([page([], 'next'), page([])]);
    let count = 0;
    const result = await collectClosedOrders(
        { ...input, token: undefined },
        {
            root,
            ...io,
            getToken: async () => {
                count++;
                return issueCollectorToken(credentials, auth.fetchImpl);
            },
        }
    );
    assert.equal(result.status, 'complete');
    assert.equal(count, 1);
    assert.equal(auth.calls[0].options.method, 'POST');
    assert.equal(
        new URLSearchParams(auth.calls[0].options.body).get('client_secret'),
        credentials.TOSS_CLIENT_SECRET
    );
    for (const name of await readdir(directory)) {
        const text = await readFile(join(directory, name), 'utf8');
        for (const secret of [
            input.token,
            credentials.TOSS_CLIENT_SECRET,
            credentials.TOSS_CLIENT_ID,
        ])
            assert.ok(!text.includes(secret));
    }
    const bad = mock([new Response('fixture-secret', { status: 401 })]);
    await assert.rejects(
        issueCollectorToken(credentials, bad.fetchImpl),
        (error) => error.message === 'authentication_failed'
    );
    assert.equal(bad.calls.length, 1);
});

test('successful exhausted rate bucket is paced; repeated 429 has a fixed attempt budget', async (t) => {
    const { root } = await setup(t);
    const paced = mock([
        new Response(page([], 'next'), {
            headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '5' },
        }),
        page([]),
    ]);
    assert.equal(
        (await collectClosedOrders(input, { root, ...paced })).status,
        'complete'
    );
    assert.ok(paced.waits.some((ms) => ms > 4500 && ms <= 5000));
    const limited = mock(
        Array.from(
            { length: 3 },
            () => new Response('private error', { status: 429 })
        )
    );
    const result = await collectClosedOrders(
        { ...input, run: '429-budget', maxRetries: 2 },
        { root, ...limited }
    );
    assert.equal(result.reason, 'retry_exhausted');
    assert.equal(limited.calls.length, 3);
});

test('future status codes and signed decimal strings remain observations; invalid pagination is partial', async (t) => {
    const { root, directory } = await setup(t);
    const future = order('future', {
        status: 'FUTURE_STATUS',
        orderType: 'FUTURE_TYPE',
        execution: { ...order().execution, tax: '-0.01000000000000000001' },
    });
    const result = await collectClosedOrders(input, {
        root,
        ...mock([page([future])]),
    });
    assert.equal(result.status, 'complete');
    const row = (await json(directory, 'orders-index.json')).orders[0]
        .observations[0];
    assert.equal(row.status, 'FUTURE_STATUS');
    assert.equal(row.execution.tax, '-0.01000000000000000001');
    for (const [i, raw] of [
        JSON.stringify({
            result: { orders: [], hasNext: false, nextCursor: 'unexpected' },
        }),
        page([order('missing-execution', { execution: {} })]),
    ].entries()) {
        assert.equal(
            (
                await collectClosedOrders(
                    { ...input, run: `invalid-page-${i}` },
                    { root, ...mock([raw]) }
                )
            ).reason,
            'invalid_response'
        );
    }
});
