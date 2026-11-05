import { openPortfolioPage } from './portfolio-navigation.mjs';
// Local Vite + in-memory Flask only. No production identities or data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixtureDir = await mkdtemp(join(tmpdir(), 'yieldloom-broker-'));
const fixturePath = join(fixtureDir, 'broker.xlsx');
execFileSync(process.env.FAMILY_TEST_PYTHON || 'python3', [
    '-c',
    "from openpyxl import Workbook; import sys; b=Workbook(); b.active.append(['종목코드','잔고수량','평가금액','거래통화']); b.active.append(['AAPL',1.25,250,'USD']); b.save(sys.argv[1]); b.close()",
    fixturePath,
]);
import { chromium } from 'playwright';

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });
    const errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import { ref, computed } from '/node_modules/.vite/deps/vue.js';
            export const firebaseUser = ref({uid: 'manual-browser-' + Date.now(), displayName: '테스트', email: 'totobubu.lab@gmail.com', emailVerified: true, getIdToken: async function() { return this.uid; }});
            export const authLoading = ref(false), signedIn = computed(() => true);
            export const firebaseReady = false, db = null, auth = null, googleProvider = null;`,
        })
    );
    await page.route('**/api/stock-prices*', (route) =>
        route.fulfill({ json: { prices: {}, errors: [] } })
    );
    const requests = [];
    page.on('request', (request) => {
        if (request.url().includes('/api/family-portfolio'))
            requests.push({
                method: request.method(),
                action: new URL(request.url()).searchParams.get('action') || '',
            });
    });
    await page.goto(
        (process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5175') +
            '/mypage?tab=assets'
    );
    await page.getByRole('button', { name: '계좌 추가', exact: true }).click();
    await page.getByRole('button', { name: '직접 입력', exact: true }).click();
    await page.getByLabel('금융기관', { exact: true }).waitFor();
    await page.getByLabel('금융기관', { exact: true }).fill('테스트증권');
    await page.getByLabel('별칭', { exact: true }).fill('수동입력');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 수동입력' }).waitFor();

    await page
        .getByRole('button', { name: '증권사 CSV·XLSX 열 연결', exact: true })
        .click();
    const form = page.getByRole('region', {
        name: '증권사 CSV·XLSX 열 연결',
        exact: true,
    });
    const choose = async (label, option) => {
        if (label === '연결 자료 종류') {
            const group = form.getByRole('radiogroup', {
                name: label,
                exact: true,
            });
            await group.getByText(option, { exact: true }).click();
            assert.equal(
                await group
                    .getByRole('radio', { name: option, exact: true })
                    .isChecked(),
                true
            );
            return;
        }
        await form.getByLabel(label, { exact: true }).click();
        await page
            .getByRole('option', { name: option, exact: true })
            .last()
            .click();
        await page.waitForFunction(
            () => !document.querySelector('.p-select-overlay')
        );
    };
    await form.getByLabel('잔고 기준일', { exact: true }).fill('2026-10-18');
    await form
        .getByLabel('CSV 또는 XLSX 파일', { exact: true })
        .setInputFiles(fixturePath);
    await choose('파일 증권사', '키움증권');
    await form.getByLabel(/명의와 계좌에 속하는/).check();
    const before = requests.length;
    await form
        .getByRole('button', { name: '파일 열 확인', exact: true })
        .click();
    await form.getByLabel('연결 종목 코드', { exact: true }).waitFor();
    assert.equal(await form.locator('.broker-raw-preview tbody tr').count(), 1);
    assert.equal(
        await form
            .locator('.broker-raw-preview tbody tr')
            .textContent()
            .then((text) => text.includes('1.25')),
        true,
        'raw inspection preserves uploaded values'
    );
    // Duplicate columns must not enable a review that the server would reject.
    await choose('연결 종목 코드', '1열 · 종목코드');
    await choose('연결 수량', '1열 · 종목코드');
    assert.equal(
        await form
            .getByRole('button', { name: '연결 자료 미리보기', exact: true })
            .isDisabled(),
        true
    );
    assert.equal(
        await form
            .getByText(
                '같은 열을 여러 항목에 연결할 수 없습니다. 중복 연결을 해제하세요.',
                { exact: true }
            )
            .isVisible(),
        true
    );
    await form
        .getByRole('button', {
            name: '파일·계좌 확인 및 업로드 설정 열기',
            exact: true,
        })
        .click();
    assert.equal(
        (await form.locator('.broker-upload-settings').getAttribute('open')) !==
            null,
        true,
        'file settings remain accessible from the file icon'
    );
    await form.locator('.broker-upload-settings>summary').click();
    assert.deepEqual(requests.slice(before), [
        { method: 'POST', action: 'inspectSpreadsheet' },
    ]);
    for (const [label, option] of [
        ['종목 코드', '1열 · 종목코드'],
        ['수량', '2열 · 잔고수량'],
        ['평가액/거래 금액', '3열 · 평가금액'],
        ['통화', '4열 · 거래통화'],
    ])
        await choose('연결 ' + label, option);
    assert.equal(
        requests.length,
        before + 1,
        'column selections add no requests'
    );
    assert.match(
        await form.locator('.broker-preview-notes').innerText(),
        /amount 250 · currency USD/,
        'raw mapped values remain quoted without financial inference'
    );
    for (const width of [1440, 1280, 834, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        const box = await form.boundingBox();
        const expected = Math.min(width, 1280) - (width <= 640 ? 32 : 48);
        assert.ok(
            Math.abs(box.width - expected) < 1,
            `mapping content width ${width}: ${box.width} vs ${expected}`
        );
        assert.equal(
            await form.evaluate((e) => e.scrollWidth > e.clientWidth + 1),
            false,
            `mapping overflow ${width}`
        );
        await page.screenshot({
            path: `/tmp/yieldloom-broker-dialog-${width}.png`,
        });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await form
        .getByRole('button', { name: '연결 자료 미리보기', exact: true })
        .click();
    await page
        .getByRole('heading', {
            name: '검토 · broker-mapped-v1:kiwoom',
            exact: true,
        })
        .waitFor();
    assert.equal(
        await page.getByLabel('1행 quantity', { exact: true }).inputValue(),
        '1.25'
    );
    await page
        .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
        .click();
    await page
        .getByRole('heading', {
            name: '자료 저장이 완료되었습니다',
            exact: true,
        })
        .waitFor();
    assert.equal(await form.isVisible(), false);
    await page.getByRole('button', { name: '추가 등록', exact: true }).click();
    await choose('연결 자료 종류', '거래 내역');
    await form.getByLabel('조회 종료일', { exact: true }).fill('2026-10-18');
    await form.getByLabel('CSV 또는 XLSX 파일', { exact: true }).setInputFiles({
        name: 'dividend.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
            'date,symbol,type,externalId,amount,currency\n2026-09-10,AAPL,dividend,div-1,25,USD\n'
        ),
    });
    await form.getByLabel(/명의와 계좌에 속하는/).check();
    await form
        .getByRole('button', { name: '파일 열 확인', exact: true })
        .click();
    await form.getByLabel('연결 거래 고유번호', { exact: true }).waitFor();
    await form
        .getByRole('button', { name: '연결 자료 미리보기', exact: true })
        .click();
    await page
        .getByRole('heading', {
            name: '검토 · broker-mapped-v1:other',
            exact: true,
        })
        .waitFor();
    await page
        .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
        .click();
    await page
        .getByRole('heading', {
            name: '자료 저장이 완료되었습니다',
            exact: true,
        })
        .waitFor();
    await page.locator('.p-dialog-close-button').click();
    await openPortfolioPage(page, '배당 분석');
    const insights = page.getByRole('region', {
        name: '배당 성과·집중도 분석',
        exact: true,
    });
    await insights
        .getByLabel('분석 월 선택 (현재월 이하)', { exact: true })
        .fill('2026년 09월');
    await page.keyboard.press('Tab');
    const statement = insights.getByRole('region', {
        name: '월간 결산 저장·비교',
        exact: true,
    });
    await statement.getByText(/확인된 저장 배당 25 USD/).waitFor();
    await statement
        .getByRole('button', { name: '계정 보관함 열기', exact: true })
        .click();
    await statement
        .getByText('계정에 저장한 결산이 없습니다.', { exact: true })
        .waitFor();
    await statement.getByLabel(/배당 금액·통화/).check();
    await statement
        .getByRole('button', { name: '현재 결산 계정에 저장', exact: true })
        .click();
    await statement
        .locator('.saved-reports li')
        .getByText('2026-09', { exact: true })
        .waitFor();
    await statement
        .getByRole('button', { name: '계정 보관함 열기', exact: true })
        .click();
    await statement
        .locator('.saved-reports li')
        .getByText('2026-09', { exact: true })
        .waitFor();
    page.once('dialog', (dialog) => dialog.accept());
    await statement
        .getByRole('button', { name: '저장 결산 삭제', exact: true })
        .click();
    await statement
        .getByText('계정에 저장한 결산이 없습니다.', { exact: true })
        .waitFor();
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
            () =>
                new Promise((r) =>
                    requestAnimationFrame(() => requestAnimationFrame(r))
                )
        );
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `broker overflow ${width}`
        );
    }
    await page.screenshot({
        path: '/tmp/yieldloom-broker-mobile.png',
        fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
        'PASS: real XLSX/CSV → explicit broker columns → review → in-memory commit and account statement save/read/delete; typing/mapping zero requests; six mapping-dialog widths and four portfolio widths'
    );
} finally {
    await browser.close();
    await rm(fixtureDir, { recursive: true, force: true });
}
