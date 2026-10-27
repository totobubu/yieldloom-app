import { isPortfolioAdmin } from './portfolio-admin.js';
import {
    reportDigest,
    reportIndexKey,
    sourceTimesIndexKey,
} from './private-report-store.js';
import {
    followupCheckpoint,
    followupResponse,
} from './toss-followup-report.js';
import { validSourceTimeItems } from './sheet-source-times.js';

const fail = (message, status) => {
    throw Object.assign(new Error(message), { status });
};
const accountIds = ['wife', 'husband'];
export function sheetReportHandler({
    verify,
    database,
    store,
    checkpoint = followupCheckpoint,
}) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('CDN-Cache-Control', 'no-store');
        res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        try {
            const claims = await verify(req);
            if (!isPortfolioAdmin(claims))
                fail('관리자만 대조 보고서를 읽을 수 있습니다.', 403);
            if (req.method !== 'GET') fail('읽기 전용 보고서입니다.', 405);
            const { accountId = 'wife', section = 'summary' } = req.query || {};
            if (
                !accountIds.includes(accountId) ||
                !['summary', 'details', 'times', 'followup'].includes(section)
            )
                fail('계좌와 보고서 구분을 확인해 주세요.', 400);
            if (
                section === 'followup' &&
                Object.keys(req.query || {}).some(
                    (key) => !['view', 'section', 'accountId'].includes(key)
                )
            )
                fail('후속 보고서는 고정된 계좌별 경로로만 조회합니다.', 400);
            const index = await store.read(reportIndexKey, {
                maxBytes: 32_000,
            });
            if (
                index.schemaVersion !== 1 ||
                !/^[a-f0-9]{64}$/.test(
                    index.sourceBinding?.spreadsheetIdSha256 || ''
                )
            )
                throw new Error('Invalid report index');
            // An allowlisted email alone does not grant access to another administrator's reports.
            // The current uid must already own this imported workbook in its trial ledger.
            const root = database()
                .collection('sheetTrialLedgers')
                .doc(claims.uid);
            const meta = await root.get();
            if (!meta.exists || !(meta.data().pageCount > 0))
                fail('연결된 시험 장부가 없습니다.', 403);
            const page = await root.collection('pages').doc('0').get();
            const ownsSource = (page.data()?.rows || []).some(
                (row) =>
                    accountIds.includes(row.accountId) &&
                    typeof row.source?.spreadsheetId === 'string' &&
                    reportDigest(row.source.spreadsheetId) ===
                        index.sourceBinding.spreadsheetIdSha256
            );
            if (!ownsSource)
                fail(
                    '현재 시험 장부에 연결된 출처의 보고서만 조회할 수 있습니다.',
                    403
                );
            if (section === 'followup') {
                if (accountId !== checkpoint.accountId)
                    throw Object.assign(
                        new Error(
                            '이 계좌에 연결된 후속 보고서가 아직 없습니다. 검증 완료나 이슈 없음이 아닙니다.'
                        ),
                        { status: 404, code: 'REPORT_NOT_FOUND' }
                    );
                const verified = await store.readFollowup();
                const value = followupResponse(
                    verified,
                    accountId,
                    index.sourceBinding.spreadsheetIdSha256,
                    checkpoint
                );
                res.setHeader('X-Report-Document-Reads', '2');
                return res.status(200).json(value);
            }
            let descriptor = index.accounts?.[accountId]?.[section];
            if (section === 'times' && !descriptor) {
                let timeIndex;
                try {
                    timeIndex = await store.read(sourceTimesIndexKey, {
                        maxBytes: 32_000,
                    });
                } catch (error) {
                    if (error.name !== 'NoSuchKey') throw error;
                    fail(
                        '저장된 원문 시각 인덱스가 아직 연결되지 않았습니다. 시각이 없다는 뜻은 아닙니다.',
                        409
                    );
                }
                if (
                    timeIndex.schemaVersion !== 1 ||
                    timeIndex.runId !== index.runId ||
                    timeIndex.sourceBinding?.spreadsheetIdSha256 !==
                        index.sourceBinding.spreadsheetIdSha256
                )
                    fail(
                        '원문 시각과 요약의 출처·기준이 다릅니다. 연결 보고서를 확인해 주세요.',
                        409
                    );
                descriptor = timeIndex.descriptors?.[accountId];
            }
            if (
                !descriptor ||
                typeof descriptor.key !== 'string' ||
                !/^[a-f0-9]{64}$/.test(descriptor.sha256 || '') ||
                !descriptor.key.includes(`/${accountId}/`)
            )
                throw new Error('Invalid account descriptor');
            const report = await store.read(descriptor.key, {
                sha256: descriptor.sha256,
                maxBytes:
                    section === 'summary'
                        ? 64_000
                        : section === 'times'
                          ? 4_300_000
                          : 512_000,
            });
            if (
                report.schemaVersion !== 1 ||
                report.accountId !== accountId ||
                report.section !== section ||
                report.runId !== index.runId
            )
                throw new Error('Report account/version mismatch');
            if (section === 'summary' && !Array.isArray(report.metrics))
                throw new Error('Invalid report summary');
            if (
                ['details', 'times'].includes(section) &&
                (!Array.isArray(report.items) ||
                    report.items.some((x) => x.accountId !== accountId))
            )
                throw new Error('Cross-account detail');
            if (
                section === 'times' &&
                !validSourceTimeItems(report.items, accountId)
            )
                throw new Error('Invalid source time report');
            res.setHeader('X-Report-Document-Reads', '2');
            return res
                .status(200)
                .json({ ...report, readOnly: true, adoptionAvailable: false });
        } catch (error) {
            const auth = String(error?.code || '').startsWith('auth/');
            const status = auth
                ? 401
                : [400, 401, 403, 404, 405, 409, 503].includes(error.status)
                  ? error.status
                  : 503;
            return res.status(status).json({
                ...([
                    'REPORT_NOT_FOUND',
                    'REPORT_INTEGRITY_FAILED',
                    'REPORT_STORAGE_DENIED',
                ].includes(error.code)
                    ? { code: error.code }
                    : {}),
                error:
                    status === 503
                        ? '비공개 보고서를 읽지 못했습니다. 기존 R2 읽기 설정과 보고서 연결을 확인해 주세요.'
                        : auth
                          ? '로그인이 만료되었습니다. 다시 로그인해 주세요.'
                          : error.message,
            });
        }
    };
}
