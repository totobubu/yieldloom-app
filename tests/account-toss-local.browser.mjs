import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
    });
    const errors = [],
        external = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) => {
        if (new URL(route.request().url()).hostname !== '127.0.0.1') {
            external.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    await page.goto('http://127.0.0.1:5173/tests/toss-local-update-demo.html');
    const button = page.getByRole('button', {
        name: '선택 계좌 로컬 업데이트',
    });
    assert.equal(await button.isDisabled(), true);
    await page.getByLabel('주문 조회 시작일').fill('2026-01-01');
    await page.getByLabel('주문 조회 종료일').fill('2026-01-02');
    await button.focus();
    await page.keyboard.press('Enter');
    await page
        .getByRole('status')
        .filter({ hasText: '이 PC에 보존했습니다' })
        .waitFor();
    await page.getByLabel('모의 계좌').selectOption('demo-error');
    await page.getByLabel('주문 조회 시작일').fill('2026-01-01');
    await page.getByLabel('주문 조회 종료일').fill('2026-01-02');
    await button.click();
    await page
        .getByText('로컬 업데이트를 완료하지 못했습니다.', { exact: false })
        .waitFor();
    assert.equal(await page.getByText('synthetic-private-details').count(), 0);
    for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const dark of [false, true]) {
            await page.evaluate(
                (v) => document.documentElement.classList.toggle('p-dark', v),
                dark
            );
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth
                ),
                false
            );
        }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0
    );
    console.log(
        'PASS: local UI success/error/keyboard/mobile/desktop/light/dark; external requests and browser storage: 0'
    );
} finally {
    await browser.close();
}
