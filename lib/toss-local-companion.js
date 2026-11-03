import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConnectionError } from './account-toss-connection.js';
import { createAccountTossLocalRunner } from './account-toss-local-runner.js';
import { localHash, verifyLocalGrant } from './toss-local-grants.js';

const fail = (code, status = 409) => {
    throw new ConnectionError(code, status);
};
export function createLocalCompanion({
    vault,
    credentials,
    cloud,
    fetchBroker = fetch,
    now = Date.now,
    collect,
    pairing = randomBytes(32).toString('base64url'),
}) {
    const running = new Set();
    const challenges = new Map(),
        flows = new Map();
    let pairExpires = now() + 8 * 60 * 60 * 1000;
    const equal = (value) =>
        typeof value === 'string' &&
        Buffer.byteLength(value) === Buffer.byteLength(pairing) &&
        timingSafeEqual(Buffer.from(value), Buffer.from(pairing));
    async function grant(envelope, operation) {
        let hint;
        try {
            hint = JSON.parse(Buffer.from(envelope.split('.')[0], 'base64url'));
        } catch {
            fail('LOCAL_GRANT_REJECTED', 403);
        }
        const expiry = challenges.get(hint.nonce);
        challenges.delete(hint.nonce); // Single-use, including failed verification.
        if (!expiry || expiry <= now()) fail('LOCAL_GRANT_REJECTED', 403);
        const claims = verifyLocalGrant(envelope, await cloud.key(), {
            nonce: hint.nonce,
            operation,
            now: now(),
        });
        if (!(await cloud.check(envelope))?.active)
            fail('LOCAL_GRANT_REJECTED', 403);
        return claims;
    }
    async function fresh(envelope, claims) {
        if (claims.exp <= now() || !(await cloud.check(envelope))?.active)
            fail('LOCAL_GRANT_REJECTED', 403);
    }
    async function bindingFor(claims) {
        const state = await vault.read(),
            binding = state.bindings[claims.accountId];
        if (
            !binding ||
            binding.subjectUid !== claims.subjectUid ||
            (claims.accountNoSha256 &&
                binding.accountNoSha256 !== claims.accountNoSha256)
        )
            fail('LOCAL_PROFILE_REQUIRED');
        return binding;
    }
    return {
        pairing,
        paired: (value) => now() < pairExpires && equal(value),
        close() {
            pairExpires = 0;
            vault.lock();
            challenges.clear();
            flows.clear();
        },
        async act(path, input = {}) {
            if (path === '/challenge') {
                for (const [key, expiry] of challenges)
                    if (expiry <= now()) challenges.delete(key);
                if (challenges.size >= 100) fail('LOCAL_SYNC_BUSY');
                const nonce = randomBytes(32).toString('base64url');
                challenges.set(nonce, now() + 60000);
                return { nonce };
            }
            if (path === '/unlock') return vault.unlock(input.passphrase);
            if (path === '/lock') {
                vault.lock();
                return { locked: true };
            }
            if (path === '/prepare') {
                const claims = await grant(input.grant, 'configure');
                for (const [id, flow] of flows)
                    if (flow.claims.exp <= now()) flows.delete(id);
                if (flows.size >= 10) fail('LOCAL_SYNC_BUSY');
                const flowId = randomBytes(24).toString('hex');
                flows.set(flowId, { claims, envelope: input.grant });
                return { flowId, path: `/register?flow=${flowId}` };
            }
            if (path === '/enroll') {
                const flow = flows.get(input.flowId);
                if (!flow) fail('LOCAL_GRANT_REJECTED', 403);
                await fresh(flow.envelope, flow.claims);
                const result = await credentials.enroll(
                    flow.claims,
                    input.form
                );
                flows.delete(input.flowId);
                return result;
            }
            if (path === '/flow-info') {
                const flow = flows.get(input.flowId);
                if (!flow || flow.claims.exp <= now())
                    fail('LOCAL_GRANT_REJECTED', 403);
                return {
                    label: flow.claims.label,
                    accountId: flow.claims.accountId,
                    suffix: flow.claims.suffix,
                };
            }
            const operation = {
                '/profile': 'profile',
                '/token': 'token',
                '/collect': 'read',
                '/batch': 'batch',
                '/ack': 'ack',
            }[path];
            if (!operation) fail('INVALID_REQUEST', 400);
            const claims = await grant(input.grant, operation),
                binding = await bindingFor(claims);
            if (path === '/profile')
                return {
                    accountId: claims.accountId,
                    accountNoSha256: binding.accountNoSha256,
                    suffix: binding.suffix,
                };
            if (path === '/token') {
                await fresh(input.grant, claims);
                const result = await credentials.issue(
                    binding.credentialRef,
                    input.confirmed
                );
                await fresh(input.grant, claims);
                return result;
            }
            if (path === '/batch') {
                const state = await vault.read();
                const queued = state.queue.find(
                    (q) =>
                        q.accountId === claims.accountId &&
                        q.accountNoSha256 === claims.accountNoSha256
                );
                if (!queued) return { batch: null };
                // Reconnecting a preserved queue requires a new batch identity for
                // the new cloud binding revision; original objects are unchanged.
                const body = { ...queued };
                delete body.batchId;
                body.bindingRevision = claims.bindingRevision;
                return { batch: { ...body, batchId: localHash(body) } };
            }
            if (path === '/ack') {
                const receipt = claims.receipt;
                if (
                    !receipt ||
                    receipt.status !== 'complete' ||
                    receipt.accountId !== claims.accountId ||
                    receipt.accountNoSha256 !== binding.accountNoSha256
                )
                    fail('RECEIPT_REQUIRED');
                return vault.transaction(async (state) => {
                    const at = state.queue.findIndex((q) => {
                        const body = { ...q };
                        delete body.batchId;
                        return (
                            q.accountId === claims.accountId &&
                            localHash({
                                ...body,
                                bindingRevision: claims.bindingRevision,
                            }) === receipt.batchId &&
                            q.records.length === receipt.count
                        );
                    });
                    if (at >= 0) state.queue.splice(at, 1);
                    return { acknowledged: true };
                });
            }
            // Keep resumed cloud batches first. A click never silently replaces an
            // unacknowledged source with a fresh broker collection.
            if (running.has(binding.credentialRef)) fail('LOCAL_SYNC_BUSY');
            running.add(binding.credentialRef);
            try {
                if (
                    (await vault.read()).queue.some(
                        (q) => q.accountId === claims.accountId
                    )
                )
                    return {
                        accountId: claims.accountId,
                        status: 'collected_locally',
                        canonicalUnchanged: true,
                        cloudSaved: false,
                        resumed: true,
                    };
                await vault.transaction(async (state) => {
                    state.bindings[claims.accountId].revision =
                        claims.bindingRevision;
                });
                const pages = [];
                const runner = createAccountTossLocalRunner({
                    root: `${vault.root}/orders`,
                    credentials,
                    ...(collect ? { collect } : {}),
                    registry: {
                        list: async () => {
                            const state = await vault.read();
                            return Object.values(state.bindings).map((b) => ({
                                ...b,
                                clientGeneration:
                                    state.clients[b.credentialRef]?.generation,
                            }));
                        },
                    },
                    authorize: async () => {
                        // Broker transport revalidates cloud ACL immediately before
                        // and after each request. Local snapshot checks do not issue
                        // redundant Firebase reads between those boundaries.
                        if (claims.exp <= now())
                            fail('LOCAL_GRANT_REJECTED', 403);
                        return { ...claims, canManage: true };
                    },
                    fetchImpl: async (url, request) => {
                        await fresh(input.grant, claims);
                        const response = await fetchBroker(url, request);
                        try {
                            await fresh(input.grant, claims);
                        } catch (error) {
                            await response.body?.cancel().catch(() => {});
                            throw error;
                        }
                        if (
                            new URL(url).pathname === '/api/v1/orders' &&
                            response.ok
                        ) {
                            const bytes = Buffer.from(
                                await response.clone().arrayBuffer()
                            );
                            pages.push({
                                scope: new URL(url).searchParams.get('status'),
                                raw: new TextDecoder('utf-8', {
                                    fatal: true,
                                }).decode(bytes),
                                pageHash: createHash('sha256')
                                    .update(bytes)
                                    .digest('hex'),
                            });
                        }
                        return response;
                    },
                });
                const result = await runner.update({
                    accountId: claims.accountId,
                    from: input.from,
                    to: input.to,
                });
                await fresh(input.grant, claims);
                await vault.transaction(async (state) => {
                    let records = [];
                    const flush = () => {
                        if (!records.length) return;
                        const body = {
                            accountId: claims.accountId,
                            accountNoSha256: claims.accountNoSha256,
                            bindingRevision: claims.bindingRevision,
                            records,
                        };
                        state.queue.push({ ...body, batchId: localHash(body) });
                        records = [];
                    };
                    for (const page of pages) {
                        const orders = JSON.parse(page.raw).result.orders;
                        for (const [position, original] of orders.entries()) {
                            const record = {
                                original,
                                pageHash: page.pageHash,
                                position,
                                scope: page.scope,
                            };
                            if (
                                Buffer.byteLength(JSON.stringify(record)) >
                                300000
                            )
                                fail('LOCAL_RECORD_TOO_LARGE');
                            if (
                                records.length >= 50 ||
                                Buffer.byteLength(
                                    JSON.stringify([...records, record])
                                ) > 300000
                            )
                                flush();
                            records.push(record);
                        }
                    }
                    flush();
                    if (Buffer.byteLength(JSON.stringify(state)) > 10000000)
                        fail('LOCAL_QUEUE_FULL');
                });
                return result;
            } finally {
                running.delete(binding.credentialRef);
            }
        },
    };
}

// The production origin is fixed. No browser-supplied cloud/provider URL exists.
export function createCompanionCloud(fetchImpl = fetch) {
    const endpoint = 'https://yieldloom-app.vercel.app/api/toss-portfolio';
    async function request(url, body) {
        const response = await fetchImpl(url, {
            method: body ? 'POST' : 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
            headers: body ? { 'Content-Type': 'application/json' } : {},
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) fail('LOCAL_GRANT_REJECTED', 403);
        return response.json();
    }
    return {
        key: () => request(`${endpoint}?action=local-key`),
        check: (grant) => request(endpoint, { action: 'local-check', grant }),
    };
}
