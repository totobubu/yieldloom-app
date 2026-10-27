// Fictional data and in-memory API only: no production writes or user browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { numericFields } from '../lib/sheet-ledger.js';
import { createManualRow } from '../lib/sheet-reconciliation.js';

let rows = Array.from({ length: 2285 }, (_, i) => ({
    ...Object.fromEntries(numericFields.map((f) => [f, null])),
    id: `fixture:${i}`,
    accountId: i % 2 ? 'wife' : 'husband',
    type: 'BUY',
    symbol: 'TEST',
    date: '2025-02-03',
    quantity: i + 1,
    purchaseUsd: i + 2,
    source: { spreadsheetId: 'fixture', sheetId: 1, sheet: '합성', row: i + 1 },
    fieldStatus: {},
    evidence: [],
    fundingSource: '미확인',
    reinvested: null,
    status: '미확인',
    needsReview: true,
}));
let version = 1,
    hold = false,
    release,
    submitted;
const pending = new Promise((resolve) => {
    submitted = resolve;
});
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
        }),
        requests = [],
        errors = [];
    const reportRequests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/portfolio-capital?*', async (route) => {
        const query = new URL(route.request().url()).searchParams;
        if (query.get('view') !== 'sheet-reports') return route.fallback();
        const accountId = query.get('accountId'),
            section = query.get('section');
        reportRequests.push({ accountId, section });
        return route.fulfill({
            json: {
                schemaVersion: 1,
                runId: 'synthetic-cloud-review',
                accountId,
                section,
                readOnly: true,
                adoptionAvailable: false,
                snapshotAt: '2026-01-01T00:00:00Z',
                overallStatus: '합성 검증 자료',
                metrics: [
                    {
                        id: 'fictional',
                        label: '합성 수집 건수',
                        value: 4,
                        unit: '대상',
                        note: '금융사건 수 아님',
                    },
                ],
                flows: [],
                holds: [],
                manualEvidence: [],
                limitations: ['합성 자료'],
                nonblocking: {
                    label: '합성 보류',
                    note: '추가 수집 요청 없음',
                },
                items: [
                    {
                        id: 'synthetic-reference',
                        accountId,
                        category: 'blocking',
                        date: '2026-01-01',
                        symbol: 'TEST',
                        label: '합성 비교',
                        reason: '값 채택 없음',
                        existing: [{ field: '합성 기존값', value: 3 }],
                        compared: [{ field: '합성 비교값', value: 4 }],
                        sourceReferences: [],
                        nextAction: '합성 검토',
                    },
                ],
            },
        });
    });
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'fixture',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true;",
        })
    );
    await page.route('**/api/sheet-ledger', async (route) => {
        const body = route.request().postDataJSON();
        requests.push({
            method: route.request().method(),
            action: body?.action,
        });
        if (body?.action) {
            assert.equal(body.action, 'add-manual', 'No Google importer calls');
            try {
                const r = createManualRow(
                    body.data,
                    body.requestId,
                    'fixture',
                    '2026-10-25T00:00:00Z',
                    '2026-10-25'
                );
                if (hold)
                    await new Promise((resolve) => {
                        release = resolve;
                        submitted();
                    });
                rows = [...rows, r];
                version++;
                return route.fulfill({
                    json: { rows, version, addedId: r.id, imported: 1 },
                });
            } catch (e) {
                return route.fulfill({
                    status: 400,
                    json: { error: e.message },
                });
            }
        }
        return route.fulfill({ json: { rows, version } });
    });
    const start = Date.now();
    await page.goto(
        (process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5181') +
            '/admin/sheet-ledger'
    );
    const ledger = page.locator('.ledger-list'),
        bodyRows = ledger.locator('tbody tr');
    await page
        .getByText(/전체 2285건/)
        .first()
        .waitFor();
    await page.waitForFunction(
        () => document.querySelectorAll('.ledger-list tbody tr').length >= 100
    );
    const initialMs = Date.now() - start;
    const cloud = page.getByRole('region', { name: '클라우드 수집·대조 현황' });
    await cloud.getByText('합성 수집 건수', { exact: true }).waitFor();
    assert.equal(reportRequests.length, 1, 'Summary only at initial entry');
    await cloud.getByRole('button', { name: '비교값·원문 위치 확인' }).click();
    await cloud.getByText('합성 기존값', { exact: true }).waitFor();
    assert.equal(
        reportRequests.filter((x) => x.section === 'details').length,
        1
    );
    await cloud.getByRole('button', { name: '비교 근거 접기' }).click();
    await cloud.getByRole('button', { name: '비교값·원문 위치 확인' }).click();
    assert.equal(
        reportRequests.filter((x) => x.section === 'details').length,
        1,
        'Details reused when reopened'
    );
    await cloud.getByRole('button', { name: '비교 근거 접기' }).click();
    console.log(`List initial render ${initialMs}ms`);
    assert(initialMs < 20000);
    assert.equal(await bodyRows.count(), 100);
    assert.equal(await page.getByLabel('시트 URL', { exact: true }).count(), 0);
    assert.equal(await ledger.locator('.p-paginator').count(), 0);
    assert(
        await ledger
            .locator('.p-datatable-table-container')
            .evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight) < 2)
    );
    await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight)
    );
    await page.waitForFunction(
        () =>
            Number(
                document.querySelector('.ledger-list tr[data-ledger-index]')
                    ?.dataset.ledgerIndex
            ) > 0
    );
    const search = page.getByRole('textbox', {
        name: '거래 검색',
        exact: true,
    });
    for (const term of ['fixture:2284', 'no-match', 'fixture:2284']) {
        await search.fill(term);
    }
    await page.getByText(/검색\/필터 1건/).waitFor();
    assert.equal(await bodyRows.count(), 1);
    await search.fill('');
    await ledger
        .getByRole('columnheader', { name: '수량(주)', exact: true })
        .click();
    await ledger
        .getByRole('columnheader', { name: '수량(주)', exact: true })
        .click();
    assert.equal(
        (
            await bodyRows
                .first()
                .locator('td')
                .nth(6)
                .locator('strong')
                .innerText()
        ).trim(),
        '2,285'
    );
    assert.equal(
        requests.length,
        1,
        'Scroll/filter/sort must not fetch DB again'
    );
    await page
        .getByRole('button', { name: '거래 행 추가', exact: true })
        .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    assert.equal(requests.length, 1);
    await page
        .getByRole('button', { name: '거래 행 추가', exact: true })
        .click();
    await dialog.getByLabel('티커', { exact: true }).fill('FAKE');
    await dialog.getByLabel('거래일', { exact: true }).fill('2025-02-03');
    await dialog
        .getByRole('button', { name: '추가 저장', exact: true })
        .click();
    await dialog
        .getByText('남편/아내 계좌를 지정해 주세요.', { exact: true })
        .waitFor();
    await dialog
        .getByRole('combobox', { name: '추가 계좌', exact: true })
        .click();
    await page.getByRole('option', { name: '남편', exact: true }).click();
    await dialog
        .getByLabel('거래 일시 · 표시 정밀도 그대로', { exact: true })
        .fill('2025-02-03 13:42');
    await dialog.getByLabel('거래금액($)', { exact: true }).fill('123');
    hold = true;
    await dialog
        .getByRole('button', { name: '추가 저장', exact: true })
        .click();
    await Promise.race([
        pending,
        new Promise((_, reject) =>
            setTimeout(
                () =>
                    reject(
                        new Error('Manual save did not reach in-memory API')
                    ),
                5000
            )
        ),
    ]);
    const save = dialog.getByRole('button', { name: '추가 저장', exact: true });
    assert(await save.isDisabled());
    await save.evaluate((el) => {
        el.click();
        el.click();
    });
    assert.equal(
        requests.filter((r) => r.action === 'add-manual').length,
        2,
        'One validation error and one save only'
    );
    hold = false;
    release();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(rows.length, 2286);
    assert.equal(rows.at(-1).source.kind, 'manual');
    assert.equal(rows.at(-1).timePrecision, 'minute');
    assert.equal(rows.at(-1).commissionUsd, null);
    await page
        .getByRole('button', { name: '추가한 거래 보기', exact: true })
        .click();
    await ledger.getByRole('cell', { name: 'FAKE', exact: true }).waitFor();
    const id = rows.at(-1).id;
    await page.reload();
    await page
        .getByText(/전체 2286건/)
        .first()
        .waitFor();
    await page
        .getByRole('textbox', { name: '거래 검색', exact: true })
        .fill(id);
    await ledger.getByRole('cell', { name: 'FAKE', exact: true }).waitFor();
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
        await ledger
            .locator('.p-datatable-table-container')
            .evaluate(
                (el) =>
                    el.scrollWidth > el.clientWidth &&
                    Math.abs(el.scrollHeight - el.clientHeight) < 2
            )
    );
    await page
        .getByRole('textbox', { name: '거래 검색', exact: true })
        .fill('');
    await page
        .getByRole('button', { name: '마지막 거래로 이동', exact: true })
        .focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
        (n) =>
            Number(
                [
                    ...document.querySelectorAll(
                        '.ledger-list tr[data-ledger-index]'
                    ),
                ].at(-1)?.dataset.ledgerIndex
            ) ===
            n - 1,
        rows.length,
        { timeout: 60000 }
    );
    await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight)
    );
    await page.getByText('목록 끝', { exact: true }).waitFor();
    assert((await bodyRows.count()) <= 100, 'DOM window must remain bounded');
    assert.equal(requests.filter((r) => r.method === 'GET').length, 2);
    assert.deepEqual(errors, []);
    console.log(
        `Passed: fictional 2285-row document list, initial ${initialMs}ms; progressive document scroll, global sort/filter, full keyboard access, nullable manual add/cancel/validation/double-click/reload, mobile/dark; remote writes=0.`
    );
} finally {
    await browser.close();
}
