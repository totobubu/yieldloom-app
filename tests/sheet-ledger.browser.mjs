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
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    const errors = [],
        requests = [];
    let expiredGoogle = false,
        holdPreview = false,
        releasePreview,
        previewStarted;
    const previewReady = new Promise((resolve) => {
        previewStarted = resolve;
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (message) => {
        if (
            message.type() === 'warning' &&
            message.text().includes('[Vue warn]')
        )
            errors.push(message.text());
    });
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref({uid:'fixture',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'fixture-token'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true; window.__replaceSameUser=()=>{firebaseUser.value={...firebaseUser.value};};`,
        })
    );
    await page.route('**/api/sheet-ledger', async (route) => {
        requests.push(route.request().method());
        const body = route.request().postDataJSON();
        if (body?.action === 'preview' && expiredGoogle) {
            expiredGoogle = false;
            return route.fulfill({
                status: 401,
                json: { error: 'expired', code: 'google_reconnect_required' },
            });
        }
        if (body?.action === 'preview' && holdPreview)
            await new Promise((resolve) => {
                releasePreview = resolve;
                previewStarted();
            });
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
    await page.route('**/src/services/sheetLedger.js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: service.replace(
                "import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';",
                `class GoogleAuthProvider {addScope(){} setCustomParameters(){} static credentialFromResult(){return {accessToken:'fixture-token'}}} async function reauthenticateWithPopup(){window.__googleCalls=(window.__googleCalls||0)+1; if(window.__denyGoogle) throw {code:'auth/popup-closed-by-user'}; window.__replaceSameUser(); await Promise.resolve(); return {};}`
            ),
        })
    );
    await page.goto(
        `${process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5173'}/admin/sheet-ledger`
    );
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
    await page.getByRole('combobox', { name: '계좌 필터' }).click();
    await page.getByRole('option', { name: '남편', exact: true }).click();
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
    const urlField = page.getByLabel('시트 URL', { exact: true });
    const originalUrl = await urlField.inputValue();
    await urlField.fill('not-a-google-sheet');
    await urlField.press('Enter');
    await page
        .getByText('올바른 Google Sheets URL을 입력해 주세요.', { exact: true })
        .waitFor();
    assert.equal(requests.filter((m) => m === 'POST').length, 0);
    await urlField.fill(originalUrl);
    await page.evaluate(() => {
        window.__denyGoogle = true;
    });
    await page
        .getByRole('button', { name: '미리보기 분석', exact: true })
        .click();
    await page
        .getByText('Google 연결이 취소되었습니다. 다시 연결할 수 있습니다.')
        .waitFor();
    await page.evaluate(() => {
        window.__denyGoogle = false;
    });
    holdPreview = true;
    await page
        .getByRole('button', { name: '미리보기 분석', exact: true })
        .click();
    await previewReady;
    await page
        .getByText('구글시트 내용을 읽고 실제 거래를 분석하는 중입니다.', {
            exact: true,
        })
        .waitFor();
    assert(
        await page
            .getByRole('button', { name: '처리 중', exact: true })
            .isDisabled()
    );
    holdPreview = false;
    releasePreview();
    await page
        .getByRole('button', { name: '확인한 신규 거래 저장', exact: true })
        .waitFor();
    assert.equal(
        requests.filter((m) => m === 'GET').length,
        1,
        'same-user reauthentication must not reload or clear the ledger'
    );
    await page
        .getByRole('button', { name: '미리보기 분석', exact: true })
        .click();
    await page
        .getByText('분석 완료: 1개 거래를 미리보기에서 확인해 주세요.')
        .waitFor();
    assert.equal(
        await page.evaluate(() => window.__googleCalls),
        2,
        'cancelled + successful connection; subsequent analysis reuses token'
    );
    expiredGoogle = true;
    await page
        .getByRole('button', { name: '미리보기 분석', exact: true })
        .click();
    await page
        .getByText(
            'Google 연결이 만료되었습니다. 미리보기 분석을 눌러 다시 연결해 주세요.',
            { exact: true }
        )
        .waitFor();
    await page
        .getByRole('button', { name: '미리보기 분석', exact: true })
        .click();
    await page
        .getByText('분석 완료: 1개 거래를 미리보기에서 확인해 주세요.', {
            exact: true,
        })
        .waitFor();
    assert.equal(await page.evaluate(() => window.__googleCalls), 3);
    await page
        .getByRole('button', { name: '확인한 신규 거래 저장', exact: true })
        .click();
    await page.getByText('1개 거래를 시험 계좌에 저장했습니다.').waitFor();
    assert.equal(requests.filter((m) => m === 'POST').length, 5);
    assert.deepEqual(errors, []);
    console.log(
        'Desktop/mobile, Select filters, edit, URL validation, one-click OAuth/preview, delayed response, same-user refresh, token reuse and expired-token recovery: passed. API GET 1, PATCH 1, filter requests 0.'
    );
} catch (error) {
    for (const page of browser.contexts().flatMap((context) => context.pages()))
        console.error((await page.locator('body').innerText()).slice(0, 4000));
    throw error;
} finally {
    await browser.close();
}
