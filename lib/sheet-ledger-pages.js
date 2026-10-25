import { observationAccount } from './sheet-observation-store.js';

const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
export async function readLedgerPage(db, root, query = {}) {
    let cursor;
    try {
        if (query.cursor) {
            if (typeof query.cursor !== 'string' || query.cursor.length > 512)
                throw Error();
            cursor = JSON.parse(
                Buffer.from(query.cursor, 'base64url').toString()
            );
            if (
                cursor.kind !== 'rows' ||
                !Number.isSafeInteger(cursor.offset) ||
                cursor.offset < 0 ||
                !Number.isSafeInteger(cursor.version)
            )
                throw Error();
        }
    } catch {
        fail('장부 페이지 커서를 확인해 주세요.');
    }
    const limit = Number(query.limit || 500);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
        fail('조회 크기는 1~500행입니다.');
    return db.runTransaction(
        async (tx) => {
            const meta = (await tx.get(root)).data() || {
                version: 0,
                pageCount: 0,
            };
            if (
                (cursor && cursor.version !== meta.version) ||
                (query.version != null &&
                    Number(query.version) !== meta.version)
            )
                fail(
                    '장부가 변경되었습니다. 전체 조회를 다시 시작해 주세요.',
                    409
                );
            const observationStates = {};
            if (!cursor)
                for (const accountId of ['wife', 'husband']) {
                    const state = (
                        await tx.get(observationAccount(root, accountId))
                    ).data();
                    observationStates[accountId] = {
                        sequence: state?.sequence || 0,
                        recordCount: state?.recordCount || 0,
                    };
                }
            let totalRows = meta.rowCount;
            let lastPage;
            if (totalRows == null) {
                lastPage = meta.pageCount
                    ? await tx.get(
                          root
                              .collection('pages')
                              .doc(String(meta.pageCount - 1))
                      )
                    : null;
                totalRows = meta.pageCount
                    ? (meta.pageCount - 1) * 100 +
                      (lastPage?.data()?.rows || []).length
                    : 0;
            }
            const offset = cursor?.offset || 0;
            if (offset > totalRows) fail('장부 페이지 범위를 확인해 주세요.');
            const first = Math.floor(offset / 100),
                end = Math.min(
                    meta.pageCount,
                    Math.ceil((offset + limit) / 100)
                );
            const docs = await Promise.all(
                Array.from({ length: Math.max(0, end - first) }, (_, i) =>
                    first + i === meta.pageCount - 1 && lastPage
                        ? lastPage
                        : tx.get(
                              root.collection('pages').doc(String(first + i))
                          )
                )
            );
            const available = docs
                .flatMap((d) => d.data()?.rows || [])
                .slice(offset % 100, (offset % 100) + limit);
            const rows = [];
            let bytes = 0;
            for (const row of available) {
                const size = Buffer.byteLength(JSON.stringify(row)) + 1;
                if (bytes + size > 995000) break;
                rows.push(row);
                bytes += size;
            }
            if (available.length && !rows.length)
                fail('단일 거래 응답이 너무 큽니다.', 413);
            const next = offset + rows.length;
            return {
                rows,
                observations: [],
                archives: meta.archives || [],
                version: meta.version,
                totalRows,
                observationPaging: true,
                observationStates,
                legacyEvidencePageCount: meta.evidencePageCount || 0,
                nextCursor:
                    next < totalRows
                        ? Buffer.from(
                              JSON.stringify({
                                  kind: 'rows',
                                  offset: next,
                                  version: meta.version,
                              })
                          ).toString('base64url')
                        : null,
            };
        },
        { readOnly: true }
    );
}

// Large mutations return changed rows, not a copy of the complete private database.
export function ledgerMutationResponse(snapshot, result) {
    if (Buffer.byteLength(JSON.stringify(result)) <= 2_500_000) return result;
    const before = new Map(snapshot.rows.map((r) => [r.id, JSON.stringify(r)]));
    const changed = result.rows.filter(
        (r) => before.get(r.id) !== JSON.stringify(r)
    );
    const { rows, observations, ...meta } = result;
    const reloadRows = Buffer.byteLength(JSON.stringify(changed)) > 995000;
    return {
        ...meta,
        rows: [],
        observations: [],
        partial: true,
        totalRows: rows.length,
        rowDelta: reloadRows ? [] : changed,
        reloadRows,
        reloadObservations:
            JSON.stringify(observations) !==
            JSON.stringify(snapshot.observations),
    };
}
