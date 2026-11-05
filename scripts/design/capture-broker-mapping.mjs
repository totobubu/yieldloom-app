/* global document, getComputedStyle, innerWidth, window */
// Synthetic local component review; API responses are intercepted. Never run against production.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
import { installStaticAssets } from './browser-static-assets.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url)),
    out = resolve(
        process.env.STITCH_CAPTURE_DIR || '/tmp/yieldloom-column-mapping-review'
    );
await fs.mkdir(out, { recursive: true });
const captureBase = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5175');
assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(captureBase.hostname),
    'Synthetic component capture requires a local server'
);
const harness = repo + '/.phase32-broker.html';
await fs.writeFile(
    harness,
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated synthetic mapping review</title></head><body><div id="app" class="studio-shell"></div><script type="module">import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Broker from '/src/components/portfolio/BrokerSpreadsheetForm.vue';import {saveBrokerPreset} from '/src/services/brokerPresets.js';import 'primeicons/primeicons.css';import '/src/styles/style.scss';import '/src/styles/studio.scss';saveBrokerPreset(localStorage,'other','transactions',{encoding:'utf-8-sig',headerRow:1,defaultCurrency:'',columnCount:1,sheetIndex:0,mapping:{},headerSignature:'0'.repeat(64)});const busy=ref(false);window.phase32={busy,previews:0};createApp({setup(){return()=>h('main',{class:'fixture-frame'},h(Broker,{account:{id:'synthetic-account',ownerId:'stitch-review-user',institution:'기타',alias:'DEMO-ACC-****-891'},busy:busy.value,onPreview:()=>window.phase32.previews++}));}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');</script><style>body{margin:0;background:#f8fafc}.fixture-frame{max-width:1280px;margin:auto;padding:32px 24px}@media(max-width:1023px){.fixture-frame{max-width:834px;padding:24px}}@media(max-width:640px){.fixture-frame{max-width:390px;padding:20px 16px}}</style></body></html>`
);
const b = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const results = [];
const data = {
    sheets: [],
    sheet: '',
    headers: [
        'date',
        'symbol',
        'rawtype',
        'externalId',
        'quantity',
        'amount',
        'currency',
    ],
    rowCount: 3,
    previewRows: [
        ['2026-11-01', 'DEMO-K', '매수', 'DEMO-001', '10', '100000', 'KRW'],
        ['2026-11-02', 'DEMO-A', '배당금', 'DEMO-002', '', '10.00', 'USD'],
        ['2026-11-03', 'CASH', '입금', 'DEMO-003', '', '500.00', 'USD'],
    ],
};
const metrics = (source) => {
    const select = source ? 'select' : '.p-select',
        heading = source ? 'h1' : '.broker-heading h3';
    const h = document.querySelector(heading);
    const m = (e) => {
        const r = e.getBoundingClientRect(),
            s = getComputedStyle(e);
        return {
            width: r.width,
            height: r.height,
            font: s.fontSize,
            line: s.lineHeight,
            weight: s.fontWeight,
            padding: s.padding,
            radius: s.borderRadius,
            color: s.color,
            gap: s.gap,
        };
    };
    return {
        icons: [...document.querySelectorAll('.pi')].slice(0, 2).map((e) => ({
            family: getComputedStyle(e).fontFamily,
            before: getComputedStyle(e, '::before').fontFamily,
            content: getComputedStyle(e, '::before').content,
        })),
        heading: m(h),
        selects: [...document.querySelectorAll(select)].slice(0, 10).map(m),
        cards: [
            ...document.querySelectorAll(
                source
                    ? 'main>section'
                    : '.broker-file-card,.broker-mapping-card,.broker-preview-card,.broker-confirm-card'
            ),
        ].map(m),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        fonts: [...document.fonts]
            .filter((f) => f.status === 'loaded')
            .map((f) => ({ family: f.family, weight: f.weight })),
    };
};
try {
    for (const [width, id] of [
        [1280, '9ae2f0f1253a41b1839e792d36996900'],
        [768, '0bb2ab1d8197472f910b73ed175c4448'],
        [834, '0bb2ab1d8197472f910b73ed175c4448'],
        [390, 'e0fb1368a1684edaa56c1a506e806530'],
    ]) {
        const source = await b.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const sourceFailures = await installStaticAssets(source);
        await source.setContent(
            await fs.readFile(
                `${repo}/docs/design/stitch-v3/originals/17382728461495959991/${id}.html`,
                'utf8'
            ),
            { waitUntil: 'networkidle' }
        );
        await source.evaluate(() => document.fonts.ready);
        const original = await source.evaluate(metrics, true);
        await source.screenshot({
            path: `${out}/source-${width}.png`,
            fullPage: true,
        });
        const page = await b.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(page, { admin: true });
        const failures = await installStaticAssets(page),
            errors = [],
            requests = [];
        page.on('requestfailed', (r) => {
            if (r.url().includes('primeicons'))
                errors.push('font:' + r.failure()?.errorText);
        });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route(
            '**/api/family-portfolio?action=inspectSpreadsheet',
            (r) => {
                requests.push('inspectSpreadsheet');
                return r.fulfill({ json: data });
            }
        );
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/.phase32-broker.html'
        );
        await page
            .getByRole('heading', {
                name: '증권사 파일 열 연결 (컬럼 매핑)',
                exact: true,
            })
            .waitFor();
        const choose = async (label, option) => {
            if (label === '연결 자료 종류') {
                await page
                    .getByRole('radiogroup', { name: label, exact: true })
                    .getByText(option, { exact: true })
                    .click();
                return;
            }
            await page.getByLabel(label, { exact: true }).click();
            await page
                .getByRole('option', { name: option, exact: true })
                .click();
            await page
                .locator('.p-select-overlay')
                .waitFor({ state: 'hidden' });
        };
        await choose('연결 자료 종류', '거래 내역');
        await page
            .getByLabel('조회 종료일', { exact: true })
            .fill('2026-11-03');
        await page
            .getByLabel('CSV 또는 XLSX 파일', { exact: true })
            .setInputFiles({
                name: 'DEMO.csv',
                mimeType: 'text/csv',
                buffer: Buffer.from(
                    data.headers.join(',') +
                        '\n' +
                        data.previewRows.map((r) => r.join(',')).join('\n')
                ),
            });
        await page.getByLabel(/명의와 계좌에 속하는/).check();
        await page
            .getByRole('button', { name: '열 연결 설정 불러오기', exact: true })
            .click();
        await page
            .getByRole('button', { name: '파일 열 확인', exact: true })
            .click();
        await page.locator('.broker-basic-fields').waitFor();
        await page.waitForFunction(
            () => !document.querySelector('.p-message-enter-active')
        );
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() =>
            Promise.allSettled(
                document
                    .getAnimations()
                    .filter((a) =>
                        Number.isFinite(a.effect?.getTiming().iterations)
                    )
                    .map((a) => a.finished)
            )
        );
        assert.equal(
            await page
                .getByRole('button', {
                    name: '연결 자료 미리보기',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        assert.equal(
            await page.locator('.broker-raw-preview tbody tr').count(),
            3
        );
        const implementation = await page.evaluate(metrics, false);
        assert.equal(implementation.overflow, false);
        await page.screenshot({
            path: `${out}/implementation-${width}.png`,
            fullPage: true,
        });
        if (width === 390) {
            await page.evaluate(() =>
                document.documentElement.classList.add('p-dark')
            );
            assert.notEqual(
                await page
                    .locator('.broker-heading h3')
                    .evaluate((e) => getComputedStyle(e).color),
                'rgb(56, 36, 24)',
                'dark headings remain readable'
            );
            await page.screenshot({
                path: `${out}/implementation-dark-390.png`,
                fullPage: true,
            });
            await page.evaluate(() =>
                document.documentElement.classList.remove('p-dark')
            );
        }
        await choose('연결 거래 유형', '3열 · rawtype');
        assert.equal(
            await page
                .getByRole('button', {
                    name: '연결 자료 미리보기',
                    exact: true,
                })
                .isEnabled(),
            true
        );
        await page
            .getByRole('button', { name: '연결 자료 미리보기', exact: true })
            .click();
        assert.equal(await page.evaluate(() => window.phase32.previews), 1);
        assert.deepEqual(requests, ['inspectSpreadsheet']);
        await choose('연결 거래 유형', '2열 · symbol');
        assert.equal(
            await page
                .getByRole('button', {
                    name: '연결 자료 미리보기',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        assert.ok(
            await page
                .getByText(
                    '같은 열을 여러 항목에 연결할 수 없습니다. 중복 연결을 해제하세요.',
                    { exact: true }
                )
                .isVisible()
        );
        assert.deepEqual(requests, ['inspectSpreadsheet']);
        await page.evaluate(() => (window.phase32.busy.value = true));
        assert.equal(
            await page
                .getByLabel('연결 거래 유형', { exact: true })
                .getAttribute('aria-disabled'),
            'true'
        );
        assert.equal(
            await page
                .getByRole('radiogroup', {
                    name: '연결 자료 종류',
                    exact: true,
                })
                .getByRole('radio', { name: '거래 내역', exact: true })
                .isDisabled(),
            true
        );
        assert.deepEqual(errors, []);
        results.push({
            width,
            id,
            original,
            implementation,
            sourceFailures,
            failures,
            errors,
            requestCount: requests.length,
            states: 'missing type blocked;ready emits preview;duplicate mapping blocked;busy disabled;three raw rows',
        });
        await source.close();
        await page.close();
    }
    await fs.writeFile(
        `${out}/measurements.json`,
        JSON.stringify(results, null, 2)
    );
    console.log(
        JSON.stringify(
            results.map((r) => ({
                width: r.width,
                heading: [r.original.heading, r.implementation.heading],
                sourceFailures: r.sourceFailures,
                failures: r.failures,
                states: r.states,
            }))
        )
    );
} finally {
    await b.close();
    await fs.unlink(harness);
}
