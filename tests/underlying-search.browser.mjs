import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const output = '/tmp/yieldloom-underlying-browser';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const expected = ['AAPB', 'AAPD', 'AAPU', 'AAPW', 'AAPY', 'APLY'];
    await page.goto('http://127.0.0.1:5173/?q=AAPL&type=etf');
    for (const symbol of expected) {
        const row = page
            .locator('.desktop-results tbody tr')
            .filter({
                has: page.locator('strong', {
                    hasText: new RegExp(`^${symbol}$`),
                }),
            });
        await row.getByText('AAPL 기반', { exact: true }).waitFor();
    }
    for (const width of [390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const symbol of expected) {
            const row = page
                .locator('.mobile-results li')
                .filter({
                    has: page.locator('strong', {
                        hasText: new RegExp(`^${symbol}$`),
                    }),
                });
            await row.getByText('AAPL 기반', { exact: true }).waitFor();
        }
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page.screenshot({
            path: `${output}/aapl-${width}.png`,
            fullPage: true,
        });
    }
    await page.getByRole('button', { name: '다크 모드', exact: true }).click();
    await page.screenshot({ path: `${output}/aapl-dark.png`, fullPage: true });
    // Older directory data (including a remote release) still receives the verified overlay.
    await page.route('**/ticker-index.json', (route) =>
        route.fulfill({
            json: {
                nav: expected.map((symbol) => ({
                    symbol,
                    market: 'NYSE',
                    currency: 'USD',
                    company: 'ETF issuer',
                })),
            },
        })
    );
    await page.reload();
    for (const symbol of expected.filter((value) => value !== 'AAPW')) {
        const row = page
            .locator('.mobile-results li')
            .filter({
                has: page.locator('strong', {
                    hasText: new RegExp(`^${symbol}$`),
                }),
            });
        await row.getByText('AAPL 기반', { exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(
        'PASS: AAPL search with six ETFs, desktop/mobile, dark mode, older directory overlay, no page errors'
    );
} finally {
    await browser.close();
}
