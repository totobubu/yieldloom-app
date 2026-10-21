// Local Vite + in-memory Flask only. No production identities or data.
import assert from 'node:assert/strict';
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
            export const firebaseUser = ref({uid: 'manual-browser-' + Date.now(), displayName: '테스트', getIdToken: async function() { return this.uid; }});
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
    await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="tab"]')].some(
            (tab) =>
                tab.textContent?.includes('자산관리') &&
                tab.getAttribute('aria-selected') === 'true'
        )
    );
    await page.getByRole('button', { name: '계좌 추가', exact: true }).click();
    await page.getByLabel('금융기관', { exact: true }).fill('테스트증권');
    await page.getByLabel('별칭', { exact: true }).fill('수동입력');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page.getByRole('heading', { name: '선택 계좌: 수동입력' }).waitFor();
    const openManual = async () => {
        const uploadDialog = page.getByRole('dialog', {
            name: '자료 업로드 · 수동입력',
        });
        if (!(await uploadDialog.isVisible())) {
            await page
                .getByRole('button', { name: '자료 업로드', exact: true })
                .click();
        }
        await page
            .getByRole('button', { name: '수동 잔고 입력', exact: true })
            .click();
        await page
            .getByRole('heading', { name: '수동 잔고 입력', exact: true })
            .waitFor();
    };
    const form = page.getByRole('form', {
        name: '수동 잔고 입력',
        exact: true,
    });
    await openManual();
    const initialCount = requests.length;
    await form
        .getByLabel('수동 잔고 기준일', { exact: true })
        .fill('2026-10-16');
    await form.getByLabel('1행 종목', { exact: true }).fill('AAPL');
    await form.getByLabel('1행 수량', { exact: true }).fill('1.25');
    await form.getByLabel('1행 통화', { exact: true }).fill('USD');
    await form.getByLabel(/선택 계좌의 명의/).check();
    assert.equal(
        requests.length,
        initialCount,
        'typing must not request portfolio data'
    );
    await page.screenshot({
        path: '/tmp/yieldloom-manual-desktop.png',
        fullPage: true,
    });
    // Enter submits the input form into the existing review flow.
    await form.getByLabel('1행 통화', { exact: true }).press('Enter');
    await page
        .getByRole('heading', { name: '검토 · manual-holdings-v1' })
        .waitFor();
    assert.deepEqual(requests.slice(initialCount), [
        { method: 'POST', action: 'previewManualHoldings' },
    ]);
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
    await form.getByLabel('1행 종목', { exact: true }).waitFor();
    assert.equal(
        await form.getByLabel('1행 종목', { exact: true }).inputValue(),
        'AAPL'
    );
    assert.equal(
        await form.getByLabel('1행 수량', { exact: true }).inputValue(),
        '1.25'
    );
    assert.equal(
        await form
            .getByLabel('1행 평가액 (선택)', { exact: true })
            .inputValue(),
        ''
    );
    await form
        .getByLabel('수동 잔고 기준일', { exact: true })
        .fill('2026-10-16');
    await form.getByLabel(/선택 계좌의 명의/).check();
    const beforeInvalid = requests.length;
    await form
        .getByRole('button', { name: '수동 잔고 검토', exact: true })
        .click();
    await form
        .getByText('기존 잔고보다 새로운 기준일을 입력하세요.', { exact: true })
        .waitFor();
    assert.equal(requests.length, beforeInvalid);
    await form
        .getByLabel('수동 잔고 기준일', { exact: true })
        .fill('2026-10-17');
    await form.getByRole('button', { name: '종목 추가', exact: true }).click();
    assert.equal(await form.getByLabel(/선택 계좌의 명의/).isChecked(), false);
    await form.getByLabel('2행 종목', { exact: true }).fill('MSFT');
    await form.getByLabel('2행 수량', { exact: true }).fill('2');
    await form.getByLabel('2행 평가액 (선택)', { exact: true }).fill('800');
    await form.getByLabel(/선택 계좌의 명의/).check();
    await form
        .getByRole('button', { name: '수동 잔고 검토', exact: true })
        .click();
    await page
        .getByRole('heading', { name: '검토 · manual-holdings-v1' })
        .waitFor();
    assert.equal(
        await page.getByLabel('1행 symbol', { exact: true }).inputValue(),
        'AAPL'
    );
    assert.equal(
        await page.getByLabel('2행 symbol', { exact: true }).inputValue(),
        'MSFT'
    );
    await page
        .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
        .click();
    await page.getByText('저장 2행 · 중복 0행', { exact: true }).waitFor();
    await page.getByRole('button', { name: '추가 등록', exact: true }).click();
    await form.getByLabel('2행 종목', { exact: true }).waitFor();
    await form.getByRole('button', { name: '2행 삭제', exact: true }).click();
    assert.equal(
        await form.getByLabel('1행 종목', { exact: true }).inputValue(),
        'AAPL'
    );
    assert.equal(await form.getByLabel(/선택 계좌의 명의/).isChecked(), false);
    for (const dark of [false, true]) {
        await page.evaluate(
            (value) =>
                document.documentElement.classList.toggle('p-dark', value),
            dark
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await form.scrollIntoViewIfNeeded();
        await page.screenshot({
            path: `/tmp/yieldloom-manual-${dark ? 'dark' : 'light'}.png`,
            fullPage: true,
        });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
    }
    assert.deepEqual(errors, []);
    console.log(
        'manual holdings: create, preserve, review, save, validation, Enter, mobile and themes passed'
    );
} finally {
    await browser.close();
}
