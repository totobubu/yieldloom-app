/* global document, window, innerWidth, getComputedStyle */
// Synthetic component and immutable Stitch references only; no customer/API access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const base = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5194');
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname));
const out = process.env.STITCH_CAPTURE_DIR || '/tmp/yieldloom-ledger-phase46';
await fs.mkdir(out, { recursive: true });
const harness = resolve(repo, '.phase46-ledger.html');
const rows = [
    ['KRX-DEMO-01', 'buy', 'KRW', '720000', '10'],
    ['NYSE-DEMO-US', 'buy', 'USD', '226.00', '5'],
    ['KRX-DEMO-99', 'sell', 'KRW', '140000', '4'],
    ['NYSE-DEMO-US', 'dividend', 'USD', '5.75', '5'],
    ['DEMO-UNKNOWN', 'buy', '', '150000', '20'],
    ['CASH', 'cash_in', 'KRW', '500000', '0'],
].map(([symbol, type, currency, amount, quantity], i) => ({
    accountId: 'DEMO-ACCOUNT',
    row: {
        symbol,
        type,
        currency,
        amount,
        quantity,
        date: `2026-03-${String([5, 12, 18, 24, 27, 30][i]).padStart(2, '0')}`,
        securityName: [
            '가상모의전자',
            '알파테크가상 ETF',
            '모의에너지홀딩스',
            '알파테크가상 ETF',
            '신규미식별인프라',
            '예수금 충전 거래',
        ][i],
        externalId: `DEMO-${i}`,
    },
}));
await fs.writeFile(
    harness,
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app" class="studio-shell"></div><script type="module">import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import Ledger from '/src/components/portfolio/AdvancedPortfolioInsights.vue';import '/src/styles/style.scss';import '/src/styles/studio.scss';const entries=ref(${JSON.stringify(rows)}),month=ref('2026-03'),accounts=ref([{id:'DEMO-ACCOUNT',alias:'합성 계좌',snapshot:{asOf:'2026-03-31',positions:[]}}]);window.ledgerFixture={entries,month,accounts};createApp({setup(){return()=>h('main',{class:'fixture'},h(Ledger,{entries:entries.value,positions:[],accounts:accounts.value,month:month.value,currency:'KRW',today:'2026-04-10'}));}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}}}).mount('#app');</script><style>body{margin:0}.fixture{max-width:882px;margin:auto;padding:24px}@media(max-width:640px){.fixture{padding:16px;max-width:390px}}</style></body></html>`
);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const result = [];
try {
    for (const width of [1280, 834, 768, 390, 360]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
            deviceScaleFactor: 2,
        });
        const assetFailures = await installStaticAssets(context),
            page = await context.newPage(),
            errors = [];
        let requests = 0;
        page.on('pageerror', (e) => errors.push(e.message));
        await context.route('**/api/**', (route) => {
            requests++;
            return route.abort();
        });
        await page.goto(new URL('/.phase46-ledger.html', base).href);
        await page
            .getByRole('heading', {
                name: '원장 품질 및 청산 손익 분석',
                exact: true,
            })
            .waitFor();
        await page.evaluate(() => document.fonts.ready);
        const titleStyle = await page
            .locator('.ledger-heading h3')
            .evaluate((el) => ({
                size: getComputedStyle(el).fontSize,
                line: getComputedStyle(el).lineHeight,
            }));
        if (width <= 640)
            assert.deepEqual(titleStyle, { size: '20px', line: '28px' });

        const table = page.getByRole('table', {
            name: '원장 트랜잭션 기록',
            exact: true,
        });
        assert.equal(await table.locator('tbody tr').count(), 6);
        assert.match(await table.innerText(), /통화 미지정/);
        assert.equal(
            await table
                .locator('tbody tr')
                .nth(1)
                .locator('td')
                .nth(4)
                .innerText(),
            '226.00\nUSD',
            'raw fractional precision and trailing zero survive'
        );
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        const geometry = await page
            .locator('.advanced-insights')
            .evaluate((el) => ({
                width: el.getBoundingClientRect().width,
                height: el.getBoundingClientRect().height,
            }));
        await page.screenshot({
            path: resolve(out, `implementation-${width}.png`),
            fullPage: true,
        });
        await page.evaluate(() => {
            window.ledgerFixture.entries.value[3].row.amount = '0';
        });
        assert.equal(
            await table
                .locator('tbody tr')
                .nth(3)
                .locator('td')
                .nth(4)
                .innerText(),
            '0\nUSD'
        );

        await page
            .getByRole('button', { name: '확인 필요 (1)', exact: true })
            .click();
        assert.equal(await table.locator('tbody tr').count(), 1);
        assert.match(await table.innerText(), /DEMO-UNKNOWN/);
        await page
            .getByRole('button', { name: '전체 거래 (6)', exact: true })
            .click();
        await page.evaluate(() =>
            window.ledgerFixture.entries.value.push({
                accountId: 'UNSELECTED-ACCOUNT',
                row: {
                    date: '2026-03-01',
                    symbol: 'DO-NOT-DISPLAY',
                    type: 'buy',
                    currency: 'KRW',
                    amount: 1,
                },
            })
        );
        assert.equal(
            await table.getByText('DO-NOT-DISPLAY', { exact: true }).count(),
            0
        );
        assert.equal(
            await page
                .getByRole('list', { name: '계좌 XIRR 결과', exact: true })
                .count(),
            0
        );
        await page.getByRole('checkbox').nth(0).check();
        await page
            .getByRole('list', { name: '계좌 XIRR 결과', exact: true })
            .waitFor();
        await page.getByRole('checkbox').nth(1).check();
        await page.evaluate(() => {
            window.ledgerFixture.month.value = '2026-02';
        });
        assert.equal(
            await page.getByRole('checkbox').nth(0).isChecked(),
            false
        );
        assert.equal(
            await page.getByRole('checkbox').nth(1).isChecked(),
            false
        );
        await page.evaluate(() => {
            window.ledgerFixture.month.value = '2026-03';
            window.ledgerFixture.entries.value = Array.from(
                { length: 101 },
                (_, i) => ({
                    accountId: 'DEMO-ACCOUNT',
                    row: {
                        date: '2026-03-01',
                        symbol: 'PAGE-' + i,
                        type: 'buy',
                        currency: 'KRW',
                        amount: 0,
                        quantity: 0,
                    },
                })
            );
        });
        await page
            .getByRole('button', { name: '다음 100행', exact: true })
            .click();
        assert.equal(await table.locator('tbody tr').count(), 1);
        assert.match(await table.innerText(), /PAGE-100/);
        await page.evaluate((rows) => {
            window.ledgerFixture.entries.value = rows;
            document.documentElement.classList.add('p-dark');
        }, rows);
        if (width === 390)
            await page.screenshot({
                path: resolve(out, 'implementation-dark-390.png'),
                fullPage: true,
            });
        assert.deepEqual(errors, []);
        assert.equal(requests, 0);
        assert.deepEqual(assetFailures, []);
        const item = {
            width,
            geometry,
            requests,
            visualAcceptance:
                'pending; actual data and gated calculations preserved; reference model metrics and controls differ',
        };
        if (
            !process.env.STITCH_SKIP_SOURCE &&
            [1280, 834, 390].includes(width)
        ) {
            const id =
                width === 390
                    ? '986013fd6b61404f82b4eeda2b643cd6'
                    : '65c1b225397746ada071cf14ae4f687c';
            const html = await fs.readFile(
                resolve(
                    repo,
                    `docs/design/stitch-v3/originals/17382728461495959991/${id}.html`
                ),
                'utf8'
            );
            await page.route('**/source-ledger', (route) =>
                route.fulfill({ contentType: 'text/html', body: html })
            );
            await page.goto(new URL('/source-ledger', base).href);
            await page.evaluate(() => document.fonts.ready);
            item.sourceId = id;
            item.sourceAssetFailures = [...assetFailures];
            await page.screenshot({
                path: resolve(out, `source-${width}.png`),
                fullPage: true,
            });
        }
        result.push(item);
        await context.close();
    }
    await fs.writeFile(
        resolve(out, 'measurements.json'),
        JSON.stringify(result, null, 2) + '\n'
    );
    console.log(
        'PASS ledger: five widths, raw zero/missing currency, account scope, local filters, all101 rows by paging, XIRR/closed confirmation reset, dark, zero API. Full visual acceptance pending.'
    );
} finally {
    await browser.close();
    await fs.rm(harness, { force: true });
}
