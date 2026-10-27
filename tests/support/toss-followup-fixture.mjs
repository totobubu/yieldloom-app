// Fictional records only. Never load the private R2 reports into repository tests.
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
const hash = (b) => createHash('sha256').update(b).digest('hex');
export function followupFixture({
    corruptMember = false,
    crossAccount = false,
    mixedPanel = false,
    wrongWorkbook = false,
    duplicateOrderId = false,
    reportVersion = 2,
} = {}) {
    const descriptor = {
        accountId: 'wife',
        version: 2,
        key: 'fixture/followup.zip',
        evidenceKey: 'fixture/evidence.json',
    };
    const originals = new Map();
    const account = { label: crossAccount ? 'husband' : 'wife', last4: '0000' };
    originals.set(
        'account-check.json',
        JSON.stringify({
            accountLast4: '0000',
            expectedLast4: '0000',
            matches: true,
        })
    );
    const orders = [],
        observed = [];
    for (let i = 0; i < 4; i++) {
        const quantity = String(i + 2),
            amount = ['9.12', '8', '11.15', '16.20'][i],
            date = '2025-02-03',
            orderNo = String(i + 1),
            orderId = duplicateOrderId
                ? 'fictional-order'
                : `fictional-order-${i}`;
        const fields = {
            market: 'all',
            from: 'executed',
            orderDate: date,
            orderNo,
            orderId,
            orderType: 'regular',
            detailMarket: 'us',
        };
        const url =
            'https://www.tossinvest.com/account/orders?' +
            new URLSearchParams(fields);
        const file = `order-${i}.json`,
            panelFile = i < 2 ? file : `panel-${i}.txt`;
        const panel = `TEST\n구매 수량\n${mixedPanel && i === 0 ? '999' : quantity}주\n총 구매 금액\n$${amount}\n구매 시간\n2025년 2월 3일 12:34`;
        const selection = {
            accountLast4: '0000',
            selectedRow: `TEST ${quantity}주 $${amount}`,
            detailUrl: url,
            explicitUrlFields: fields,
            ...(i < 2 ? { panelText: panel } : {}),
        };
        originals.set(file, JSON.stringify(selection));
        if (i >= 2) originals.set(panelFile, panel);
        observed.push({
            symbol: 'TEST',
            orderDate: date,
            requestedQuantity: quantity,
            requestedPurchaseAmountUsd: amount,
            urlFields: fields,
            detailUrl: url,
            selectionEvidenceFile: file,
            detailPanelEvidenceFile: panelFile,
            individualFillIdShown: false,
        });
        orders.push({
            caseId: i < 2 ? 'case-04' : 'case-14',
            account: 'wife',
            symbol: 'TEST',
            orderDate: date,
            orderNo,
            capturedUrlOrderId: orderId,
            capturedDetailUrl: url,
            quantity,
            purchaseAmountUsd: amount,
            uiSelectionUrlPanelVerified: true,
            exactPriorOpaqueIdMatch: i < 2 ? null : false,
            purchaseTimeUi: '2025-02-03 12:34',
            evidenceFiles: [file, panelFile],
        });
    }
    originals.set(
        'verification-results.json',
        JSON.stringify({ schemaVersion: 1, account, rows: observed })
    );
    originals.set('sha256-manifest.json', '{}');
    const evidence = Buffer.from(
        JSON.stringify({
            schemaVersion: 1,
            account: 'wife',
            files: [...originals].map(([name, value]) => ({
                name,
                bytes: Buffer.byteLength(value),
                sha256: hash(value),
                base64: Buffer.from(value).toString('base64'),
            })),
        })
    );
    descriptor.evidenceSha256 = hash(evidence);
    descriptor.evidenceBytes = evidence.length;
    const report = {
        schemaVersion: reportVersion,
        reviewedAt: '2026-01-01T00:00:00Z',
        sourceEvidence: {
            objectKey: descriptor.evidenceKey,
            sha256: descriptor.evidenceSha256,
            bytes: evidence.length,
        },
        orders,
        remainingEightRows: Array.from({ length: 8 }, (_, i) => ({
            caseId:
                i === 3 ? 'case-04' : i === 7 ? 'case-14' : `fixture-case-${i}`,
            symbol: 'TEST',
            referenceDate: '2025-02-03',
            canonicalRowId: `${wrongWorkbook ? 'another-workbook' : 'fictional-workbook'}:1:${i}:BUY:TEST`,
            category:
                i % 2
                    ? 'different_candidate_or_aggregation_scope'
                    : 'possible_display_precision_difference',
            availableFact: '합성 수량/금액 차이',
            missingEvidence: '합성 기록 범위',
            nextAction: '시트 참고 연결 보류',
        })),
    };
    const reportBytes = Buffer.from(JSON.stringify(report));
    const manifest = {
        files: [
            {
                name: 'four-order-review.v2.json',
                bytes: reportBytes.length,
                sha256: corruptMember ? '0'.repeat(64) : hash(reportBytes),
            },
        ],
    };
    const zip = Buffer.from(
        zipSync({
            'manifest.json': strToU8(JSON.stringify(manifest)),
            'four-order-review.v2.json': reportBytes,
        })
    );
    descriptor.sha256 = hash(zip);
    descriptor.bytes = zip.length;
    return {
        descriptor,
        zip,
        evidence,
        report,
        workbookSha256: hash('fictional-workbook'),
    };
}
