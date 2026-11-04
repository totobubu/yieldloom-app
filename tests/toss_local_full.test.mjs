import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
    mkdtemp,
    readFile,
    rm,
    stat,
    readdir,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createLocalVault,
    createLocalCredentials,
} from '../lib/toss-local-vault.js';
import { createLocalCompanion } from '../lib/toss-local-companion.js';
import {
    createLocalGrantSigner,
    localHash,
    verifyLocalGrant,
} from '../lib/toss-local-grants.js';
import { createTossLocalCloud } from '../lib/toss-local-cloud.js';
import { createFirestoreLocalRepository } from '../api/_utils/toss-local-store.js';
import { createLocalTossClient } from '../src/services/localTossClient.js';
import { accountDigest } from '../lib/account-toss-connection.js';
import { memoryLocks } from './support/account-toss-fixture.mjs';
import { order, page } from './support/toss-orders-fixture.mjs';
import {
    createCompanionHttp,
    main as companionMain,
} from '../scripts/toss/local-companion.mjs';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); // Synthetic test-only key.
const signer = createLocalGrantSigner(privateKey);
const passphrase = 'SYNTHETIC-ONLY-PASSPHRASE';
const actor = { uid: 'owner1' },
    accountId = 'dynamic42';
test('CLI rejects a credential directory in the checkout before opening a listener or creating state', async () => {
    await assert.rejects(
        companionMain([
            '--serve',
            '--directory',
            fileURLToPath(new URL('..', import.meta.url)),
        ])
    );
});
function memoryDb() {
    const data = new Map([
        [
            `investmentAccounts/${accountId}`,
            {
                familyId: 'family1',
                ownerId: 'profile1',
                authorityUid: actor.uid,
                institution: '토스증권',
                maskedNumber: '****0042',
                permissions: { [actor.uid]: 'owner' },
            },
        ],
        [
            'familySpaces/family1',
            {
                participantUids: [actor.uid],
                profiles: { profile1: { uid: actor.uid } },
            },
        ],
    ]);
    const snapshot = (path) => ({
        id: path.split('/').at(-1),
        exists: data.has(path),
        data: () => structuredClone(data.get(path)),
    });
    const ref = (path) => ({
        path,
        collection: (name) => collection(`${path}/${name}`),
        get: async () => snapshot(path),
    });
    const query = (path, after = '', limit = 100) => ({
        startAfter: (id) => query(path, id, limit),
        limit: (n) => query(path, after, n),
        get: async () => ({
            docs: [...data.keys()]
                .filter(
                    (key) =>
                        key.startsWith(path + '/') &&
                        !key.slice(path.length + 1).includes('/') &&
                        key.slice(path.length + 1) > after
                )
                .sort()
                .slice(0, limit)
                .map(snapshot),
        }),
    });
    const collection = (path) => ({
        doc: (id) => ref(`${path}/${id}`),
        orderBy: () => query(path),
    });
    const lock = memoryLocks();
    return {
        data,
        collection,
        runTransaction: (work) =>
            lock('db', async () => {
                const writes = [];
                const tx = {
                    get: async (r) => snapshot(r.path),
                    set: (r, value) => writes.push([r.path, value]),
                    create: (r, value) => {
                        assert.equal(data.has(r.path), false);
                        writes.push([r.path, value]);
                    },
                };
                const result = await work(tx);
                writes.forEach(([path, value]) =>
                    data.set(path, structuredClone(value))
                );
                return result;
            }),
    };
}
async function setup(t, overrides = {}) {
    const root = await mkdtemp(join(tmpdir(), 'yieldloom-local-full-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const vault = createLocalVault(root);
    await vault.unlock(passphrase);
    const db = memoryDb(),
        repository = createFirestoreLocalRepository(db),
        service = createTossLocalCloud({
            repository,
            signer,
            ...(overrides.now ? { now: overrides.now } : {}),
        });
    const requests = [];
    const fetchBroker = async (url, request) => {
        const u = new URL(url);
        requests.push({ path: u.pathname, method: request.method });
        if (u.pathname === '/oauth2/token')
            return new Response(
                JSON.stringify({
                    access_token: 'SYNTHETIC-API-TOKEN',
                    expires_in: 3600,
                })
            );
        if (u.pathname === '/api/v1/accounts')
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
        assert.equal(u.pathname, '/api/v1/orders');
        assert.equal(request.headers['X-Tossinvest-Account'], '42');
        return new Response(page([order('SYNTHETIC-order1')]));
    };
    const credentials = createLocalCredentials({
        vault,
        fetchImpl: fetchBroker,
        ...(overrides.now ? { now: overrides.now } : {}),
    });
    const companion = createLocalCompanion({
        vault,
        credentials,
        cloud: {
            key: async () => signer.publicKey,
            check: (g) => service.check(g),
        },
        fetchBroker,
        ...overrides,
    });
    const browserRequests = [];
    const cloudClient = {
        act: (_id, input) => service.act(actor, { ...input, accountId: _id }),
    };
    const client = createLocalTossClient({
        getUser: () => actor,
        cloudClient,
        fetcher: async (url, request) => {
            browserRequests.push({ url, request });
            assert.ok(companion.paired(request.headers['X-Yieldloom-Pairing']));
            assert.equal(request.headers.Authorization, undefined);
            try {
                const result = await companion.act(
                    new URL(url).pathname,
                    JSON.parse(request.body)
                );
                return { ok: true, json: async () => result };
            } catch {
                return { ok: false };
            }
        },
    });
    client.setPairing(companion.pairing);
    const configure = async () => {
        const url = await client.prepare(accountId),
            flowId = new URL(url).searchParams.get('flow');
        await companion.act('/enroll', {
            flowId,
            form: {
                clientId: 'SYNTHETIC-client1',
                clientSecret: 'SYNTHETIC-secret1',
                accountNo: '00000000042',
                confirmed: true,
            },
        });
        await client.register(accountId);
    };
    return {
        root,
        vault,
        db,
        service,
        repository,
        credentials,
        companion,
        client,
        configure,
        requests,
        browserRequests,
        cloudClient,
        baseFetchBroker: fetchBroker,
    };
}

test('end to end: local enrollment → cloud binding → explicit token → collector → immutable cloud receipt → signed ack', async (t) => {
    const f = await setup(t);
    await f.configure();
    assert.equal(f.requests.length, 0); // Enrollment never issues or reads a broker.
    assert.equal((await f.client.status(accountId)).connected, true);
    await f.client.issueToken(accountId, true);
    const result = await f.client.update({
        accountId,
        from: '2026-01-01',
        to: '2026-01-03',
    });
    assert.equal(result.cloudSaved, true);
    assert.equal(result.canonicalUnchanged, true);
    assert.equal(result.saved, 2);
    assert.deepEqual(
        f.requests.map((r) => r.path),
        [
            '/oauth2/token',
            '/api/v1/accounts',
            '/api/v1/orders',
            '/api/v1/orders',
        ]
    );
    assert.equal((await f.vault.read()).queue.length, 0);
    assert.equal(
        [...f.db.data.keys()].filter((k) => k.includes('tossApiObservations'))
            .length,
        1
    ); // OPEN/CLOSED duplicate raw order is not counted twice.
    const archives = await readdir(join(f.root, 'archives'));
    assert.equal(archives.length, 2);
    await assert.rejects(stat(join(f.root, 'orders')), { code: 'ENOENT' });
    for (const file of archives) {
        const ciphertext = await readFile(
            join(f.root, 'archives', file),
            'utf8'
        );
        assert.doesNotMatch(
            ciphertext,
            /SYNTHETIC|orderId|filledQuantity|00000000042/
        );
        assert.equal(
            (await stat(join(f.root, 'archives', file))).mode & 0o077,
            0
        );
        assert.equal(
            (await f.vault.readArchive(file.slice(0, -5))).toString(),
            page([order('SYNTHETIC-order1')])
        );
    }
    assert.equal(
        [...f.db.data.entries()].find(([key]) =>
            key.includes('tossApiObservations')
        )[1].sourceVerification,
        'unverified_local_observation'
    );
    assert.equal(
        [...f.db.data.keys()].some((k) => /\/entries\//.test(k)),
        false
    );
    const disk = await readFile(join(f.root, 'vault.json'), 'utf8');
    assert.doesNotMatch(disk, /SYNTHETIC|00000000042|owner1/);
    assert.equal((await stat(join(f.root, 'vault.json'))).mode & 0o077, 0);
    assert.doesNotMatch(
        JSON.stringify(f.browserRequests),
        /SYNTHETIC-secret1|SYNTHETIC-API-TOKEN|clientSecret|client_id|00000000042/
    );
    f.vault.lock();
    await assert.rejects(f.vault.read());
    await assert.rejects(f.vault.unlock('wrong-synthetic-passphrase'));
    await f.vault.unlock(passphrase);
    assert.equal(Object.keys((await f.vault.read()).bindings).length, 1);
});

function resumedClient(companion, cloudClient) {
    const client = createLocalTossClient({
        getUser: () => actor,
        cloudClient,
        fetcher: async (url, request) => {
            assert.ok(companion.paired(request.headers['X-Yieldloom-Pairing']));
            try {
                const body = await companion.act(
                    new URL(url).pathname,
                    JSON.parse(request.body)
                );
                return { ok: true, json: async () => body };
            } catch {
                return { ok: false };
            }
        },
    });
    client.setPairing(companion.pairing);
    return client;
}

test('expired read grant preserves encrypted large OPEN and CLOSED cursor; restart resumes offsets without recollecting OPEN', async (t) => {
    let clock = 0,
        f;
    const broker = async (url, request) => {
        const u = new URL(url);
        if (u.pathname !== '/api/v1/orders')
            return f.baseFetchBroker(url, request);
        const scope = u.searchParams.get('status'),
            cursor = u.searchParams.get('cursor');
        f.requests.push({ path: u.pathname, scope, cursor });
        if (scope === 'OPEN')
            return new Response(
                page(
                    Array.from({ length: 120 }, (_, i) =>
                        order('SYNTHETIC-open-' + i)
                    )
                )
            );
        return new Response(
            cursor
                ? page([order('SYNTHETIC-closed-final')])
                : page([order('SYNTHETIC-closed-first')], 'opaque-next')
        );
    };
    f = await setup(t, {
        now: () => clock,
        sleep: async (ms) => {
            clock += ms;
        },
        fetchBroker: broker,
    });
    await f.configure();
    await f.client.issueToken(accountId, true);
    const write = f.vault.writeArchive.bind(f.vault);
    f.vault.writeArchive = async (...args) => {
        await write(...args);
        clock += 61000;
    };
    const act = f.cloudClient.act;
    let lost = true;
    f.cloudClient.act = async (id, input) => {
        const result = await act(id, input);
        if (input.action === 'local-save' && lost) {
            lost = false;
            throw Error('synthetic lost response');
        }
        return result;
    };
    const scope = { accountId, from: '2026-01-01', to: '2026-01-03' };
    await assert.rejects(f.client.update(scope));
    let state = await f.vault.read(),
        runId = state.activeCollections[accountId];
    assert.equal(state.collections[runId].scope, 'CLOSED');
    assert.equal(state.collections[runId].pages[0].count, 120);
    assert.equal(state.collections[runId].pages[0].ackOffset, 0);
    f.companion.close();
    const vault = createLocalVault(f.root);
    await vault.unlock(passphrase);
    const credentials = createLocalCredentials({
        vault,
        now: () => clock,
        fetchImpl: f.baseFetchBroker,
    });
    const restarted = createLocalCompanion({
        vault,
        credentials,
        now: () => clock,
        sleep: async (ms) => {
            clock += ms;
        },
        fetchBroker: broker,
        cloud: {
            key: async () => signer.publicKey,
            check: (g) => f.service.check(g),
        },
    });
    const client = resumedClient(restarted, f.cloudClient),
        requests = f.requests.length;
    const drained = await client.update(scope);
    assert.equal(drained.collectionPending, true);
    assert.equal(drained.saved, 120);
    assert.equal(f.requests.length, requests);
    state = await vault.read();
    assert.equal(state.collections[runId].pages[0].ackOffset, 120);
    const nextWrite = vault.writeArchive.bind(vault);
    vault.writeArchive = async (id, bytes) => {
        await nextWrite(id, bytes);
        if (JSON.parse(bytes).result.hasNext) clock += 61000;
    };
    const partial = await client.update(scope);
    assert.equal(partial.collectionPending, true);
    state = await vault.read();
    assert.equal(state.collections[runId].cursor, 'opaque-next');
    const before = f.requests.length;
    await assert.rejects(client.update({ ...scope, from: '2026-01-02' }));
    assert.equal(f.requests.length, before);
    f.db.data.get('familySpaces/family1').participantUids = [];
    await assert.rejects(client.update(scope));
    assert.equal(f.requests.length, before);
    f.db.data.get('familySpaces/family1').participantUids = [actor.uid];
    const finished = await client.update(scope);
    assert.equal(finished.collectionPending, false);
    assert.deepEqual(
        f.requests.filter((r) => r.scope).map((r) => [r.scope, r.cursor]),
        [
            ['OPEN', null],
            ['CLOSED', null],
            ['CLOSED', 'opaque-next'],
        ]
    );
    state = await vault.read();
    assert.equal(state.collections[runId].done, true);
    assert.equal(
        state.collections[runId].pages.every((p) => p.ackOffset === p.count),
        true
    );
});

test('OPEN response exceeding a grant is explicitly partial, never a date-filtered workaround or a saved empty result', async (t) => {
    let clock = 0,
        f;
    const broker = async (url, request) => {
        const u = new URL(url);
        if (u.pathname !== '/api/v1/orders')
            return f.baseFetchBroker(url, request);
        assert.equal(u.searchParams.get('status'), 'OPEN');
        assert.equal(u.searchParams.has('from'), false);
        f.requests.push({ path: u.pathname, scope: 'OPEN' });
        let part = 0;
        return new Response(
            new ReadableStream({
                pull(controller) {
                    clock += 35000;
                    if (part++ < 2)
                        controller.enqueue(
                            new TextEncoder().encode(
                                'incomplete-synthetic-json'
                            )
                        );
                    else controller.close();
                },
            })
        );
    };
    f = await setup(t, {
        now: () => clock,
        sleep: async (ms) => {
            clock += ms;
        },
        fetchBroker: broker,
    });
    await f.configure();
    await f.client.issueToken(accountId, true);
    const response = await f.client.update({
        accountId,
        from: '2026-01-01',
        to: '2026-01-02',
    });
    assert.equal(response.collectionPending, true);
    assert.equal(response.stopReason, 'OPEN_RESPONSE_LIMIT');
    assert.equal(response.saved, 0);
    const state = await f.vault.read(),
        session = state.collections[state.activeCollections[accountId]];
    assert.equal(session.pages.length, 0);
    assert.equal(session.scope, 'OPEN');
    await assert.rejects(stat(join(f.root, 'archives')), { code: 'ENOENT' });
    assert.equal(
        [...f.db.data.keys()].some((key) => key.includes('tossApiBatches')),
        false
    );
});

test('archive tampering fails closed after unlock; no plaintext fallback, checkpoint advance or provider recollection', async (t) => {
    const f = await setup(t);
    await f.configure();
    await f.client.issueToken(accountId, true);
    const challenge = await f.companion.act('/challenge');
    const signed = await f.service.act(actor, {
        action: 'local-grant',
        accountId,
        operation: 'read',
        nonce: challenge.nonce,
    });
    await f.companion.act('/collect', {
        grant: signed.grant,
        from: '2026-01-01',
        to: '2026-01-03',
    });
    const state = await f.vault.read(),
        run = state.collections[state.activeCollections[accountId]],
        id = run.pages[0].archiveId;
    const path = join(f.root, 'archives', id + '.json'),
        record = JSON.parse(await readFile(path, 'utf8'));
    record.tag = Buffer.alloc(16).toString('base64');
    await writeFile(path, JSON.stringify(record), { mode: 0o600 });
    f.vault.lock();
    await f.vault.unlock(passphrase);
    const count = f.requests.length;
    await assert.rejects(
        f.client.update({ accountId, from: '2026-01-01', to: '2026-01-03' })
    );
    assert.equal(f.requests.length, count);
    const after = await f.vault.read();
    assert.equal(after.collections[run.id].pages[0].ackOffset, 0);
    assert.equal(after.queue.length, 0);
});

test('OPEN transport timeout and response size limit remain explicit unsupported single-response boundaries', async (t) => {
    for (const reason of ['timeout', 'size']) {
        let f;
        const broker = async (url, request) => {
            if (new URL(url).pathname !== '/api/v1/orders')
                return f.baseFetchBroker(url, request);
            if (reason === 'timeout')
                throw new DOMException('synthetic timeout', 'TimeoutError');
            return new Response(new Uint8Array(20000001));
        };
        f = await setup(t, { fetchBroker: broker });
        await f.configure();
        await f.client.issueToken(accountId, true);
        const result = await f.client.update({
            accountId,
            from: '2026-01-01',
            to: '2026-01-02',
        });
        assert.equal(result.collectionPending, true);
        assert.equal(result.stopReason, 'OPEN_RESPONSE_LIMIT');
        assert.equal(result.saved, 0);
        await assert.rejects(stat(join(f.root, 'archives')), {
            code: 'ENOENT',
        });
    }
});

test('accounts timeout/expiry is identified before OPEN and during CLOSED resume without misreporting an OPEN limit', async (t) => {
    for (const scenario of [
        { phase: 'OPEN', name: 'TimeoutError' },
        { phase: 'CLOSED', name: 'TimeoutError' },
        { phase: 'OPEN', name: 'AbortError' },
        { phase: 'OPEN', name: 'TimeoutError', expire: true },
    ]) {
        let clock = 0;
        const paths = [];
        const f = await setup(t, {
            now: () => clock,
            fetchBroker: async (url) => {
                paths.push(new URL(url).pathname);
                assert.equal(new URL(url).pathname, '/api/v1/accounts');
                if (scenario.expire) clock += 61000;
                throw new DOMException(
                    'synthetic account lookup timeout',
                    scenario.name
                );
            },
        });
        await f.configure();
        await f.client.issueToken(accountId, true);
        if (scenario.phase === 'CLOSED')
            await f.vault.transaction(async (state) => {
                const id = 'synthetic-resume';
                state.activeCollections = { [accountId]: id };
                state.collections = {
                    [id]: {
                        id,
                        accountId,
                        subjectUid: actor.uid,
                        accountNoSha256:
                            state.bindings[accountId].accountNoSha256,
                        from: '2026-01-01',
                        to: '2026-01-02',
                        scope: 'CLOSED',
                        cursor: 'preserved-cursor',
                        pages: [],
                        seen: [],
                        done: false,
                        notBefore: 0,
                    },
                };
            });
        const result = await f.client.update({
            accountId,
            from: '2026-01-01',
            to: '2026-01-02',
        });
        assert.equal(
            result.stopReason,
            scenario.expire ? 'ACCOUNT_LOOKUP_WINDOW' : 'ACCOUNT_LOOKUP_TIMEOUT'
        );
        assert.equal(result.failureStage, 'ACCOUNTS');
        assert.equal(result.collectionPending, true);
        assert.equal(result.saved, 0);
        assert.deepEqual(paths, ['/api/v1/accounts']);
        const state = await f.vault.read(),
            active = state.collections[state.activeCollections[accountId]];
        assert.equal(active.scope, scenario.phase);
        assert.equal(
            active.cursor,
            scenario.phase === 'CLOSED' ? 'preserved-cursor' : null
        );
        assert.equal(active.pages.length, 0);
        await assert.rejects(stat(join(f.root, 'archives')), {
            code: 'ENOENT',
        });
        assert.equal(
            [...f.db.data.keys()].some((key) => key.includes('tossApiBatches')),
            false
        );
    }
});

test('permissions revoked during archive materialization prevent raw response/cloud publication and retain progress', async (t) => {
    const f = await setup(t);
    await f.configure();
    await f.client.issueToken(accountId, true);
    const read = f.vault.readArchive.bind(f.vault);
    f.vault.readArchive = async (id) => {
        const bytes = await read(id);
        f.db.data.get('familySpaces/family1').participantUids = [];
        return bytes;
    };
    await assert.rejects(
        f.client.update({ accountId, from: '2026-01-01', to: '2026-01-03' })
    );
    assert.equal(
        [...f.db.data.keys()].some((key) => key.includes('tossApiBatches')),
        false
    );
    const state = await f.vault.read(),
        run = state.collections[state.activeCollections[accountId]];
    assert.equal(state.queue.length, 1);
    assert.equal(run.pages[0].ackOffset, 0);
});

test('unknown issuance is durable, no automatic reissue; another process cannot overlap vault work', async (t) => {
    const f = await setup(t);
    await f.configure();
    const ref = accountDigest('SYNTHETIC-client1');
    let attempts = 0;
    const c = createLocalCredentials({
        vault: f.vault,
        fetchImpl: async () => {
            attempts++;
            throw Error('SYNTHETIC-private');
        },
    });
    await assert.rejects(c.issue(ref, true), {
        code: 'TOKEN_ISSUANCE_UNCERTAIN',
    });
    await assert.rejects(c.issue(ref, true), {
        code: 'TOKEN_ISSUANCE_UNCERTAIN',
    });
    assert.equal(attempts, 1);
    const second = createLocalVault(f.root);
    await second.unlock(passphrase);
    let release, entered;
    const entry = new Promise((resolve) => {
        entered = resolve;
    });
    const locked = f.vault.transaction(
        async () =>
            new Promise((r) => {
                release = r;
                entered();
            })
    );
    await entry;
    await assert.rejects(
        second.transaction(async () => {}),
        { code: 'LOCAL_SYNC_BUSY' }
    );
    release();
    await locked;
});

test('lost cloud save response resumes the same durable queue and receipt without recollecting or double insertion', async (t) => {
    const f = await setup(t);
    await f.configure();
    await f.client.issueToken(accountId, true);
    const original = f.cloudClient.act;
    let loseResponse = true;
    f.cloudClient.act = async (id, input) => {
        const result = await original(id, input);
        if (input.action === 'local-save' && loseResponse) {
            loseResponse = false;
            throw Error('synthetic transport interrupted after commit');
        }
        return result;
    };
    await assert.rejects(
        f.client.update({ accountId, from: '2026-01-01', to: '2026-01-03' })
    );
    assert.equal((await f.vault.read()).queue.length, 1);
    const calls = f.requests.length;
    const resumed = await f.client.update({
        accountId,
        from: '2026-01-01',
        to: '2026-01-03',
    });
    assert.equal(resumed.cloudSaved, true);
    assert.equal(f.requests.length, calls);
    assert.equal((await f.vault.read()).queue.length, 0);
    assert.equal(
        [...f.db.data.keys()].filter((k) => k.includes('tossApiBatches'))
            .length,
        2
    );
});

test('explicit key rotation clears only the client token and keeps original queue/bindings; shared client cannot cross owners', async (t) => {
    const f = await setup(t);
    await f.configure();
    await f.client.issueToken(accountId, true);
    const ref = accountDigest('SYNTHETIC-client1');
    const grant = {
        accountId,
        subjectUid: actor.uid,
        suffix: '0042',
        bindingRevision: 1,
        accountNoSha256: accountDigest('00000000042'),
    };
    const form = {
        clientId: 'SYNTHETIC-client1',
        clientSecret: 'SYNTHETIC-rotated-secret',
        accountNo: '00000000042',
        confirmed: true,
    };
    await assert.rejects(f.credentials.enroll(grant, form), {
        code: 'CLIENT_ALREADY_REGISTERED',
    });
    await f.credentials.enroll(grant, { ...form, replaceExisting: true });
    const state = await f.vault.read();
    assert.equal(state.clients[ref].generation, 2);
    assert.equal(state.clients[ref].token, undefined);
    assert.equal(
        state.bindings[accountId].accountNoSha256,
        grant.accountNoSha256
    );
    await assert.rejects(
        f.credentials.withExistingToken(ref, async () => {}),
        { code: 'AUTHORIZATION_REQUIRED' }
    );
    await assert.rejects(
        f.credentials.enroll(
            { ...grant, subjectUid: 'another-owner' },
            { ...form, replaceExisting: true }
        ),
        { code: 'CLIENT_ALREADY_REGISTERED' }
    );
});

test('account-view cancellation after a cloud commit stops acknowledgement and safely resumes the preserved source', async (t) => {
    const f = await setup(t);
    await f.configure();
    await f.client.issueToken(accountId, true);
    const original = f.cloudClient.act;
    let cancel = true;
    f.cloudClient.act = async (id, input) => {
        const result = await original(id, input);
        if (cancel && input.action === 'local-save') {
            cancel = false;
            f.client.cancel(accountId);
        }
        return result;
    };
    const input = { accountId, from: '2026-01-01', to: '2026-01-03' };
    await assert.rejects(f.client.update(input));
    let state = await f.vault.read(),
        run = state.collections[state.activeCollections[accountId]];
    assert.equal(state.queue.length, 1);
    assert.equal(run.pages[0].ackOffset, 0);
    const calls = f.requests.length;
    const resumed = await f.client.update(input);
    assert.equal(resumed.cloudSaved, true);
    assert.equal(f.requests.length, calls);
    state = await f.vault.read();
    assert.equal(state.queue.length, 0);
});

test('cloud writes revalidate family/owner/binding and preserve replay plus order revisions', async (t) => {
    const f = await setup(t);
    await f.configure();
    const binding = (await f.repository.scope(actor, accountId)).binding;
    const body = {
        accountId,
        accountNoSha256: binding.accountNoSha256,
        bindingRevision: binding.revision,
        records: [
            {
                pageHash: accountDigest('SYNTHETIC-page'),
                position: 0,
                scope: 'CLOSED',
                original: order(),
            },
        ],
    };
    const batch = { ...body, batchId: localHash(body) };
    const save = (value) =>
        f.service.act(actor, { action: 'local-save', accountId, batch: value });
    assert.equal((await save(batch)).replayed, false);
    assert.equal((await save(batch)).replayed, true);
    const changed = structuredClone(body);
    changed.records[0].original.execution.commission = '1.00';
    await save({ ...changed, batchId: localHash(changed) });
    assert.equal(
        [...f.db.data.keys()].filter((k) => k.includes('tossApiObservations'))
            .length,
        2
    );
    const malicious = structuredClone(body);
    malicious.records[0].original.clientSecret = 'SYNTHETIC';
    await assert.rejects(save({ ...malicious, batchId: localHash(malicious) }));
    f.db.data.get('familySpaces/family1').participantUids = [];
    await assert.rejects(save(batch), { code: 'OWNER_REQUIRED' });
});

test('grant signature, operation, expiry, one-use nonce and missing receipt block forged acknowledgements', async (t) => {
    const f = await setup(t);
    await f.configure();
    const challenge = await f.companion.act('/challenge');
    const { grant } = await f.service.act(actor, {
        action: 'local-grant',
        accountId,
        nonce: challenge.nonce,
        operation: 'profile',
    });
    const claims = verifyLocalGrant(grant, signer.publicKey, {
        nonce: challenge.nonce,
        operation: 'profile',
    });
    assert.equal(claims.accountId, accountId);
    assert.throws(() =>
        verifyLocalGrant(grant + 'x', signer.publicKey, {
            nonce: challenge.nonce,
            operation: 'profile',
        })
    );
    assert.throws(() =>
        verifyLocalGrant(grant, signer.publicKey, {
            nonce: challenge.nonce,
            operation: 'read',
        })
    );
    assert.throws(() =>
        verifyLocalGrant(grant, signer.publicKey, {
            nonce: challenge.nonce,
            operation: 'profile',
            now: claims.exp + 1,
        })
    );
    await f.companion.act('/profile', { grant });
    await assert.rejects(f.companion.act('/profile', { grant }), {
        code: 'LOCAL_GRANT_REJECTED',
    });
    await assert.rejects(
        f.service.act(actor, {
            action: 'local-grant',
            accountId,
            operation: 'ack',
            nonce: 'a'.repeat(43),
            batchId: 'a'.repeat(64),
        }),
        { code: 'RECEIPT_REQUIRED' }
    );
});

test('account observation reads are bounded, cursor based and reauthorize every page', async (t) => {
    const f = await setup(t);
    await f.configure();
    const binding = (await f.repository.scope(actor, accountId)).binding;
    const body = {
        accountId,
        accountNoSha256: binding.accountNoSha256,
        bindingRevision: binding.revision,
        records: Array.from({ length: 12 }, (_, position) => ({
            pageHash: accountDigest('SYNTHETIC-page'),
            position,
            scope: 'CLOSED',
            original: order('SYNTHETIC-' + position),
        })),
    };
    await f.service.act(actor, {
        action: 'local-save',
        accountId,
        batch: { ...body, batchId: localHash(body) },
    });
    const first = await f.service.act(actor, {
        action: 'local-observations',
        accountId,
    });
    assert.equal(first.observations.length, 10);
    assert.ok(first.nextCursor);
    const second = await f.service.act(actor, {
        action: 'local-observations',
        accountId,
        after: first.nextCursor,
    });
    assert.equal(second.observations.length, 2);
    assert.equal(second.nextCursor, null);
    assert.equal(
        new Set(
            [...first.observations, ...second.observations].map((r) => r.id)
        ).size,
        12
    );
    f.db.data.get('familySpaces/family1').participantUids = [];
    await assert.rejects(
        f.service.act(actor, {
            action: 'local-observations',
            accountId,
            after: first.nextCursor,
        }),
        { code: 'OWNER_REQUIRED' }
    );
});

test('actual loopback HTTP rejects foreign Origin/Host, missing pairing and hosted enrollment of secrets', async (t) => {
    const f = await setup(t),
        server = createCompanionHttp(f.companion);
    await new Promise((r) => server.listen(43129, '127.0.0.1', r));
    t.after(() => new Promise((r) => server.close(r)));
    const url = 'http://127.0.0.1:43129';
    const request = (path, origin, code = f.companion.pairing, extra = {}) =>
        fetch(url + path, {
            method: 'POST',
            headers: {
                Origin: origin,
                'Content-Type': 'application/json',
                'X-Yieldloom-Pairing': code,
                ...extra,
            },
            body: '{}',
        });
    assert.equal(
        (await request('/challenge', 'https://evil.example')).status,
        403
    );
    assert.equal(
        (await request('/challenge', 'https://yieldloom-app.vercel.app', 'bad'))
            .status,
        403
    );
    const badHost = await new Promise((resolve, reject) => {
        const req = httpRequest(
            url + '/challenge',
            {
                method: 'POST',
                headers: {
                    Host: 'attacker.example:43129',
                    Origin: 'https://yieldloom-app.vercel.app',
                    'Content-Type': 'application/json',
                    'X-Yieldloom-Pairing': f.companion.pairing,
                },
            },
            (res) => {
                res.resume();
                resolve(res.statusCode);
            }
        );
        req.on('error', reject);
        req.end('{}');
    });
    assert.equal(badHost, 403);
    assert.equal(
        (await request('/enroll', 'https://yieldloom-app.vercel.app')).status,
        403
    );
    assert.equal(
        (await request('/challenge', 'https://yieldloom-app.vercel.app'))
            .status,
        200
    );
    const response = await fetch(url + '/session', {
        headers: { Origin: 'https://evil.example' },
    });
    assert.equal(response.status, 403);
});
