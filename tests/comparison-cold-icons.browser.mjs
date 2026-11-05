// Synthetic public directory; font failure must not expand the page.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5198';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const view of ['similar', 'theme']) {
        const page = await browser.newPage({
            viewport: { width: 1280, height: 1000 },
        });
        await installStitchFixtures(page);
        await installStaticAssets(page);
        await page.route('**/*MaterialSymbols*', (route) => route.abort());
        await page.goto(`${base}/compare?view=${view}`);
        await page.locator('h1').first().waitFor();
        for (const width of [834, 390, 768]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.locator('.comparison-filter-arrow').first().waitFor();
            const metrics = await page.evaluate(async () => {
                const widths = [];
                for (let frame = 0; frame < 12; frame++) {
                    await new Promise(requestAnimationFrame);
                    widths.push(document.documentElement.scrollWidth);
                }
                return {
                    viewport: innerWidth,
                    widths,
                    icons: [
                        ...document.querySelectorAll(
                            '.comparison-filter-arrow'
                        ),
                    ].map((el) => el.getBoundingClientRect().width),
                };
            });
            assert.ok(
                metrics.widths.every((w) => w <= metrics.viewport),
                JSON.stringify({ view, width, metrics })
            );
            assert.ok(
                metrics.icons.every((w) => w === 18),
                JSON.stringify(metrics)
            );
        }
        await page.close();
    }
    console.log(
        'PASS cold/failed icon font: both views, viewport changes, every measured frame bounded.'
    );
} finally {
    await browser.close();
}
