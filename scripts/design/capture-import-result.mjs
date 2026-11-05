/* global document, getComputedStyle, window, innerWidth */
// Local synthetic receipts only; no Firebase initialization or customer writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const base = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5189');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const out = resolve(
    process.env.STITCH_CAPTURE_DIR || '/tmp/yieldloom-result-review'
);
await fs.mkdir(out, { recursive: true });
const harness = resolve(repo, '.phase34-result.html');
const fixture = {
    inserted: 5,
    duplicates: 1,
    kind: 'transactions',
    asOf: '2026-03-31',
    accountAlias: 'DEMO-ACC-****-891',
    fileNames: ['DEMO_MARCH_2026.csv'],
    rowResultsComplete: true,
    rowResults: [
        {
            status: 'inserted',
            position: 0,
            row: {
                date: '2026-03-01',
                symbol: 'DEMO-K',
                type: 'buy',
                quantity: 10,
                amount: 100000,
                currency: 'KRW',
                externalId: 'DEMO-001',
            },
        },
        {
            status: 'inserted',
            position: 1,
            row: {
                date: '2026-03-02',
                symbol: 'DEMO-A',
                type: 'buy',
                quantity: 2,
                amount: 200,
                currency: 'USD',
                externalId: 'DEMO-002',
            },
        },
        {
            status: 'inserted',
            position: 2,
            row: {
                date: '2026-03-03',
                symbol: 'DEMO-K',
                type: 'sell',
                quantity: 2,
                amount: 24000,
                currency: 'KRW',
                externalId: 'DEMO-003',
            },
        },
        {
            status: 'inserted',
            position: 3,
            row: {
                date: '2026-03-04',
                symbol: 'DEMO-A',
                type: 'dividend',
                quantity: null,
                amount: 10,
                currency: 'USD',
                externalId: 'DEMO-004',
            },
        },
        {
            status: 'inserted',
            position: 4,
            row: {
                date: '2026-03-05',
                symbol: 'CASH',
                type: 'deposit',
                quantity: null,
                amount: 1000000,
                currency: 'KRW',
                externalId: 'DEMO-005',
            },
        },
        {
            status: 'duplicate',
            position: 5,
            row: {
                date: '2026-03-06',
                symbol: 'CASH',
                type: 'withdrawal',
                quantity: null,
                amount: 50000,
                currency: 'KRW',
                externalId: 'DEMO-006',
            },
        },
    ],
};
await fs.writeFile(
    harness,
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app" class="studio-shell"></div><script type="module">import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Result from '/src/components/portfolio/PortfolioImportResult.vue';import 'primeicons/primeicons.css';import '/src/styles/style.scss';import '/src/styles/studio.scss';const receipt=ref(${JSON.stringify(fixture)}),state=ref('error'),busy=ref(false),events=[];window.receiptFixture={receipt,state,busy,events};createApp({setup(){return()=>h('main',{class:'fixture-frame'},[h('p',{class:'fixture-label'},'합성 검증 데이터 (DEMO)'),h(Result,{receipt:receipt.value,accountsState:state.value,busy:busy.value,onRetry:()=>events.push('retry'),onView:()=>events.push('view'),onExport:()=>events.push('export'),onCalendar:()=>events.push('calendar'),onAnother:()=>events.push('another')})]);}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');</script><style>body{margin:0}.fixture-frame{max-width:834px;margin:auto;padding:24px}.fixture-label{font-size:11px;color:#64748b;margin:0 0 8px}@media(max-width:640px){.fixture-frame{max-width:390px;padding:16px 8px}}</style></body></html>`
);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const measurements = [];
try {
    for (const width of [1280, 834, 768, 390, 360]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
            deviceScaleFactor: 2,
        });
        const failures = await installStaticAssets(context);
        const page = await context.newPage();
        const errors = [];
        let apiRequests = 0;
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
            if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests++;
        });
        await page.goto(new URL('/.phase34-result.html', base).href);
        await page
            .getByRole('heading', {
                name: '자료 저장이 완료되었습니다',
                exact: true,
            })
            .waitFor();
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('.receipt-row').count(), 6);
        for (const name of [
            '저장 거래 확인',
            '배당 캘린더 확인',
            'CSV로 내려받기',
        ])
            assert.equal(
                await page
                    .getByRole('button', { name, exact: true })
                    .isDisabled(),
                true
            );
        await page
            .getByRole('button', {
                name: '계좌 목록 다시 불러오기',
                exact: true,
            })
            .click();
        assert.deepEqual(
            await page.evaluate(() => window.receiptFixture.events),
            ['retry']
        );
        await page
            .getByRole('button', { name: '중복 제외 (1)', exact: true })
            .click();
        assert.equal(await page.locator('.receipt-row').count(), 1);
        assert.match(
            await page.locator('.receipt-row').innerText(),
            /DEMO-006/
        );
        await page
            .getByRole('button', { name: '전체 결과', exact: true })
            .click();
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        const data = await page.locator('.import-result').evaluate((e) => ({
            width: e.getBoundingClientRect().width,
            height: e.getBoundingClientRect().height,
            header: e.querySelector('.receipt-header').getBoundingClientRect()
                .height,
            titleFont: getComputedStyle(e.querySelector('h2')).fontSize,
        }));
        await page.screenshot({
            path: resolve(out, `implementation-${width}.png`),
            fullPage: true,
        });
        await page.evaluate(() => {
            window.receiptFixture.state.value = 'ready';
        });
        await page
            .getByRole('button', { name: 'CSV로 내려받기', exact: true })
            .click();
        assert.deepEqual(
            await page.evaluate(() => window.receiptFixture.events),
            ['retry', 'export']
        );
        await page.evaluate(() => {
            const f = window.receiptFixture;
            f.receipt.value = {
                ...f.receipt.value,
                rowResultsComplete: false,
                rowResults: [],
                inserted: 0,
                duplicates: 6,
            };
        });
        await page
            .getByRole('heading', {
                name: '이미 등록된 자료입니다',
                exact: true,
            })
            .waitFor();
        assert.equal(await page.locator('.receipt-row').count(), 0);
        assert.match(
            await page.locator('.receipt-unavailable').innerText(),
            /행별 저장 결과를 제공하지 않습니다/
        );
        assert.equal(
            await page
                .locator('.receipt-currencies dd')
                .filter({ hasText: '미제공' })
                .count(),
            4
        );
        await page.evaluate((fixture) => {
            const f = window.receiptFixture;
            f.receipt.value = {
                ...fixture,
                inserted: 101,
                duplicates: 0,
                rowResults: Array.from({ length: 101 }, (_, i) => ({
                    ...fixture.rowResults[0],
                    position: i,
                    row: {
                        ...fixture.rowResults[0].row,
                        amount: i === 0 ? 0 : 0.00000001,
                        externalId: 'SYNTHETIC-' + i,
                    },
                })),
            };
        }, fixture);
        assert.equal(await page.locator('.receipt-row').count(), 50);
        await page.getByRole('button', { name: '다음', exact: true }).click();
        assert.equal(await page.locator('.receipt-row').count(), 50);
        await page.getByRole('button', { name: '다음', exact: true }).click();
        assert.equal(await page.locator('.receipt-row').count(), 1);
        await page
            .getByRole('button', { name: '신규 저장 (101)', exact: true })
            .click();
        assert.equal(await page.locator('.receipt-row').count(), 50);
        assert.match(
            await page.locator('.receipt-row').first().innerText(),
            /0 KRW/
        );
        assert.match(
            await page.locator('.receipt-row').nth(1).innerText(),
            /0\.00000001 KRW/
        );
        await page.evaluate((fixture) => {
            window.receiptFixture.receipt.value = fixture;
            window.receiptFixture.state.value = 'error';
            document.documentElement.classList.add('p-dark');
        }, fixture);
        if (width === 390)
            await page.screenshot({
                path: resolve(out, 'implementation-dark-390.png'),
                fullPage: true,
            });
        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        assert.equal(apiRequests, 0);
        measurements.push({
            width,
            implementation: data,
            apiRequests,
            sourceComparison:
                width === 1280 || width === 360
                    ? 'No final source at this viewport'
                    : 'pending',
        });
        if ([834, 768, 390].includes(width)) {
            const id =
                width === 390
                    ? 'f5a2132c4e234e648269220f0e889387'
                    : 'cf7686fbb620465f93418fde1572a6cc';
            const html = await fs.readFile(
                resolve(
                    repo,
                    `docs/design/stitch-v3/originals/17382728461495959991/${id}.html`
                ),
                'utf8'
            );
            await page.route('**/stitch-original', (route) =>
                route.fulfill({ body: html, contentType: 'text/html' })
            );
            await page.goto(new URL('/stitch-original', base).href);
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
                path: resolve(out, `source-${width}.png`),
                fullPage: true,
            });
            measurements.at(-1).source = await page
                .locator(width === 390 ? 'body > div' : 'main')
                .evaluate((e) => ({
                    width: e.getBoundingClientRect().width,
                    height: e.getBoundingClientRect().height,
                    titleFont: getComputedStyle(e.querySelector('h1')).fontSize,
                }));
            const measured = measurements.at(-1);
            assert.equal(measured.implementation.width, measured.source.width);
            assert.equal(
                measured.implementation.titleFont,
                measured.source.titleFont
            );
            measured.sourceComparison =
                'content width and title font match; full visual acceptance pending';
            measured.heightDifference =
                measured.implementation.height - measured.source.height;
            assert.deepEqual(failures, []);
        }
        await context.close();
    }
    await fs.writeFile(
        resolve(out, 'measurements.json'),
        JSON.stringify(measurements, null, 2) + '\n'
    );
    console.log(
        'PASS: receipt error/ready/replay, filters, 101-row paging, zero/precision, 5 widths, dark; zero API requests; source captures recorded, full visual acceptance pending.'
    );
} finally {
    await browser.close();
    await fs.unlink(harness);
}
