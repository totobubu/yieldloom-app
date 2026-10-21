import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const harness = new URL('../.tmp-funding-trace.html', import.meta.url);
const trade = (id, date, type, symbol, amount, quantity) => ({
    id,
    date,
    type,
    symbol,
    accountId: 'a',
    assetId: 'ACCOUNT',
    currency: 'USD',
    nativeAmount: amount,
    nativeSettlementAmount: amount,
    quantity,
});
const state = {
    version: 'v1:1:0',
    entries: [
        {
            id: 'D',
            date: '20260101',
            amount: 1000,
            currency: 'USD',
            accountId: 'a',
        },
        {
            id: 'W',
            date: '20260401',
            amount: 50,
            currency: 'USD',
            accountId: 'a',
        },
    ],
    classifications: [
        { id: 'D', classification: 'external_deposit' },
        { id: 'W', classification: 'dividend_withdrawal' },
    ],
    allocations: [],
    trades: [
        trade('B', '20260102', 'buy', 'A', 1000, 10),
        trade('D1', '20260201', 'dividend', 'A', 100, 0),
        trade('B2', '20260202', 'buy', 'B', 100, 2),
        trade('S', '20260301', 'sell', 'B', 120, 2),
    ],
};
const secondState = {
    ...state,
    entries: state.entries.map((r) => ({
        ...r,
        accountId: 'b',
        amount: r.id === 'D' ? 100 : 50,
    })),
    trades: [],
};
await writeFile(
    harness,
    `<!doctype html><html><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--app-text:#172033;--app-muted:#505968;--app-surface:#fff;--app-surface-muted:#f3f5fa;--app-border:#d6d9df}body{margin:12px;font-family:sans-serif;color:var(--app-text)}.p-dark{background:#111827;--app-text:#eee;--app-muted:#b7c0d0;--app-surface:#1f2937;--app-surface-muted:#253347;--app-border:#4b5563}</style><div id="app"></div><script type="module">import {createApp,h} from 'vue';import Overview from '/src/components/portfolio/AccountRecoveryOverview.vue';createApp({render:()=>h(Overview,{user:{uid:'fixture',getIdToken:async()=> 'fixture'},accounts:[{id:'a',alias:'내 계좌'},{id:'b',alias:'추가 계좌'}]})}).mount('#app');</script></html>`
);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 1000 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let requests = 0;
    await page.route('**/api/portfolio-capital*', (route) => {
        requests++;
        const accountId = new URL(route.request().url()).searchParams.get(
            'accountId'
        );
        assert.ok(['a', 'b'].includes(accountId));
        assert.equal(route.request().headers().authorization, 'Bearer fixture');
        return route.fulfill({ json: accountId === 'a' ? state : secondState });
    });
    await page.goto(
        (process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5173') +
            '/.tmp-funding-trace.html'
    );
    const panel = page.getByRole('region', {
        name: '내 돈과 재투자 추적',
        exact: true,
    });
    await panel.getByText('0%', { exact: true }).first().waitFor();
    const accountTable = page.getByRole('region', {
        name: '계좌별 원금 회수율',
        exact: true,
    });
    assert.ok((await accountTable.innerText()).includes('0%'));
    await accountTable
        .getByRole('button', {
            name: '추가 계좌 USD 자금 추적 보기',
            exact: true,
        })
        .first()
        .click();
    await panel.getByText('0%', { exact: true }).first().waitFor();
    assert.ok((await panel.innerText()).includes('총 현금 회수 US$50.00'));
    await accountTable
        .getByRole('button', {
            name: '내 계좌 USD 자금 추적 보기',
            exact: true,
        })
        .first()
        .click();
    await panel.getByText('0%', { exact: true }).first().waitFor();
    assert.ok((await panel.innerText()).includes('US$1,000.00'));
    const rows = panel.getByRole('table', { name: '종목별 원금과 재투자' });
    assert.ok((await rows.innerText()).includes('내 계좌 · A'));
    assert.ok((await rows.innerText()).includes('A → B'));
    await panel.getByText('일자별 차트 데이터', { exact: true }).click();
    assert.ok((await panel.innerText()).includes('2026.04.01'));
    await panel.getByLabel('자금 추적 통화').selectOption('KRW');
    await panel.getByRole('status').filter({ hasText: '이 통화' }).waitFor();
    await panel.getByLabel('자금 추적 통화').selectOption('USD');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
        ),
        false
    );
    await panel.screenshot({ path: '/tmp/yieldloom-funding-trace-mobile.png' });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    assert.equal(
        await panel.evaluate(
            (element) => getComputedStyle(element).backgroundColor
        ),
        'rgb(31, 41, 55)'
    );
    await panel.screenshot({ path: '/tmp/yieldloom-funding-trace-dark.png' });
    await page.getByLabel('자금 추적 통화').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await panel.getByLabel('자금 추적 통화').inputValue(), 'KRW');
    assert.equal(requests, 2);
    assert.deepEqual(errors, []);
    // API failures must replace private values with a retryable error.
    await page.unroute('**/api/portfolio-capital*');
    await page.route('**/api/portfolio-capital*', (route) =>
        route.fulfill({ status: 503, json: { error: '검증용 조회 실패' } })
    );
    await page.reload();
    await page
        .getByRole('alert')
        .filter({ hasText: '검증용 조회 실패' })
        .waitFor();
    assert.equal(
        await page
            .getByRole('region', { name: '내 돈과 재투자 추적', exact: true })
            .count(),
        0
    );
    console.log(
        'PASS: account API → funding trace, dividend reinvestment, currency switch, chart data, mobile, dark mode, keyboard and failure state'
    );
} finally {
    await browser.close();
    await rm(harness, { force: true });
}
