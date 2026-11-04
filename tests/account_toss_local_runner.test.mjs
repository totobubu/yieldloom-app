import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountDigest } from '../lib/account-toss-connection.js';
import { createAccountTossLocalRunner } from '../lib/account-toss-local-runner.js';
import { readAccountOrders } from '../scripts/toss/read-account-orders.mjs';

function fixture(
    collect = async () => ({ apiStatus: 'complete' }),
    overrides = {}
) {
    const mapping = {
        accountId: 'dynamic-app-42',
        subjectUid: 'owner-42',
        credentialRef: 'local-client-42',
        accountNoSha256: accountDigest('00000000042'),
        suffix: '0042',
        revision: 1,
        enabled: true,
    };
    const grant = {
        accountId: mapping.accountId,
        actorUid: mapping.subjectUid,
        subjectUid: mapping.subjectUid,
        accountNoSha256: mapping.accountNoSha256,
        bindingRevision: 1,
        canManage: true,
    };
    const entries = [mapping],
        calls = [];
    const runner = createAccountTossLocalRunner({
        authorize: async () => grant,
        registry: { list: async () => entries },
        credentials: {
            withExistingToken: async (ref, work) => {
                calls.push(ref);
                return work('SYNTHETIC-TOKEN');
            },
        },
        root: '/tmp/local-test-only',
        collect,
        ...overrides,
    });
    return { runner, mapping, grant, entries, calls };
}
const input = {
    accountId: 'dynamic-app-42',
    from: '2026-01-01',
    to: '2026-01-02',
};
const rejected = (p, code) => assert.rejects(p, (error) => error.code === code);

test('dynamic accountId stays scoped; collector uses existing token only, no upload or financial mutation', async () => {
    let collected;
    const f = fixture(async (options, runtime) => {
        collected = { options, runtime };
        return {
            apiStatus: 'complete',
            secret: 'never-returned',
            localPath: '/private',
        };
    });
    assert.deepEqual(await f.runner.status(input.accountId), {
        accountId: input.accountId,
        connected: true,
        readOnly: true,
    });
    const result = await f.runner.update(input);
    assert.deepEqual(result, {
        accountId: input.accountId,
        status: 'collected_locally',
        canonicalUnchanged: true,
        cloudSaved: false,
    });
    assert.equal(collected.options.issueToken, false);
    assert.equal(collected.options.noExternalStorage, true);
    assert.equal(
        collected.options.expectedAccountNoSha256,
        f.mapping.accountNoSha256
    );
    assert.equal(
        collected.runtime.root,
        join('/tmp/local-test-only', input.accountId, f.mapping.accountNoSha256)
    );
    assert.deepEqual(f.calls, ['local-client-42']);
});

test('revocation while official account response is in flight stops before order reads', async () => {
    const requests = [];
    const f = fixture(readAccountOrders, {
        fetchImpl: async (url) => {
            requests.push(new URL(url).pathname);
            f.grant.canManage = false;
            return new Response(
                JSON.stringify({
                    result: [
                        {
                            accountNo: '00000000042',
                            accountSeq: 42,
                            accountType: 'BROKERAGE',
                        },
                    ],
                })
            );
        },
    });
    await rejected(f.runner.update(input), 'OWNER_REQUIRED');
    assert.deepEqual(requests, ['/api/v1/accounts']);
});

test('owner/family authorization failures, injected fields, invalid dates and duplicate registry bindings stop before credentials', async () => {
    for (const change of [
        (f) => {
            f.grant.actorUid = 'other';
        },
        (f) => {
            f.grant.canManage = false;
        },
        (f) => {
            f.grant.accountId = 'other';
        },
        (f) => {
            f.mapping.accountNoSha256 = accountDigest('other');
        },
        (f) => {
            f.entries.push({ ...f.mapping, accountId: 'other' });
        },
    ]) {
        const f = fixture();
        change(f);
        await assert.rejects(f.runner.update(input));
        assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    for (const body of [
        { ...input, accountSeq: 1 },
        { ...input, credentialRef: 'other' },
        { ...input, from: '2026-02-30' },
        { ...input, to: '2025-01-01' },
    ])
        await rejected(f.runner.update(body), 'INVALID_REQUEST');
    assert.equal(f.calls.length, 0);
});

test('late authorization/mapping changes discard local result; failures never echo provider text', async () => {
    const f = fixture(async () => {
        f.mapping.revision++;
        return { apiStatus: 'complete' };
    });
    await rejected(f.runner.update(input), 'STALE_BINDING');
    const broken = fixture(async () => {
        throw Error('SYNTHETIC-SECRET /private/location');
    });
    await rejected(broken.runner.update(input), 'LOCAL_SYNC_FAILED');
    const auth = fixture(async () => ({
        apiStatus: 'partial',
        reason: 'authentication_failed',
    }));
    await rejected(auth.runner.update(input), 'AUTHORIZATION_REQUIRED');
    assert.equal(auth.calls.length, 1);
});

test('duplicate clicks do not collect twice; explicit retry works after completion', async () => {
    let release,
        count = 0;
    const f = fixture(async () => {
        count++;
        await new Promise((r) => {
            release = r;
        });
        return { apiStatus: 'complete' };
    });
    const first = f.runner.update(input);
    await new Promise(setImmediate);
    await rejected(f.runner.update(input), 'LOCAL_SYNC_BUSY');
    release();
    await first;
    assert.equal(count, 1);
});

test('official account listing full hash mismatch fails before any orders request even with matching suffix', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'toss-dynamic-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const urls = [];
    const result = await readAccountOrders(
        {
            status: 'BOTH',
            accountSuffix: '0042',
            expectedAccountNoSha256: accountDigest('11111110042'),
            from: input.from,
            to: input.to,
        },
        {
            root,
            credentials: { TOSS_ACCESS_TOKEN: 'SYNTHETIC' },
            fetchImpl: async (url) => {
                urls.push(new URL(url).pathname);
                return new Response(
                    JSON.stringify({
                        result: [
                            {
                                accountNo: '00000000042',
                                accountSeq: 42,
                                accountType: 'BROKERAGE',
                            },
                        ],
                    })
                );
            },
        }
    );
    assert.equal(result.reason, 'profile_account_mismatch');
    assert.deepEqual(urls, ['/api/v1/accounts']);
});
