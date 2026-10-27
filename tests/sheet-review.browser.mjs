// Synthetic accounts and an in-memory API only. Never reads or writes user data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import { normalizeObservation } from '../lib/sheet-reconciliation.js';
import { numericFields } from '../lib/sheet-ledger.js';
import { observationHash } from '../lib/sheet-observation-store.js';
import { memoryDb } from './helpers/sheet-memory-db.mjs';

const base = process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5175';
const root = 'sheetTrialLedgers/inline-admin';
const original = normalizeObservation({
    kind: 'TOSS_TRANSACTION',
    sourceId: 'synthetic-fill',
    accountId: 'wife',
    type: 'BUY',
    symbol: 'TEST',
    location: '합성 토스 체결 원문',
    rawText: 'synthetic immutable source',
    values: {
        date: '2025-02-03',
        transactionAt: '2025-02-03 16:10',
        timeZone: 'Asia/Seoul',
        quantity: 2,
        purchaseUsd: 12,
        unitPriceKrw: 16500,
        orderedAt: '2025-02-03 16:08',
        orderAmountUsd: 12,
    },
});
const rows = Array.from({ length: 35 }, (_, i) => ({
    ...Object.fromEntries(numericFields.map((field) => [field, null])),
    id: `sheet:${i}`,
    accountId: 'wife',
    type: 'BUY',
    symbol: i ? `TEST${i}` : 'TEST',
    date: '2025-02-03',
    quantity: 1,
    purchaseUsd: 10,
    transactionAt: '2025-02-03 16:10',
    timeZone: 'Asia/Seoul',
    source: { spreadsheetId: 'synthetic', sheet: '妻', row: i + 1 },
    status: '미확인',
    fieldStatus: {},
    fundingSource: '미확인',
    reinvested: null,
    needsReview: true,
    evidence: [],
}));
const key = observationHash(original.id);
const db = memoryDb([
    [root, { version: 1, pageCount: 1, rowCount: rows.length }],
    [`${root}/pages/0`, { rows }],
    [`${root}/reconciliationAccounts/wife`, { sequence: 1, recordCount: 1 }],
    [
        `${root}/reconciliationAccounts/wife/observations/${key}`,
        {
            observation: original,
            digest: 'immutable',
            sequence: 1,
            reviewVersion: 0,
        },
    ],
]);
const handler = sheetLedgerHandler({
    database: () => db,
    verify: async () => ({
        uid: 'inline-admin',
        email: 'jomalkeun@gmail.com',
        email_verified: true,
    }),
    fetchImpl: async () => {
        throw Error('Google must not be contacted');
    },
    now: () => new Date('2026-10-27T00:00:00Z'),
});
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    const errors = [],
        requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) =>
        route.fulfill({
            status: 403,
            json: { error: 'Synthetic test: no external API' },
        })
    );
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'text/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'inline-admin',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=> 'synthetic'}),authLoading=ref(false),firebaseReady=false,auth=null,db=null,googleProvider=null;export const signedIn=computed(()=>true);",
        })
    );
    await page.route('**/api/sheet-ledger**', async (route) => {
        const body = route.request().postDataJSON();
        requests.push({
            method: route.request().method(),
            action: body?.action,
        });
        const response = {
            setHeader() {},
            status(code) {
                this.code = code;
                return this;
            },
            json(payload) {
                this.payload = payload;
                return this;
            },
        };
        await handler(
            {
                method: route.request().method(),
                body,
                query: Object.fromEntries(
                    new URL(route.request().url()).searchParams
                ),
            },
            response
        );
        await route.fulfill({ status: response.code, json: response.payload });
    });
    await page.goto(`${base}/admin/sheet-ledger`);
    await page.getByRole('button', { name: '확인', exact: true }).click();
    const ledger = page.getByRole('region', { name: '거래 목록', exact: true });
    await ledger
        .getByRole('columnheader', { name: '주문 금액($)', exact: true })
        .waitFor();
    await ledger
        .getByRole('columnheader', { name: '주문 일시', exact: true })
        .waitFor();
    assert.deepEqual(
        (await ledger.getByRole('columnheader').allTextContents())
            .slice(0, 4)
            .map((label) => label.trim()),
        ['계좌', '거래일', '거래시간', '유형']
    );
    assert.equal(
        await ledger
            .getByRole('columnheader', { name: '거래시간', exact: true })
            .count(),
        1
    );
    assert.equal(
        await ledger
            .getByText('구글 시트: 2025-02-03', { exact: true })
            .count(),
        0,
        'Identical date source lines are hidden without changing source data'
    );
    assert.match(
        await page.getByLabel('출처 대조 집계').innerText(),
        /전체 등록 거래 35행/
    );
    const conflictCount = page
        .locator('.summary-grid article')
        .filter({ hasText: '출처 값 충돌 · 미해결' })
        .locator('strong');
    assert.equal(await conflictCount.innerText(), '1행');
    const readCount = requests.length;
    for (const [field, value] of [
        ['수량(주)', '2'],
        ['거래금액($)', '12'],
    ]) {
        await ledger
            .getByRole('combobox', {
                name: `아내 2025-02-03 TEST ${field} 승인값`,
                exact: true,
            })
            .click();
        await page
            .getByRole('option', {
                name: `${value} · 토스 거래내역 · 합성 토스 체결 원문`,
                exact: true,
            })
            .click();
    }
    assert.equal(
        requests.length,
        readCount,
        'Selections add no API or DB requests'
    );
    assert.equal(db.writes.length, 0);
    await page
        .getByRole('button', { name: '선택값 승인·저장', exact: true })
        .click();
    const dialog = page.getByRole('dialog', {
        name: '선택 출처 값 승인',
        exact: true,
    });
    await dialog.waitFor();
    assert(
        await dialog
            .getByRole('button', { name: '관리자 승인·저장', exact: true })
            .isDisabled()
    );
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(db.writes.length, 0);
    await page
        .getByRole('button', { name: '선택값 승인·저장', exact: true })
        .click();
    await dialog
        .getByLabel('관리자 확인 근거', { exact: true })
        .fill('합성 실제 체결 원문에서 수량과 금액을 확인함');
    await dialog
        .getByRole('button', { name: '관리자 승인·저장', exact: true })
        .click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
        requests.filter((item) => item.action === 'resolve-fields').length,
        1
    );
    assert.equal(await conflictCount.innerText(), '0행');
    const approved = db.store.get(`${root}/pages/0`).rows[0];
    assert.equal(approved.purchaseUsd, 12);
    assert.equal(approved.quantity, 2);
    assert.equal(
        approved.unitPriceKrw,
        null,
        'Unselected source fields remain unmodified'
    );
    assert.equal(approved.sourceValues.purchaseUsd, 10);
    assert.equal(approved.review.history[0].actor, 'inline-admin');
    assert.equal(
        db.store.get(`${root}/reconciliationAccounts/wife/observations/${key}`)
            .digest,
        'immutable'
    );
    await page.reload();
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await ledger.locator('.approved').first().waitFor();
    assert.equal(await conflictCount.innerText(), '0행');
    const writes = db.writes.length,
        beforeScroll = requests.length;
    await page.evaluate(() => {
        const region = document.querySelector('.document-list-region');
        const root = document.querySelector('.ledger-dialog-scroll');
        root.scrollTop +=
            region.getBoundingClientRect().top -
            root.getBoundingClientRect().top +
            200;
    });
    const sticky = page.locator('.document-ledger-header');
    await sticky.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
        const dialog = document
            .querySelector('.ledger-dialog-scroll')
            ?.closest('[role="dialog"]');
        const bounds = dialog?.getBoundingClientRect();
        return (
            bounds &&
            Math.abs(bounds.width - innerWidth) < 2 &&
            Math.abs(bounds.height - innerHeight) < 2 &&
            dialog
                .getAnimations()
                .every((animation) => animation.playState !== 'running')
        );
    });
    const alignment = await page.evaluate(() => {
        const header = document
            .querySelector('.ledger-dialog-scroll')
            .closest('.p-dialog')
            .querySelector('.p-dialog-header')
            .getBoundingClientRect();
        const clone = document
            .querySelector('.document-ledger-header')
            .getBoundingClientRect();
        return {
            delta: Math.abs(header.bottom - clone.top),
            headerBottom: header.bottom,
            cloneTop: clone.top,
            scrollRootTop: document
                .querySelector('.ledger-dialog-scroll')
                .getBoundingClientRect().top,
            dialogTop: document
                .querySelector('.ledger-dialog-scroll')
                .closest('.p-dialog')
                .getBoundingClientRect().top,
        };
    });
    assert(
        alignment.delta < 2,
        `Pinned header stays below the dialog header: ${JSON.stringify(alignment)}`
    );
    await ledger.locator('.p-datatable-table-container').evaluate((element) => {
        element.scrollLeft = 650;
    });
    await page.waitForFunction(
        () =>
            document.querySelector('.document-ledger-header').scrollLeft ===
            document.querySelector('.ledger-list .p-datatable-table-container')
                .scrollLeft
    );
    const aligned = await page.evaluate(() => {
        const columns = [0, 1, 2, 3, 8];
        return columns.map((index) => ({
            index,
            delta: Math.abs(
                document
                    .querySelectorAll('.ledger-list thead th')
                    [index].getBoundingClientRect().left -
                    document
                        .querySelectorAll('.document-ledger-header th')
                        [index].getBoundingClientRect().left
            ),
        }));
    });
    assert(
        aligned.every((column) => column.delta < 2),
        `Header alignment: ${JSON.stringify(aligned)}`
    );
    await sticky.locator('th').nth(1).click();
    assert.equal(
        requests.length,
        beforeScroll,
        'Scrolling and sorting reuse the loaded source data'
    );
    assert.equal(db.writes.length, writes);
    await page.screenshot({ path: '/tmp/sheet-review-sticky-desktop.png' });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    assert(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
        )
    );
    await page.evaluate(() => {
        const region = document.querySelector('.document-list-region');
        const root = document.querySelector('.ledger-dialog-scroll');
        root.scrollTop +=
            region.getBoundingClientRect().top -
            root.getBoundingClientRect().top +
            200;
    });
    await sticky.waitFor({ state: 'visible' });
    await page.screenshot({ path: '/tmp/sheet-review-mobile.png' });
    assert.deepEqual(errors, []);
    console.log(
        'PASS: dynamic source fields, explicit per-field Select approval, cancel=0 writes, one atomic save, immutable source/audit, reload persistence, precise unresolved count, pinned/horizontal header alignment, no extra reads on selection/scroll/sort, mobile/dark; production writes=0'
    );
} finally {
    await browser.close();
}
