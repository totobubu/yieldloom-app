import { isPortfolioAdmin } from './portfolio-admin.js';
import { reportDigest } from './private-report-store.js';
import { finalLedgerCheckpoint } from './final-ledger-snapshot.js';
import { adoptedFifoInput } from './adopted-fifo-input.js';
import {
    emptyFifoState,
    activeFifoCorrections,
    changeFifoState,
} from './fifo-adjustments.js';
import { calculateFifoAssets } from './fifo-asset-report.js';
import { randomUUID } from 'node:crypto';
import { publicReportFailure } from './report-diagnostics.js';
const localFailures = new WeakSet();
const fail = (message, status) => {
    const error = Object.assign(new Error(message), { status });
    localFailures.add(error);
    throw error;
};
export function fifoReportHandler({
    verify,
    database,
    store,
    checkpoint = finalLedgerCheckpoint,
    now = () => new Date().toISOString(),
    logDiagnostic = (record) =>
        console.warn('private_report_diagnostic', record),
}) {
    return async (req, res) => {
        const requestId = randomUUID();
        let adminVerified = false,
            authorized = false,
            fallback = 'REPORT_SNAPSHOT_READ';
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('CDN-Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const claims = await verify(req);
            if (!isPortfolioAdmin(claims))
                fail('관리자 권한이 필요합니다.', 403);
            adminVerified = true;
            if (!['GET', 'POST'].includes(req.method))
                fail('지원하지 않는 요청입니다.', 405);
            if (
                Object.keys(req.query || {}).some(
                    (k) => !['view', 'accountId', 'section'].includes(k)
                ) ||
                (req.query?.accountId && req.query.accountId !== 'family')
            )
                fail('가족 리포트 경로를 확인해 주세요.', 400);
            const db = database(),
                root = db.collection('sheetTrialLedgers').doc(claims.uid);
            const meta = await root.get();
            if (!meta.exists || !(meta.data().pageCount > 0))
                fail('연결된 채택 장부가 없습니다.', 403);
            const page = await root.collection('pages').doc('0').get();
            if (
                !(page.data()?.rows || []).some(
                    (r) =>
                        r.accountId === 'wife' &&
                        typeof r.source?.spreadsheetId === 'string' &&
                        reportDigest(r.source.spreadsheetId) ===
                            checkpoint.workbookSha256
                )
            )
                fail('접근 가능한 채택 장부가 없습니다.', 403);
            authorized = true;
            const snapshot = await store.readFinalSnapshot(
                claims.uid,
                'family'
            );
            fallback = 'REPORT_INPUT_INVALID';
            const input = adoptedFifoInput(snapshot);
            const ref = root.collection('fifoAdjustments').doc('state');
            fallback = 'REPORT_ADJUSTMENTS_READ';
            if (req.method === 'POST') {
                if (Buffer.byteLength(JSON.stringify(req.body || {})) > 64000)
                    fail('보정 요청 크기를 줄여 주세요.', 413);
                fallback = 'REPORT_ADJUSTMENTS_WRITE';
                const result = await db.runTransaction(async (tx) => {
                    const [currentMeta, currentPage] = await Promise.all([
                        tx.get(root),
                        tx.get(root.collection('pages').doc('0')),
                    ]);
                    if (
                        !currentMeta.exists ||
                        !(currentMeta.data().pageCount > 0) ||
                        !(currentPage.data()?.rows || []).some(
                            (r) =>
                                r.accountId === 'wife' &&
                                typeof r.source?.spreadsheetId === 'string' &&
                                reportDigest(r.source.spreadsheetId) ===
                                    checkpoint.workbookSha256
                        )
                    )
                        fail('장부 접근 권한이 변경되었습니다.', 403);
                    const saved = await tx.get(ref);
                    const state = saved.exists
                        ? saved.data()
                        : emptyFifoState();
                    let changed;
                    try {
                        changed = changeFifoState(state, req.body, input, {
                            uid: claims.uid,
                            now,
                        });
                    } catch (error) {
                        const status = [400, 409, 413].includes(error.status)
                            ? error.status
                            : 400;
                        fail(
                            status === 409
                                ? '장부 또는 보정 버전이 바뀌었습니다. 다시 조회해 주세요.'
                                : status === 413
                                  ? '보정 요청 또는 이력 한도를 확인해 주세요.'
                                  : '보정 입력값과 확인 근거를 확인해 주세요.',
                            status
                        );
                    }
                    if (!changed.replayed) tx.set(ref, changed.state);
                    return {
                        revision: changed.state.revision,
                        replayed: changed.replayed,
                    };
                });
                return res.status(200).json({
                    ...result,
                    canonicalUnchanged: true,
                    ledgerRevision: input.ledgerRevision,
                });
            }
            const saved = await ref.get(),
                state = saved.exists ? saved.data() : emptyFifoState();
            const corrections = activeFifoCorrections(state);
            let report = null,
                calculationError = null;
            try {
                report = calculateFifoAssets({
                    ...input,
                    corrections,
                    today: now().slice(0, 10),
                });
            } catch {
                calculationError =
                    '보정 대상·계좌가 바뀌었거나 보정이 서로 의존합니다. 이력을 확인하고 해당 보정을 되돌려 주세요.';
            }
            res.setHeader('X-Report-Document-Reads', '3');
            return res.status(200).json({
                schemaVersion: 1,
                section: 'assets',
                accountId: 'family',
                readOnly: true,
                input,
                adjustments: { ...state, active: corrections },
                report,
                calculationError,
                today: now().slice(0, 10),
                canonicalUnchanged: true,
            });
        } catch (error) {
            // Only our own literal validation messages may cross this boundary.
            if (localFailures.has(error))
                return res.status(error.status).json({ error: error.message });
            if (!authorized)
                return res.status(adminVerified ? 503 : 401).json({
                    error: adminVerified
                        ? '보고서 접근 권한을 확인하지 못했습니다. 다시 조회해 주세요.'
                        : '로그인을 확인해 주세요.',
                });
            const { status, ...body } = publicReportFailure(
                error,
                requestId,
                fallback
            );
            if (body.diagnostic) {
                res.setHeader('X-Report-Request-ID', body.diagnostic.requestId);
                try {
                    logDiagnostic({
                        requestId: body.diagnostic.requestId,
                        code: body.diagnostic.code,
                        stage: body.diagnostic.stage,
                    });
                } catch {
                    /* Diagnostics cannot change the report result. */
                }
            }
            return res.status(status).json(body);
        }
    };
}
