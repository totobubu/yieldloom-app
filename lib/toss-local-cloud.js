import { ConnectionError } from './account-toss-connection.js';
import { localHash, verifyLocalGrant } from './toss-local-grants.js';
const requireThat = (ok, code = 'INVALID_REQUEST', status = 400) => {
    if (!ok) throw new ConnectionError(code, status);
};
const hex = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function localOwner(actor, account, family) {
    requireThat(
        actor?.uid &&
            account &&
            family?.participantUids?.includes(actor.uid) &&
            ['owner', 'editor'].includes(account.permissions?.[actor.uid]) &&
            account.authorityUid === actor.uid &&
            family.profiles?.[account.ownerId]?.uid === actor.uid,
        'OWNER_REQUIRED',
        403
    );
    requireThat(
        /토스|toss/i.test(account.institution || '') &&
            /\d{4}$/.test(account.maskedNumber || ''),
        'ACCOUNT_VERIFICATION_REQUIRED',
        409
    );
    return account.maskedNumber.slice(-4);
}
export function validateLocalBatch(input) {
    requireThat(
        input &&
            Object.keys(input).every((k) =>
                [
                    'accountId',
                    'accountNoSha256',
                    'bindingRevision',
                    'records',
                    'batchId',
                ].includes(k)
            ) &&
            hex(input.accountNoSha256) &&
            Number.isSafeInteger(input.bindingRevision) &&
            Array.isArray(input.records) &&
            input.records.length > 0 &&
            input.records.length <= 50 &&
            Buffer.byteLength(JSON.stringify(input)) <= 350000
    );
    const inspect = (v, depth = 0) => {
        requireThat(depth < 30);
        if (!v || typeof v !== 'object') return;
        for (const [key, value] of Object.entries(v)) {
            requireThat(
                !/^(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|client[_-]?(secret|id)|password|secret|credential)$/i.test(
                    key
                )
            );
            inspect(value, depth + 1);
        }
    };
    inspect(input.records);
    for (const r of input.records)
        requireThat(
            r &&
                Object.keys(r).every((k) =>
                    ['pageHash', 'position', 'scope', 'original'].includes(k)
                ) &&
                hex(r.pageHash) &&
                Number.isSafeInteger(r.position) &&
                r.position >= 0 &&
                ['OPEN', 'CLOSED'].includes(r.scope) &&
                typeof r.original?.orderId === 'string' &&
                r.original.orderId.length > 0 &&
                r.original.orderId.length <= 200
        );
    const { batchId, ...data } = input;
    requireThat(batchId === localHash(data), 'BATCH_HASH_MISMATCH', 409);
    return input;
}
export function createTossLocalCloud({ repository, signer, now = Date.now }) {
    return {
        async check(envelope) {
            let hint;
            try {
                hint = JSON.parse(
                    Buffer.from(envelope.split('.')[0], 'base64url')
                );
            } catch {
                throw new ConnectionError('LOCAL_GRANT_REJECTED', 403);
            }
            const claims = verifyLocalGrant(envelope, signer.publicKey, {
                nonce: hint.nonce,
                operation: hint.operation,
                now: now(),
            });
            const state = await repository.scope(
                { uid: claims.actorUid },
                claims.accountId
            );
            const suffix = localOwner(
                { uid: claims.actorUid },
                state.account,
                state.family
            );
            requireThat(claims.suffix === suffix, 'STALE_BINDING', 409);
            requireThat(
                claims.bindingRevision === (state.binding?.revision ?? 0) &&
                    claims.accountNoSha256 ===
                        (state.binding?.enabled
                            ? state.binding.accountNoSha256
                            : null),
                'STALE_BINDING',
                409
            );
            if (!['configure', 'profile'].includes(claims.operation))
                requireThat(
                    state.binding?.enabled &&
                        state.binding.revision === claims.bindingRevision &&
                        state.binding.accountNoSha256 ===
                            claims.accountNoSha256,
                    'STALE_BINDING',
                    409
                );
            return { active: true };
        },
        async act(actor, input) {
            requireThat(
                input && typeof input === 'object' && !Array.isArray(input)
            );
            const allowed = {
                'local-status': [],
                'local-register': ['accountNoSha256', 'revision', 'confirmed'],
                'local-disconnect': ['revision', 'confirmed'],
                'local-grant': ['nonce', 'operation', 'batchId'],
                'local-save': ['batch'],
                'local-receipt': ['batchId'],
                'local-observations': ['after'],
            }[input.action];
            requireThat(
                allowed &&
                    Object.keys(input).every((k) =>
                        ['accountId', 'action', ...allowed].includes(k)
                    ) &&
                    /^[\w-]{1,100}$/.test(input.accountId || '')
            );
            // Repository transactions revalidate this scope for every write.
            const state = await repository.scope(actor, input.accountId);
            const suffix = localOwner(actor, state.account, state.family);
            const binding = state.binding;
            if (input.action === 'local-observations') {
                requireThat(
                    input.after === undefined ||
                        /^[a-f0-9]{64}-[a-f0-9]{64}$/.test(input.after)
                );
                return repository.observations(
                    actor,
                    input.accountId,
                    input.after
                );
            }
            if (input.action === 'local-status')
                return {
                    mode: 'local',
                    binding: binding
                        ? {
                              revision: binding.revision,
                              connected: binding.enabled,
                              accountNoSha256: binding.accountNoSha256,
                          }
                        : null,
                };
            if (['local-register', 'local-disconnect'].includes(input.action)) {
                requireThat(
                    input.confirmed === true &&
                        Number.isSafeInteger(input.revision)
                );
                if (input.action === 'local-register')
                    requireThat(hex(input.accountNoSha256));
                return repository.bind(actor, input);
            }
            if (input.action === 'local-grant') {
                requireThat(
                    /^[A-Za-z0-9_-]{43}$/.test(input.nonce || '') &&
                        [
                            'configure',
                            'profile',
                            'read',
                            'token',
                            'batch',
                            'ack',
                        ].includes(input.operation)
                );
                if (!['configure', 'profile'].includes(input.operation))
                    requireThat(binding?.enabled, 'CONNECTION_REQUIRED', 409);
                let receipt;
                if (input.operation === 'ack') {
                    requireThat(hex(input.batchId));
                    receipt = await repository.receipt(
                        actor,
                        input.accountId,
                        input.batchId
                    );
                    requireThat(
                        receipt?.status === 'complete' &&
                            receipt.bindingRevision === binding.revision &&
                            receipt.accountNoSha256 === binding.accountNoSha256,
                        'RECEIPT_REQUIRED',
                        409
                    );
                } else requireThat(input.batchId === undefined);
                const iat = now();
                return {
                    grant: signer.sign({
                        aud: 'yieldloom-local-toss/v1',
                        actorUid: actor.uid,
                        subjectUid: actor.uid,
                        accountId: input.accountId,
                        label: String(state.account.alias || '토스 계좌').slice(
                            0,
                            100
                        ),
                        suffix,
                        accountNoSha256: binding?.enabled
                            ? binding.accountNoSha256
                            : null,
                        bindingRevision: binding?.revision ?? 0,
                        nonce: input.nonce,
                        operation: input.operation,
                        ...(receipt ? { receipt } : {}),
                        iat,
                        exp:
                            iat +
                            (input.operation === 'configure' ? 600000 : 60000),
                    }),
                };
            }
            requireThat(binding?.enabled, 'CONNECTION_REQUIRED', 409);
            if (input.action === 'local-receipt') {
                requireThat(hex(input.batchId));
                return {
                    receipt: await repository.receipt(
                        actor,
                        input.accountId,
                        input.batchId
                    ),
                };
            }
            requireThat(
                input.batch?.accountId === input.accountId &&
                    input.batch.bindingRevision === binding.revision &&
                    input.batch.accountNoSha256 === binding.accountNoSha256,
                'STALE_BINDING',
                409
            );
            return repository.save(actor, validateLocalBatch(input.batch));
        },
    };
}
