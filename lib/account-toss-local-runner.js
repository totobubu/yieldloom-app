// Local process only. Never import into a browser bundle or a hosted API.
import { resolve } from 'node:path';
import { ConnectionError } from './account-toss-connection.js';
import {
    readAccountOrders,
    validateManualOptions,
} from '../scripts/toss/read-account-orders.mjs';

const validId = (v) => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);
const fail = (code, status = 409) => {
    throw new ConnectionError(code, status);
};

// authorize must independently validate the current Firebase session, family
// participation, account ACL and subject ownership in the trusted app process.
// It must NOT send Firebase tokens to this runner. This module creates no listener,
// pairing credential, token issuer, credential file or persistent permission.
export function createAccountTossLocalRunner({
    authorize,
    registry,
    credentials,
    root,
    collect = readAccountOrders,
    fetchImpl = fetch,
}) {
    const pending = new Set();
    async function checkedScope(accountId) {
        if (!validId(accountId)) fail('INVALID_REQUEST', 400);
        const grant = await authorize(accountId);
        if (
            grant?.accountId !== accountId ||
            !validId(grant.subjectUid) ||
            grant.actorUid !== grant.subjectUid ||
            grant.canManage !== true
        )
            fail('OWNER_REQUIRED', 403);
        const entries = await registry.list();
        const matches = entries.filter(
            (entry) => entry.accountId === accountId
        );
        if (matches.length !== 1) fail('LOCAL_PROFILE_REQUIRED');
        const binding = matches[0];
        if (
            binding.subjectUid !== grant.subjectUid ||
            binding.enabled !== true ||
            !validId(binding.credentialRef) ||
            !Number.isSafeInteger(binding.revision) ||
            !/^[a-f0-9]{64}$/.test(binding.accountNoSha256 ?? '') ||
            !/^\d{4}$/.test(binding.suffix ?? '') ||
            grant.accountNoSha256 !== binding.accountNoSha256 ||
            grant.bindingRevision !== binding.revision
        )
            fail('STALE_BINDING');
        if (
            entries.some(
                (other) =>
                    other !== binding &&
                    other.enabled &&
                    other.accountNoSha256 === binding.accountNoSha256
            )
        )
            fail('DUPLICATE_ACCOUNT_BINDING');
        return structuredClone(binding);
    }
    async function scope(accountId) {
        try {
            return await checkedScope(accountId);
        } catch (error) {
            if (error instanceof ConnectionError) throw error;
            fail('LOCAL_SYNC_FAILED', 503);
        }
    }
    return {
        async status(accountId) {
            await scope(accountId);
            return { accountId, connected: true, readOnly: true };
        },
        async update(input) {
            if (
                !input ||
                Object.keys(input).some(
                    (key) => !['accountId', 'from', 'to'].includes(key)
                ) ||
                !validateManualOptions({
                    ...input,
                    status: 'BOTH',
                    accountSuffix: '0000',
                })
            )
                fail('INVALID_REQUEST', 400);
            const binding = await scope(input.accountId);
            // The resolver owns the client-wide lock, including any other CLI.
            // No token issuance/renewal is performed by this adapter.
            if (pending.has(binding.credentialRef)) fail('LOCAL_SYNC_BUSY');
            pending.add(binding.credentialRef);
            try {
                const assertFresh = async () => {
                    if (
                        JSON.stringify(await scope(input.accountId)) !==
                        JSON.stringify(binding)
                    )
                        fail('STALE_BINDING');
                };
                return await credentials.withExistingToken(
                    binding.credentialRef,
                    async (token) => {
                        if (typeof token !== 'string' || !token)
                            fail('AUTHORIZATION_REQUIRED', 503);
                        await assertFresh();
                        const result = await collect(
                            {
                                status: 'BOTH',
                                accountSuffix: binding.suffix,
                                expectedAccountNoSha256:
                                    binding.accountNoSha256,
                                from: input.from,
                                to: input.to,
                                issueToken: false,
                                noExternalStorage: true,
                            },
                            {
                                credentials: { TOSS_ACCESS_TOKEN: token },
                                root: resolve(
                                    root,
                                    input.accountId,
                                    binding.accountNoSha256
                                ),
                                fetchImpl: async (url, request) => {
                                    await assertFresh();
                                    const response = await fetchImpl(
                                        url,
                                        request
                                    );
                                    try {
                                        await assertFresh();
                                    } catch (error) {
                                        await response.body
                                            ?.cancel()
                                            .catch(() => {});
                                        throw error;
                                    }
                                    return response;
                                },
                            }
                        );
                        if (
                            JSON.stringify(await scope(input.accountId)) !==
                            JSON.stringify(binding)
                        )
                            fail('STALE_BINDING');
                        // Never return provider payloads, local paths, account
                        // numbers, tokens or raw exception text to the website.
                        if (result.apiStatus !== 'complete')
                            fail(
                                result.reason === 'authentication_failed'
                                    ? 'AUTHORIZATION_REQUIRED'
                                    : 'LOCAL_SYNC_FAILED',
                                503
                            );
                        return {
                            accountId: input.accountId,
                            status: 'collected_locally',
                            canonicalUnchanged: true,
                            cloudSaved: false,
                        };
                    }
                );
            } catch (error) {
                if (error instanceof ConnectionError) throw error;
                fail('LOCAL_SYNC_FAILED', 503);
            } finally {
                pending.delete(binding.credentialRef);
            }
        },
    };
}
