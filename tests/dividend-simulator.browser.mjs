import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const out = 'design-review/dividend-simulator';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('http://127.0.0.1:5173/simulator');
    await page
        .getByRole('heading', { name: '배당 시뮬레이터', exact: true })
        .waitFor();
    const resultA = page.locator('article[aria-label="시나리오 A 결과"]'),
        resultB = page.locator('article[aria-label="시나리오 B 결과"]');
    await resultA.waitFor();
    assert.notEqual(
        await resultA.locator('h2').innerText(),
        await resultB.locator('h2').innerText()
    );
    await page
        .getByRole('button', { name: '원천징수율만 비교', exact: true })
        .click();
    assert.ok(
        await page.getByLabel('B 최초 투자액 USD', { exact: true }).isDisabled()
    );
    await page.getByLabel('B 원천징수 가정 (%)', { exact: true }).fill('30');
    await page.getByLabel('B 원천징수 가정 (%)', { exact: true }).press('Tab');
    await page.getByLabel('A 최초 투자액 USD', { exact: true }).fill('1000');
    await page.getByLabel('A 최초 투자액 USD', { exact: true }).press('Tab');
    await page.getByLabel('A 월 추가 납입 USD', { exact: true }).fill('0');
    await page.getByLabel('A 월 추가 납입 USD', { exact: true }).press('Tab');
    await page.getByText('1,102 USD', { exact: true }).first().waitFor();
    await page.getByText('1,084 USD', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: '가정 저장', exact: true }).click();
    await page
        .getByText('입력한 가정을 이 브라우저에 저장했습니다.', { exact: true })
        .waitFor();
    await page.reload();
    await page
        .getByRole('button', { name: '저장된 가정 불러오기', exact: true })
        .click();
    await page.getByText('1,084 USD', { exact: true }).first().waitFor();
    assert.equal(
        await page
            .getByLabel('B 최초 투자액 USD', { exact: true })
            .inputValue(),
        '1,000'
    );
    await page.getByLabel('연간 주가 변화율 (%)', { exact: true }).fill('-50');
    await page.getByLabel('연간 주가 변화율 (%)', { exact: true }).press('Tab');
    await resultA.getByText('-398 USD', { exact: true }).waitFor();
    await page
        .getByLabel('투자 기간 (개월 · 0~360)', { exact: true })
        .fill('0');
    await page
        .getByLabel('투자 기간 (개월 · 0~360)', { exact: true })
        .press('Tab');
    await page
        .getByText('기간이 0개월이면 시작 시점의 매수·현금만 표시합니다.', {
            exact: true,
        })
        .waitFor();
    await page
        .getByRole('button', { name: '예시로 초기화', exact: true })
        .click();
    await page.getByLabel('A 최초 투자액 USD', { exact: true }).fill('');
    await page.getByLabel('A 최초 투자액 USD', { exact: true }).press('Tab');
    await page
        .getByRole('alert')
        .getByText(/최초 투자액 입력 범위/)
        .waitFor();
    assert.equal(await resultA.count(), 0);
    await page
        .getByRole('button', { name: '예시로 초기화', exact: true })
        .click();
    await page
        .getByRole('combobox', { name: '계산 통화', exact: true })
        .click();
    await page.getByRole('option', { name: 'KRW · 원화', exact: true }).click();
    await resultA.getByText(/KRW/).first().waitFor();
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `overflow ${width}`
        );
        await page.evaluate(() => {
            document.activeElement?.blur();
            window.scrollTo(0, 0);
        });
        await page.screenshot({ path: `${out}/${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '다크 모드', exact: true }).click();
    await page.screenshot({ path: `${out}/360-dark.png`, fullPage: true });
    await page.evaluate(() =>
        localStorage.setItem(
            'yieldloom.dividend-simulation.v1',
            '{"version":99}'
        )
    );
    await page
        .getByRole('button', { name: '저장된 가정 불러오기', exact: true })
        .click();
    await page.getByText(/저장된 가정을 불러오지 못했습니다/).waitFor();
    assert.deepEqual(errors, []);
    console.log(
        'PASS: A/B reinvestment, tax-only synchronization, save/restore, negative price, zero period, validation, currency, 4 widths and dark mode'
    );
} finally {
    await browser.close();
}
