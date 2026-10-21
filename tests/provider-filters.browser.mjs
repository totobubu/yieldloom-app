// Public search only: verifies provider discovery, URL state and responsive interactions.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = '/tmp/yieldloom-provider-design';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 768, 390, 360]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
        });
        const page = await context.newPage();
        const errors = [];
        const requests = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (['fetch', 'xhr'].includes(request.resourceType()))
                requests.push(request.url());
        });
        await page.goto(base + '/');
        await page.locator('.stock-card-grid li').first().waitFor();
        const shortcuts = page.locator('.provider-chips button:visible');
        assert.ok(
            (await shortcuts.count()) > 5,
            'Show more than the previous five providers'
        );
        assert.ok((await shortcuts.count()) <= (width < 768 ? 9 : 16));
        const requestsBefore = requests.length;
        const provider = await shortcuts.nth(1).innerText();
        await shortcuts.nth(1).focus();
        await page.keyboard.press('Enter');
        await page.waitForURL(
            (url) => url.searchParams.get('company') === provider
        );
        assert.equal(
            await page
                .locator('.provider-chips button[aria-pressed="true"]')
                .innerText(),
            provider
        );
        for (const name of await page
            .locator('.stock-provider-badge')
            .allTextContents())
            assert.equal(name, provider);
        const toggle = page.locator('.provider-expand');
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        const search = page.getByRole('searchbox', {
            name: '운용사명 검색',
            exact: true,
        });
        await search.fill('zz-no-provider-zz');
        await page
            .getByText('일치하는 운용사가 없습니다.', { exact: true })
            .waitFor();
        await search.fill(provider.toLowerCase());
        assert.ok((await shortcuts.count()) >= 2);
        await toggle.click();
        await page
            .getByRole('button', { name: '선택 초기화', exact: true })
            .click();
        await page.waitForURL((url) => !url.searchParams.has('company'));
        await page.getByRole('button', { name: 'ETF', exact: true }).click();
        await page.waitForURL((url) => url.searchParams.get('type') === 'etf');
        assert.equal(
            requests.length,
            requestsBefore,
            'Local filters must not fetch data again'
        );
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `Overflow at ${width}`
        );
        await page.screenshot({ path: `${output}/${width}-light.png` });
        await page
            .getByRole('button', { name: '다크 모드', exact: true })
            .click();
        await toggle.click();
        await page.screenshot({ path: `${output}/${width}-dark-expanded.png` });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page.reload();
        await page.locator('.stock-card-grid li').first().waitFor();
        assert.equal(
            await page
                .getByRole('button', { name: 'ETF', exact: true })
                .getAttribute('aria-pressed'),
            'true'
        );
        assert.equal(await page.locator('html.p-dark').count(), 1);
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}px: shortcuts, keyboard selection, URL, search/empty, reset, no filter requests, theme/reload, no overflow/errors`
        );
        await context.close();
    }
} finally {
    await browser.close();
}
