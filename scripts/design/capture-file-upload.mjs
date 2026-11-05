/* global window, document, innerWidth, getComputedStyle */
// Isolated local UI with synthetic files. No auth, API or customer writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const base = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5190');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const out = resolve(
    process.env.STITCH_CAPTURE_DIR || '/tmp/yieldloom-upload-phase36'
);
await fs.mkdir(out, { recursive: true });
const harness = resolve(repo, '.phase36-upload.html');
await fs.writeFile(
    harness,
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app" class="studio-shell"></div><script type="module">import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Upload from '/src/components/portfolio/PortfolioFileImportForm.vue';import 'primeicons/primeicons.css';import '/src/styles/style.scss';import '/src/styles/studio.scss';const values={kind:ref('transactions'),format:ref('standard-csv'),asOf:ref('2026-03-31'),password:ref(''),rememberPassword:ref(false),confirmed:ref(false)},files=ref([]),busy=ref(false),owner=ref(true),error=ref(''),component=ref(null),events=[];window.uploadFixture={values,files,busy,owner,error,component,events};createApp({setup(){return()=>h('main',{class:'fixture-frame'},h(Upload,{ref:component,accountLabel:'DEMO-ACC-****-891',passwordConfigured:true,isOwner:owner.value,busy:busy.value,error:error.value,reviewing:false,kindOptions:[{label:'거래 내역',value:'transactions'},{label:'보유 잔고',value:'holdings'}],formatOptions:[{label:'표준 CSV',value:'standard-csv'},{label:'표준 XLSX',value:'standard-xlsx'},{label:'토스 거래내역 PDF',value:'toss-pdf'}],selectedFiles:files.value,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.value])),...Object.fromEntries(Object.entries(values).map(([k,v])=>['onUpdate:'+k,x=>v.value=x])),onSelect:e=>{files.value=e.files;values.confirmed.value=false;events.push('select')},onClear:()=>{files.value=[];events.push('clear')},onPreview:()=>events.push('preview'),onManual:()=>events.push('manual'),onRemovePassword:()=>events.push('remove-password'),onReset:()=>{component.value.clear();values.confirmed.value=false;events.push('reset')}}));}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');</script><style>body{margin:0}.fixture-frame{max-width:834px;margin:auto;padding:24px}@media(max-width:640px){.fixture-frame{max-width:390px;padding:16px}}</style></body></html>`
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
        const page = await context.newPage();
        const errors = [];
        let apiCalls = 0;
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
            if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls++;
        });
        await page.goto(new URL('/.phase36-upload.html', base).href);
        await page
            .getByRole('heading', { name: '증권 데이터 등록', exact: true })
            .waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page
            .getByRole('radio', { name: '보유 잔고', exact: true })
            .check();
        assert.equal(
            await page.evaluate(() => window.uploadFixture.values.kind.value),
            'holdings'
        );
        await page
            .getByRole('radio', { name: '거래 내역', exact: true })
            .check();
        await page.getByLabel('파일', { exact: true }).setInputFiles({
            name: 'DEMO_DIVIDEND_2024.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from(
                'date,symbol,amount,currency,type,externalId\n2024-03-15,DEMO-A,43.32,KRW,dividend,DEMO-1\n'
            ),
        });
        await page
            .getByRole('list', { name: '선택한 파일', exact: true })
            .waitFor();
        assert.equal(
            await page
                .getByRole('button', { name: '추출·미리보기', exact: true })
                .isDisabled(),
            true
        );
        assert.match(
            await page.locator('.upload-preview').innerText(),
            /이 화면에는 원문 행을 표시하지 않습니다/
        );
        assert.ok(
            !/142|정상 인식|세전 실입금액/.test(
                await page.locator('.upload-preview').innerText()
            )
        );
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false,
            `viewport ${width} overflow`
        );
        await page.evaluate(() => document.activeElement?.blur());
        const measured = await page.locator('.import-layout').evaluate((e) => {
            const r = e.getBoundingClientRect();
            return {
                width: r.width,
                height: r.height,
                header: e
                    .querySelector('.upload-heading')
                    .getBoundingClientRect().height,
                headerParts: Object.fromEntries(
                    [
                        '.upload-badges',
                        '.upload-heading-row > div',
                        '.upload-heading-row .p-button',
                        '.upload-steps',
                    ].map((sel) => {
                        const rect = e
                            .querySelector(sel)
                            .getBoundingClientRect();
                        return [
                            sel,
                            { width: rect.width, height: rect.height },
                        ];
                    })
                ),
            };
        });
        await page.screenshot({
            path: resolve(out, `implementation-${width}.png`),
            fullPage: true,
        });
        await page
            .getByRole('checkbox', { name: /의 자료임을 확인했습니다/ })
            .check();
        await page
            .getByRole('button', { name: '추출·미리보기', exact: true })
            .click();
        assert.equal(
            await page.evaluate(
                () =>
                    window.uploadFixture.events.filter((e) => e === 'preview')
                        .length
            ),
            1
        );
        await page
            .getByRole('button', { name: '직접 수기 입력', exact: true })
            .click();
        assert.ok(
            (await page.evaluate(() => window.uploadFixture.events)).includes(
                'manual'
            )
        );
        await page
            .getByRole('button', {
                name: 'DEMO_DIVIDEND_2024.csv 제거',
                exact: true,
            })
            .click();
        assert.equal(
            await page.evaluate(() => window.uploadFixture.files.value.length),
            0
        );
        await page
            .getByRole('combobox', { name: '파일 형식', exact: true })
            .click();
        await page
            .getByRole('option', { name: '토스 거래내역 PDF', exact: true })
            .click();
        await page.getByLabel('PDF 비밀번호', { exact: true }).fill('fixture');
        await page
            .getByRole('button', { name: '비밀번호 표시', exact: true })
            .click();
        assert.equal(
            await page
                .getByLabel('PDF 비밀번호', { exact: true })
                .getAttribute('type'),
            'text'
        );
        await page
            .getByRole('button', { name: '저장된 비밀번호 삭제', exact: true })
            .click();
        assert.ok(
            (await page.evaluate(() => window.uploadFixture.events)).includes(
                'remove-password'
            )
        );
        await page.evaluate(() => {
            window.uploadFixture.owner.value = false;
        });
        assert.equal(
            await page
                .getByRole('checkbox', {
                    name: '이 계좌의 기본 비밀번호로 암호화 저장',
                    exact: true,
                })
                .count(),
            0
        );
        assert.equal(
            await page
                .getByRole('button', {
                    name: '저장된 비밀번호 삭제',
                    exact: true,
                })
                .count(),
            0
        );
        await page.evaluate(() => {
            window.uploadFixture.busy.value = true;
        });
        assert.equal(
            await page
                .getByRole('button', { name: '직접 수기 입력', exact: true })
                .isDisabled(),
            true
        );
        assert.equal(
            await page
                .getByRole('button', { name: '추출·미리보기', exact: true })
                .isDisabled(),
            true
        );
        await page.evaluate(() => {
            window.uploadFixture.busy.value = false;
            document.documentElement.classList.add('p-dark');
        });
        if (width === 390)
            await page.screenshot({
                path: resolve(out, 'implementation-dark-390.png'),
                fullPage: true,
            });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        assert.equal(apiCalls, 0);
        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        const item = {
            width,
            implementation: measured,
            apiCalls,
            visualAcceptance:
                'not accepted; pre-extraction data and format controls differ from source post-inspection fixture',
        };
        if ([834, 768, 390].includes(width)) {
            const id =
                width === 390
                    ? '80b06442816e4d1baebc96cb520b19d6'
                    : '3c2a0d37b5f54a63b3a633f01f0d2b33';
            const html = await fs.readFile(
                resolve(
                    repo,
                    `docs/design/stitch-v3/originals/17382728461495959991/${id}.html`
                ),
                'utf8'
            );
            await page.route('**/source-upload', (route) =>
                route.fulfill({ contentType: 'text/html', body: html })
            );
            await page.goto(new URL('/source-upload', base).href);
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
                path: resolve(out, `source-${width}.png`),
                fullPage: true,
            });
            item.sourceId = id;
            item.sourceGeometry = await page.evaluate(() => {
                const title = document.querySelector('h1');
                const header = title.closest('header');
                const group = title.parentElement.parentElement;
                const first = group.children[0].getBoundingClientRect();
                const last = group.children[2]?.getBoundingClientRect();
                const action = [...document.querySelectorAll('button')].find(
                    (el) => el.textContent.includes('직접 수기 입력')
                );
                return {
                    titleSize: getComputedStyle(title).fontSize,
                    titleHeight: title.getBoundingClientRect().height,
                    headerHeight: header
                        ? header.getBoundingClientRect().height
                        : last.bottom - first.top,
                    manualButtonHeight: action.getBoundingClientRect().height,
                    manualButtonWidth: action.getBoundingClientRect().width,
                    tabletParts: header
                        ? [...header.children].map((el) => ({
                              tag: el.tagName,
                              width: el.getBoundingClientRect().width,
                              height: el.getBoundingClientRect().height,
                          }))
                        : null,
                };
            });
            if (width >= 768)
                assert.equal(
                    item.implementation.header,
                    item.sourceGeometry.headerHeight,
                    'Tablet header must match the unmodified source height'
                );
            item.sourceAssetFailures = [...failures];
            if (failures.length)
                item.visualAcceptance =
                    'blocked: original source font asset unavailable';
        }
        results.push(item);
        await context.close();
    }
    await fs.writeFile(
        resolve(out, 'measurements.json'),
        JSON.stringify(results, null, 2) + '\n'
    );
    console.log(
        'PASS: 5 widths, real file selection/remove, ownership gate, kind/format, password owner controls, busy/dark, manual shortcut; zero API calls. Full visual acceptance pending.'
    );
} finally {
    await browser.close();
    await fs.unlink(harness);
}
