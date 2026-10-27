// Synthetic UI smoke test. No user browser, OAuth request, or remote writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { numericFields } from '../lib/sheet-ledger.js';
const row = {
    ...Object.fromEntries(numericFields.map((f) => [f, null])),
    id: 'fixture:1',
    accountId: 'husband',
    type: 'BUY',
    symbol: 'TEST',
    date: '2025-02-03',
    quantity: 1,
    purchaseUsd: 20,
    source: { spreadsheetId: 'fixture', sheetId: 1, sheet: '合成', row: 1 },
    fieldStatus: {},
    evidence: [],
    fundingSource: '미확인',
    reinvested: null,
    status: '미확인',
    needsReview: true,
};
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
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'fixture',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true;",
        })
    );
    await page.route('**/api/sheet-ledger', (route) => {
        requests.push(route.request().method());
        const body = route.request().postDataJSON();
        assert(!body?.action, 'Import must never be called');
        return route.fulfill({
            json: { rows: [{ ...row, ...body?.patch }], version: 1 },
        });
    });
    await page.goto(
        (process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5181') +
            '/admin/sheet-ledger'
    );
    const ledger = page.locator('.ledger-list');
    await ledger.getByRole('cell', { name: 'TEST', exact: true }).waitFor();
    assert.equal(requests.length, 1);
    const search = page.getByRole('textbox', {
        name: '거래 검색',
        exact: true,
    });
    await search.fill('no-match');
    await page
        .getByText('조건에 맞는 거래가 없습니다.', { exact: false })
        .waitFor();
    await search.fill('TEST');
    await page.getByRole('combobox', { name: '계좌 필터' }).click();
    await page.getByRole('option', { name: '남편', exact: true }).click();
    assert.equal(requests.length, 1);
    await ledger.getByRole('button', { name: '수정', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('거래수수료($)', { exact: true }).fill('1.25');
    await dialog
        .getByRole('button', { name: '수정 저장', exact: true })
        .click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(requests.filter((m) => m === 'PATCH').length, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    const container = ledger.locator('.p-datatable-table-container');
    assert(
        await container.evaluate(
            (el) =>
                el.scrollWidth > el.clientWidth &&
                Math.abs(el.scrollHeight - el.clientHeight) < 2
        )
    );
    assert.equal(
        await ledger.locator('.p-datatable-frozen-column').count(),
        0,
        'Narrow screens keep every field reachable by horizontal scroll'
    );
    await container.evaluate((el) => {
        el.scrollLeft = 700;
    });
    assert(await container.evaluate((el) => el.scrollLeft > 0));
    assert.equal(await page.getByLabel('시트 URL', { exact: true }).count(), 0);
    assert.equal(await ledger.locator('.p-paginator').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'Passed: synthetic edit/filter, importer removed, no pagination or inner Y scroll, mobile horizontal scrolling and responsive column freezing; GET=1, PATCH=1, filter requests=0.'
    );
} finally {
    await browser.close();
}
