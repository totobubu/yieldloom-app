import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    collectOpenOrders,
    collectClosedOrders,
} from '../scripts/toss/collect-closed-orders.mjs';
import { order, page } from './support/toss-orders-fixture.mjs';

const input = {
    accountSeq: '123456',
    token: 'fixture-open-secret',
    run: 'open-test',
};
const accountHash = createHash('sha256').update(input.accountSeq).digest('hex');
async function setup(t) {
    const root = await mkdtemp(join(tmpdir(), 'yieldloom-open-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return { root, folder: (run = input.run) => join(root, accountHash, run) };
}
function mock(responses) {
    const calls = [];
    return {
        calls,
        sleep: async () => {},
        fetchImpl: async (url, options) => {
            calls.push({ url: new URL(url), options });
            assert.ok(responses.length, 'Unexpected request');
            const response = responses.shift();
            if (response instanceof Error) throw response;
            return typeof response === 'string'
                ? new Response(response)
                : response;
        },
    };
}

test('OPEN keeps every current row in one response without limit/cursor and preserves partial fill strings', async (t) => {
    const { root, folder } = await setup(t);
    const orders = Array.from({ length: 101 }, (_, i) =>
        order(`open-${i}`, { status: i ? 'PENDING' : 'PARTIAL_FILLED' })
    );
    const io = mock([page(orders)]);
    const result = await collectOpenOrders(
        { ...input, limit: 1 },
        { root, ...io }
    );
    assert.equal(result.status, 'complete');
    assert.equal(result.reason, 'open_observation_returned');
    assert.equal(result.coverage, 'supported_open_orders_observed_only');
    assert.equal(result.snapshotGuaranteed, false);
    assert.equal(result.uniqueOrders, 101);
    assert.equal(result.pages, 1);
    assert.equal(io.calls.length, 1);
    assert.equal(io.calls[0].url.searchParams.get('status'), 'OPEN');
    for (const key of ['limit', 'cursor', 'from', 'to'])
        assert.equal(io.calls[0].url.searchParams.has(key), false);
    assert.equal(io.calls[0].options.method, 'GET');
    const index = JSON.parse(
        await readFile(join(folder(), 'orders-index.json'), 'utf8')
    );
    assert.equal(index.orders[0].observations[0].status, 'PARTIAL_FILLED');
    assert.equal(
        index.orders[0].observations[0].execution.filledQuantity,
        order().execution.filledQuantity
    );
    const receipt = JSON.parse(
        await readFile(join(folder(), 'page-00000001.json'), 'utf8')
    );
    assert.equal(
        Buffer.from(receipt.bodyBase64, 'base64').toString('utf8'),
        page(orders)
    );
});

test('OPEN empty observation completes only the current-order response', async (t) => {
    const { root } = await setup(t);
    const result = await collectOpenOrders(input, {
        root,
        ...mock([page([])]),
    });
    assert.equal(result.uniqueOrders, 0);
    assert.equal(result.reason, 'open_observation_returned');
    assert.notEqual(result.reason, 'provider_exhausted');
});

test('unexpected OPEN pagination is partial and cannot archive or follow a cursor', async (t) => {
    const { root } = await setup(t);
    const io = mock([page([order()], 'unexpected-cursor')]);
    const result = await collectOpenOrders(input, { root, ...io });
    assert.equal(result.status, 'partial');
    assert.equal(result.reason, 'invalid_response');
    assert.equal(result.pages, 0);
    assert.equal(io.calls.length, 1);
});

test('OPEN has a separate run and does not overwrite any CLOSED evidence', async (t) => {
    const { root, folder } = await setup(t);
    const closedRun = 'closed-fixture';
    await collectClosedOrders(
        { ...input, run: closedRun },
        { root, ...mock([page([order()])]) }
    );
    const names = [
        'page-00000001.json',
        'manifest.json',
        'checkpoint.json',
        'orders-index.json',
    ];
    const before = await Promise.all(
        names.map((name) => readFile(join(folder(closedRun), name)))
    );
    const io = mock([]);
    assert.equal(
        (await collectOpenOrders({ ...input, run: closedRun }, { root, ...io }))
            .reason,
        'invalid_options'
    );
    assert.equal(io.calls.length, 0);
    await collectOpenOrders(input, {
        root,
        ...mock([page([order('current', { status: 'PARTIAL_FILLED' })])]),
    });
    for (const [i, name] of names.entries())
        assert.deepEqual(
            await readFile(join(folder(closedRun), name)),
            before[i]
        );
    assert.equal(
        (
            await collectClosedOrders(
                { ...input, status: 'OPEN' },
                { root, ...mock([]) }
            )
        ).reason,
        'invalid_options'
    );
});

test('completed OPEN run stays immutable; new run is needed for a fresh observation', async (t) => {
    const { root, folder } = await setup(t);
    await collectOpenOrders(input, { root, ...mock([page([order()])]) });
    const old = await readFile(join(folder(), 'page-00000001.json'));
    const io = mock([]);
    assert.equal(
        (await collectOpenOrders(input, { root, ...io })).status,
        'complete'
    );
    assert.equal(io.calls.length, 0);
    await collectOpenOrders(
        { ...input, run: 'open-next' },
        { root, ...mock([page([])]) }
    );
    assert.deepEqual(await readFile(join(folder(), 'page-00000001.json')), old);
});

test('OPEN never issues tokens and stops immediately on authentication failure', async (t) => {
    const { root } = await setup(t);
    let issued = false;
    const result = await collectOpenOrders(
        { ...input, token: undefined },
        {
            root,
            ...mock([]),
            getToken: () => {
                issued = true;
                return 'fixture';
            },
        }
    );
    assert.equal(result.reason, 'invalid_options');
    assert.equal(issued, false);
    const missing = await collectOpenOrders(
        { ...input, token: undefined },
        { root, ...mock([]) }
    );
    assert.equal(missing.reason, 'invalid_options');
    const io = mock([
        new Response('fixture-open-secret must not be emitted', {
            status: 401,
        }),
    ]);
    const rejected = await collectOpenOrders(input, { root, ...io });
    assert.equal(rejected.reason, 'authentication_failed');
    assert.equal(io.calls.length, 1);
    assert.ok(!JSON.stringify(rejected).includes(input.token));
});

test('failed OPEN response can resume without being treated as an empty complete observation', async (t) => {
    const { root } = await setup(t);
    const failed = await collectOpenOrders(
        { ...input, maxRetries: 0 },
        { root, ...mock([new Error('sensitive transport error')]) }
    );
    assert.equal(failed.status, 'partial');
    assert.equal(failed.reason, 'retry_exhausted');
    assert.equal(failed.pages, 0);
    assert.equal(
        (await collectOpenOrders(input, { root, ...mock([page([order()])]) }))
            .uniqueOrders,
        1
    );
});

test('OPEN CLI rejects token issuance before reading any credential file', () => {
    const result = spawnSync(
        process.execPath,
        [
            'scripts/toss/collect-closed-orders.mjs',
            '--live',
            '--status',
            'OPEN',
            '--run',
            'open-fixture',
            '--issue-token',
        ],
        { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing token/);
    assert.ok(!result.stdout);
});
