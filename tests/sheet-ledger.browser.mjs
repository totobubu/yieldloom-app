// Synthetic auth and API: no Google calls or production writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { numericFields } from '../lib/sheet-ledger.js';

const row = {
    ...Object.fromEntries(numericFields.map((f) => [f, null])),
    id: 'fixture:1',
    accountId: 'husband',
    type: 'BUY',
    symbol: 'YMAX',
    date: '2025-01-04',
    exDate: null,
    paymentDate: null,
    quantity: 10,
    purchaseUsd: 100,
    unitPriceUsd: 10,
    fundingSource: '미확인',
    reinvested: null,
    status: '미확인',
    needsReview: true,
    fieldStatus: {},
    evidence: ['합성 테스트 근거'],
    source: { spreadsheetId: 'fixture', sheetId: 1, sheet: '夫', row: 10 },
};
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
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
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref({uid:'fixture',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'fixture-token'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true;`,
        })
    );
    await page.route('**/api/sheet-ledger', async (route) => {
        requests.push(route.request().method());
        const body = route.request().postDataJSON();
        const result =
            body?.action === 'preview'
                ? {
                      rows: [{ ...row, duplicate: false }],
                      excluded: [
                          { sheet: '夫', row: 11, reason: '미래 예상 매매' },
                      ],
                      warnings: ['비용 미확인'],
                      cutoff: '2026-10-24',
                      fingerprint: 'fixture',
                      version: 2,
                  }
                : body?.action === 'commit'
                  ? { rows: [row], imported: 1, version: 3 }
                  : body?.patch
                    ? { rows: [{ ...row, ...body.patch }], version: 2 }
                    : { rows: [row], version: 1 };
        await route.fulfill({ json: result });
    });
    const service = await readFile(
        new URL('../src/services/sheetLedger.js', import.meta.url),
        'utf8'
    );
    await page.route('**/src/services/sheetLedger.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: service.replace(
                "import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';",
                `class GoogleAuthProvider {addScope(){} setCustomParameters(){} static credentialFromResult(){return {accessToken:'fixture-token'}}} async function reauthenticateWithPopup(){if(window.__denyGoogle) throw {code:'auth/popup-closed-by-user'}; return {};}`
            ),
        })
    );
    await page.goto('http://127.0.0.1:5173/admin/sheet-ledger');
    await page
        .getByRole('heading', { name: '부부 거래 목록', exact: true })
        .waitFor();
    await page.getByRole('cell', { name: 'YMAX', exact: true }).waitFor();
    assert.equal(requests.filter((m) => m === 'GET').length, 1);
    await page
        .getByRole('textbox', { name: '거래 검색', exact: true })
        .fill('no-match');
    await page.getByText('저장된 거래가 없습니다.', { exact: false }).waitFor();
    await page
        .getByRole('textbox', { name: '거래 검색', exact: true })
        .fill('YMAX');
    assert.equal(requests.length, 1);
    await page.getByRole('button', { name: '수정', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('거래수수료($)', { exact: true }).fill('1.25');
    await dialog
        .getByRole('button', { name: '수정 저장', exact: true })
        .click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(requests.filter((m) => m === 'PATCH').length, 1);
    await page.getByRole('alert').getByText('거래를 수정했습니다.').waitFor();
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
        await page
            .getByRole('heading', { name: '부부 거래 목록', exact: true })
            .isVisible()
    );
    assert(
        await page
            .locator('.p-datatable-table-container')
            .first()
            .evaluate((el) => el.scrollWidth > el.clientWidth)
    );
    const before = await page
        .locator('.p-datatable-frozen-column')
        .first()
        .boundingBox();
    await page
        .locator('.p-datatable-table-container')
        .first()
        .evaluate((el) => {
            el.scrollLeft = 700;
        });
    const after = await page
        .locator('.p-datatable-frozen-column')
        .first()
        .boundingBox();
    assert(Math.abs(before.x - after.x) < 2);
    await page.getByRole('button', { name: '수정', exact: true }).click();
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await page.evaluate(() => {
        window.__denyGoogle = true;
    });
    await page
        .getByRole('button', { name: 'Google 읽기 권한 연결', exact: true })
        .click();
    await page
        .getByText('Google 연결이 취소되었습니다. 다시 연결할 수 있습니다.')
        .waitFor();
    await page.evaluate(() => {
        window.__denyGoogle = false;
    });
    await page
        .getByRole('button', { name: 'Google 읽기 권한 연결', exact: true })
        .click();
    await page
        .getByRole('button', { name: '미리보기 분석', exact: true })
        .click();
    await page
        .getByRole('button', { name: '확인한 신규 거래 저장', exact: true })
        .waitFor();
    await page
        .getByRole('button', { name: '확인한 신규 거래 저장', exact: true })
        .click();
    await page.getByText('1개 거래를 시험 계좌에 저장했습니다.').waitFor();
    assert.equal(requests.filter((m) => m === 'POST').length, 2);
    assert.deepEqual(errors, []);
    console.log(
        'Desktop/mobile, light/dark, frozen columns, filtering and edit: passed. API: GET 1, PATCH 1, filters 0.'
    );
} finally {
    await browser.close();
}
