// Run with the Vite dev server at CAPITAL_TEST_URL (default localhost:5173).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { capitalHandler } from '../lib/portfolio-capital-handler.js';

const harness = new URL('../.tmp-capital-test.html', import.meta.url);
const layoutSource = await readFile(
    new URL('../src/layouts/ThumbnailLayout.vue', import.meta.url),
    'utf8'
);
const layoutStyles = layoutSource
    .split('<style scoped>')[1]
    .split('</style>')[0];
await writeFile(
    harness,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${layoutStyles}</style><div id="app" class="thumbnail-app"></div><script type="module">
import {createApp,h} from 'vue'; import {createRouter,createMemoryHistory,RouterView} from 'vue-router'; import MyPage from '/src/pages/MyPageView.vue'; import FamilyPage from '/src/pages/FamilyPortfolioView.vue';
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:new URLSearchParams(location.search).has('family')?FamilyPage:MyPage},{path:'/login',component:{template:'<p>login</p>'}}]});
createApp({render:()=>h(RouterView)}).use(router).mount('#app');</script></html>`
);
const trade = {
    id: 'T',
    type: 'buy',
    rawType: '구매',
    date: '20261015',
    quantity: 1,
    currency: 'USD',
    amount: 140000,
    settlementAmount: 140140,
    nativeAmount: 100,
    nativeSettlementAmount: 100.1,
    exchangeRate: 1400,
};
const records = new Map([
    ['portfolios/owner/assets/A/transactions/T', trade],
    [
        'portfolios/owner/cashEntries/E',
        {
            date: trade.date,
            currency: 'KRW',
            amount: 42140,
            exchangeRate: 1400,
            rawType: '환전원화출금',
            suggestedKind: 'exchange',
            source: 'toss-pdf',
        },
    ],
    [
        'portfolios/owner/cashEntries/D',
        {
            date: trade.date,
            currency: 'KRW',
            amount: 1000000,
            rawType: '원화입금',
            suggestedKind: 'external_deposit',
            source: 'toss-pdf',
        },
    ],
]);
const snap = (path) => ({
    id: path.split('/').at(-1),
    exists: records.has(path),
    data: () => records.get(path),
});
const db = {
    doc: (path) => ({ path, get: async () => snap(path) }),
    collection: (path) => {
        const get = async (field, value) => ({
            docs: [...records.keys()]
                .filter(
                    (k) =>
                        k.startsWith(path + '/') &&
                        !k.slice(path.length + 1).includes('/') &&
                        (!field ||
                            field
                                .split('.')
                                .reduce(
                                    (v, key) => v?.[key],
                                    records.get(k)
                                ) === value)
                )
                .map(snap),
        });
        return {
            get: () => get(),
            where: (field, op, value) => ({ get: () => get(field, value) }),
        };
    },
    runTransaction: async (fn) => {
        const writes = [];
        await fn({
            get: async (r) => snap(r.path),
            set: (r, d) => writes.push([r.path, d]),
        });
        for (const [path, d] of writes) records.set(path, d);
    },
};
const handler = capitalHandler({
    verify: async () => ({ uid: 'owner' }),
    database: () => db,
    timestamp: () => null,
});
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/src/services/firebaseClient.js*', (route) =>
        route.fulfill({
            contentType: 'text/javascript',
            body: `import {ref} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref({uid:'owner',email:'test@example.com',getIdToken:async()=> 'test'}); export const authLoading=ref(false);`,
        })
    );
    await page.route('**/src/services/portfolio.js*', (route) =>
        route.fulfill({
            contentType: 'text/javascript',
            body: `import {summarizePortfolio} from '/src/services/portfolioSummary.js'; export async function loadPortfolioDashboard(){return summarizePortfolio([{id:'A',symbol:'TEST',name:'검증 종목',portfolioPriority:'current',holdingShares:1,transactions:[${JSON.stringify(trade)}]}]);} export const commitTossStatement=async()=>({}); export const previewTossStatement=async()=>({}); export const refreshTossStatementReview=async()=>({});`,
        })
    );
    await page.route('**/api/portfolio-capital*', async (route) => {
        const req = route.request();
        let status = 200,
            payload;
        await handler(
            {
                method: req.method(),
                query: Object.fromEntries(new URL(req.url()).searchParams),
                body: req.method() === 'POST' ? req.postDataJSON() : null,
            },
            {
                setHeader() {},
                status(s) {
                    status = s;
                    return this;
                },
                json(d) {
                    payload = d;
                    return this;
                },
            }
        );
        await route.fulfill({ status, json: payload });
    });
    await page.goto(
        (process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5173') +
            '/.tmp-capital-test.html'
    );
    const panel = page.getByRole('region', { name: '투자 원금 확인' });
    await panel.getByText('분류 확인 필요 2건', { exact: false }).waitFor();
    assert.equal(await panel.getByText('₩0', { exact: true }).count(), 1);
    await panel.locator('summary').click();
    const deposit = panel.locator('tr').filter({ hasText: '원화입금' });
    await deposit.getByRole('button', { name: '분류 확정' }).click();
    await panel.getByText('₩1,000,000', { exact: true }).waitFor();
    await panel.getByText('분류 확인 필요 1건', { exact: false }).waitFor();
    const fx = panel.locator('tr').filter({ hasText: '환전원화출금' });
    await fx.getByRole('button', { name: '분류 확정' }).click();
    await panel.getByText('분류 확인 필요 0건', { exact: false }).waitFor();
    assert.equal(
        await panel.getByText('₩1,000,000', { exact: true }).count(),
        1
    ); // FX is not added to principal.
    await page.getByRole('button', { name: '거래 상세', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog
        .getByRole('button', { name: '자금 구성 확인', exact: true })
        .click();
    const editor = dialog.getByRole('region', { name: '매수 자금 구성 확인' });
    await editor.locator('summary').click();
    await editor
        .getByRole('button', { name: '환전 금액을 참고해 분할 입력' })
        .click();
    assert.equal(
        await editor
            .getByLabel('자금 1 사용 금액', { exact: true })
            .inputValue(),
        '30.1'
    );
    assert.equal(
        await editor
            .getByLabel('자금 2 사용 금액', { exact: true })
            .inputValue(),
        '70'
    );
    await editor.getByLabel('자금 1 자금 출처').selectOption('principal');
    await editor.getByLabel('자금 2 결제 구성').selectOption('usd_balance');
    await editor.getByLabel('자금 2 자금 출처').selectOption('dividend');
    const save = editor.getByRole('button', {
        name: '자금 구성 저장',
        exact: true,
    });
    assert.equal(await save.isDisabled(), true);
    await editor
        .getByRole('checkbox', { name: '계좌 내역과 금액을 확인했습니다.' })
        .check();
    await save.click();
    await dialog
        .getByText('자금 구성을 저장했습니다.', { exact: true })
        .waitFor();
    assert.equal(
        records.get('portfolios/owner/fundingAllocations/A.T').parts.length,
        2
    );
    assert.equal(
        records.get('portfolios/owner/fundingAllocations/A.T').status,
        'confirmed'
    );
    assert.deepEqual(
        records.get('portfolios/owner/assets/A/transactions/T'),
        trade
    );
    const ledger = dialog.locator('.detail-table');
    assert.equal(await ledger.locator('tbody tr').count(), 2);
    const first = ledger.locator('tbody tr').first();
    assert.equal(
        await first.locator('td').first().getAttribute('rowspan'),
        '2'
    );
    assert.equal(
        await first
            .locator('td')
            .nth(3)
            .locator('.transaction-amount > span')
            .innerText(),
        '$70.00'
    );
    assert.equal(await first.locator('td').nth(4).innerText(), '-');
    assert.equal(await first.locator('td').nth(5).innerText(), '-');
    const second = ledger.locator('tbody tr').nth(1);
    assert.equal(await second.locator('td').count(), 1);
    assert.equal(
        await second.locator('.transaction-amount > span').innerText(),
        '₩42,140'
    );
    assert.ok((await second.innerText()).includes('$30.10'));
    assert.equal(
        await page
            .locator('table[aria-label="기간별 거래내역"] tbody tr')
            .count(),
        2
    );
    await editor.getByRole('button', { name: '닫기', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await ledger.scrollIntoViewIfNeeded();
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await dialog.screenshot({ path: '/tmp/yieldloom-transaction-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await ledger.scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: '/tmp/yieldloom-transaction-desktop.png' });
    await dialog
        .getByRole('button', { name: '자금 구성 · 확인 완료', exact: true })
        .click();
    await editor.getByLabel('자금 1 사용 금액', { exact: true }).fill('29');
    await editor
        .getByRole('checkbox', { name: '계좌 내역과 금액을 확인했습니다.' })
        .check();
    assert.equal(await save.isDisabled(), true);
    await editor.getByRole('button', { name: '확정 해제' }).click();
    await dialog
        .getByRole('button', { name: '자금 구성 확인', exact: true })
        .waitFor();
    assert.equal(await ledger.locator('tbody tr').count(), 1);
    assert.ok((await ledger.innerText()).includes('결제 구성 확인 필요'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await page.screenshot({
        path: '/tmp/yieldloom-capital-mobile.png',
        fullPage: true,
    });
    await dialog
        .getByRole('button', { name: '상세 창 닫기', exact: true })
        .click();
    await panel.getByRole('button', { name: '계좌 내역 직접 추가' }).click();
    const add = panel.locator('form');
    await add.getByLabel('금액', { exact: true }).fill('100');
    await add.getByLabel('계좌 거래 통화', { exact: true }).selectOption('USD');
    await add
        .getByLabel('확인 근거·메모', { exact: true })
        .fill('계좌의 외화 외부입금 확인');
    await add.getByRole('button', { name: '확인 후 추가' }).click();
    await panel.getByText('US$100.00', { exact: true }).waitFor();
    assert.equal(
        await panel.getByText('₩1,000,000', { exact: true }).count(),
        1
    );
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );

    const family = {
        id: 'FA',
        name: '검증 가족',
        adminUid: 'owner',
        participantUids: ['owner'],
        profiles: { P: { name: '본인', uid: 'owner', kind: 'adult' } },
    };
    const account = {
        id: 'AA',
        familyId: 'FA',
        ownerId: 'P',
        authorityUid: 'owner',
        permissions: { owner: 'owner' },
        alias: '검증 계좌',
        institution: '검증 증권',
        maskedNumber: '****1234',
        type: 'general',
        source: 'manual',
    };
    const viewer = {
        ...account,
        id: 'BB',
        alias: '조회 전용 계좌',
        permissions: { owner: 'viewer' },
    };
    records.set('familySpaces/FA', family);
    records.set('investmentAccounts/AA', account);
    records.set('investmentAccounts/BB', viewer);
    records.set('investmentAccounts/AA/entries/T', {
        row: { ...trade, date: '2026-10-15', symbol: 'TEST' },
        source: 'toss-pdf',
    });
    records.set('investmentAccounts/AA/entries/E', {
        row: {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_out',
            cashKind: 'exchange',
            amount: 42140,
            currency: 'KRW',
            exchangeRate: 1400,
            rawType: '환전원화출금',
        },
        source: 'toss-pdf',
    });
    await page.route('**/api/family-portfolio?**', (route) => {
        const params = new URL(route.request().url()).searchParams;
        const payload = params.get('accountId')
            ? {
                  entries: [
                      {
                          id: 'T',
                          row: { ...trade, date: '2026-10-15', symbol: 'TEST' },
                          source: 'toss-pdf',
                      },
                  ],
                  nextCursor: null,
              }
            : params.get('familyId')
              ? {
                    families: [family],
                    accounts: [account, viewer],
                    summary: null,
                }
              : { families: [family] };
        return route.fulfill({ json: payload });
    });
    await page.goto(
        (process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5173') +
            '/.tmp-capital-test.html?family'
    );
    await page
        .getByRole('heading', { name: '선택 계좌: 검증 계좌', exact: true })
        .waitFor();
    const familyPanel = page.getByRole('region', { name: '투자 원금 확인' });
    await familyPanel
        .getByText('분류 확인 필요 1건', { exact: false })
        .waitFor();
    await page.getByRole('button', { name: '조회', exact: true }).click();
    await page
        .getByRole('button', { name: '자금 구성 확인', exact: true })
        .click();
    const familyDialog = page.getByRole('dialog', {
        name: '계좌 매수 자금 상세',
    });
    const familyEditor = familyDialog.getByRole('region', {
        name: '매수 자금 구성 확인',
    });
    await familyEditor.locator('summary').click();
    await familyEditor
        .getByRole('button', { name: '환전 금액을 참고해 분할 입력' })
        .click();
    await familyEditor.getByLabel('자금 1 자금 출처').selectOption('principal');
    await familyEditor
        .getByLabel('자금 2 결제 구성')
        .selectOption('usd_balance');
    await familyEditor.getByLabel('자금 2 자금 출처').selectOption('dividend');
    await familyEditor
        .getByRole('checkbox', { name: '계좌 내역과 금액을 확인했습니다.' })
        .check();
    await familyEditor
        .getByRole('button', { name: '자금 구성 저장', exact: true })
        .click();
    await familyDialog
        .getByText('자금 구성을 저장했습니다.', { exact: true })
        .waitFor();
    assert.equal(
        records.get('investmentAccounts/AA/fundingAllocations/ACCOUNT.T')
            .status,
        'confirmed'
    );
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await familyDialog
        .getByRole('button', { name: '상세 창 닫기', exact: true })
        .click();
    const selectedSection = page.locator('section').filter({
        has: page.getByRole('heading', {
            name: '선택 계좌: 검증 계좌',
            exact: true,
        }),
    });
    await selectedSection.locator('select').first().selectOption('BB');
    await familyPanel
        .getByText('조회 권한으로 열었습니다.', { exact: false })
        .waitFor();
    assert.equal(
        await familyPanel
            .getByRole('button', { name: '계좌 내역 직접 추가' })
            .isDisabled(),
        true
    );
    await familyPanel.getByText('내역 필요', { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log(
        'PASS: legacy and family account cash review, principal exclusion, mixed funding, consent, exact settlement, reset, USD separation and mobile layout'
    );
} finally {
    await browser.close();
    await rm(harness, { force: true });
}
