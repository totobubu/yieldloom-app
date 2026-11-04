/* global document */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
import { installStaticAssets } from './browser-static-assets.mjs';
const output =
    process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
await fs.mkdir(output + '/ttm-variant', { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const results = [];
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const assetFailures = await installStaticAssets(page);
        await installStitchFixtures(page);
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/stock/DEMO-A?tab=share'
        );
        await page
            .getByRole('button', {
                name: '12개월 배당 요약 미리보기',
                exact: true,
            })
            .click();
        await page.locator('.ttm-summary-card').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const name = 'stock-share-ttm',
            box = await page.locator('.studio-main').boundingBox();
        await page.screenshot({
            path: `${output}/ttm-variant/${name}-${width}.png`,
            fullPage: true,
            animations: 'disabled',
        });
        await page.screenshot({
            path: `${output}/ttm-variant/${name}-${width}-content.png`,
            fullPage: true,
            animations: 'disabled',
            clip: { x: 0, y: box.y, width, height: box.height },
            style: '.studio-header,.studio-footer,.mobile-nav {visibility:hidden!important;}',
        });
        results.push({
            name,
            width,
            screenId: '2b8b6a95d49a43a6b0ab02e71556ed0e',
            path: '/stock/DEMO-A?tab=share',
            interaction:
                'clicked 12개월 배당 요약 미리보기; default remains latest-event summary',
            status: 'captured',
            assetFailures,
            errors,
        });
        await page.close();
        console.log(name, width, 'captured');
    }
} finally {
    await browser.close();
    await fs.writeFile(
        output + '/ttm-variant/results.json',
        JSON.stringify(
            {
                results,
                dataset:
                    'fixed synthetic source with explicit dividend coverage; source prototype values not substituted',
            },
            null,
            2
        )
    );
}
