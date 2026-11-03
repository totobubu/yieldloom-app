import { createHash } from 'node:crypto';

// Server-only contracts. No default credential resolver, token issuer or live store.
export class ConnectionError extends Error {
    constructor(code, status = 409) {
        super(code);
        this.code = code;
        this.status = status;
    }
}
export const accountDigest = (value) =>
    createHash('sha256').update(String(value)).digest('hex');
const requireThat = (condition, code, status) => {
    if (!condition) throw new ConnectionError(code, status);
};
const id = (value) => typeof value === 'string' && /^[\w-]{1,100}$/.test(value);

// store.lock must serialize all instances/processes sharing a client identity.
// Both CLI and HTTP callers must use this coordinator before live activation.
export function createConnectionTokens({ store, issue, now = Date.now }) {
    return {
        async get(connection) {
            return store.lock(connection.clientIdentity, async () => {
                requireThat(
                    await store.active(connection),
                    'CONNECTION_ROTATED'
                );
                const key = `${connection.clientIdentity}:${connection.generation}`;
                const cached = await store.read(key);
                if (cached?.expiresAt > now() + 30000) return cached.token;
                const result = await issue(connection.secretRef);
                requireThat(
                    await store.active(connection),
                    'CONNECTION_ROTATED'
                );
                requireThat(
                    typeof result?.access_token === 'string' &&
                        result.access_token.length > 0 &&
                        Number.isFinite(result.expires_in) &&
                        result.expires_in > 30,
                    'TOKEN_UNAVAILABLE',
                    503
                );
                await store.write(key, {
                    token: result.access_token,
                    expiresAt: now() + result.expires_in * 1000,
                });
                return result.access_token;
            });
        },
    };
}

// Deliberately excludes token issuance and every financial mutation.
export function createTossReadTransport({ fetcher, timeoutMs = 10000 }) {
    return async function read(path, token, accountSeq) {
        requireThat(
            path === '/api/v1/accounts' ||
                path === '/api/v1/holdings' ||
                path === '/api/v1/orders' ||
                /^\/api\/v1\/orders\/[A-Za-z0-9_-]+$/.test(path),
            'ENDPOINT_REJECTED',
            400
        );
        requireThat(
            path === '/api/v1/accounts' ||
                /^[1-9]\d*$/.test(String(accountSeq)),
            'BINDING_REQUIRED'
        );
        try {
            const response = await fetcher(
                `https://openapi.tossinvest.com${path}`,
                {
                    method: 'GET',
                    redirect: 'error',
                    signal: AbortSignal.timeout(timeoutMs),
                    headers: {
                        Authorization: `Bearer ${token}`,
                        ...(path === '/api/v1/accounts'
                            ? {}
                            : { 'X-Tossinvest-Account': String(accountSeq) }),
                    },
                }
            );
            if (!response.ok) {
                await response.body?.cancel();
                throw new ConnectionError(
                    [401, 403].includes(response.status)
                        ? 'AUTHORIZATION_REQUIRED'
                        : 'PROVIDER_UNAVAILABLE',
                    503
                );
            }
            const payload = await response.json();
            requireThat(
                !payload.error && payload.result !== undefined,
                'PROVIDER_RESPONSE_INVALID',
                502
            );
            return payload.result;
        } catch (error) {
            if (error instanceof ConnectionError) throw error;
            throw new ConnectionError('PROVIDER_UNAVAILABLE', 503);
        }
    };
}

export function createAccountTossService({
    repository,
    tokens,
    read,
    now = () => new Date().toISOString(),
}) {
    async function scope(actor, accountId, manage = false) {
        requireThat(actor?.uid, 'AUTHENTICATION_REQUIRED', 401);
        requireThat(id(accountId), 'INVALID_REQUEST', 400);
        const account = await repository.account(accountId);
        const family = account && (await repository.family(account.familyId));
        requireThat(
            account &&
                family?.participantUids?.includes(actor.uid) &&
                ['owner', 'editor', 'viewer'].includes(
                    account.permissions?.[actor.uid]
                ),
            'ACCESS_DENIED',
            403
        );
        const subject = family.profiles?.[account.ownerId]?.uid;
        if (manage)
            requireThat(
                account.authorityUid === actor.uid &&
                    subject === actor.uid &&
                    ['owner', 'editor'].includes(
                        account.permissions[actor.uid]
                    ),
                'OWNER_REQUIRED',
                403
            );
        return { account, subject };
    }
    async function connectionScope(actor, accountId, connectionId, manage) {
        const { account, subject } = await scope(actor, accountId, manage);
        const connection = await repository.connection(connectionId);
        requireThat(
            connection?.enabled &&
                connection.subjectUid === subject &&
                (actor.uid === subject ||
                    connection.queryUids?.includes(actor.uid)),
            'CONNECTION_ACCESS_DENIED',
            403
        );
        requireThat(
            connection.executionReady === true,
            'EXECUTION_NOT_CONFIGURED',
            503
        );
        return { account, connection };
    }
    const publicState = (state) =>
        state
            ? {
                  status: state.status,
                  revision: state.revision,
                  checkedAt: state.checkedAt ?? null,
                  syncedAt: state.syncedAt ?? null,
              }
            : { status: 'not_connected', revision: 0 };
    async function matchingAccount(account, connection, token) {
        const list = await read('/api/v1/accounts', token);
        requireThat(Array.isArray(list), 'PROVIDER_RESPONSE_INVALID', 502);
        const matches = list.filter(
            (a) =>
                a.accountType === 'BROKERAGE' &&
                typeof a.accountNo === 'string' &&
                accountDigest(a.accountNo) ===
                    account.expectedAccountNoSha256 &&
                a.accountNo.endsWith(account.expectedSuffix) &&
                Number.isSafeInteger(a.accountSeq) &&
                a.accountSeq > 0
        );
        requireThat(
            matches.length === 1 && connection.subjectUid,
            'ACCOUNT_VERIFICATION_REQUIRED'
        );
        return matches[0];
    }
    async function state(actor, accountId) {
        const { account, subject } = await scope(actor, accountId);
        const canManage =
            account.authorityUid === actor.uid &&
            subject === actor.uid &&
            ['owner', 'editor'].includes(account.permissions[actor.uid]);
        const options = canManage
            ? await repository.options(subject, accountId)
            : [];
        const binding = await repository.binding(accountId);
        const connection =
            binding && (await repository.connection(binding.connectionId));
        const stale =
            binding &&
            binding.status !== 'disconnected' &&
            (!connection?.enabled ||
                connection.generation !== binding.generation);
        return {
            ...publicState(binding),
            ...(stale ? { status: 'reauthorization_required' } : {}),
            mode: repository.mode,
            canManage,
            options: options.map((c) => ({ id: c.id, label: c.label })),
        };
    }
    async function act(actor, input) {
        const { accountId, action, revision, connectionId } = input;
        requireThat(
            Object.keys(input).every((key) =>
                ['action', 'accountId', 'revision', 'connectionId'].includes(
                    key
                )
            ) &&
                ['register', 'verify', 'query', 'disconnect'].includes(
                    action
                ) &&
                Number.isSafeInteger(revision),
            'INVALID_REQUEST',
            400
        );
        await scope(actor, accountId, action !== 'query');
        const initial = await repository.binding(accountId);
        const selected =
            action === 'register' ? connectionId : initial?.connectionId;
        requireThat(id(selected), 'CONNECTION_REQUIRED');
        // Serializes binding changes and syncs across service instances. A store must
        // provide distributed exclusion/fencing before it can be used in production.
        return repository.lock(selected, async () => {
            const current = await repository.binding(accountId);
            requireThat((current?.revision ?? 0) === revision, 'STALE_BINDING');
            const manage = action !== 'query';
            if (action === 'disconnect') {
                await scope(actor, accountId, true);
                requireThat(
                    current?.connectionId === selected &&
                        current.status !== 'disconnected',
                    'CONNECTION_REQUIRED'
                );
                const next = {
                    ...current,
                    revision: revision + 1,
                    status: 'disconnected',
                    accountSeqSha256: null,
                };
                await repository.commit({
                    actor,
                    manage: true,
                    accountId,
                    connectionId: selected,
                    previousRevision: revision,
                    next,
                });
                await repository.audit({
                    actorId: actor.uid,
                    accountId,
                    connectionId: selected,
                    action,
                    outcome: 'success',
                    at: now(),
                });
                return state(actor, accountId);
            }
            const { account, connection } = await connectionScope(
                actor,
                accountId,
                selected,
                manage
            );
            const assertFresh = async () => {
                const fresh = await connectionScope(
                    actor,
                    accountId,
                    selected,
                    manage
                );
                requireThat(
                    fresh.connection.generation === connection.generation &&
                        fresh.account.expectedAccountNoSha256 ===
                            account.expectedAccountNoSha256 &&
                        (await repository.binding(accountId))?.revision ===
                            current?.revision,
                    'STALE_BINDING'
                );
            };
            if (action === 'register') {
                requireThat(
                    !current ||
                        ['disconnected', 'not_connected'].includes(
                            current.status
                        ),
                    'ALREADY_CONNECTED'
                );
                const offered = await repository.options(
                    connection.subjectUid,
                    accountId
                );
                requireThat(
                    offered.some((c) => c.id === selected),
                    'CONNECTION_ACCESS_DENIED',
                    403
                );
            } else {
                requireThat(
                    current?.connectionId === selected &&
                        current.status !== 'disconnected',
                    'CONNECTION_REQUIRED'
                );
                requireThat(
                    current.generation === connection.generation,
                    'CONNECTION_ROTATED'
                );
            }
            let next = {
                ...current,
                connectionId: selected,
                generation: connection.generation,
                revision: revision + 1,
            };
            let holdings;
            try {
                if (action === 'register')
                    next = {
                        ...next,
                        status: 'pending_verification',
                        accountNoSha256: account.expectedAccountNoSha256,
                    };
                if (action === 'verify' || action === 'query') {
                    requireThat(
                        current.accountNoSha256 ===
                            account.expectedAccountNoSha256,
                        'STALE_BINDING'
                    );
                    if (action === 'query')
                        requireThat(
                            current.status === 'verified',
                            'ACCOUNT_VERIFICATION_REQUIRED'
                        );
                    const token = await tokens.get(connection);
                    // Recheck after token acquisition, before account/holding calls.
                    await assertFresh();
                    const actual = await matchingAccount(
                        account,
                        connection,
                        token
                    );
                    if (action === 'query') {
                        requireThat(
                            accountDigest(actual.accountSeq) ===
                                current.accountSeqSha256,
                            'STALE_BINDING'
                        );
                        await assertFresh();
                        const result = await read(
                            '/api/v1/holdings',
                            token,
                            actual.accountSeq
                        );
                        requireThat(
                            Array.isArray(result?.items),
                            'PROVIDER_RESPONSE_INVALID',
                            502
                        );
                        holdings = result.items.map((h) => {
                            requireThat(
                                typeof h.symbol === 'string' &&
                                    /^[A-Za-z0-9.-]{1,30}$/.test(h.symbol) &&
                                    typeof h.quantity === 'string' &&
                                    /^\d+(\.\d+)?$/.test(h.quantity),
                                'PROVIDER_RESPONSE_INVALID',
                                502
                            );
                            return { symbol: h.symbol, quantity: h.quantity };
                        });
                    }
                    next = {
                        ...next,
                        status: 'verified',
                        checkedAt: now(),
                        accountSeqSha256: accountDigest(actual.accountSeq),
                        ...(action === 'query' ? { syncedAt: now() } : {}),
                    };
                }
                // A real repository must atomically revalidate ACL, generation and
                // expected binding revision when committing. Never persist holdings.
                await assertFresh();
                await repository.commit({
                    actor,
                    manage,
                    accountId,
                    connectionId: selected,
                    previousRevision: revision,
                    generation: connection.generation,
                    next,
                });
                await repository.audit({
                    actorId: actor.uid,
                    accountId,
                    connectionId: selected,
                    action,
                    outcome: 'success',
                    at: now(),
                });
                return {
                    ...(await state(actor, accountId)),
                    ...(holdings ? { holdings } : {}),
                };
            } catch (error) {
                const code =
                    error instanceof ConnectionError
                        ? error.code
                        : 'CONNECTION_UNAVAILABLE';
                await repository.audit({
                    actorId: actor.uid,
                    accountId,
                    connectionId: selected,
                    action,
                    outcome: code,
                    at: now(),
                });
                throw new ConnectionError(
                    code,
                    error instanceof ConnectionError ? error.status : 503
                );
            }
        });
    }
    return { state, act };
}
