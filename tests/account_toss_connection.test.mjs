import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createAccountTossService,
    createConnectionTokens,
    createTossReadTransport,
    ConnectionError,
} from '../lib/account-toss-connection.js';
import {
    createAccountTossHandler,
    createUnavailableTossService,
    createRetiredTossHandler,
} from '../lib/account-toss-handler.js';
import { createAccountTossClient } from '../src/services/accountTossClient.js';
import {
    accountTossFixture,
    memoryLocks,
} from './support/account-toss-fixture.mjs';

const wife = { uid: 'demo-wife' },
    husband = { uid: 'demo-husband' },
    viewer = { uid: 'demo-viewer' };
const act = (f, action, revision, extra = {}) =>
    f.service.act(wife, { accountId: 'demo-wife', action, revision, ...extra });
async function connected(f) {
    await act(f, 'register', 0, { connectionId: 'connection-wife' });
    await act(f, 'verify', 1);
}
const rejected = (promise, code) =>
    assert.rejects(promise, (e) => e.code === code);

test('production service stays disabled after ACL validation; legacy route never calls provider', async () => {
    const f = accountTossFixture();
    const unavailable = createUnavailableTossService({
        loadAccount: f.repository.account,
        loadFamily: f.repository.family,
    });
    assert.equal((await unavailable.state(wife, 'demo-wife')).mode, 'disabled');
    for (const action of ['register', 'verify', 'query', 'disconnect'])
        await rejected(
            unavailable.act(wife, { accountId: 'demo-wife', action }),
            'EXECUTION_NOT_CONFIGURED'
        );
    await rejected(unavailable.state(husband, 'demo-wife'), 'ACCESS_DENIED');
    let status, body;
    const headers = {};
    const res = {
        setHeader: (k, v) => {
            headers[k] = v;
        },
        status: (s) => {
            status = s;
            return {
                json: (b) => {
                    body = b;
                },
            };
        },
    };
    await createRetiredTossHandler(async () => wife)(
        { method: 'GET', query: { action: 'holdings', accountSeq: 2 } },
        res
    );
    assert.equal(status, 410);
    assert.equal(body.error, 'ACCOUNT_SCOPED_CONNECTION_REQUIRED');
    assert.equal(headers['Cache-Control'], 'private, no-store');
    assert.equal(f.calls.length, 0);
    assert.equal(f.issued(), 0);
});

test('downgraded account role cannot manage a connection even when authorityUid still matches', async () => {
    const f = accountTossFixture();
    f.accounts.get('demo-wife').permissions[wife.uid] = 'viewer';
    assert.equal((await f.service.state(wife, 'demo-wife')).canManage, false);
    await rejected(
        act(f, 'register', 0, { connectionId: 'connection-wife' }),
        'OWNER_REQUIRED'
    );
    assert.equal(f.issued(), 0);
});

test('account UI client → authenticated handler → binding/token/fixture end to end; no private fields escape', async () => {
    const f = accountTossFixture();
    const requests = [];
    const handler = createAccountTossHandler({
        authenticate: async () => wife,
        service: f.service,
    });
    const user = { ...wife, getIdToken: async () => 'fixture-firebase' };
    const client = createAccountTossClient({
        getUser: () => user,
        fetcher: async (url, options) => {
            requests.push(options);
            const headers = {};
            let status;
            let body;
            await handler(
                {
                    method: options.method,
                    query: Object.fromEntries(
                        new URL(url, 'http://fixture').searchParams
                    ),
                    body: options.body && JSON.parse(options.body),
                },
                {
                    setHeader: (k, v) => {
                        headers[k] = v;
                    },
                    status: (s) => {
                        status = s;
                        return {
                            json: (b) => {
                                body = b;
                            },
                        };
                    },
                }
            );
            assert.equal(headers['Cache-Control'], 'private, no-store');
            assert.doesNotMatch(
                JSON.stringify(body),
                /secretRef|clientIdentity|synthetic-token|accountSeq|accountNo|SYNTHETIC/
            );
            return { ok: status === 200, json: async () => body };
        },
    });
    assert.equal((await client.status('demo-wife')).status, 'not_connected');
    await client.act('demo-wife', {
        action: 'register',
        revision: 0,
        connectionId: 'connection-wife',
    });
    await client.act('demo-wife', { action: 'verify', revision: 1 });
    assert.deepEqual(
        (await client.act('demo-wife', { action: 'query', revision: 2 }))
            .holdings,
        [{ symbol: 'DEMO', quantity: '1' }]
    );
    await client.act('demo-wife', { action: 'disconnect', revision: 3 });
    await assert.rejects(
        client.act('demo-wife', { action: 'query', revision: 4 })
    );
    assert.equal(f.issued(), 1);
    assert.equal(f.calls.length, 3);
    assert.equal(f.audit.length, 4);
    assert.ok(requests.every((r) => r.cache === 'no-store'));
    assert.doesNotMatch(
        JSON.stringify(f.audit),
        /secret|token|quantity|accountSeq/i
    );
});

test('foreign connection, accountSeq injection, viewer/editor/manager and family boundaries', async () => {
    const f = accountTossFixture();
    await rejected(
        act(f, 'register', 0, { connectionId: 'connection-husband' }),
        'CONNECTION_ACCESS_DENIED'
    );
    await rejected(
        act(f, 'register', 0, {
            connectionId: 'connection-wife',
            accountSeq: 1,
        }),
        'INVALID_REQUEST'
    );
    await rejected(f.service.state(husband, 'demo-wife'), 'ACCESS_DENIED');
    assert.equal((await f.service.state(viewer, 'demo-wife')).canManage, false);
    await rejected(
        f.service.act(viewer, {
            accountId: 'demo-wife',
            action: 'register',
            revision: 0,
            connectionId: 'connection-wife',
        }),
        'OWNER_REQUIRED'
    );
    f.accounts.get('demo-wife').authorityUid = viewer.uid;
    await rejected(
        f.service.act(viewer, {
            accountId: 'demo-wife',
            action: 'register',
            revision: 0,
            connectionId: 'connection-wife',
        }),
        'OWNER_REQUIRED'
    );
    f.family.participantUids = [];
    await rejected(f.service.state(wife, 'demo-wife'), 'ACCESS_DENIED');
    assert.equal(f.calls.length, 0);
    assert.equal(f.issued(), 0);
});

test('stale revisions, duplicate clicks, rotation, disabled connection and disconnect preservation', async () => {
    const f = accountTossFixture();
    const body = { connectionId: 'connection-wife' };
    const results = await Promise.allSettled([
        act(f, 'register', 0, body),
        act(f, 'register', 0, body),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    await rejected(act(f, 'query', 1), 'ACCOUNT_VERIFICATION_REQUIRED');
    await act(f, 'verify', 1);
    f.connections.get('connection-wife').generation++;
    await rejected(act(f, 'query', 2), 'CONNECTION_ROTATED');
    f.connections.get('connection-wife').enabled = false;
    await act(f, 'disconnect', 2);
    assert.equal(f.bindings.get('demo-wife').status, 'disconnected');
    assert.equal(f.accounts.size, 2);
    assert.equal(f.issued(), 1);
});

test('cross-account provider evidence and stale account mapping fail closed', async () => {
    const f = accountTossFixture();
    await act(f, 'register', 0, { connectionId: 'connection-wife' });
    const service = createAccountTossService({
        repository: f.repository,
        tokens: f.tokens,
        read: async () => [
            {
                accountType: 'BROKERAGE',
                accountNo: 'SYNTHETIC-20002',
                accountSeq: 2,
            },
        ],
    });
    await rejected(
        service.act(wife, {
            accountId: 'demo-wife',
            action: 'verify',
            revision: 1,
        }),
        'ACCOUNT_VERIFICATION_REQUIRED'
    );
    f.accounts.get('demo-wife').expectedAccountNoSha256 = 'changed';
    await rejected(act(f, 'verify', 1), 'STALE_BINDING');
});

test('permissions, rotation and account identity changes during provider call discard result and commit', async () => {
    for (const change of [
        (f) => {
            delete f.accounts.get('demo-wife').permissions[wife.uid];
        },
        (f) => {
            f.connections.get('connection-wife').generation++;
        },
        (f) => {
            f.accounts.get('demo-wife').expectedAccountNoSha256 = 'changed';
        },
    ]) {
        const f = accountTossFixture();
        await connected(f);
        const service = createAccountTossService({
            repository: f.repository,
            tokens: f.tokens,
            read: async (...args) => {
                const result = await f.read(...args);
                if (args[0].endsWith('/holdings')) change(f);
                return result;
            },
        });
        await assert.rejects(
            service.act(wife, {
                action: 'query',
                accountId: 'demo-wife',
                revision: 2,
            })
        );
        assert.equal(f.bindings.get('demo-wife').revision, 2);
        assert.equal(f.bindings.get('demo-wife').syncedAt, undefined);
    }
});

test('two service instances share synchronization, no revision duplicate and no 401 auto refresh', async () => {
    const f = accountTossFixture();
    await connected(f);
    const second = createAccountTossService({
        repository: f.repository,
        tokens: f.tokens,
        read: f.read,
    });
    const input = { action: 'query', accountId: 'demo-wife', revision: 2 };
    const results = await Promise.allSettled([
        f.service.act(wife, input),
        second.act(wife, input),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const denied = createAccountTossService({
        repository: f.repository,
        tokens: f.tokens,
        read: async () => {
            throw new ConnectionError('AUTHORIZATION_REQUIRED', 503);
        },
    });
    await rejected(
        denied.act(wife, { ...input, revision: 3 }),
        'AUTHORIZATION_REQUIRED'
    );
    assert.equal(f.issued(), 1);
    assert.equal(f.bindings.get('demo-wife').revision, 3);
});

test('token TTL and shared client lock coordinate instances/accounts; rotation cannot issue old token', async () => {
    const values = new Map();
    let time = 0,
        issued = 0,
        active = 1;
    const store = {
        lock: memoryLocks(),
        active: async (c) => c.generation === active,
        read: async (k) => values.get(k),
        write: async (k, v) => {
            values.set(k, v);
        },
    };
    const issue = async () => {
        issued++;
        await Promise.resolve();
        return { access_token: 'synthetic', expires_in: 100 };
    };
    const a = createConnectionTokens({ store, issue, now: () => time }),
        b = createConnectionTokens({ store, issue, now: () => time });
    const c = { clientIdentity: 'same-client', generation: 1 };
    await Promise.all([a.get(c), b.get(c), a.get(c)]);
    assert.equal(issued, 1);
    time = 71000;
    await Promise.all([a.get(c), b.get(c)]);
    assert.equal(issued, 2);
    active = 2;
    await rejected(a.get(c), 'CONNECTION_ROTATED');
    assert.equal(issued, 2);
    await b.get({ ...c, generation: 2 });
    assert.equal(issued, 3);
});

test('transport allowlist, redirects/timeouts and sensitive provider errors are bounded and sanitized', async () => {
    let calls = 0;
    const read = createTossReadTransport({
        fetcher: async (_url, options) => {
            calls++;
            assert.equal(options.method, 'GET');
            assert.equal(options.redirect, 'error');
            assert.ok(options.signal);
            return { ok: false, status: 401, body: { cancel: async () => {} } };
        },
    });
    for (const path of [
        '/oauth2/token',
        'https://evil.test',
        '/api/v1/orders/../holdings',
        '/api/v1/orders?bad=true',
    ])
        await rejected(read(path, 'synthetic', 1), 'ENDPOINT_REJECTED');
    await rejected(read('/api/v1/holdings', 'synthetic'), 'BINDING_REQUIRED');
    await rejected(
        read('/api/v1/accounts', 'synthetic'),
        'AUTHORIZATION_REQUIRED'
    );
    assert.equal(calls, 1);
    const timeout = createTossReadTransport({
        timeoutMs: 1,
        fetcher: async (_url, options) =>
            new Promise((resolve, reject) => {
                const timer = setTimeout(() => resolve({}), 50);
                options.signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(Error('synthetic-private-error'));
                });
            }),
    });
    await rejected(
        timeout('/api/v1/accounts', 'synthetic'),
        'PROVIDER_UNAVAILABLE'
    );
    const redirect = createTossReadTransport({
        fetcher: async () => {
            throw Error('secret-value redirect failed');
        },
    });
    await rejected(
        redirect('/api/v1/accounts', 'synthetic'),
        'PROVIDER_UNAVAILABLE'
    );
});

test('handler rejects accountSeq GET and always no-store including unsafe auth exceptions', async () => {
    const f = accountTossFixture();
    let code, payload;
    const headers = {};
    const res = {
        setHeader: (k, v) => {
            headers[k] = v;
        },
        status: (c) => {
            code = c;
            return {
                json: (p) => {
                    payload = p;
                },
            };
        },
    };
    await createAccountTossHandler({
        authenticate: async () => wife,
        service: f.service,
    })(
        { method: 'GET', query: { accountId: 'demo-wife', accountSeq: '2' } },
        res
    );
    assert.equal(code, 400);
    assert.equal(headers['Cache-Control'], 'private, no-store');
    await createAccountTossHandler({
        authenticate: async () => {
            throw Error('private-key');
        },
        service: f.service,
    })({ method: 'GET' }, res);
    assert.equal(code, 503);
    assert.deepEqual(payload, { error: 'CONNECTION_UNAVAILABLE' });
});

test('client shares concurrent status only, cancels independently and discards changed sessions', async () => {
    let user = { getIdToken: async () => 'synthetic-firebase' },
        count = 0,
        release;
    const client = createAccountTossClient({
        getUser: () => user,
        fetcher: async () => {
            count++;
            await new Promise((r) => {
                release = r;
            });
            return {
                ok: true,
                json: async () => ({ status: 'not_connected' }),
            };
        },
    });
    const abort = new AbortController();
    const a = client.status('demo-wife', abort.signal),
        b = client.status('demo-wife');
    await new Promise(setImmediate);
    abort.abort();
    await assert.rejects(a, { name: 'AbortError' });
    release();
    await b;
    assert.equal(count, 1);
    const late = client.status('demo-wife');
    await new Promise(setImmediate);
    user = null;
    release();
    await assert.rejects(late, { name: 'AbortError' });
});

test('failed read can be explicitly retried without rebinding, token reissue or duplicate commit', async () => {
    const f = accountTossFixture();
    await connected(f);
    let failed = false;
    const service = createAccountTossService({
        repository: f.repository,
        tokens: f.tokens,
        read: async (...args) => {
            if (!failed) {
                failed = true;
                throw Error('synthetic private network details');
            }
            return f.read(...args);
        },
    });
    const input = { accountId: 'demo-wife', action: 'query', revision: 2 };
    await rejected(service.act(wife, input), 'CONNECTION_UNAVAILABLE');
    assert.equal(f.bindings.get('demo-wife').revision, 2);
    const result = await service.act(wife, input);
    assert.equal(result.revision, 3);
    assert.equal(f.issued(), 1);
    await rejected(service.act(wife, input), 'STALE_BINDING');
});

test('revocation during token acquisition stops provider reads, and token generation change stops cache publication', async () => {
    const f = accountTossFixture();
    await act(f, 'register', 0, { connectionId: 'connection-wife' });
    const service = createAccountTossService({
        repository: f.repository,
        read: f.read,
        tokens: {
            get: async () => {
                delete f.accounts.get('demo-wife').permissions[wife.uid];
                return 'synthetic';
            },
        },
    });
    await rejected(
        service.act(wife, {
            accountId: 'demo-wife',
            action: 'verify',
            revision: 1,
        }),
        'ACCESS_DENIED'
    );
    assert.equal(f.calls.length, 0);
    let active = true,
        writes = 0;
    const tokens = createConnectionTokens({
        store: {
            lock: memoryLocks(),
            active: async () => active,
            read: async () => null,
            write: async () => {
                writes++;
            },
        },
        issue: async () => {
            active = false;
            return { access_token: 'synthetic', expires_in: 100 };
        },
    });
    await rejected(
        tokens.get({ clientIdentity: 'synthetic-client', generation: 1 }),
        'CONNECTION_ROTATED'
    );
    assert.equal(writes, 0);
});

test('Firebase SDK exception text is never reflected by the browser client', async () => {
    const client = createAccountTossClient({
        getUser: () => ({
            getIdToken: async () => {
                throw Error('private SDK details');
            },
        }),
    });
    await assert.rejects(
        client.status('demo-wife'),
        (error) => !error.message.includes('private')
    );
});
