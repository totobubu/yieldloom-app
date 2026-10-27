// Server-only, immutable allowlist. These are content fingerprints, not credentials.
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
export const followupCheckpoint = Object.freeze({
    accountId: 'wife',
    version: 2,
    key: 'reconciliation/reviews/2026-10-27/toss-event-first/four-order-followup/afec27110796ace74abcc729232693f0d443d42fa998d1eca3a4fc1f9481a141/four-order-review-v2.zip',
    sha256: 'afec27110796ace74abcc729232693f0d443d42fa998d1eca3a4fc1f9481a141',
    bytes: 9339,
    evidenceKey:
        'reconciliation/reviews/2026-10-27/toss-event-first/wife/8c40b875-897e-4be8-bc8b-a559835f45f7/af36380eb309cff70080092f14b7d46530e2b6ce262946822c1f8fae0c78eee4/wife-four-order-ui-evidence.json',
    evidenceSha256:
        'af36380eb309cff70080092f14b7d46530e2b6ce262946822c1f8fae0c78eee4',
    evidenceBytes: 21041,
});
const digest = (b) => createHash('sha256').update(b).digest('hex');
const invalid = () => {
    throw Object.assign(
        Error('보존 보고서의 버전·해시·계좌·원문 연결 검증에 실패했습니다.'),
        { status: 409, code: 'REPORT_INTEGRITY_FAILED' }
    );
};
const check = (value) => {
    if (!value) invalid();
};
const text = (value) => typeof value === 'string' && value.length <= 10_000;
const scalar = (value) =>
    typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value);
function plainPanel(panel) {
    return panel.includes('text "')
        ? [...panel.matchAll(/text "([^"\n]*)"/g)].map((m) => m[1]).join('\n')
        : panel;
}
export function verifiedFollowup(
    zip,
    evidenceBytes,
    descriptor = followupCheckpoint
) {
    try {
        check(
            zip.length === descriptor.bytes && digest(zip) === descriptor.sha256
        );
        check(
            evidenceBytes.length === descriptor.evidenceBytes &&
                digest(evidenceBytes) === descriptor.evidenceSha256
        );
        const files = unzipSync(zip, {
            filter: (file) =>
                ['manifest.json', 'four-order-review.v2.json'].includes(
                    file.name
                ) && file.originalSize <= 512_000,
        });
        check(files['manifest.json'] && files['four-order-review.v2.json']);
        const manifest = JSON.parse(
            Buffer.from(files['manifest.json']).toString('utf8')
        );
        const reportBytes = Buffer.from(files['four-order-review.v2.json']);
        const member = manifest.files?.find(
            (f) => f.name === 'four-order-review.v2.json'
        );
        check(
            member?.bytes === reportBytes.length &&
                member.sha256 === digest(reportBytes)
        );
        const report = JSON.parse(reportBytes.toString('utf8')),
            evidence = JSON.parse(evidenceBytes.toString('utf8'));
        check(
            report.schemaVersion === descriptor.version &&
                report.sourceEvidence?.sha256 === descriptor.evidenceSha256 &&
                report.sourceEvidence.objectKey === descriptor.evidenceKey &&
                report.sourceEvidence.bytes === descriptor.evidenceBytes
        );
        check(
            evidence.schemaVersion === 1 &&
                evidence.account === descriptor.accountId &&
                Array.isArray(evidence.files) &&
                evidence.files.length === 9
        );
        const originals = new Map();
        for (const f of evidence.files) {
            check(
                typeof f.name === 'string' &&
                    /^[A-Za-z0-9_.-]+$/.test(f.name) &&
                    !originals.has(f.name) &&
                    typeof f.base64 === 'string' &&
                    f.base64.length <= 140_000
            );
            const bytes = Buffer.from(f.base64, 'base64');
            check(
                bytes.toString('base64') === f.base64 &&
                    bytes.length === f.bytes &&
                    digest(bytes) === f.sha256
            );
            originals.set(f.name, bytes.toString('utf8'));
        }
        const verification = JSON.parse(
            originals.get('verification-results.json')
        );
        const accountCheck = JSON.parse(originals.get('account-check.json'));
        // account-check is retained as evidence; the captured masked account must agree throughout.
        check(
            accountCheck?.matches === true &&
                accountCheck.accountLast4 === verification.account?.last4 &&
                accountCheck.expectedLast4 === verification.account?.last4 &&
                verification.account?.label === descriptor.accountId &&
                /^\d{4}$/.test(verification.account.last4)
        );
        check(
            Array.isArray(verification.rows) &&
                verification.rows.length === 4 &&
                Array.isArray(report.orders) &&
                report.orders.length === 4
        );
        check(
            Array.isArray(report.remainingEightRows) &&
                report.remainingEightRows.length === 8
        );
        const ids = new Set(),
            orderKeys = new Set(),
            observations = [];
        for (const r of verification.rows) {
            const selection = JSON.parse(
                originals.get(r.selectionEvidenceFile)
            );
            const panelFile = originals.get(r.detailPanelEvidenceFile);
            check(text(panelFile));
            const panel = r.detailPanelEvidenceFile.endsWith('.json')
                ? JSON.parse(panelFile).panelText
                : panelFile;
            check(
                text(panel) &&
                    scalar(r.requestedQuantity) &&
                    scalar(r.requestedPurchaseAmountUsd)
            );
            const url = new URL(selection.detailUrl),
                q = Object.fromEntries(url.searchParams);
            check(
                url.origin === 'https://www.tossinvest.com' &&
                    url.pathname === '/account/orders' &&
                    selection.detailUrl === r.detailUrl
            );
            check(
                selection.accountLast4 === verification.account.last4 &&
                    q.orderDate === r.orderDate &&
                    q.detailMarket === 'us' &&
                    /^\d+$/.test(q.orderNo) &&
                    text(q.orderId) &&
                    q.orderId.length > 0
            );
            for (const [key, value] of Object.entries(r.urlFields || {}))
                check(
                    q[key] === value &&
                        selection.explicitUrlFields?.[key] === value
                );
            check(!ids.has(q.orderId));
            ids.add(q.orderId);
            const key = JSON.stringify([r.orderDate, q.orderNo]);
            check(!orderKeys.has(key));
            orderKeys.add(key);
            check(
                selection.selectedRow?.includes(r.symbol) &&
                    selection.selectedRow.includes(
                        r.requestedQuantity + '주'
                    ) &&
                    selection.selectedRow.includes(
                        '$' + r.requestedPurchaseAmountUsd
                    )
            );
            const plain = plainPanel(panel);
            const quantityValue = plain.match(
                /구매\s*수량\s*(\d+(?:\.\d+)?)주[ \t]*(?=\n|$)/
            );
            const amountValue = plain.match(
                /총\s*구매\s*금액\s*\$[ \t]*(\d+(?:\.\d+)?)[ \t]*(?=\n|$)/
            );
            check(
                plain.includes(r.symbol) &&
                    quantityValue?.[1] === r.requestedQuantity &&
                    amountValue?.[1] === r.requestedPurchaseAmountUsd
            );

            const matches = report.orders.filter(
                (o) =>
                    o.account === descriptor.accountId &&
                    o.symbol === r.symbol &&
                    o.orderDate === r.orderDate &&
                    String(o.orderNo) === q.orderNo &&
                    o.capturedUrlOrderId === q.orderId &&
                    o.capturedDetailUrl === selection.detailUrl &&
                    o.quantity === r.requestedQuantity &&
                    o.purchaseAmountUsd === r.requestedPurchaseAmountUsd &&
                    o.uiSelectionUrlPanelVerified === true
            );
            check(matches.length === 1 && r.individualFillIdShown === false);
            const order = matches[0];
            check(
                Array.isArray(order.evidenceFiles) &&
                    order.evidenceFiles.includes(r.selectionEvidenceFile) &&
                    order.evidenceFiles.includes(r.detailPanelEvidenceFile) &&
                    order.evidenceFiles.every((name) => originals.has(name))
            );
            const time = plainPanel(panel).match(
                /구매\s*시간\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(\d{1,2}):(\d{2})/
            );
            check(time);
            const purchasedUiAt = `${time[1]}-${time[2].padStart(2, '0')}-${time[3].padStart(2, '0')} ${time[4].padStart(2, '0')}:${time[5]}`;
            check(order.purchaseTimeUi === purchasedUiAt);
            const id = `followup:${descriptor.sha256}:${descriptor.accountId}:${r.orderDate}:${q.orderNo}`;
            observations.push({
                id,
                sourceId: id,
                accountId: descriptor.accountId,
                kind: 'TOSS_ORDER',
                type: 'BUY',
                symbol: r.symbol,
                location: `보존 체크포인트 / ${r.selectionEvidenceFile} / ${r.detailPanelEvidenceFile}`,
                capture:
                    '서버 해시 검증 원문 발췌 · 관측 ID이며 영구 금융사건 ID 아님',
                hasOriginal: true,
                rawText: panel,
                values: {
                    date: r.orderDate,
                    quantity: r.requestedQuantity,
                    purchaseUsd: r.requestedPurchaseAmountUsd,
                    purchasedUiAt,
                },
                targetId: null,
                uiLinkVerified: true,
            });
        }
        return {
            report,
            observations,
            reportSha256: member.sha256,
            evidenceFileCount: originals.size,
        };
    } catch (error) {
        if (error.code === 'REPORT_INTEGRITY_FAILED') throw error;
        invalid();
    }
}
export function followupResponse(
    verified,
    accountId,
    workbookSha256,
    descriptor = followupCheckpoint
) {
    const { report, observations } = verified;
    check(
        accountId === descriptor.accountId &&
            observations.every((o) => o.accountId === accountId)
    );
    const cases = new Set();
    const remainingEightRows = report.remainingEightRows.map((r) => {
        check(
            text(r.caseId) &&
                !cases.has(r.caseId) &&
                /^[A-Z][A-Z0-9.-]{0,11}$/.test(r.symbol || '') &&
                /^\d{4}-\d{2}-\d{2}$/.test(r.referenceDate || '') &&
                typeof r.canonicalRowId === 'string' &&
                digest(r.canonicalRowId.split(':')[0]) === workbookSha256
        );
        cases.add(r.caseId);
        for (const field of [
            'category',
            'availableFact',
            'missingEvidence',
            'nextAction',
        ])
            check(text(r[field]));
        return Object.fromEntries(
            [
                'caseId',
                'symbol',
                'referenceDate',
                'category',
                'availableFact',
                'missingEvidence',
                'nextAction',
            ].map((k) => [k, r[k]])
        );
    });
    check(
        report.orders.every((o) => {
            const reference = report.remainingEightRows.find(
                (r) => r.caseId === o.caseId
            );
            return (
                cases.has(o.caseId) &&
                reference.symbol === o.symbol &&
                reference.referenceDate === o.orderDate
            );
        })
    );
    return {
        schemaVersion: 2,
        accountId,
        section: 'followup',
        runId: `followup:${descriptor.sha256}`,
        snapshotAt: report.reviewedAt,
        readOnly: true,
        adoptionAvailable: false,
        integrity: {
            verified: true,
            checkpointSha256: descriptor.sha256,
            reportSha256: verified.reportSha256,
            evidenceSha256: descriptor.evidenceSha256,
            evidenceFileCount: verified.evidenceFileCount,
        },
        provenance: {
            label: '비공개 R2 · 보존 체크포인트와 주문 원문 해시 검증',
        },
        orders: report.orders.map((o) => ({
            caseId: o.caseId,
            account: o.account,
            quantity: o.quantity,
            purchaseAmountUsd: o.purchaseAmountUsd,
            orderNo: o.orderNo,
            uiSelectionUrlPanelVerified: true,
            exactPriorOpaqueIdMatch: o.exactPriorOpaqueIdMatch,
            evidenceFiles: o.evidenceFiles,
        })),
        observations,
        remainingEightRows,
        limitations: [
            '개별 체결 ID 미확인',
            '주문과 정산의 직접 ID 연결 미확인',
            'URL orderId 영속성 미확정',
            '관측 중복과 경제적 사건 중복은 다름 · 주문/정산 합산 없음',
            '목록↔상세 연결 확인은 시트 매핑 승인 아님',
        ],
    };
}
