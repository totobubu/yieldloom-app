// Local synthetic mapping only. No production accounts, data or API writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const base = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5175');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const evidence = process.env.BROKER_CONFIRMATION_EVIDENCE_DIR;
if (evidence) await fs.mkdir(evidence, { recursive: true });
const harness = fileURLToPath(
    new URL('../.phase74-broker-confirm.html', import.meta.url)
);
await fs.writeFile(
    harness,
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app" class="studio-shell"></div><script type="module">
import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Broker from '/src/components/portfolio/BrokerSpreadsheetForm.vue';import '/src/styles/style.scss';import '/src/styles/studio.scss';
const account=ref({id:'synthetic-account',ownerId:'stitch-review-user',institution:'합성증권',alias:'DEMO-ACC-****-891'}),busy=ref(false),previews=[];window.brokerConfirmFixture={account,busy,previews};createApp({setup(){return()=>h('main',{class:'fixture-frame'},h(Broker,{account:account.value,busy:busy.value,onPreview:({form,kind,asOf})=>previews.push({kind,asOf,fields:Object.fromEntries([...form.entries()].filter(([key])=>key!=='file')),file:{name:form.get('file').name,size:form.get('file').size}})}));}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');
</script><style>body{margin:0}.fixture-frame{max-width:1280px;margin:auto;padding:32px 24px}@media(max-width:1023px){.fixture-frame{max-width:834px;padding:24px}}@media(max-width:640px){.fixture-frame{max-width:390px;padding:20px 16px}}</style></body></html>`,
    { flag: 'wx' }
);
const data = {
    sheets: [],
    sheet: '',
    headers: [
        'date',
        'symbol',
        'type',
        'externalId',
        'quantity',
        'amount',
        'currency',
    ],
    rowCount: 1,
    previewRows: [
        ['2026-03-01', 'DEMO', 'buy', 'DEMO-001', '2.125', '100.0001', 'USD'],
    ],
};
const file = {
    name: 'DEMO.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
        data.headers.join(',') + '\n' + data.previewRows[0].join(',') + '\n'
    ),
};
const workbook = execFileSync(process.env.FAMILY_TEST_PYTHON || 'python3', [
    '-c',
    "from openpyxl import Workbook; from io import BytesIO; import sys; b=Workbook(); b.active.append(['date','symbol','type','externalId','quantity','amount','currency']); b.active.append(['2026-03-01','DEMO','buy','DEMO-001',2.125,100.0001,'USD']); out=BytesIO(); b.save(out); b.close(); sys.stdout.buffer.write(out.getvalue())",
]);
let browser;
const results = [],
    violations = [];
try {
    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox'],
    });
    for (const width of [1280, 834, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1100 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(page, { admin: true });
        await installStaticAssets(page);
        const requests = [],
            errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
            if (new URL(r.url()).pathname.startsWith('/api/'))
                requests.push({
                    method: r.method(),
                    action: new URL(r.url()).searchParams.get('action'),
                });
        });
        await page.route(
            '**/api/family-portfolio?action=inspectSpreadsheet',
            (r) => r.fulfill({ json: data })
        );
        await page.goto(new URL('/.phase74-broker-confirm.html', base).href);
        const form = page.locator('.broker-import'),
            submit = form.getByRole('button', {
                name: '연결 자료 미리보기',
                exact: true,
            }),
            check = form.getByLabel(
                '파일의 열 연결과 기본 통화를 확인했습니다.',
                { exact: true }
            );
        const choose = async (label, option) => {
            await form.getByLabel(label, { exact: true }).click();
            await page
                .getByRole('option', { name: option, exact: true })
                .click();
            // Select restores focus asynchronously when its option list closes.
            await page.getByRole('listbox').waitFor({ state: 'hidden' });
        };
        const count = () =>
            page.evaluate(() => window.brokerConfirmFixture.previews.length);
        const bypass = () =>
            form
                .locator('form')
                .evaluate((e) =>
                    e.dispatchEvent(
                        new Event('submit', { bubbles: true, cancelable: true })
                    )
                );
        const inspect = async () => {
            await form
                .getByRole('button', { name: '파일 열 확인', exact: true })
                .click();
            await form.getByLabel('연결 거래 유형', { exact: true }).waitFor();
        };
        const confirm = async () => {
            assert.equal(await check.isEnabled(), true);
            await check.focus();
            assert.equal(
                await check.evaluate(
                    (element) => element === document.activeElement
                ),
                true
            );
            await page.keyboard.press('Space');
            assert.equal(await check.isChecked(), true);
        };
        const snapshot = async () => ({
            checked: await check.isChecked(),
            disabled: await submit.isDisabled(),
            height: await form
                .locator('.broker-confirm-card')
                .evaluate((e) => e.getBoundingClientRect().height),
            previews: await count(),
            requests: requests.length,
        });
        await form
            .getByRole('radiogroup', { name: '연결 자료 종류', exact: true })
            .getByText('거래 내역', { exact: true })
            .click();
        await form
            .getByLabel('조회 종료일', { exact: true })
            .fill('2026-03-31');
        await form
            .getByLabel('CSV 또는 XLSX 파일', { exact: true })
            .setInputFiles(file);
        await form.getByLabel(/명의와 계좌에 속하는/).check();
        await inspect();
        const manual = await snapshot();
        if (evidence)
            await page.screenshot({
                path: resolve(evidence, `manual-unchecked-${width}.png`),
                fullPage: true,
            });
        if (!manual.disabled) {
            violations.push(width);
            results.push({
                width,
                manual,
                gate: 'manual unchecked still enabled',
            });
            await page.close();
            continue;
        }
        await check.focus();
        await page.keyboard.press('Enter');
        assert.equal(await count(), 0);
        assert.equal(
            await check.evaluate((input) => input.validity.valueMissing),
            true
        );
        await form
            .locator('form')
            .evaluate((element) => element.requestSubmit());
        assert.equal(await count(), 0);
        await bypass();
        assert.equal(await count(), 0);
        await confirm();
        assert.equal(await submit.isEnabled(), true);
        await submit.focus();
        await page.keyboard.press('Enter');
        assert.equal(await count(), 1);
        const original = await page.evaluate(
            () => window.brokerConfirmFixture.previews[0]
        );
        assert.deepEqual(JSON.parse(original.fields.mapping), {
            date: 0,
            symbol: 1,
            type: 2,
            externalId: 3,
            quantity: 4,
            amount: 5,
            currency: 6,
        });
        assert.equal(original.fields.accountId, 'synthetic-account');
        assert.equal(original.fields.identityConfirmed, 'true');
        assert.equal(original.fields.defaultCurrency, '');
        assert.equal(original.file.name, 'DEMO.csv');
        // Both operations happen in one browser task, before Vue's normal DOM flush.
        await form.locator('.broker-currency-toggle').evaluate((group) => {
            const input = group.querySelector('input[value="USD"]');
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            group
                .closest('form')
                .dispatchEvent(
                    new Event('submit', { bubbles: true, cancelable: true })
                );
        });
        assert.equal(await check.isChecked(), false);
        assert.equal(await count(), 1);
        await confirm();
        await form.getByLabel('연결 평가액/거래 금액', { exact: true }).click();
        await page
            .getByRole('option', { name: '연결 안 함', exact: true })
            .evaluate((option) => {
                option.dispatchEvent(
                    new MouseEvent('mousedown', { bubbles: true })
                );
                document
                    .querySelector('.broker-import form')
                    .dispatchEvent(
                        new Event('submit', { bubbles: true, cancelable: true })
                    );
            });
        assert.equal(await check.isChecked(), false);
        assert.equal(await count(), 1);
        await choose('연결 평가액/거래 금액', '6열 · amount');
        await confirm();
        await page.evaluate(
            () => (window.brokerConfirmFixture.busy.value = true)
        );
        await bypass();
        assert.equal(await count(), 1);
        await page.evaluate(
            () => (window.brokerConfirmFixture.busy.value = false)
        );
        await submit.click();
        assert.equal(await count(), 2);
        const changed = await page.evaluate(
            () => window.brokerConfirmFixture.previews[1]
        );
        assert.deepEqual(
            { ...changed.fields, defaultCurrency: '' },
            original.fields
        );
        await form
            .locator('.broker-preset-actions')
            .getByRole('button', { name: '열 연결 설정 저장', exact: true })
            .click();
        await form
            .getByText(/이 브라우저에 열 연결 설정을 저장했습니다/)
            .waitFor();
        await form
            .getByRole('button', { name: '열 연결 설정 불러오기', exact: true })
            .click();
        await bypass();
        assert.equal(await count(), 2);
        await inspect();
        await form
            .getByText(
                '불러온 열 연결과 통화를 확인한 뒤 확인란을 선택하세요.',
                { exact: true }
            )
            .waitFor();
        assert.equal(await check.isChecked(), false);
        assert.equal(await submit.isDisabled(), true);
        await bypass();
        assert.equal(await count(), 2);
        await confirm();
        await submit.click();
        assert.equal(await count(), 3);
        // A missing required column must also reject direct submit despite old consent.
        await choose('연결 거래 유형', '연결 안 함');
        await bypass();
        assert.equal(await count(), 3);
        assert.equal(await check.isDisabled(), true);
        await choose('연결 거래 유형', '3열 · type');
        await confirm();
        await form
            .getByLabel('CSV 또는 XLSX 파일', { exact: true })
            .setInputFiles({
                name: 'DEMO.xlsx',
                mimeType:
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                buffer: workbook,
            });
        await form.getByLabel(/명의와 계좌에 속하는/).check();
        await inspect();
        assert.equal(await check.isChecked(), false);
        await confirm();
        // Sheet/header/encoding changes invalidate inspected information.
        for (const [label, value] of [
            ['워크시트 (선택)', 'Other'],
            ['헤더 시작 행', '2'],
        ]) {
            await form
                .locator('.broker-upload-settings')
                .evaluate((e) => (e.open = true));
            const input =
                label === '헤더 시작 행'
                    ? form.locator('#broker-header-row')
                    : form.getByLabel(label, { exact: true });
            await input.fill(value);
            await input.press('Tab');
            await bypass();
            assert.equal(await count(), 3);
            assert.equal(await form.locator('.broker-basic-fields').count(), 0);
            await input.fill(label === '워크시트 (선택)' ? '' : '1');
            await input.press('Tab');
            await inspect();
            assert.equal(await check.isChecked(), false);
            await confirm();
        }
        await choose('CSV 인코딩', '한국어 CP949');
        await bypass();
        assert.equal(await count(), 3);
        assert.equal(await form.locator('.broker-basic-fields').count(), 0);
        await choose('CSV 인코딩', 'UTF-8');
        await inspect();
        assert.equal(await check.isChecked(), false);
        await confirm();
        await form
            .getByRole('button', {
                name: '파일·계좌 확인 및 업로드 설정 열기',
                exact: true,
            })
            .click();
        await choose('파일 증권사', '키움증권');
        await bypass();
        assert.equal(await count(), 3);
        await form.getByLabel(/명의와 계좌에 속하는/).check();
        await inspect();
        assert.equal(await check.isChecked(), false);
        await confirm();
        await form
            .getByLabel('CSV 또는 XLSX 파일', { exact: true })
            .setInputFiles({ ...file, name: 'DEMO_RESELECTED.csv' });
        await bypass();
        assert.equal(await count(), 3);
        assert.equal(
            await form.getByLabel(/명의와 계좌에 속하는/).isChecked(),
            false
        );
        await form.getByLabel(/명의와 계좌에 속하는/).check();
        await inspect();
        assert.equal(await check.isChecked(), false);
        await confirm();
        await page.evaluate(
            () =>
                (window.brokerConfirmFixture.account.value = {
                    ...window.brokerConfirmFixture.account.value,
                    id: 'synthetic-other-account',
                })
        );
        await bypass();
        assert.equal(await count(), 3);
        assert.equal(
            await form.getByLabel(/명의와 계좌에 속하는/).isChecked(),
            false
        );
        await form.getByLabel(/명의와 계좌에 속하는/).check();
        await inspect();
        assert.equal(await check.isChecked(), false);
        await confirm();
        await form
            .getByRole('radiogroup', { name: '연결 자료 종류', exact: true })
            .getByText('전체 잔고', { exact: true })
            .click();
        await bypass();
        assert.equal(await count(), 3);
        assert.equal(
            await form.getByLabel(/명의와 계좌에 속하는/).isChecked(),
            false
        );
        assert.ok(
            requests.every(
                (r) => r.method === 'POST' && r.action === 'inspectSpreadsheet'
            )
        );
        assert.equal(
            requests.length,
            9,
            'only the nine explicit inspections use the API'
        );
        assert.deepEqual(errors, []);
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        results.push({
            width,
            manual,
            payload: original,
            previewEmits: await count(),
            requests,
            errors,
            sameTickReset: true,
            transitions: [
                'preset',
                'mapping',
                'currency',
                'busy',
                'sheet',
                'header',
                'encoding',
                'broker',
                'file',
                'account',
                'kind',
            ],
            scope: 'synthetic component/inspect response only; preview payload emitted without production write; source fidelity is not native PNG acceptance',
        });
        await page.close();
    }
    if (evidence)
        await fs.writeFile(
            resolve(evidence, 'results.json'),
            JSON.stringify(results, null, 2) + '\n'
        );
    assert.deepEqual(
        violations,
        [],
        'all mappings must require explicit confirmation under the revised UX'
    );
    console.log(
        'PASS: manual/preset confirmation, same-tick invalidation, all scope/settings changes, busy/direct submit, keyboard and unchanged FormData; only explicit synthetic inspection requests. No real account/PDF/DB writes.'
    );
} finally {
    await browser?.close();
    await fs.unlink(harness);
}
