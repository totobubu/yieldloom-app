import { projectAutomaticCashClassifications } from './cash-automatic-classification.js';

export const FX_LINK_ORIGIN = 'yieldloom_internal';
const digest = async (value) =>
    [
        ...new Uint8Array(
            await globalThis.crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(JSON.stringify(value))
            )
        ),
    ]
        .map((x) => x.toString(16).padStart(2, '0'))
        .join('');
export const internalFxLinkId = async (accountId, entryIds) =>
    'ylfx_' +
    (await digest(['yieldloom-fx-link-v1', accountId, [...entryIds].sort()]));
export const fxEntryFingerprint = async (e) =>
    digest([
        'cash-fx-evidence-v1',
        e.accountId,
        e.id,
        e.externalId || null,
        e.source,
        e.date,
        e.rawType,
        e.type || null,
        e.direction || null,
        e.currency,
        String(e.amount),
        String(e.exchangeRate),
        e.cashTime || null,
        e.exchangeFee || null,
        !!e.cashTimeUnverified,
        !!e.exchangeFeeUnverified,
        e.nativeCommission ?? null,
        !!e.purchaseExchange,
    ]);
export const fxAnnotationBinding = (row) => ({
    revision: row?.decisionRevision ?? (row?.noteOnly ? 0 : row?.revision || 0),
    classification: row?.noteOnly ? null : row?.classification || null,
});
export function fxAnnotationStillValid(binding, current) {
    if (!binding) return false;
    const now = fxAnnotationBinding(current);
    return (
        (now.revision === binding.revision &&
            now.classification === binding.classification) ||
        (now.revision > binding.revision && now.classification === 'exchange')
    );
}

// All IDs below are app-generated links, never broker transaction identifiers.
// Automatic links are deterministic projections. Only explicit pair approval/detach is persisted.
export async function projectCashFxLinks(input, accountId) {
    const state = projectAutomaticCashClassifications(input, accountId);
    const entries = new Map(state.entries.map((e) => [e.id, e]));
    const stored = new Map(state.storedClassifications.map((e) => [e.id, e]));
    const candidates = new Map(
        state.fxPairCandidates.map((e) => [e.entryId, new Set(e.peerIds)])
    );
    const documents = (state.fxLinks || []).filter(
        (d) =>
            d.accountId === accountId &&
            d.origin === FX_LINK_ORIGIN &&
            Array.isArray(d.entryIds) &&
            d.entryIds.length === 2 &&
            d.entryIds[0] !== d.entryIds[1]
    );
    const ids = new Set([
        ...candidates.keys(),
        ...documents.flatMap((d) => d.entryIds),
    ]);
    const fingerprints = Object.fromEntries(
        await Promise.all(
            [...ids]
                .filter((id) => entries.has(id))
                .map(async (id) => [
                    id,
                    await fxEntryFingerprint(entries.get(id)),
                ])
        )
    );
    const blocked = new Set(documents.flatMap((d) => d.entryIds));
    const claimed = new Map();
    for (const d of documents.filter((d) => d.state === 'active'))
        for (const id of d.entryIds)
            claimed.set(id, (claimed.get(id) || 0) + 1);
    const annotations = new Map(
        state.classifications
            .filter((a) => !a.automatic || !blocked.has(a.id))
            .map((a) => [a.id, a])
    );
    for (const original of stored.values())
        if (blocked.has(original.id) && !annotations.has(original.id))
            annotations.set(original.id, {
                ...original,
                classification: original.classification || 'unknown',
            });
    const views = [];
    for (const d of documents) {
        if (d.id !== (await internalFxLinkId(accountId, d.entryIds))) continue;
        const [a, b] = d.entryIds;
        const valid =
            d.state === 'active' &&
            claimed.get(a) === 1 &&
            claimed.get(b) === 1 &&
            candidates.get(a)?.has(b) &&
            candidates.get(b)?.has(a) &&
            d.entryFingerprints?.[a] === fingerprints[a] &&
            d.entryFingerprints?.[b] === fingerprints[b] &&
            d.entryIds.every((id) =>
                fxAnnotationStillValid(d.annotations?.[id], stored.get(id))
            );
        const status =
            d.state === 'detached' ? 'detached' : valid ? 'active' : 'stale';
        views.push({ ...d, status, mode: 'approved' });
        if (valid)
            for (const id of d.entryIds)
                annotations.set(id, {
                    ...stored.get(id),
                    id,
                    classification: 'exchange',
                    automatic: false,
                    origin: 'approved_fx_pair',
                    internalFxLinkId: d.id,
                    fxLinkOrigin: FX_LINK_ORIGIN,
                    fxLinkMode: 'approved',
                });
        else if (status === 'stale')
            for (const id of d.entryIds) {
                const original = stored.get(id);
                if (
                    !original ||
                    ['unknown', 'exchange'].includes(original.classification)
                )
                    annotations.set(id, {
                        ...original,
                        id,
                        classification: original?.classification || 'unknown',
                        fxLinkStatus: 'stale',
                    });
            }
    }
    const autoGroups = new Map();
    for (const a of annotations.values())
        if (
            a.automatic &&
            a.classification === 'exchange' &&
            a.evidence?.peerId &&
            annotations.get(a.evidence.peerId)?.automatic
        ) {
            const pair = [a.id, a.evidence.peerId].sort();
            const id = await internalFxLinkId(accountId, pair);
            annotations.set(a.id, {
                ...a,
                internalFxLinkId: id,
                fxLinkOrigin: FX_LINK_ORIGIN,
                fxLinkMode: 'automatic',
            });
            autoGroups.set(id, {
                id,
                entryIds: pair,
                accountId,
                origin: FX_LINK_ORIGIN,
                revision: 0,
                status: 'active',
                mode: 'automatic',
            });
        }
    views.push(...autoGroups.values());
    return {
        ...state,
        classifications: [...annotations.values()],
        automaticClassifications: [...annotations.values()].filter(
            (a) => a.automatic
        ),
        fxLinkViews: views,
        fxEntryFingerprints: fingerprints,
    };
}
