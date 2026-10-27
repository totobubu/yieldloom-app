import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTossLocalSync } from '../src/services/tossLocalSync.js';
const user = { synthetic: true };
const batch = () => ({
    accountId: 'wife',
    batchId: 'synthetic-1',
    observations: [
        {
            accountId: 'wife',
            kind: 'TOSS_TRANSACTION',
            sourceId: 'namespace|source-id',
            values: {},
        },
    ],
    checkpoint: { sourceHash: 'a'.repeat(64), offset: 0, count: 1 },
});
function fixture({ status = {}, input = batch(), failCommit = false } = {}) {
    const calls = [],
        states = [];
    let ctx = { user, accountId: 'wife' };
    const connector = {
        status: async () => ({
            connected: true,
            readOnly: true,
            accountVerified: true,
            accountId: 'wife',
            ...status,
        }),
        nextBatch: async (options) => {
            calls.push(['collect', options]);
            return input;
        },
        acknowledge: async (args) => {
            calls.push(['ack', args]);
        },
    };
    const client = {
        mutate: async (who, method, command) => {
            assert.equal(who, user);
            assert.equal(method, 'POST');
            calls.push([command.action, command]);
            if (failCommit && command.action === 'batch-commit')
                throw Error('synthetic disconnect');
            return {
                canonicalUnchanged: true,
                fingerprint: 'synthetic-digest',
                replayed: false,
            };
        },
    };
    const controller = createTossLocalSync({
        connector,
        ledgerClient: client,
        context: () => ctx,
        onSaved: () => calls.push(['saved']),
        onState: (s) => states.push(s),
    });
    return {
        controller,
        calls,
        states,
        connector,
        change: (next) => {
            ctx = next;
        },
    };
}
test('user click verifies account, collects read-only, previews/commits evidence and acknowledges last', async () => {
    const f = fixture();
    await f.controller.update();
    assert.deepEqual(
        f.calls.map((c) => c[0]),
        ['collect', 'batch-preview', 'batch-commit', 'saved', 'ack']
    );
    assert.deepEqual(f.calls[0][1], { accountId: 'wife', readOnly: true });
    assert.equal(f.calls[2][1].fingerprint, 'synthetic-digest');
    assert.equal(f.states.at(-1).phase, 'saved');
});
test('missing connector or unverified/wrong account blocks all collection and cloud writes', async () => {
    const empty = createTossLocalSync({
        context: () => ({ user, accountId: 'wife' }),
    });
    await assert.rejects(empty.update(), /아직 이 화면에 연결되지/);
    for (const status of [
        { accountVerified: false },
        { accountId: 'husband' },
        { readOnly: false },
        { readOnly: 'false' },
    ]) {
        const f = fixture({ status });
        await assert.rejects(f.controller.update(), /계좌의 일치/);
        assert.equal(f.calls.length, 0);
    }
});
test('failed save does not advance local checkpoint; retry retains exact batch identity', async () => {
    const f = fixture({ failCommit: true });
    await assert.rejects(f.controller.update(), /disconnect/);
    await assert.rejects(f.controller.update(), /disconnect/);
    assert.equal(
        f.calls.some((c) => c[0] === 'ack'),
        false
    );
    const commits = f.calls.filter((c) => c[0] === 'batch-commit');
    assert.deepEqual(commits[0][1], commits[1][1]);
});
test('logout during collection blocks cloud submission', async () => {
    const f = fixture();
    f.connector.nextBatch = async () => {
        f.change({ user: null, accountId: 'wife' });
        return batch();
    };
    await assert.rejects(f.controller.update(), /로그인 또는 선택 계좌/);
    assert.equal(f.calls.length, 0);
});
test('secret fields, raw cookie headers and cross-account batches are never uploaded', async () => {
    for (const extra of [
        { cookie: 'fictional' },
        { rawText: '{"access_token":"fictional"}' },
        { rawText: 'Cookie: example=fictional' },
    ]) {
        const input = batch();
        Object.assign(input.observations[0], extra);
        const f = fixture({ input });
        await assert.rejects(f.controller.update(), /인증 정보/);
        assert.deepEqual(
            f.calls.map((c) => c[0]),
            ['collect']
        );
    }
    const f = fixture({ input: { ...batch(), accountId: 'husband' } });
    await assert.rejects(f.controller.update(), /배치의 계좌/);
});
test('one click remains one batch and concurrent clicks cannot submit duplicate operations', async () => {
    const f = fixture();
    let release;
    f.connector.nextBatch = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    const first = f.controller.update();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(f.controller.update(), /업데이트가 진행 중/);
    release(batch());
    await first;
    assert.equal(f.calls.filter((c) => c[0] === 'batch-commit').length, 1);
});
