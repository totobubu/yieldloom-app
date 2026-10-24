import { createHash } from 'node:crypto';
import {
    accounts,
    normalizeWorkbook,
    sourceTabs,
    spreadsheetId,
    validateEdit,
} from './sheet-ledger.js';
import { isPortfolioAdmin } from './portfolio-admin.js';

const fail = (message, status = 400) => {
    throw Object.assign(new Error(message), { status });
};
const hash = (value) =>
    createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PAGE_SIZE = 100,
    MAX_ROWS = 4000;

export async function readGoogleWorkbook(url, token, fetchImpl = fetch) {
    const id = spreadsheetId(url);
    if (typeof token !== 'string' || !token || token.length > 8192)
        fail('Google 읽기 권한을 먼저 연결해 주세요.', 401);
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
            response.status === 401 ? 401 : 400
        );
    return response.json();
}

// Pages keep a 4,000-row trial ledger below Firestore's document size limit.
// All writes lock the metadata document so edits and imports cannot overwrite each other.
export async function readLedger(db, uid) {
    const root = db.collection('sheetTrialLedgers').doc(uid);
    return db.runTransaction(
        async (tx) => {
            const meta = await tx.get(root);
            const data = meta.exists
                ? meta.data()
                : { version: 0, pageCount: 0 };
            const refs = Array.from({ length: data.pageCount || 0 }, (_, i) =>
                root.collection('pages').doc(String(i))
            );
            const docs = await Promise.all(refs.map((ref) => tx.get(ref)));
            return {
                root,
                version: data.version,
                rows: docs.flatMap((d) => d.data()?.rows || []),
            };
        },
        { readOnly: true }
    );
}
export async function persistLedger(db, snapshot, transform) {
    return db.runTransaction(async (tx) => {
        const meta = await tx.get(snapshot.root);
        if ((meta.data()?.version || 0) !== snapshot.version)
            fail(
                '다른 작업으로 장부가 변경되었습니다. 새로고침 후 다시 시도해 주세요.',
                409
            );
        const rows = transform(snapshot.rows);
        if (JSON.stringify(rows) === JSON.stringify(snapshot.rows))
            return { rows, version: snapshot.version, accounts };
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
        tx.set(snapshot.root, {
            version: snapshot.version + 1,
            pageCount: count,
            accounts,
            updatedAt: new Date().toISOString(),
        });
        return { rows, version: snapshot.version + 1, accounts };
    });
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
            const snapshot = await readLedger(db, claims.uid);
            if (req.method === 'GET')
                return res.status(200).json({
                    rows: snapshot.rows,
                    version: snapshot.version,
                    accounts,
                });
            const body = req.body || {};
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
            const cutoff = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Seoul',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).format(now());
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
            if (!additions.length)
                return res.status(200).json({
                    rows: snapshot.rows,
                    version: snapshot.version,
                    accounts,
                    imported: 0,
                });
            const saved = await persistLedger(db, snapshot, (rows) => [
                ...rows,
                ...additions,
            ]);
            return res
                .status(200)
                .json({ ...saved, imported: additions.length });
        } catch (error) {
            const status =
                error.status ||
                (String(error.code || '').startsWith('auth/') ? 401 : 400);
            return res.status(status).json({
                error:
                    status >= 500
                        ? '시험 장부를 처리하지 못했습니다. 다시 시도해 주세요.'
                        : error.message,
            });
        }
    };
}
