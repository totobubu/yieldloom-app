import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ConnectionError } from './account-toss-connection.js';
import {
    collectEncryptedOrders,
    materializeArchiveBatch,
} from './toss-local-collection.js';
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
    sleep,
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
        if (pairExpires <= now()) fail('LOCAL_PAIRING_REQUIRED', 403);
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
                const result = await vault.transaction(async (state) => {
                    let queued = state.queue.find(
                        (q) =>
                            q.accountId === claims.accountId &&
                            q.accountNoSha256 === claims.accountNoSha256
                    );
                    if (!queued) {
                        queued = await materializeArchiveBatch(
                            vault,
                            state,
                            claims
                        );
                        if (queued) state.queue.push(queued);
                    }
                    if (!queued) return { batch: null };
                    // Reconnecting a preserved queue requires a new batch identity for
                    // the new cloud binding revision; original objects are unchanged.
                    const body = { ...queued };
                    delete body.batchId;
                    delete body.archiveProgress;
                    body.bindingRevision = claims.bindingRevision;
                    return { batch: { ...body, batchId: localHash(body) } };
                });
                await fresh(input.grant, claims);
                return result;
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
                        delete body.archiveProgress;
                        return (
                            q.accountId === claims.accountId &&
                            localHash({
                                ...body,
                                bindingRevision: claims.bindingRevision,
                            }) === receipt.batchId &&
                            q.records.length === receipt.count
                        );
                    });
                    if (at >= 0) {
                        const progress = state.queue[at].archiveProgress;
                        if (progress) {
                            const page =
                                state.collections?.[progress.runId]?.pages[
                                    progress.pageIndex
                                ];
                            if (
                                !page ||
                                page.ackOffset !== progress.offset ||
                                progress.count !== receipt.count ||
                                page.ackOffset + progress.count > page.count
                            )
                                fail('LOCAL_ARCHIVE_INVALID');
                            page.ackOffset += progress.count;
                        }
                        state.queue.splice(at, 1);
                    }
                    return { acknowledged: true };
                });
            }
            // Keep resumed cloud batches first. A click never silently replaces an
            // unacknowledged source with a fresh broker collection.
            if (running.has(binding.credentialRef)) fail('LOCAL_SYNC_BUSY');
            running.add(binding.credentialRef);
            try {
                const checkpoint = await vault.read();
                const prior =
                    checkpoint.collections?.[
                        checkpoint.activeCollections?.[claims.accountId]
                    ];
                if (
                    prior &&
                    (!prior.done ||
                        prior.pages.some((p) => p.ackOffset < p.count)) &&
                    (prior.from !== input.from || prior.to !== input.to)
                )
                    fail('LOCAL_COLLECTION_SCOPE_MISMATCH');
                if (
                    checkpoint.queue.some(
                        (q) => q.accountId === claims.accountId
                    )
                )
                    return {
                        accountId: claims.accountId,
                        status: 'collected_locally',
                        canonicalUnchanged: true,
                        cloudSaved: false,
                        resumed: true,
                        collectionPending:
                            checkpoint.collections?.[
                                checkpoint.activeCollections?.[claims.accountId]
                            ]?.done === false,
                    };
                await vault.transaction(async (state) => {
                    state.bindings[claims.accountId].revision =
                        claims.bindingRevision;
                });
                return await collectEncryptedOrders({
                    vault,
                    credentials,
                    claims,
                    input,
                    authorize: () => fresh(input.grant, claims),
                    fetchImpl: fetchBroker,
                    now,
                    ...(sleep ? { sleep } : {}),
                });
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
