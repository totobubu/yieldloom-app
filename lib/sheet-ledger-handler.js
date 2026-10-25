import { createHash } from 'node:crypto';
import {
    accounts,
    normalizeWorkbook,
    sourceTabs,
    spreadsheetId,
    validateEdit,
} from './sheet-ledger.js';
import { isPortfolioAdmin } from './portfolio-admin.js';
import {
    acceptEvidence,
    classifyCash,
    createManualRow,
    stageObservations,
} from './sheet-reconciliation.js';

const fail = (message, status = 400, code) => {
    throw Object.assign(new Error(message), {
        status,
        ...(code ? { code } : {}),
    });
};
const hash = (value) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PAGE_SIZE = 100,
    MAX_ROWS = 4000;

export async function readGoogleWorkbook(url, token, fetchImpl = fetch) {
    const id = spreadsheetId(url);
    if (typeof token !== 'string' || !token || token.length > 8192)
        fail(
            'Google 읽기 권한을 먼저 연결해 주세요.',
            401,
            'google_reconnect_required'
        );
    const params = new URLSearchParams({
        includeGridData: 'true',
        fields: 'spreadsheetId,sheets(properties(title,sheetId),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue))))',
    });
    for (const name of sourceTabs)
        params.append(
            'ranges',
            `'${name}'!A1:${name === '妻' ? 'AK566' : name === '夫' ? 'V570' : name === '夫배당' ? 'K652' : 'K2000'}`
        );
    const response = await fetchImpl(
        `https://sheets.googleapis.com/v4/spreadsheets/${id}?${params}`,
        {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(30000),
        }
    );
    if (!response.ok)
        fail(
            response.status === 401
                ? 'Google 권한이 만료되었습니다. 다시 연결해 주세요.'
                : response.status === 403
                  ? '시트 접근 권한 또는 Google Sheets API 활성화 상태를 확인해 주세요.'
                  : response.status === 404
                    ? '시트를 찾지 못했습니다. URL과 공유 권한을 확인해 주세요.'
                    : '시트를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.',
            response.status === 401 ? 401 : 400,
            response.status === 401 ? 'google_reconnect_required' : undefined
        );
    return response.json();
}

// Pages keep a 4,000-row trial ledger below Firestore's document size limit.
// All writes lock the metadata document so edits and imports cannot overwrite each other.
export async function readLedger(db, uid, { metadataOnly = false } = {}) {
    const root = db.collection('sheetTrialLedgers').doc(uid);
    return db.runTransaction(
        async (tx) => {
            const meta = await tx.get(root);
            const data = meta.exists
                ? meta.data()
                : { version: 0, pageCount: 0 };
            const refs = Array.from(
                { length: metadataOnly ? 0 : data.pageCount || 0 },
                (_, i) => root.collection('pages').doc(String(i))
            );
            const docs = await Promise.all(refs.map((ref) => tx.get(ref)));
            const evidenceDocs = await Promise.all(
                Array.from(
                    { length: metadataOnly ? 0 : data.evidencePageCount || 0 },
                    (_, i) =>
                        tx.get(root.collection('evidencePages').doc(String(i)))
                )
            );
            return {
                root,
                version: data.version,
                rows: docs.flatMap((d) => d.data()?.rows || []),
                observations: evidenceDocs.flatMap(
                    (d) => d.data()?.observations || []
                ),
                archives: data.archives || [],
            };
        },
        { readOnly: true }
    );
}
export async function persistLedger(db, snapshot, transform, options = {}) {
    return db.runTransaction(async (tx) => {
        const meta = await tx.get(snapshot.root);
        if ((meta.data()?.version || 0) !== snapshot.version)
            fail(
                '다른 작업으로 장부가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
                409
            );
        const rows = transform(snapshot.rows);
        const observations =
            options.observations ?? snapshot.observations ?? [];
        const archives = options.archives ?? snapshot.archives ?? [];
        if (
            Buffer.byteLength(
                JSON.stringify({ rows, observations, archives })
            ) > 4_000_000
        )
            fail(
                '시험 장부 응답 한도(4MB)를 초과합니다. 기존 자료는 변경하지 않았습니다.'
            );
        if (
            JSON.stringify(rows) === JSON.stringify(snapshot.rows) &&
            JSON.stringify(observations) ===
                JSON.stringify(snapshot.observations ?? []) &&
            JSON.stringify(archives) === JSON.stringify(snapshot.archives ?? [])
        )
            return {
                rows,
                observations,
                archives,
                version: snapshot.version,
                accounts,
            };
        if (rows.length > MAX_ROWS)
            fail('시험 장부는 최대 4,000개 거래를 저장할 수 있습니다.');
        const count = Math.ceil(rows.length / PAGE_SIZE);
        for (let i = 0; i < count; i++) {
            const page = rows.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
            if (
                JSON.stringify(page) ===
                JSON.stringify(
                    snapshot.rows.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE)
                )
            )
                continue;
            if (Buffer.byteLength(JSON.stringify(page)) > 900000)
                fail('원본 행의 내용이 너무 큽니다.');
            tx.set(snapshot.root.collection('pages').doc(String(i)), {
                rows: page,
            });
        }
        const evidencePageCount = Math.ceil(observations.length / PAGE_SIZE);
        if (observations.length > 2000)
            fail('시험 대조 자료는 최대 2,000건입니다.');
        for (let i = 0; i < evidencePageCount; i++) {
            const page = observations.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
            if (
                JSON.stringify(page) ===
                JSON.stringify(
                    (snapshot.observations || []).slice(
                        i * PAGE_SIZE,
                        (i + 1) * PAGE_SIZE
                    )
                )
            )
                continue;
            if (Buffer.byteLength(JSON.stringify(page)) > 900000)
                fail(
                    '대조 원문이 너무 큽니다. 한 페이지의 원문 크기를 줄여 주세요.'
                );
            tx.set(snapshot.root.collection('evidencePages').doc(String(i)), {
                observations: page,
            });
        }
        tx.set(snapshot.root, {
            version: snapshot.version + 1,
            pageCount: count,
            evidencePageCount,
            archives,
            accounts,
            updatedAt: new Date().toISOString(),
        });
        return {
            rows,
            observations,
            archives,
            version: snapshot.version + 1,
            accounts,
        };
    });
}

// Immutable, owner-isolated source snapshots include future/error/formula rows too.
// Kept outside the main transaction so a large source cannot overflow its size limit.
async function archiveWorkbook(db, root, workbook, excluded, cutoff) {
    const serialized = JSON.stringify(workbook),
        id = hash(workbook);
    if (
        Buffer.byteLength(serialized) +
            Buffer.byteLength(JSON.stringify(excluded)) >
        4_000_000
    )
        fail(
            '원본과 제외 내역의 보존 한도(4MB)를 초과했습니다. 저장하지 않았습니다.'
        );
    if (Buffer.byteLength(JSON.stringify(excluded)) > 800000)
        fail('제외 내역 보존 한도를 초과했습니다. 저장하지 않았습니다.');
    const encoded = Buffer.from(serialized).toString('base64');
    const chunks = encoded.match(/.{1,600000}/g) || [];
    const ref = root.collection('sourceArchives').doc(id);
    const manifest = {
        id,
        cutoff,
        excludedCount: excluded.length,
        bytes: Buffer.byteLength(serialized),
        sheets: workbook.sheets.map((s) => s.properties.title),
        chunkCount: chunks.length,
    };
    await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return;
        chunks.forEach((data, i) =>
            tx.set(ref.collection('chunks').doc(String(i)), { data })
        );
        tx.set(ref, { ...manifest, excluded });
    });
    return manifest;
}

export function sheetLedgerHandler({
    verify,
    database,
    fetchImpl = fetch,
    now = () => new Date(),
}) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            const claims = await verify(req);
            if (!isPortfolioAdmin(claims))
                fail('관리자만 시험 장부에 접근할 수 있습니다.', 403);
            if (!['GET', 'POST', 'PATCH'].includes(req.method))
                fail('지원하지 않는 요청입니다.', 405);
            const db = database();
            const snapshot = await readLedger(db, claims.uid, {
                metadataOnly:
                    req.method === 'GET' && Boolean(req.query?.sourceArchive),
            });
            if (req.method === 'GET' && req.query?.sourceArchive) {
                const id = String(req.query.sourceArchive);
                if (
                    !/^[a-f0-9]{64}$/.test(id) ||
                    !snapshot.archives.some((a) => a.id === id)
                )
                    fail('보존한 원본을 찾지 못했습니다.', 404);
                const ref = snapshot.root.collection('sourceArchives').doc(id);
                const meta = (await ref.get()).data();
                if (!meta) fail('보존한 원본을 찾지 못했습니다.', 404);
                const docs = await Promise.all(
                    Array.from({ length: meta.chunkCount }, (_, i) =>
                        ref.collection('chunks').doc(String(i)).get()
                    )
                );
                const workbook = JSON.parse(
                    Buffer.from(
                        docs.map((d) => d.data().data).join(''),
                        'base64'
                    ).toString('utf8')
                );
                return res.status(200).json({
                    rows: [],
                    version: snapshot.version,
                    archive: { ...meta, workbook },
                });
            }
            if (req.method === 'GET')
                return res.status(200).json({
                    rows: snapshot.rows,
                    observations: snapshot.observations,
                    archives: snapshot.archives,
                    version: snapshot.version,
                    accounts,
                });
            const body = req.body || {};
            const cutoff = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(now());
            if (req.method === 'POST' && body.action === 'add-manual') {
                const row = createManualRow(
                    body.data || {},
                    body.requestId,
                    claims.uid,
                    now().toISOString(),
                    cutoff
                );
                const fingerprint = hash({
                    accountId: row.accountId,
                    type: row.type,
                    symbol: row.symbol,
                    values: body.data?.values,
                    note: body.data?.note || '',
                });
                const previous = snapshot.rows.find((r) => r.id === row.id);
                if (previous) {
                    if (previous.source.requestFingerprint !== fingerprint)
                        fail('같은 요청 ID의 거래 내용이 다릅니다.', 409);
                    return res.status(200).json({
                        rows: snapshot.rows,
                        observations: snapshot.observations,
                        archives: snapshot.archives,
                        accounts,
                        version: snapshot.version,
                        addedId: row.id,
                        imported: 0,
                    });
                }
                if (body.version !== snapshot.version)
                    fail('장부가 변경되었습니다. 새로고침해 주세요.', 409);
                row.source.requestFingerprint = fingerprint;
                const result = await persistLedger(db, snapshot, (rows) => [
                    ...rows,
                    row,
                ]);
                return res
                    .status(200)
                    .json({ ...result, addedId: row.id, imported: 1 });
            }
            if (
                req.method === 'POST' &&
                [
                    'evidence-preview',
                    'evidence-commit',
                    'accept-evidence',
                    'classify-cash',
                ].includes(body.action)
            ) {
                if (body.version !== snapshot.version)
                    fail('장부가 변경되었습니다. 새로고침해 주세요.', 409);
                if (body.action.startsWith('evidence-')) {
                    const staged = stageObservations(
                        snapshot.rows,
                        snapshot.observations,
                        body.observations
                    );
                    const fingerprint = hash({
                        ...staged,
                        version: snapshot.version,
                    });
                    if (body.action === 'evidence-preview')
                        return res.status(200).json({
                            rows: snapshot.rows,
                            observations: snapshot.observations,
                            archives: snapshot.archives,
                            version: snapshot.version,
                            staged,
                            fingerprint,
                        });
                    if (body.fingerprint !== fingerprint)
                        fail(
                            '대조 자료가 변경되었습니다. 다시 미리보기해 주세요.',
                            409
                        );
                    const result = await persistLedger(
                        db,
                        snapshot,
                        (rows) => rows,
                        {
                            observations: [
                                ...snapshot.observations,
                                ...staged.additions,
                            ],
                        }
                    );
                    return res.status(200).json({
                        ...result,
                        importedEvidence: staged.additions.length,
                    });
                }
                if (body.action === 'accept-evidence') {
                    const next = acceptEvidence(
                        snapshot.rows,
                        snapshot.observations,
                        body,
                        claims.uid,
                        now().toISOString(),
                        cutoff
                    );
                    return res.status(200).json(
                        await persistLedger(db, snapshot, () => next.rows, {
                            observations: next.observations,
                        })
                    );
                }
                const rows = classifyCash(
                    snapshot.rows,
                    snapshot.observations,
                    body,
                    claims.uid,
                    now().toISOString()
                );
                return res
                    .status(200)
                    .json(await persistLedger(db, snapshot, () => rows));
            }
            if (req.method === 'PATCH') {
                if (body.version !== snapshot.version)
                    fail('장부가 변경되었습니다. 새로고침해 주세요.', 409);
                if (!snapshot.rows.some((r) => r.id === body.id))
                    fail('거래를 찾지 못했습니다.', 404);
                const result = await persistLedger(db, snapshot, (rows) =>
                    rows.map((r) =>
                        r.id === body.id ? validateEdit(r, body.patch || {}) : r
                    )
                );
                return res.status(200).json(result);
            }
            if (!['preview', 'commit'].includes(body.action))
                fail('가져오기 작업을 확인해 주세요.');
            const workbook = await readGoogleWorkbook(
                body.url,
                body.googleToken,
                fetchImpl
            );
            const preview = normalizeWorkbook(workbook, cutoff);
            const existing = new Set(snapshot.rows.map((r) => r.id));
            preview.rows = preview.rows.map((r) => ({
                ...r,
                duplicate: existing.has(r.id),
            }));
            const fingerprint = hash({
                rows: preview.rows,
                cutoff,
                excluded: preview.excluded,
                sourceHash: hash(workbook),
            });
            if (body.action === 'preview')
                return res.status(200).json({
                    ...preview,
                    fingerprint,
                    version: snapshot.version,
                });
            if (
                body.version !== snapshot.version ||
                body.fingerprint !== fingerprint
            )
                fail(
                    '원본 시트 또는 장부가 변경되었습니다. 미리보기를 다시 확인해 주세요.',
                    409
                );
            const additions = preview.rows
                .filter((r) => !r.duplicate)
                .map((r) => {
                    const saved = { ...r };
                    delete saved.duplicate;
                    return saved;
                });
            if (
                !additions.length &&
                snapshot.archives.some((a) => a.id === hash(workbook))
            )
                return res.status(200).json({
                    rows: snapshot.rows,
                    observations: snapshot.observations,
                    archives: snapshot.archives,
                    version: snapshot.version,
                    accounts,
                    imported: 0,
                });
            if (
                snapshot.archives.length >= 8 &&
                !snapshot.archives.some((a) => a.id === hash(workbook))
            )
                fail(
                    '원본 보존은 최대 8개 버전입니다. 기존 원본을 유지합니다.'
                );
            const archive = await archiveWorkbook(
                db,
                snapshot.root,
                workbook,
                preview.excluded,
                cutoff
            );
            const saved = await persistLedger(
                db,
                snapshot,
                (rows) => [...rows, ...additions],
                {
                    archives: snapshot.archives.some((a) => a.id === archive.id)
                        ? snapshot.archives
                        : [...snapshot.archives, archive],
                }
            );
            return res
                .status(200)
                .json({ ...saved, imported: additions.length });
        } catch (error) {
            const status =
                error.status ||
                (String(error.code || '').startsWith('auth/') ? 401 : 400);
            return res.status(status).json({
                ...(error.code === 'google_reconnect_required'
                    ? { code: error.code }
                    : {}),
                error:
                    status >= 500
                        ? '시험 장부를 처리하지 못했습니다. 다시 시도해 주세요.'
                        : error.message,
            });
        }
    };
}
