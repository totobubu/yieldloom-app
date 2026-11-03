import { ConnectionError } from '../../lib/account-toss-connection.js';
import { localOwner } from '../../lib/toss-local-cloud.js';
import { localHash } from '../../lib/toss-local-grants.js';

export function createFirestoreLocalRepository(db) {
    const accountRef = (id) => db.collection('investmentAccounts').doc(id);
    async function scope(actor, id, tx) {
        const get = (ref) => (tx ? tx.get(ref) : ref.get());
        const account = (await get(accountRef(id))).data();
        if (!account?.familyId) throw new ConnectionError('ACCESS_DENIED', 403);
        const [f, b] = await Promise.all([
            get(db.collection('familySpaces').doc(account.familyId)),
            get(accountRef(id).collection('tossLocal').doc('binding')),
        ]);
        const state = { account, family: f.data(), binding: b.data() ?? null };
        localOwner(actor, account, state.family);
        if (state.binding && state.binding.subjectUid !== actor.uid)
            throw new ConnectionError('CONNECTION_ACCESS_DENIED', 403);
        return state;
    }
    return {
        scope,
        async observations(actor, id, after) {
            await scope(actor, id);
            let query = accountRef(id)
                .collection('tossApiObservations')
                .orderBy('__name__')
                .limit(11);
            if (after) query = query.startAfter(after);
            const docs = (await query.get()).docs;
            const rows = [];
            let bytes = 0;
            for (const doc of docs.slice(0, 10)) {
                const row = { id: doc.id, ...doc.data() };
                const size = Buffer.byteLength(JSON.stringify(row));
                if (rows.length && bytes + size > 350000) break;
                rows.push(row);
                bytes += size;
            }
            return {
                observations: rows,
                nextCursor: docs.length > rows.length ? rows.at(-1)?.id : null,
                canonicalUnchanged: true,
            };
        },
        bind: (actor, input) =>
            db.runTransaction(async (tx) => {
                const state = await scope(actor, input.accountId, tx);
                if ((state.binding?.revision ?? 0) !== input.revision)
                    throw new ConnectionError('STALE_BINDING');
                const enabled = input.action === 'local-register';
                const digest = enabled
                    ? input.accountNoSha256
                    : state.binding?.accountNoSha256;
                if (!digest) throw new ConnectionError('CONNECTION_REQUIRED');
                const claimRef = db
                    .collection('tossLocalAccountClaims')
                    .doc(digest);
                const claim = (await tx.get(claimRef)).data();
                if (
                    claim &&
                    (claim.accountId !== input.accountId ||
                        claim.subjectUid !== actor.uid)
                )
                    throw new ConnectionError('DUPLICATE_ACCOUNT_BINDING');
                if (enabled && state.binding?.enabled)
                    throw new ConnectionError('ALREADY_CONNECTED');
                const binding = {
                    accountNoSha256: digest,
                    subjectUid: actor.uid,
                    revision: input.revision + 1,
                    enabled,
                };
                tx.set(
                    accountRef(input.accountId)
                        .collection('tossLocal')
                        .doc('binding'),
                    binding
                );
                if (!claim)
                    tx.create(claimRef, {
                        accountId: input.accountId,
                        subjectUid: actor.uid,
                    });
                return { mode: 'local', binding };
            }),
        async receipt(actor, id, batchId) {
            await scope(actor, id);
            return (
                (
                    await accountRef(id)
                        .collection('tossApiBatches')
                        .doc(batchId)
                        .get()
                ).data()?.receipt ?? null
            );
        },
        save: (actor, batch) =>
            db.runTransaction(async (tx) => {
                const state = await scope(actor, batch.accountId, tx);
                if (
                    !state.binding?.enabled ||
                    state.binding.revision !== batch.bindingRevision ||
                    state.binding.accountNoSha256 !== batch.accountNoSha256
                )
                    throw new ConnectionError('STALE_BINDING');
                const base = accountRef(batch.accountId);
                const receiptRef = base
                    .collection('tossApiBatches')
                    .doc(batch.batchId);
                const previous = (await tx.get(receiptRef)).data();
                if (previous)
                    return {
                        receipt: previous.receipt,
                        replayed: true,
                        canonicalUnchanged: true,
                    };
                const documents = new Map(
                    batch.records.map((r) => [
                        `${localHash(r.original.orderId)}-${localHash(r.original)}`,
                        r,
                    ])
                );
                const refs = [...documents.keys()].map((key) =>
                    base.collection('tossApiObservations').doc(key)
                );
                const existing = await Promise.all(
                    refs.map((ref) => tx.get(ref))
                );
                let inserted = 0;
                refs.forEach((ref, i) => {
                    if (!existing[i].exists) {
                        inserted++;
                        tx.create(ref, {
                            ...[...documents.values()][i],
                            source: 'toss-openapi-orders',
                            approval: 'unreviewed',
                            sourceVerification: 'unverified_local_observation',
                        });
                    }
                });
                const receipt = {
                    status: 'complete',
                    batchId: batch.batchId,
                    accountId: batch.accountId,
                    accountNoSha256: batch.accountNoSha256,
                    bindingRevision: batch.bindingRevision,
                    count: batch.records.length,
                    inserted,
                    canonicalUnchanged: true,
                };
                // Full original order objects and provenance are atomic with receipt.
                tx.create(receiptRef, {
                    receipt,
                    originals: batch.records,
                    savedAt: new Date().toISOString(),
                });
                return { receipt, replayed: false, canonicalUnchanged: true };
            }),
    };
}
