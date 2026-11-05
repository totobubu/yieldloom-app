/* global document, innerWidth, window */
// Synthetic component fixture only; no account or database access.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const base = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5191');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const out = resolve(
    process.env.STITCH_CAPTURE_DIR || '/tmp/yieldloom-review-phase39'
);
await fs.mkdir(out, { recursive: true });
const harness = resolve(repo, '.phase39-review.html');
const rows = [
    ['DEMO-K', 'buy', 'KRW', 100000, 10],
    ['DEMO-A', 'buy', 'USD', 200, 2],
    ['DEMO-K', 'sell', 'KRW', 24000, 2],
    ['DEMO-A', 'dividend', 'USD', 10, 0],
    ['CASH', 'cash_in', 'KRW', 1000000, 0],
    ['CASH', 'cash_out', 'KRW', 50000, 0],
].map(([symbol, type, currency, amount, quantity], index) => ({
    date: `2026-03-0${index + 1}`,
    symbol,
    type,
    currency,
    amount,
    quantity,
    externalId: `DEMO-00${index + 1}`,
}));
await fs.writeFile(
    harness,
    `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>합성 검토 시안 검증</title><div id="app" class="studio-shell"></div><script type="module">
import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Review from '/src/components/portfolio/PortfolioImportReview.vue';import 'primeicons/primeicons.css';import '/src/styles/style.scss';import '/src/styles/studio.scss';
const label=ref('DEMO-ACC-****-891'),review=ref({reviewId:'DEMO-REVIEW',source:'standard-csv',kind:'transactions',asOf:'2026-03-06',rows:${JSON.stringify(rows)},errors:[]}),busy=ref(false),blocked=ref(false),component=ref(null),events=[];window.reviewFixture={review,busy,blocked,component,events,label};createApp({setup(){return()=>h('main',{class:'fixture-frame'},h(Review,{ref:component,review:review.value,accountLabel:label.value,busy:busy.value,saveDisabled:blocked.value,onCommit:()=>events.push('commit'),onCancel:()=>events.push('cancel'),'onUpdate-row':value=>events.push(value)}));}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');</script><style>body{margin:0}.fixture-frame{max-width:882px;margin:auto;padding:24px}@media(max-width:640px){.fixture-frame{max-width:390px;padding:20px 16px 48px}}</style></html>`
);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const results = [];
try {
    for (const width of [1280, 834, 768, 390, 360]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
            deviceScaleFactor: 2,
        });
        const failures = await installStaticAssets(context);
        let apiCalls = 0;
        await context.route('**/api/**', (route) => {
            apiCalls++;
            return route.abort();
        });
        const page = await context.newPage(),
            errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(new URL('/.phase39-review.html', base).href);
        await page
            .getByRole('heading', {
                name: '증권 데이터 검토 및 확정',
                exact: true,
            })
            .waitFor();
        await page.evaluate(() => document.fonts.ready);
        const measured = await page
            .locator('.import-review')
            .evaluate((el) => ({
                width: el.getBoundingClientRect().width,
                height: el.getBoundingClientRect().height,
                header: el
                    .querySelector('.review-heading')
                    .getBoundingClientRect().height,
                headerParts: [
                    ...el.querySelectorAll(
                        '.review-meta,.review-title-line,.review-heading p,.review-steps'
                    ),
                ].map((part) => ({
                    class: part.className,
                    width: part.getBoundingClientRect().width,
                    height: part.getBoundingClientRect().height,
                })),
                steps: el.querySelector('.review-steps').getBoundingClientRect()
                    .height,
                overflow: document.documentElement.scrollWidth > innerWidth,
            }));
        assert.equal(measured.overflow, false);
        await page.screenshot({
            path: resolve(out, `implementation-${width}.png`),
            fullPage: true,
        });
        await page.evaluate(() =>
            window.reviewFixture.component.value.focusHeading()
        );
        assert.equal(
            await page
                .getByRole('heading', {
                    name: '증권 데이터 검토 및 확정',
                    exact: true,
                })
                .evaluate((el) => document.activeElement === el),
            true
        );
        await page
            .getByRole('button', { name: '주식 매수 2', exact: true })
            .click();
        await page
            .getByRole('textbox', { name: '추출 결과 검색', exact: true })
            .fill('DEMO-A');
        assert.equal(
            await page
                .getByRole('button', {
                    name: '수정 내용 검증·저장',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        await page
            .getByLabel(
                '[필수] 원본 파일 대조 및 선택 계좌 거래·잔고 반영에 동의합니다.',
                { exact: true }
            )
            .check();
        await page
            .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
            .click();
        assert.deepEqual(
            await page.evaluate(() => window.reviewFixture.events),
            ['commit']
        );
        assert.equal(
            await page.evaluate(
                () => window.reviewFixture.review.value.rows.length
            ),
            6
        );
        await page
            .getByRole('button', { name: '필터 초기화', exact: true })
            .click();
        await page.getByLabel('1행 quantity', { exact: true }).fill('11');
        assert.equal(
            await page
                .getByLabel(
                    '[필수] 원본 파일 대조 및 선택 계좌 거래·잔고 반영에 동의합니다.',
                    { exact: true }
                )
                .isChecked(),
            false,
            'row edits revoke confirmation'
        );
        assert.equal(
            await page
                .getByRole('button', {
                    name: '수정 내용 검증·저장',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        await page
            .getByLabel(
                '[필수] 원본 파일 대조 및 선택 계좌 거래·잔고 반영에 동의합니다.',
                { exact: true }
            )
            .check();

        await page.evaluate(() => {
            window.reviewFixture.busy.value = true;
        });
        assert.equal(
            await page
                .getByRole('button', {
                    name: '수정 내용 검증·저장',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        await page.evaluate(() => {
            window.reviewFixture.busy.value = false;
            window.reviewFixture.blocked.value = true;
        });
        assert.equal(
            await page
                .getByRole('button', {
                    name: '수정 내용 검증·저장',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        if (width === 390)
            await page.screenshot({
                path: resolve(out, 'implementation-dark-390.png'),
                fullPage: true,
            });
        await page.evaluate(() => {
            window.reviewFixture.label.value = 'DEMO-' + 'A'.repeat(100);
        });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false,
            'long account labels wrap without hiding data'
        );
        await page.evaluate(() => {
            window.reviewFixture.label.value = 'DEMO-ACC-****-891';
        });
        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        assert.equal(apiCalls, 0);
        const item = {
            viewport: width,
            implementation: measured,
            apiCalls,
            visualAcceptance:
                'not accepted: header/width only; body panels and raw/approval states need source implementation',
        };
        if ([1280, 834, 768, 390].includes(width)) {
            const id =
                width === 390
                    ? '6bd9777b8bea43b98aea8397a29f809a'
                    : '5aa7a573854a46db9b106f89c09c4f23';
            const html = await fs.readFile(
                resolve(
                    repo,
                    `docs/design/stitch-v3/originals/17382728461495959991/${id}.html`
                ),
                'utf8'
            );
            await page.route('**/source-review', (route) =>
                route.fulfill({ contentType: 'text/html', body: html })
            );
            await page.goto(new URL('/source-review', base).href);
            await page.evaluate(() => document.fonts.ready);
            item.sourceId = id;
            item.source = await page.locator('header').evaluate((el) => ({
                width: el.getBoundingClientRect().width,
                height: el.getBoundingClientRect().height,
                parts: [...el.children].map((part) => ({
                    tag: part.tagName,
                    width: part.getBoundingClientRect().width,
                    height: part.getBoundingClientRect().height,
                })),
                layoutWidth:
                    document
                        .querySelector('main > .grid')
                        ?.getBoundingClientRect().width ?? null,
            }));
            assert.equal(
                measured.header,
                item.source.height,
                'fixed synthetic header geometry matches the unchanged source'
            );
            item.sourceAssetFailures = [...failures];
            await page.screenshot({
                path: resolve(out, `source-${width}.png`),
                fullPage: true,
            });
        }
        results.push(item);
        await context.close();
    }
    await fs.writeFile(
        resolve(out, 'measurements.json'),
        JSON.stringify(results, null, 2) + '\n'
    );
    console.log(
        'PASS five widths, heading focus, filter/commit preserves six input rows, busy/blocked guard, dark, zero API calls. Full visual acceptance pending.'
    );
} finally {
    await browser.close();
    await fs.unlink(harness);
}
