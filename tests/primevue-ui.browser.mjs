// Public data + isolated browser state. Never creates real accounts or uploads.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = 'design-review/primevue-implementation';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
    headless: true,
});
const results = [];
const errors = [];
try {
    for (const width of [1440, 768, 390, 360]) {
        const context = await browser.newContext({
            viewport: { width, height: 960 },
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        page.on('pageerror', (e) => errors.push({ width, error: e.message }));
        page.on('dialog', async (dialog) => {
            errors.push({
                width,
                error: `Unexpected native dialog: ${dialog.type()}`,
            });
            await dialog.dismiss();
        });
        await page.goto(base + '/');
        await page
            .locator(
                width < 768 ? '.mobile-stock-card' : '.desktop-results tbody tr'
            )
            .first()
            .waitFor({ timeout: 45000 });
        await page.screenshot({ path: `${output}/${width}-search.png` });
        await page.locator('#ticker-search').fill('TSLY');
        await page.waitForURL(/q=TSLY/);
        const result =
            width < 768
                ? page.locator('.mobile-stock-card').first()
                : page.locator('.ticker-link').first();
        await result.click();
        await page
            .getByRole('tab', { name: '상세정보', exact: true })
            .waitFor({ timeout: 60000 });
        for (const [label, value] of [
            ['상세정보', 'details'],
            ['시세정보', 'prices'],
            ['배당정보', 'dividends'],
            ['공유정보', 'share'],
        ]) {
            await page.getByRole('tab', { name: label, exact: true }).click();
            await page.waitForURL(
                (url) =>
                    url.searchParams.get('tab') === value ||
                    (value === 'details' && !url.searchParams.has('tab'))
            );
            assert.equal(
                await page
                    .getByRole('tab', { name: label, exact: true })
                    .getAttribute('aria-selected'),
                'true'
            );
            assert.equal(await page.getByRole('tabpanel').count(), 1);
            const layout = await page.evaluate(() => ({
                viewport: innerWidth,
                scrollWidth: document.documentElement.scrollWidth,
            }));
            assert.ok(
                layout.scrollWidth <= width + 1,
                `${width}/${value} page overflow: ${layout.scrollWidth}`
            );
            await page.screenshot({
                path: `${output}/${width}-stock-${value}.png`,
            });
            results.push({ width, screen: value, ...layout });
        }
        await page
            .getByRole('button', { name: '프리셋 저장', exact: true })
            .click();
        const preset = page.getByRole('dialog', {
            name: '프리셋 저장',
            exact: true,
        });
        await preset
            .getByLabel('프리셋 이름', { exact: true })
            .fill('브라우저 검증 프리셋');
        await preset
            .getByRole('button', { name: '프리셋 저장', exact: true })
            .click();
        await preset.waitFor({ state: 'hidden' });
        assert.equal(
            await page
                .locator('.preset-row')
                .getByText('브라우저 검증 프리셋', { exact: true })
                .count(),
            1
        );
        await page
            .getByRole('button', { name: '종목 검색', exact: true })
            .click();
        await page.locator('#ticker-search').waitFor();
        assert.equal(
            await page.locator('#ticker-search').inputValue(),
            'TSLY',
            'Back must preserve search'
        );
        results.push({ width, check: 'search-back-restored', passed: true });
        await page.locator('#ticker-search').fill('zz-no-matching-symbol-zz');
        await page
            .getByRole('heading', { name: '검색 결과가 없습니다', exact: true })
            .waitFor();
        await page
            .getByRole('button', { name: '검색 조건 초기화', exact: true })
            .click();
        await page.waitForURL((url) => !url.searchParams.has('q'));
        if (width < 768) {
            await page
                .getByRole('button', { name: '필터', exact: true })
                .click();
            const drawer = page.locator('.search-filter-drawer');
            await drawer
                .getByRole('button', { name: 'ETF', exact: true })
                .click();
            await drawer
                .getByRole('button', { name: '필터 적용', exact: true })
                .click();
            await page.waitForURL(/type=etf/);
            results.push({
                width,
                check: 'filter-drawer-applied',
                passed: true,
            });
        }
        await page.goto(base + '/admin/login');
        await page
            .getByLabel('이메일', { exact: true })
            .fill('example@example.test');
        await page
            .getByLabel('비밀번호', { exact: true })
            .fill('test-password');
        await page.screenshot({ path: `${output}/${width}-login.png` });
        await page
            .getByRole('button', { name: '회원가입', exact: true })
            .click();
        await page
            .getByRole('heading', { name: '회원가입', exact: true })
            .waitFor();
        await page.getByRole('button', { name: '로그인', exact: true }).click();
        await page
            .getByRole('button', {
                name: '비밀번호를 잊으셨나요?',
                exact: true,
            })
            .click();
        await page
            .getByRole('heading', { name: '비밀번호 재설정', exact: true })
            .waitFor();
        await page.screenshot({ path: `${output}/${width}-reset.png` });
        await page
            .getByRole('button', { name: '다크 모드', exact: true })
            .click();
        assert.equal(await page.locator('html.p-dark').count(), 1);
        await page.reload();
        assert.equal(await page.locator('html.p-dark').count(), 1);
        await page.screenshot({ path: `${output}/${width}-dark.png` });
        results.push({
            width,
            check: 'authentication-modes-and-theme',
            passed: true,
        });
        await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
        `${output}/results.json`,
        JSON.stringify({ results, errors }, null, 2)
    );
    console.log(JSON.stringify({ passed: results.length, errors }, null, 2));
} finally {
    await browser.close();
}
