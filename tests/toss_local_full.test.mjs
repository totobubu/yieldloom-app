import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
        service = createTossLocalCloud({ repository, signer });
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
        1
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
