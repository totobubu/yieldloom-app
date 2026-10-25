// Local synthetic authentication + in-memory Firestore only. No user browser or remote writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import { numericFields } from '../lib/sheet-ledger.js';
import { memoryDb } from './helpers/sheet-memory-db.mjs';
import { submitObservationBatch } from '../lib/sheet-observation-store.js';

const row = {
    ...Object.fromEntries(numericFields.map((f) => [f, null])),
    id: 'sheet:buy',
    accountId: 'wife',
    type: 'BUY',
    date: '2025-02-03',
    symbol: 'TEST',
    quantity: 1,
    purchaseUsd: 10,
    sourceValues: { date: '2025-02-03', quantity: 1, purchaseUsd: 10 },
    source: { sheet: '妻', row: 10 },
    fieldStatus: {},
    evidence: [],
    status: '미확인',
    fundingSource: '미확인',
    reinvested: null,
    needsReview: true,
};
const db = memoryDb([
    ['sheetTrialLedgers/browser-admin', { version: 1, pageCount: 1 }],
    ['sheetTrialLedgers/browser-admin/pages/0', { rows: [row] }],
]);
const { store } = db;
const handler = sheetLedgerHandler({
    database: () => db,
    verify: async () => ({
        uid: 'browser-admin',
        email: 'jomalkeun@gmail.com',
        email_verified: true,
    }),
    fetchImpl: async () => {
        throw new Error('Google must not be contacted');
    },
    now: () => new Date('2026-10-25T00:00:00Z'),
});
const observations = [
    {
        kind: 'PDF',
        accountId: 'wife',
        sourceId: 'pdf-order',
        type: 'BUY',
        symbol: 'TEST',
        location: '합성 PDF 1행',
        values: { date: row.date, quantity: 1, purchaseUsd: 10.02 },
    },
    {
        kind: 'TOSS_ORDER',
        accountId: 'wife',
        sourceId: 'web-order',
        type: 'BUY',
        symbol: 'TEST',
        location: '합성 웹 주문 1',
        values: {
            date: row.date,
            quantity: 1,
            purchaseUsd: 10.01,
            executedAt: '2025-02-03 16:10',
            fxFeeKrw: 7,
            usedKrw: 30007,
            fxFeeIncluded: true,
        },
    },
    {
        kind: 'TOSS_TRANSACTION',
        accountId: 'wife',
        sourceId: 'withdrawal',
        type: 'WITHDRAWAL',
        symbol: '',
        location: '합성 출금 상세',
        values: {
            date: row.date,
            transactionAt: '2025-02-03 16:11:12.345',
            cashKrw: 200,
        },
    },
    {
        kind: 'TOSS_EXPECTED_DIVIDEND',
        accountId: 'wife',
        sourceId: 'expected',
        type: 'DIVIDEND',
        symbol: 'TEST',
        location: '합성 예상 배당',
        values: { date: '2027-01-01', netDividendUsd: 1 },
    },
];
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
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'warning' && m.text().includes('[Vue warn]'))
            errors.push(m.text());
    });
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref({uid:'browser-admin',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'synthetic'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true;`,
        })
    );
    await page.route('**/api/sheet-ledger*', async (route) => {
        requests.push(route.request().method());
        assert.equal(
            route.request().headers().authorization,
            'Bearer synthetic'
        );
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
                body: route.request().postDataJSON(),
                query: Object.fromEntries(
                    new URL(route.request().url()).searchParams
                ),
            },
            response
        );
        await route.fulfill({ status: response.code, json: response.payload });
    });
    await page.goto(
        `${process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5181'}/admin/sheet-ledger`
    );
    const panel = page.getByRole('region', { name: '출처 대조와 원금 검증' });
    await page
        .getByRole('heading', { name: '출처 대조 · 원금 검증' })
        .waitFor();
    await page.getByRole('cell', { name: 'TEST', exact: true }).waitFor();
    assert.equal(requests.length, 1);
    await panel
        .getByText('대조 자료 제출 · 실제 웹 자동수집과 구분', { exact: true })
        .click();
    await panel.getByLabel('대조 자료 JSON').fill(JSON.stringify(observations));
    await panel
        .getByRole('button', { name: '대조 자료 미리보기', exact: true })
        .click();
    await panel.getByText(/신규 4건/).waitFor();
    assert.equal(
        store.get('sheetTrialLedgers/browser-admin/pages/0').rows[0]
            .purchaseUsd,
        10
    );
    await panel
        .getByRole('button', { name: '대조 자료만 저장', exact: true })
        .click();
    await panel
        .getByRole('cell', { name: '합성 웹 주문 1', exact: true })
        .waitFor();
    assert.equal(
        store.get('sheetTrialLedgers/browser-admin/pages/0').rows[0]
            .purchaseUsd,
        10
    );
    await panel
        .getByRole('row')
        .filter({
            has: page.getByRole('cell', {
                name: '합성 웹 주문 1',
                exact: true,
            }),
        })
        .getByRole('button', { name: '출처 비교' })
        .click();
    await panel.getByText('출처 간 불일치', { exact: false }).first().waitFor();
    await panel
        .getByLabel('관리자 확인 근거')
        .fill('합성 주문 상세 대조 후 선택값만 채택');
    await panel
        .getByRole('button', {
            name: '선택한 값만 시험 장부에 채택',
            exact: true,
        })
        .click();
    await page
        .getByText(
            '시험 장부의 관리자 검토를 반영했습니다. 원본 자료는 유지됩니다.',
            { exact: true }
        )
        .waitFor();
    assert.equal(
        store.get('sheetTrialLedgers/browser-admin/pages/0').rows[0]
            .purchaseUsd,
        10.01
    );
    assert.equal(
        store.get('sheetTrialLedgers/browser-admin/pages/0').rows[0]
            .sourceValues.purchaseUsd,
        10
    );
    await page
        .locator('.ledger-list')
        .getByRole('columnheader', { name: '체결 일시', exact: true })
        .waitFor();
    await panel
        .getByRole('row')
        .filter({
            has: page.getByRole('cell', {
                name: '합성 출금 상세',
                exact: true,
            }),
        })
        .getByRole('button', { name: '출처 비교' })
        .click();
    await panel.getByLabel('관리자 확인 근거').fill('합성 실제 출금 상세 확인');
    await panel
        .getByRole('button', {
            name: '선택한 값만 시험 장부에 채택',
            exact: true,
        })
        .click();
    await panel
        .getByRole('button', { name: '입출금 분류 확인', exact: true })
        .waitFor();
    await panel
        .getByRole('combobox', { name: '이동 범위', exact: true })
        .click();
    await page
        .getByRole('option', { name: '외부 입출금', exact: true })
        .click();
    await panel
        .getByRole('combobox', { name: '자금 출처', exact: true })
        .click();
    await page
        .getByRole('option', { name: '배당 이익 활용', exact: true })
        .click();
    const classifiedResponse = page.waitForResponse(
        (res) =>
            res.url().includes('/api/sheet-ledger') &&
            res.request().postDataJSON()?.action === 'classify-cash'
    );
    await panel
        .getByRole('button', { name: '입출금 분류 확인', exact: true })
        .click();
    await classifiedResponse;
    const saved = store
        .get('sheetTrialLedgers/browser-admin/pages/0')
        .rows.find((r) => r.type === 'WITHDRAWAL');
    // Wait for the response to finish before checking the in-memory server state.
    await page
        .getByRole('button', { name: '새로고침', exact: true })
        .waitFor({ state: 'visible' });
    assert.equal(saved.capital?.origin, 'DIVIDEND_PROFIT');
    await panel
        .getByRole('row')
        .filter({
            has: page.getByRole('cell', {
                name: '합성 예상 배당',
                exact: true,
            }),
        })
        .getByRole('button', { name: '출처 비교' })
        .click();
    assert(
        await panel
            .getByRole('button', {
                name: '배당 근거를 기존 입금에 연결',
                exact: true,
            })
            .isDisabled()
    );
    assert.equal(
        store.get('sheetTrialLedgers/browser-admin/pages/0').rows.length,
        2
    );
    const beforeFilter = requests.length;
    await page
        .getByRole('combobox', { name: '계좌 필터', exact: true })
        .click();
    await page.getByRole('option', { name: '남편', exact: true }).click();
    assert.equal(requests.length, beforeFilter);
    await page.locator('.p-select-overlay').last().waitFor({ state: 'hidden' });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
        await panel
            .getByRole('heading', { name: '출처 대조 · 원금 검증' })
            .isVisible()
    );
    await page.screenshot({ path: '/tmp/yieldloom-trial-mobile.png' });
    assert(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 2
        ),
        JSON.stringify(
            await page.evaluate(() => ({
                width: window.innerWidth,
                scroll: document.documentElement.scrollWidth,
                containers: [
                    ...document.querySelectorAll(
                        '.p-datatable-table-container'
                    ),
                ].map((e) => ({
                    w: e.clientWidth,
                    s: e.scrollWidth,
                    h: e.clientHeight,
                    sh: e.scrollHeight,
                    x: getComputedStyle(e).overflowX,
                })),
                outside: [...document.querySelectorAll('body *')]
                    .filter(
                        (e) =>
                            !e.closest('main') &&
                            e.getBoundingClientRect().right >
                                window.innerWidth + 2
                    )
                    .slice(0, 5)
                    .map((e) => ({
                        tag: e.tagName,
                        cls: e.className,
                        w: e.getBoundingClientRect().width,
                    })),
                wide: [...document.querySelectorAll('main *')]
                    .filter((e) => !e.closest('.p-datatable'))
                    .filter(
                        (e) =>
                            e.getBoundingClientRect().right >
                            window.innerWidth + 3
                    )
                    .slice(0, 8)
                    .map((e) => ({
                        tag: e.tagName,
                        cls: e.className,
                        width: e.getBoundingClientRect().width,
                    })),
            }))
        )
    );
    // Exercise real cursor routes and document-window rendering with >2,000 synthetic observations.
    const root = db.doc('sheetTrialLedgers/browser-admin');
    for (let offset = 0; offset < 2400; offset += 100) {
        const added = Array.from({ length: 100 }, (_, i) => ({
            ...observations[1],
            sourceId: `bulk-${String(offset + i).padStart(4, '0')}`,
            location: `합성 대량 상세 ${offset + i}`,
        }));
        await submitObservationBatch(db, root, {
            accountId: 'wife',
            batchId: `bulk-${offset}`,
            checkpoint: { sourceHash: 'b'.repeat(64), offset, count: 100 },
            observations: added,
        });
    }
    const readsBeforeReload = requests.length;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await panel.getByText('대조 자료 목록 · 2404건', { exact: true }).waitFor();
    const readsAfterReload = requests.length;
    assert.equal(readsAfterReload - readsBeforeReload, 27); // canonical 1 + 25 observation pages + version 1; no empty legacy transition request
    const listDetails = panel.locator('details').filter({
        has: page.locator('summary').filter({ hasText: '대조 자료 목록' }),
    });
    if (!(await listDetails.evaluate((e) => e.open)))
        await listDetails.locator('summary').click();
    assert.equal(await listDetails.locator('.p-paginator').count(), 0);
    assert.equal(await listDetails.locator('tbody tr').count(), 100);
    await listDetails
        .getByRole('button', { name: '대조 자료 끝으로', exact: true })
        .focus();
    await page.keyboard.press('Enter');
    await listDetails
        .getByRole('cell', { name: '합성 대량 상세 2399', exact: true })
        .waitFor();
    await listDetails.getByLabel('대조 자료 검색').fill('bulk-2399');
    await panel.getByText('대조 자료 목록 · 1건', { exact: true }).waitFor();
    assert.equal(await listDetails.locator('tbody tr').count(), 1);
    assert.equal(requests.length, readsAfterReload); // full-dataset search is local, not first-page-only
    assert.equal(
        await listDetails
            .locator('.p-datatable-table-container')
            .evaluate((e) => e.scrollHeight > e.clientHeight + 2),
        false
    );
    assert.deepEqual(errors, []);
    console.log(
        'Passed: synthetic three-source comparison, selective acceptance, dividend-funded withdrawal, forecast exclusion, account filter, mobile/dark; remote writes=0.'
    );
} finally {
    await browser.close();
}
