// Browser-side control plane only. Broker credentials and Firebase tokens are
// never sent to the loopback companion. Pairing is session-memory only.
export function createLocalTossClient({
    cloudClient,
    getUser,
    fetcher = fetch,
}) {
    const origin = 'http://127.0.0.1:43129';
    let pairing = '',
        session;
    let serial = 0;
    const updates = new Map();
    const check = (user) => {
        if (!user || getUser() !== user) throw Error('LOCAL_SESSION_CHANGED');
    };
    async function local(path, body, user) {
        check(user);
        if (!/^[A-Za-z0-9_-]{43}$/.test(pairing))
            throw Error('LOCAL_PAIRING_REQUIRED');
        const response = await fetcher(`${origin}${path}`, {
            method: 'POST',
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(path === '/collect' ? 120000 : 20000),
            headers: {
                'Content-Type': 'application/json',
                'X-Yieldloom-Pairing': pairing,
            },
            body: JSON.stringify(body),
        });
        check(user);
        if (!response.ok) throw Error('LOCAL_REQUEST_FAILED');
        const result = await response.json();
        check(user);
        return result;
    }
    function user() {
        const current = getUser();
        if (session !== current) {
            pairing = '';
            session = current;
        }
        check(current);
        return current;
    }
    async function authorized(
        path,
        operation,
        accountId,
        body = {},
        extra = {},
        active = user()
    ) {
        const challenge = await local('/challenge', {}, active);
        const signed = await cloudClient.act(accountId, {
            action: 'local-grant',
            operation,
            nonce: challenge.nonce,
            ...extra,
        });
        check(active);
        return local(path, { ...body, grant: signed.grant }, active);
    }
    return {
        clear() {
            pairing = '';
            session = undefined;
            updates.clear();
        },
        cancel(accountId) {
            updates.delete(accountId);
        },
        setPairing(value) {
            const active = getUser();
            check(active);
            session = active;
            pairing = value.trim();
        },
        async status(accountId) {
            const active = user();
            const state = await cloudClient.act(accountId, {
                action: 'local-status',
            });
            check(active);
            if (!state.binding?.connected)
                return {
                    accountId,
                    connected: false,
                    readOnly: true,
                    mode: 'local',
                };
            const profile = await authorized(
                '/profile',
                'profile',
                accountId,
                {},
                {},
                active
            );
            if (
                profile.accountId !== accountId ||
                profile.accountNoSha256 !== state.binding.accountNoSha256
            )
                throw Error('STALE_BINDING');
            return {
                accountId,
                connected: true,
                readOnly: true,
                mode: 'local',
            };
        },
        async prepare(accountId) {
            const result = await authorized('/prepare', 'configure', accountId);
            if (!/^\/register\?flow=[a-f0-9]{48}$/.test(result.path || ''))
                throw Error('LOCAL_REQUEST_FAILED');
            return `${origin}${result.path}`;
        },
        async register(accountId) {
            const active = user();
            const profile = await authorized(
                '/profile',
                'profile',
                accountId,
                {},
                {},
                active
            );
            const state = await cloudClient.act(accountId, {
                action: 'local-status',
            });
            check(active);
            if (
                profile.accountId !== accountId ||
                !/^[a-f0-9]{64}$/.test(profile.accountNoSha256 || '')
            )
                throw Error('STALE_BINDING');
            return cloudClient.act(accountId, {
                action: 'local-register',
                accountNoSha256: profile.accountNoSha256,
                revision: state.binding?.revision ?? 0,
                confirmed: true,
            });
        },
        issueToken: (accountId, confirmed) =>
            authorized('/token', 'token', accountId, { confirmed }),
        async disconnect(accountId) {
            const active = user(),
                state = await cloudClient.act(accountId, {
                    action: 'local-status',
                });
            check(active);
            return cloudClient.act(accountId, {
                action: 'local-disconnect',
                revision: state.binding?.revision ?? 0,
                confirmed: true,
            });
        },
        async update({ accountId, from, to }) {
            const active = user();
            const version = ++serial;
            updates.set(accountId, version);
            const current = () => {
                check(active);
                if (updates.get(accountId) !== version)
                    throw Error('LOCAL_SESSION_CHANGED');
            };
            try {
                const collection = await authorized(
                    '/collect',
                    'read',
                    accountId,
                    { from, to },
                    {},
                    active
                );
                current();
                let saved = 0;
                for (let i = 0; i < 100; i++) {
                    const { batch } = await authorized(
                        '/batch',
                        'batch',
                        accountId,
                        {},
                        {},
                        active
                    );
                    current();
                    if (!batch)
                        return {
                            accountId,
                            status: 'observations_saved',
                            canonicalUnchanged: true,
                            cloudSaved: true,
                            saved,
                            collectionPending:
                                collection.collectionPending === true,
                            stopReason: collection.stopReason || null,
                        };
                    if (batch.accountId !== accountId)
                        throw Error('STALE_BINDING');
                    const result = await cloudClient.act(accountId, {
                        action: 'local-save',
                        batch,
                    });
                    current();
                    const r = result.receipt;
                    if (
                        r?.status !== 'complete' ||
                        r.batchId !== batch.batchId ||
                        r.accountId !== accountId ||
                        r.accountNoSha256 !== batch.accountNoSha256 ||
                        r.bindingRevision !== batch.bindingRevision ||
                        r.count !== batch.records.length ||
                        r.canonicalUnchanged !== true ||
                        result.canonicalUnchanged !== true
                    )
                        throw Error('RECEIPT_REQUIRED');
                    await authorized(
                        '/ack',
                        'ack',
                        accountId,
                        {},
                        { batchId: batch.batchId },
                        active
                    );
                    current();
                    saved += r.count;
                }
                const tail = await authorized(
                    '/batch',
                    'batch',
                    accountId,
                    {},
                    {},
                    active
                );
                current();
                return {
                    accountId,
                    status: 'observations_saved',
                    canonicalUnchanged: true,
                    cloudSaved: true,
                    saved,
                    collectionPending:
                        !!tail.batch || collection.collectionPending === true,
                    stopReason: tail.batch
                        ? 'BATCH_BUDGET'
                        : collection.stopReason || null,
                };
            } finally {
                if (updates.get(accountId) === version)
                    updates.delete(accountId);
            }
        },
    };
}
