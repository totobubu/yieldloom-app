// Local synthetic file chooser only. No auth, API, customer files or storage.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';

const base = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5175');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
const evidence = process.env.UPLOAD_REPLACEMENT_EVIDENCE_DIR;
if (evidence) await fs.mkdir(evidence, { recursive: true });
const xlsx = execFileSync(process.env.FAMILY_TEST_PYTHON || 'python3', [
    '-c',
    "from openpyxl import Workbook; from io import BytesIO; import sys; b=Workbook(); b.active.append(['date','symbol','amount','currency','type']); b.active.append(['2026-03-01','DEMO',10,'USD','dividend']); out=BytesIO(); b.save(out); b.close(); sys.stdout.buffer.write(out.getvalue())",
]);
const file = (name, format = 'standard-csv') => ({
    name,
    mimeType:
        format === 'standard-xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : format === 'toss-pdf'
              ? 'application/pdf'
              : 'text/csv',
    buffer:
        format === 'standard-xlsx'
            ? xlsx
            : Buffer.from(
                  format === 'toss-pdf'
                      ? '%PDF-1.4\n% synthetic chooser fixture only\n%%EOF'
                      : 'date,symbol,amount,currency,type\n2026-03-01,DEMO,10,USD,dividend\n'
              ),
});
const fixture = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app" class="studio-shell"></div><script type="module">
import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Upload from '/src/components/portfolio/PortfolioFileImportForm.vue';import 'primeicons/primeicons.css';import '/src/styles/style.scss';import '/src/styles/studio.scss';
const values={kind:ref('transactions'),format:ref('standard-csv'),asOf:ref('2026-03-31'),password:ref(''),rememberPassword:ref(false),confirmed:ref(false)},files=ref([]),preview=ref(null),busy=ref(false),events=[];window.uploadReplacementFixture={values,files,preview,busy,events};
createApp({setup(){return()=>h('main',{class:'fixture-frame'},h(Upload,{accountLabel:'DEMO-ACC-****-891',passwordConfigured:false,isOwner:true,busy:busy.value,error:'',reviewing:false,kindOptions:[{label:'거래내역',value:'transactions'},{label:'잔고',value:'holdings'}],formatOptions:[{label:'CSV',value:'standard-csv'},{label:'XLSX',value:'standard-xlsx'},{label:'PDF',value:'toss-pdf'}],selectedFiles:files.value,previewReview:preview.value,...Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v.value])),...Object.fromEntries(Object.entries(values).map(([k,v])=>['onUpdate:'+k,x=>v.value=x])),onSelect:e=>{files.value=e.files;preview.value=null;values.confirmed.value=false;events.push('select')},onClear:()=>{files.value=[];preview.value=null;events.push('clear')}}));}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');
</script><style>body{margin:0}.fixture-frame{max-width:834px;margin:auto;padding:24px}@media(max-width:640px){.fixture-frame{max-width:390px;padding:16px}}</style></body></html>`;
const harness = fileURLToPath(
    new URL('../.phase72-upload-replacement.html', import.meta.url)
);
await fs.writeFile(harness, fixture, { flag: 'wx' });
let browser;
const results = [];
const state = (page) =>
    page.evaluate(() => {
        const f = window.uploadReplacementFixture;
        return {
            files: f.files.value.map((v) => v.name),
            previewRows: f.preview.value?.rows?.length ?? null,
            confirmed: f.values.confirmed.value,
            events: [...f.events],
        };
    });
try {
    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox'],
    });
    for (const width of [1280, 834, 390]) {
        for (const format of ['standard-csv', 'standard-xlsx']) {
            for (const action of width < 641
                ? ['picker', 'filename']
                : ['filename']) {
                const context = await browser.newContext({
                    viewport: { width, height: 1000 },
                });
                await installStaticAssets(context);
                let api = 0;
                await context.route('**/api/**', (route) => {
                    api++;
                    return route.abort();
                });
                const page = await context.newPage(),
                    errors = [];
                page.on('pageerror', (e) => errors.push(e.message));
                await page.goto(
                    new URL('/.phase72-upload-replacement.html', base).href
                );
                await page.locator('.import-layout').waitFor();
                await page.evaluate((value) => {
                    window.uploadReplacementFixture.values.format.value = value;
                }, format);
                const ext = format === 'standard-csv' ? 'csv' : 'xlsx';
                const original = `DEMO_SOURCE.${ext}`;
                await page
                    .getByLabel('파일', { exact: true })
                    .setInputFiles(file(original, format));
                await page.evaluate(() => {
                    const f = window.uploadReplacementFixture;
                    f.values.confirmed.value = true;
                    f.preview.value = {
                        kind: 'transactions',
                        rows: [
                            {
                                date: '2026-03-01',
                                symbol: 'DEMO',
                                amount: 10,
                                currency: 'USD',
                                type: 'dividend',
                            },
                        ],
                    };
                });
                const before = await state(page);
                const choose = async (name = original) => {
                    const next = page
                        .waitForEvent('filechooser', { timeout: 15000 })
                        .catch(() => null);
                    if (action === 'filename')
                        await page
                            .getByRole('button', {
                                name: `${name} 변경`,
                                exact: true,
                            })
                            .click();
                    else
                        await page
                            .getByRole('button', {
                                name: width < 641 ? '파일 선택' : '파일 변경',
                                exact: true,
                            })
                            .click();
                    return next;
                };
                const chooser = await choose();
                if (!chooser) {
                    const after = await state(page);
                    console.log(
                        JSON.stringify({
                            width,
                            format,
                            action,
                            before,
                            after,
                            chooserOpened: false,
                            api,
                            errors,
                        })
                    );
                    if (evidence)
                        await page.screenshot({
                            path: resolve(
                                evidence,
                                'replacement-did-not-open.png'
                            ),
                            fullPage: true,
                        });
                    assert.ok(
                        chooser,
                        'replacement control must open a file chooser'
                    );
                }
                const nativeCancelSupported = await chooser
                    .element()
                    .evaluate((el) => {
                        const supported = 'oncancel' in el;
                        el.dispatchEvent(new Event('cancel'));
                        return supported;
                    });
                await chooser.setFiles([]);
                const cancelled = await state(page);
                if (evidence)
                    await page.screenshot({
                        path: resolve(
                            evidence,
                            `cancel-${width}-${format}-${action}.png`
                        ),
                        fullPage: true,
                    });
                console.log(
                    JSON.stringify({
                        width,
                        format,
                        action,
                        before,
                        cancelled,
                        nativeCancelSupported,
                    })
                );
                assert.deepEqual(
                    cancelled,
                    before,
                    'cancelling a replacement must preserve the selected file, preview and account confirmation'
                );
                const replacement = await choose();
                await replacement.setFiles(
                    file(`DEMO_REPLACED.${ext}`, format)
                );
                const selected = await state(page);
                assert.deepEqual(selected.files, [`DEMO_REPLACED.${ext}`]);
                assert.equal(selected.confirmed, false);
                assert.equal(selected.previewRows, null);
                assert.deepEqual(selected.events, [
                    'select',
                    'clear',
                    'select',
                ]);
                if (width === 834) {
                    const invalid = await choose(`DEMO_REPLACED.${ext}`);
                    assert.ok(invalid);
                    await invalid.setFiles({
                        name: 'DEMO_INVALID.txt',
                        mimeType: 'text/plain',
                        buffer: Buffer.from('synthetic invalid format'),
                    });
                    assert.deepEqual((await state(page)).files, []);
                    await page
                        .getByText(/선택한 파일 형식과 일치하는 파일/)
                        .waitFor();
                    await page
                        .getByLabel('파일', { exact: true })
                        .setInputFiles(file(original, format));
                    const oversize = await choose();
                    assert.ok(oversize);
                    await oversize.setFiles({
                        ...file(`DEMO_LARGE.${ext}`, format),
                        buffer: Buffer.alloc(2097153),
                    });
                    assert.deepEqual((await state(page)).files, []);
                    await page.getByText(/파일 크기는 2MB 이하여야/).waitFor();
                    await page
                        .getByLabel('파일', { exact: true })
                        .setInputFiles(file(`DEMO_REPLACED.${ext}`, format));
                }
                assert.equal(
                    await page
                        .getByRole('list', { name: '선택한 파일' })
                        .count(),
                    1
                );
                assert.equal(
                    await page.evaluate(
                        () => document.documentElement.scrollWidth > innerWidth
                    ),
                    false
                );
                assert.equal(api, 0);
                assert.deepEqual(errors, []);
                results.push({
                    width,
                    format,
                    action,
                    nativeCancelSupported,
                    api,
                });
                await context.close();
            }
        }
    }
    for (const width of [834, 390]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
        });
        await installStaticAssets(context);
        let api = 0;
        await context.route('**/api/**', (route) => {
            api++;
            return route.abort();
        });
        const page = await context.newPage();
        await page.goto(
            new URL('/.phase72-upload-replacement.html', base).href
        );
        await page.locator('.import-layout').waitFor();
        await page.evaluate(() => {
            window.uploadReplacementFixture.values.format.value = 'toss-pdf';
        });
        await page
            .getByLabel('파일', { exact: true })
            .setInputFiles(file('DEMO_FIRST.pdf', 'toss-pdf'));
        const before = await state(page);
        const choosing = page
            .waitForEvent('filechooser', { timeout: 15000 })
            .catch(() => null);
        await page
            .getByRole('button', { name: '파일 추가', exact: true })
            .click();
        const chooser = await choosing;
        assert.ok(chooser, 'PDF add control must open a file chooser');
        await chooser
            .element()
            .evaluate((el) => el.dispatchEvent(new Event('cancel')));
        assert.deepEqual(await state(page), before);
        await chooser.setFiles(file('DEMO_SECOND.pdf', 'toss-pdf'));
        const added = await state(page);
        assert.deepEqual(added.files, ['DEMO_FIRST.pdf', 'DEMO_SECOND.pdf']);
        assert.deepEqual(added.events, ['select', 'select']);
        assert.equal(added.confirmed, false);
        assert.equal(api, 0);
        results.push({ width, format: 'toss-pdf', action: 'add', api });
        await context.close();
    }
    if (evidence)
        await fs.writeFile(
            resolve(evidence, 'results.json'),
            JSON.stringify(results, null, 2) + '\n'
        );
    console.log(
        'PASS: 8 synthetic CSV/XLSX PC/Tablet/Mobile file chooser cases preserve selection/preview/confirmation on empty selection and synthetic cancel; genuine replacement resets confirmation/preview and keeps one validated file; wrong extension/2MB limit still reject; 2 PDF addition cases retain both files; API0. OS dialog cancel button and real account/PDF parsing not exercised.'
    );
} finally {
    await browser?.close();
    await fs.unlink(harness);
}
