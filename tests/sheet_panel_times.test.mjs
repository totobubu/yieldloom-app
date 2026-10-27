import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPanelSourceTimeItems } from '../lib/sheet-panel-times.js';
import {
    indexSourceTimes,
    sourceTimesForRow,
    validSourceTimeItems,
} from '../lib/sheet-source-times.js';
const raw = (quantity) =>
    `QDTE · 주식 모으기\n구매 완료\n구매 수량\n${quantity}주\n총 구매 금액$3.5211월 26일 출금\n예약 시간2025년 5월 30일 20:30\n주문 시간2025년 5월 30일 22:30\n구매 시간2025년 5월 30일 23:16`;
const project = (records) =>
    buildPanelSourceTimeItems({
        records,
        accountId: 'wife',
        archiveKey: 'collected/synthetic/wife/batch.json',
        sha256: 'a'.repeat(64),
    });
test('actual displayed date is used, never the selected order date or ID', () => {
    const records = [
        {
            date: '2025-05-31',
            sourceLedgerKey: 'selected-other-order',
            accountRole: 'wife',
            status: 'detail-visible',
            raw: raw(0.02),
        },
    ];
    const before = structuredClone(records);
    const [item] = project(records);
    assert.equal(item.eventDate, '2025-05-30');
    assert.equal(item.directIdentityVerified, false);
    assert.equal(
        item.times.find((t) => t.role === 'executionDateTime').value,
        '2025-05-30 23:16'
    );
    assert.equal(item.times[0].timeZone, null);
    assert.equal(Object.hasOwn(item, 'amount'), false);
    assert.deepEqual(records, before);
});
test('same displayed minute and sheet aggregation never collapse separate panel records', () => {
    const records = [0.02, 0.19].map((q) => ({
        accountRole: 'wife',
        status: 'detail-visible',
        raw: raw(q),
    }));
    const items = project(records);
    assert.equal(validSourceTimeItems(items, 'wife'), true);
    assert.equal(
        sourceTimesForRow(
            {
                accountId: 'wife',
                type: 'BUY',
                symbol: 'QDTE',
                date: '2025-05-30',
                quantity: 0.21,
            },
            indexSourceTimes(items)
        ).length,
        2
    );
    assert.notEqual(items[0].id, items[1].id);
});
test('uncertain or another account panel is not projected', () => {
    assert.deepEqual(
        project([
            { status: 'uncertain', raw: raw(1) },
            { accountRole: 'husband', status: 'detail-visible', raw: raw(1) },
        ]),
        []
    );
});
