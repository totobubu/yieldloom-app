import { createHash } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';
import { normalizeObservation } from './sheet-reconciliation.js';

const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const json = (value) =>
    JSON.stringify(value, (_key, v) =>
        v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(
                  Object.keys(v)
                      .sort()
                      .map((k) => [k, v[k]])
              )
            : v
    );
export const observationHash = (value) =>
    createHash('sha256').update(json(value)).digest('hex');
const cursorEncode = (v) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
function cursorDecode(value, accountId, kind) {
    if (!value) return null;
    try {
        if (typeof value !== 'string' || value.length > 1024) throw Error();
        const c = JSON.parse(Buffer.from(value, 'base64url').toString());
        if (
            c.accountId !== accountId ||
            c.kind !== kind ||
            !Number.isSafeInteger(c.watermark) ||
            c.watermark < 0
        )
            throw Error();
        return c;
    } catch {
        fail('이 계좌의 조회 커서를 확인해 주세요.');
    }
}
export function observationAccount(root, accountId) {
    if (!['wife', 'husband'].includes(accountId))
        fail('남편/아내 계좌를 지정해 주세요.');
    return root.collection('reconciliationAccounts').doc(accountId);
}
function batchRef(account, batchId) {
    if (typeof batchId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(batchId))
        fail('배치 ID를 확인해 주세요.');
    return account.collection('batches').doc(batchId);
}
export async function legacyObservations(reader, root, meta) {
    const pages = await Promise.all(
        Array.from({ length: meta?.evidencePageCount || 0 }, (_, i) =>
            reader(root.collection('evidencePages').doc(String(i)))
        )
    );
    return pages.flatMap((d) => d.data()?.observations || []);
}
const comparable = (o) =>
    Object.fromEntries(
        [
            'kind',
            'sourceId',
            'accountId',
            'type',
            'symbol',
            'location',
            'rawText',
            'values',
        ].map((k) => [k, o[k]])
    );
export function observationSummary(observation, extra = {}) {
    const { rawText, original, ...summary } = observation;
    void original;
    return {
        ...summary,
        hasOriginal: Boolean(rawText) || Boolean(extra.storageKey),
        ...extra,
    };
}

function prepare(body) {
    const { accountId, batchId, observations, checkpoint } = body;
    if (
        !Array.isArray(observations) ||
        observations.length < 1 ||
        observations.length > 100
    )
        fail('배치는 1~100건이어야 합니다.');
    if (Buffer.byteLength(JSON.stringify(body)) > 3_000_000)
        fail(
            '요청이 3MB를 초과합니다. 원문을 자르지 말고 배치를 더 작게 나눠 주세요.',
            413
        );
    if (
        !checkpoint ||
        !/^[a-f0-9]{64}$/.test(checkpoint.sourceHash || '') ||
        !Number.isSafeInteger(checkpoint.offset) ||
        checkpoint.offset < 0 ||
        checkpoint.count !== observations.length ||
        Buffer.byteLength(JSON.stringify(checkpoint)) > 4096
    )
        fail('원본 해시·시작 위치·건수를 포함한 체크포인트를 확인해 주세요.');
    const items = observations.map((input) => {
        const normalized = normalizeObservation(input, {
            maxRawTextLength: 3_000_000,
        });
        if (normalized.accountId !== accountId)
            fail('다른 계좌의 자료를 한 배치에 섞을 수 없습니다.');
        const { rawText, ...observation } = normalized;
        void rawText;
        return {
            input,
            normalized,
            observation,
            key: observationHash(normalized.id),
            digest: observationHash(input),
        };
    });
    const unique = new Map();
    for (const item of items) {
        if (unique.has(item.key) && unique.get(item.key).digest !== item.digest)
            fail(
                '같은 원본 ID의 값이 다릅니다. 별도 개정 ID로 보존해 주세요.',
                409
            );
        if (!unique.has(item.key)) unique.set(item.key, item);
    }
    const fingerprint = observationHash({
        accountId,
        batchId,
        checkpoint,
        observations,
    });
    if (body.fingerprint && body.fingerprint !== fingerprint)
        fail('미리보기 이후 배치 내용이 변경되었습니다.', 409);
    const originalText = JSON.stringify(observations);
    const encoded = Buffer.from(originalText).toString('base64');
    return {
        accountId,
        batchId,
        checkpoint,
        items,
        unique: [...unique.values()],
        fingerprint,
        archiveHash: createHash('sha256').update(originalText).digest('hex'),
        bytes: Buffer.byteLength(originalText),
        chunks: encoded.match(/.{1,500000}/g) || [],
    };
}

// One bounded transaction publishes records, full original chunks and the complete receipt together.
// There is no partially visible batch and no aggregate observation-count/byte cap.
export async function submitObservationBatch(
    db,
    root,
    body,
    { preview = false, now = () => new Date() } = {}
) {
    const account = observationAccount(root, body.accountId),
        ref = batchRef(account, body.batchId);
    const data = prepare(body);
    return db.runTransaction(
        async (tx) => {
            const receiptDoc = await tx.get(ref);
            if (receiptDoc.exists) {
                const receipt = receiptDoc.data();
                if (
                    receipt.status !== 'complete' ||
                    receipt.fingerprint !== data.fingerprint
                )
                    fail('같은 배치 ID의 내용 또는 상태가 다릅니다.', 409);
                return {
                    receipt,
                    replayed: true,
                    fingerprint: data.fingerprint,
                    staged: { additions: [], duplicates: data.items.length },
                    observationDelta: [],
                };
            }
            const [stateDoc, rootDoc] = await Promise.all([
                tx.get(account),
                tx.get(root),
            ]);
            const state = { sequence: 0, recordCount: 0, ...stateDoc.data() };
            const legacy = await legacyObservations(
                (r) => tx.get(r),
                root,
                rootDoc.data()
            );
            const old = new Map(
                legacy
                    .filter((o) => o.accountId === data.accountId)
                    .map((o) => [o.id, o])
            );
            const docs = await Promise.all(
                data.unique.map((item) =>
                    tx.get(account.collection('observations').doc(item.key))
                )
            );
            const additions = [],
                delta = [];
            for (const [i, item] of data.unique.entries()) {
                const previous = docs[i].data(),
                    historical = old.get(item.normalized.id);
                if (previous && previous.digest !== item.digest)
                    fail(
                        '동일 원본 ID의 관측값이 변경됐습니다. 새 개정 ID로 보존해 주세요.',
                        409
                    );
                if (
                    !previous &&
                    historical &&
                    observationHash(comparable(historical)) !==
                        observationHash(comparable(item.normalized))
                )
                    fail(
                        '기존 관측과 값이 충돌합니다. 새 개정 ID로 보존해 주세요.',
                        409
                    );
                if (!previous && !historical) additions.push(item);
                delta.push(
                    previous
                        ? observationSummary(previous.observation, {
                              storageKey: item.key,
                              reviewVersion: previous.reviewVersion,
                          })
                        : historical
                          ? observationSummary(historical, { legacy: true })
                          : observationSummary(item.observation, {
                                storageKey: item.key,
                                reviewVersion: 0,
                            })
                );
            }
            const sequence = state.sequence + 1;
            const receipt = {
                batchId: data.batchId,
                accountId: data.accountId,
                status: preview ? 'preview' : 'complete',
                sequence,
                count: data.items.length,
                uniqueCount: data.unique.length,
                inserted: additions.length,
                duplicates: data.items.length - additions.length,
                checkpoint: data.checkpoint,
                fingerprint: data.fingerprint,
                archiveHash: data.archiveHash,
                originalBytes: data.bytes,
                chunkCount: data.chunks.length,
                ledgerVersion: rootDoc.data()?.version || 0,
                completedAt: now().toISOString(),
            };
            if (!preview) {
                for (const item of additions) {
                    const record = {
                        observation: item.observation,
                        digest: item.digest,
                        sequence,
                        batchId: data.batchId,
                        originalIndex: data.items.findIndex(
                            (i) => i.key === item.key
                        ),
                        reviewVersion: 0,
                    };
                    if (Buffer.byteLength(JSON.stringify(record)) > 900000)
                        fail(
                            '단일 관측 문서가 너무 큽니다. 원문은 보존하고 정규화 필드를 확인해 주세요.',
                            413
                        );
                    tx.set(
                        account.collection('observations').doc(item.key),
                        record
                    );
                }
                data.chunks.forEach((chunk, i) =>
                    tx.set(ref.collection('originalChunks').doc(String(i)), {
                        chunk,
                    })
                );
                tx.set(ref, receipt);
                tx.set(account, {
                    ...state,
                    sequence,
                    recordCount: state.recordCount + additions.length,
                    updatedAt: receipt.completedAt,
                });
            }
            return {
                receipt,
                replayed: false,
                fingerprint: data.fingerprint,
                staged: {
                    additions: additions.map((i) =>
                        observationSummary(i.observation)
                    ),
                    duplicates: receipt.duplicates,
                },
                observationDelta: delta,
            };
        },
        preview ? { readOnly: true } : undefined
    );
}

async function accountWatermark(account, cursor) {
    const state = {
        sequence: 0,
        recordCount: 0,
        ...(await account.get()).data(),
    };
    if (cursor && cursor.watermark > state.sequence)
        fail('조회 체크포인트가 현재 상태보다 앞섭니다.');
    return { state, watermark: cursor?.watermark ?? state.sequence };
}
export async function listObservationBatches(root, accountId, query = {}) {
    const account = observationAccount(root, accountId);
    if (query.batchId) {
        const doc = await batchRef(account, query.batchId).get();
        if (!doc.exists || doc.data().status !== 'complete')
            fail('완료된 배치를 찾지 못했습니다.', 404);
        return { receipt: doc.data() };
    }
    const cursor = cursorDecode(query.cursor, accountId, 'batches');
    const { state, watermark } = await accountWatermark(account, cursor);
    const after = cursor?.after ?? Number(query.after || 0);
    if (!Number.isSafeInteger(after) || after < 0)
        fail('배치 커서를 확인해 주세요.');
    const docs = await account
        .collection('batches')
        .where('sequence', '>', after)
        .where('sequence', '<=', watermark)
        .orderBy('sequence')
        .limit(100)
        .get();
    const batches = docs.docs
        .map((d) => d.data())
        .filter((d) => d.status === 'complete');
    return {
        batches,
        watermark,
        latestSequence: state.sequence,
        nextCursor:
            docs.docs.length === 100
                ? cursorEncode({
                      kind: 'batches',
                      accountId,
                      watermark,
                      after: docs.docs.at(-1).data().sequence,
                  })
                : null,
    };
}

export async function listObservations(root, accountId, query = {}, metadata) {
    const account = observationAccount(root, accountId),
        cursor = cursorDecode(query.cursor, accountId, 'observations');
    const { state, watermark } = await accountWatermark(account, cursor);
    const phase = cursor?.phase || 'legacy';
    if (!['legacy', 'records'].includes(phase))
        fail('관측 커서를 확인해 주세요.');
    if (phase === 'legacy') {
        const meta = metadata || (await root.get()).data() || {};
        const page = cursor?.page ?? 0;
        if (
            !Number.isSafeInteger(page) ||
            page < 0 ||
            page > (meta.evidencePageCount || 0)
        )
            fail('기존 관측 커서를 확인해 주세요.');
        const doc =
            page < (meta.evidencePageCount || 0)
                ? await root.collection('evidencePages').doc(String(page)).get()
                : null;
        const observations = (doc?.data()?.observations || [])
            .filter((o) => o.accountId === accountId)
            .map((o) => observationSummary(o, { legacy: true }));
        if (meta.evidencePageCount)
            return {
                observations,
                watermark,
                latestSequence: state.sequence,
                nextCursor: cursorEncode(
                    page + 1 < (meta.evidencePageCount || 0)
                        ? {
                              kind: 'observations',
                              accountId,
                              watermark,
                              phase: 'legacy',
                              page: page + 1,
                          }
                        : {
                              kind: 'observations',
                              accountId,
                              watermark,
                              phase: 'records',
                              afterSequence: 0,
                              afterKey: '',
                          }
                ),
            };
    }
    if (!watermark)
        return {
            observations: [],
            watermark,
            latestSequence: state.sequence,
            recordCount: 0,
            nextCursor: null,
        };
    const afterSequence = cursor?.afterSequence ?? 0,
        afterKey = cursor?.afterKey || '';
    if (
        !Number.isSafeInteger(afterSequence) ||
        afterSequence < 0 ||
        (afterKey && !/^[a-f0-9]{64}$/.test(afterKey))
    )
        fail('관측 커서를 확인해 주세요.');
    let q = account
        .collection('observations')
        .where('sequence', '<=', watermark)
        .orderBy('sequence')
        .orderBy(FieldPath.documentId());
    if (afterKey) q = q.startAfter(afterSequence, afterKey);
    const docs = await q.limit(100).get();
    const last = docs.docs.at(-1);
    return {
        observations: docs.docs.map((d) =>
            observationSummary(d.data().observation, {
                storageKey: d.id,
                reviewVersion: d.data().reviewVersion,
            })
        ),
        watermark,
        latestSequence: state.sequence,
        recordCount: state.recordCount,
        nextCursor:
            docs.docs.length === 100
                ? cursorEncode({
                      kind: 'observations',
                      accountId,
                      watermark,
                      phase: 'records',
                      afterSequence: last.data().sequence,
                      afterKey: last.id,
                  })
                : null,
    };
}

export async function readBatchOriginal(root, accountId, batchId) {
    const ref = batchRef(observationAccount(root, accountId), batchId),
        doc = await ref.get();
    if (!doc.exists || doc.data().status !== 'complete')
        fail('완료된 원본 배치를 찾지 못했습니다.', 404);
    const receipt = doc.data();
    const chunks = await Promise.all(
        Array.from({ length: receipt.chunkCount }, (_, i) =>
            ref.collection('originalChunks').doc(String(i)).get()
        )
    );
    if (chunks.some((d) => !d.exists))
        fail('원본 청크가 누락됐습니다. 검증을 중단했습니다.', 409);
    const raw = Buffer.from(
        chunks.map((d) => d.data().chunk).join(''),
        'base64'
    );
    if (createHash('sha256').update(raw).digest('hex') !== receipt.archiveHash)
        fail('보존 원본의 해시가 다릅니다. 검증을 중단했습니다.', 409);
    return { receipt, originals: JSON.parse(raw.toString('utf8')) };
}
export async function readObservation(
    root,
    accountId,
    id,
    { includeOriginal = false, legacyFallback = true } = {}
) {
    const account = observationAccount(root, accountId);
    if (typeof id !== 'string' || id.length > 500)
        fail('관측 ID를 확인해 주세요.');
    const ref = account.collection('observations').doc(observationHash(id)),
        doc = await ref.get();
    if (doc.exists) {
        const record = doc.data();
        if (
            record.observation.accountId !== accountId ||
            record.observation.id !== id
        )
            fail('관측 계좌가 일치하지 않습니다.', 403);
        let original;
        if (includeOriginal) {
            const { originals } = await readBatchOriginal(
                root,
                accountId,
                record.batchId
            );
            original = originals[record.originalIndex];
            if (observationHash(original) !== record.digest)
                fail('관측 원문의 해시가 일치하지 않습니다.', 409);
        }
        return {
            ref,
            record,
            original,
            observation: {
                ...record.observation,
                storageKey: ref.id,
                reviewVersion: record.reviewVersion,
            },
        };
    }
    if (!legacyFallback) fail('관측을 찾지 못했습니다.', 404);
    const meta = (await root.get()).data();
    const legacy = await legacyObservations((r) => r.get(), root, meta);
    const observation = legacy.find(
        (o) => o.id === id && o.accountId === accountId
    );
    if (!observation) fail('관측을 찾지 못했습니다.', 404);
    return {
        observation: { ...observation, legacy: true },
        ref: null,
        record: null,
    };
}
