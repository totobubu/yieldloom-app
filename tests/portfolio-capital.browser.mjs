// Run with the Vite dev server at CAPITAL_TEST_URL (default localhost:5173).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { capitalHandler } from '../lib/portfolio-capital-handler.js';

const harness = new URL('../.tmp-capital-test.html', import.meta.url);
await writeFile(
    harness,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><div id="app"></div><script type="module">
import {createApp,h} from 'vue'; import {createRouter,createMemoryHistory,RouterView} from 'vue-router'; import MyPage from '/src/pages/MyPageView.vue';
const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:MyPage},{path:'/login',component:{template:'<p>login</p>'}}]});
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
    doc: (path) => ({ path }),
    collection: (path) => ({
        get: async () => ({
            docs: [...records.keys()]
                .filter(
                    (k) =>
                        k.startsWith(path + '/') &&
                        !k.slice(path.length + 1).includes('/')
                )
                .map(snap),
        }),
    }),
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
    await page.route('**/api/portfolio-capital', async (route) => {
        const req = route.request();
        let status = 200,
            payload;
        await handler(
            {
                method: req.method(),
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
    await editor.getByLabel('자금 1 사용 금액', { exact: true }).fill('29');
    await editor
        .getByRole('checkbox', { name: '계좌 내역과 금액을 확인했습니다.' })
        .check();
    assert.equal(await save.isDisabled(), true);
    await editor.getByRole('button', { name: '확정 해제' }).click();
    await dialog
        .getByRole('button', { name: '자금 구성 확인', exact: true })
        .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await page.screenshot({
        path: '/tmp/yieldloom-capital/mobile.png',
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
    assert.deepEqual(errors, []);
    console.log(
        'PASS: real MyPage cash review, principal exclusion, mixed funding, consent, exact settlement, reset, USD separation and mobile layout'
    );
} finally {
    await browser.close();
    await rm(harness, { force: true });
}
