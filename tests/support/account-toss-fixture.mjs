// Synthetic server-side fixture only. Never imported by a production API.
import {
    accountDigest,
    ConnectionError,
    createAccountTossService,
    createConnectionTokens,
} from '../../lib/account-toss-connection.js';

export function memoryLocks() {
    const pending = new Map();
    return async (key, work) => {
        const previous = pending.get(key) ?? Promise.resolve();
        let release;
        const wait = new Promise((resolve) => {
            release = resolve;
        });
        const chain = previous.catch(() => {}).then(() => wait);
        pending.set(key, chain);
        await previous.catch(() => {});
        try {
            return await work();
        } finally {
            release();
            if (pending.get(key) === chain) pending.delete(key);
        }
    };
}
export function accountTossFixture() {
    const accounts = new Map(
        ['wife', 'husband'].map((owner, i) => [
            `demo-${owner}`,
            {
                familyId: 'demo-family',
                ownerId: owner,
                authorityUid: `demo-${owner}`,
                permissions: {
                    [`demo-${owner}`]: 'owner',
                    'demo-viewer': 'viewer',
                },
                expectedAccountNoSha256: accountDigest(
                    `SYNTHETIC-${i + 1}000${i + 1}`
                ),
                expectedSuffix: `000${i + 1}`,
            },
        ])
    );
    const family = {
        participantUids: ['demo-wife', 'demo-husband', 'demo-viewer'],
        profiles: {
            wife: { uid: 'demo-wife' },
            husband: { uid: 'demo-husband' },
        },
    };
    const connections = new Map(
        ['wife', 'husband'].map((owner) => [
            `connection-${owner}`,
            {
                id: `connection-${owner}`,
                label: `${owner === 'wife' ? '아내' : '남편'} 모의 연결`,
                subjectUid: `demo-${owner}`,
                enabled: true,
                executionReady: true,
                generation: 1,
                clientIdentity: `fixture-client-${owner}`,
                secretRef: `fixture-reference-${owner}`,
            },
        ])
    );
    const bindings = new Map(),
        audit = [],
        calls = [],
        tokenValues = new Map();
    const repository = {
        mode: 'simulation',
        lock: memoryLocks(),
        account: async (id) => structuredClone(accounts.get(id)),
        family: async () => structuredClone(family),
        connection: async (id) => structuredClone(connections.get(id)),
        binding: async (id) => structuredClone(bindings.get(id)),
        options: async (subject) =>
            [...connections.values()].filter(
                (c) => c.enabled && c.subjectUid === subject
            ),
        async commit({
            actor,
            manage,
            accountId,
            connectionId,
            generation,
            previousRevision,
            next,
        }) {
            const a = accounts.get(accountId),
                c = connections.get(connectionId);
            const role = a.permissions[actor.uid];
            const owner =
                a.authorityUid === actor.uid &&
                family.profiles[a.ownerId]?.uid === actor.uid;
            if (
                !family.participantUids.includes(actor.uid) ||
                (manage && (!owner || !['owner', 'editor'].includes(role))) ||
                !['owner', 'editor', 'viewer'].includes(role) ||
                (!owner && !c?.queryUids?.includes(actor.uid)) ||
                (next.status !== 'disconnected' &&
                    (!c?.enabled ||
                        c.generation !== generation ||
                        c.subjectUid !== family.profiles[a.ownerId]?.uid ||
                        next.accountNoSha256 !== a.expectedAccountNoSha256)) ||
                (bindings.get(accountId)?.revision ?? 0) !== previousRevision
            )
                throw new ConnectionError('STALE_BINDING');
            bindings.set(accountId, structuredClone(next));
        },
        audit: async (item) => {
            audit.push(item);
        },
    };
    const tokenStore = {
        lock: memoryLocks(),
        active: async (c) =>
            connections.get(c.id)?.enabled &&
            connections.get(c.id)?.generation === c.generation,
        read: async (key) => tokenValues.get(key),
        write: async (key, value) => {
            tokenValues.set(key, value);
        },
    };
    let issued = 0;
    const tokens = createConnectionTokens({
        store: tokenStore,
        issue: async (ref) => {
            issued++;
            return { access_token: `synthetic-token-${ref}`, expires_in: 120 };
        },
    });
    const read = async (path, token, seq) => {
        const owner = token.includes('wife') ? 'wife' : 'husband';
        const index = owner === 'wife' ? 1 : 2;
        calls.push({ path, owner });
        if (path === '/api/v1/accounts')
            return [
                {
                    accountType: 'BROKERAGE',
                    accountNo: `SYNTHETIC-${index}000${index}`,
                    accountSeq: index,
                },
            ];
        if (path === '/api/v1/holdings' && seq === index)
            return { items: [{ symbol: 'DEMO', quantity: String(index) }] };
        throw new ConnectionError('ACCOUNT_VERIFICATION_REQUIRED');
    };
    return {
        service: createAccountTossService({ repository, tokens, read }),
        repository,
        accounts,
        family,
        connections,
        bindings,
        audit,
        calls,
        tokens,
        tokenStore,
        read,
        issued: () => issued,
    };
}
