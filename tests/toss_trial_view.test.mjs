import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildTossTrialRows,
    decimalDifference,
    filterTossTrialRows,
    projectTrialReviewReport,
} from '../lib/toss-trial-view.js';
const observation = (id, extra = {}) => ({
    id,
    sourceId: id,
    accountId: 'wife',
    kind: 'TOSS_ORDER',
    type: 'BUY',
    symbol: 'TEST',
    location: '합성 보존 원문',
    values: {
        date: '2025-02-03',
        quantity: 2,
        purchaseUsd: 9.12,
        orderedAt: '2025-02-03 12:34',
    },
    ...extra,
});
const sheet = (quantity, purchaseUsd) => ({
    id: 'sheet-test',
    accountId: 'wife',
    type: 'BUY',
    symbol: 'TEST',
    date: '2025-02-03',
    quantity,
    purchaseUsd,
});
test('exact observation replay is idempotent, independent same-minute orders stay separate', () => {
    const a = observation('fixture:1'),
        b = observation('fixture:2');
    const first = buildTossTrialRows([a, b]);
    assert.equal(first.length, 2);
    assert.deepEqual(
        buildTossTrialRows([a, b, structuredClone(a), structuredClone(b)]),
        first
    );
    assert(first.every((r) => r.fillIdentityStatus === '개별 체결 ID 미확인'));
});
test('same evidence ID conflicts preserve variants rather than overwrite; null fee differs from zero', () => {
    const a = observation('fixture:1', {
        values: { quantity: 2, commissionUsd: null },
    });
    const b = observation('fixture:1', {
        values: { quantity: 2, commissionUsd: 0 },
    });
    const result = buildTossTrialRows([a, b]);
    assert.equal(result.length, 2);
    assert(result.every((r) => r.identityConflict));
    assert.equal(a.values.commissionUsd, null);
});
test('URL orderId changes cannot merge orders or become a permanent identity', () => {
    const a = observation('capture-a', {
        original: { detailUrl: 'https://example.test/?orderId=opaque-one' },
    });
    const b = observation('capture-b', {
        original: { detailUrl: 'https://example.test/?orderId=opaque-two' },
    });
    const result = buildTossTrialRows([a, b]);
    assert.equal(result.length, 2);
    assert(
        result.every((r) => r.identityStatus.includes('영구 주문/체결 ID 아님'))
    );
});
test('mixed quantity and amount never become a joint match; orders and transactions remain independent', () => {
    const a = observation('a'),
        b = observation('b', {
            values: { date: '2025-02-03', quantity: 3, purchaseUsd: 8 },
        });
    const tx = observation('cash', { kind: 'TOSS_TRANSACTION' });
    const input = [a, b, tx],
        reference = [sheet(2, 8)];
    const before = JSON.stringify([input, reference]);
    const rows = buildTossTrialRows(input, reference);
    assert.equal(rows.length, 3);
    assert(
        rows.every(
            (r) => r.references.length === 1 && !r.references[0].jointMatch
        )
    );
    assert.equal(rows[0].references[0].amountDifference, '1.12');
    assert.equal(JSON.stringify([input, reference]), before);
});
test('no inferred missing amounts, zero fill, greedy date parsing, rounding or event time', () => {
    assert.equal(decimalDifference('1.234567', '1.23'), '0.004567');
    assert.equal(decimalDifference(null, 0), null);
    assert.equal(decimalDifference('1.232025-02-03', 1), null);
    const row = buildTossTrialRows([
        observation('a', { values: { date: '2025-02-03', quantity: 2 } }),
    ])[0];
    assert.equal(row.amountUsd, null);
    assert.equal(row.values.executedAt, undefined);
});
test('full search/sort use all rows, separate accounts and retain numeric precision', () => {
    const rows = buildTossTrialRows(
        Array.from({ length: 250 }, (_, i) =>
            observation(`fixture:${i}`, {
                values: { quantity: i, purchaseUsd: i },
            })
        )
    );
    assert.equal(
        filterTossTrialRows(rows, { search: 'fixture:249' }).length,
        1
    );
    assert.equal(
        filterTossTrialRows(rows, { sort: 'quantity', direction: -1 })[0]
            .quantity,
        249
    );
    assert.equal(filterTossTrialRows(rows, { account: 'husband' }).length, 0);
});
test('report connection confirmation stays separate from mapping approval and fill identity', () => {
    const report = {
        schemaVersion: 2,
        orders: [
            {
                caseId: 'fixture-case',
                account: 'wife',
                quantity: '2',
                purchaseAmountUsd: '9.12',
                orderNo: '2',
                uiSelectionUrlPanelVerified: true,
                exactPriorOpaqueIdMatch: false,
                evidenceFiles: ['fixture.json'],
            },
        ],
        remainingEightRows: [
            {
                caseId: 'fixture-case',
                symbol: 'TEST',
                referenceDate: '2025-02-03',
                availableFact: '합성 불일치',
                missingEvidence: '집계 범위',
                nextAction: '참고 연결 보류',
            },
        ],
    };
    const rows = projectTrialReviewReport(report);
    assert.equal(rows[0].uiLink, '보고서상 연결 확인');
    assert.equal(rows[0].approval, '미승인');
    assert.equal(rows[0].fillIdentity, '개별 체결 ID 미확인');
    assert.equal(rows[0].orders[0].opaqueIdChanged, true);
    assert.throws(() =>
        projectTrialReviewReport({ ...report, schemaVersion: 1 })
    );
});
