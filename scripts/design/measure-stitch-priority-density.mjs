/* global document -- isolated browser DOM measurement. */
// Compare actual immutable source structure with the fixture-driven Vue page.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const root = process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output = `${root}/checks/phase14/density`;
await fs.mkdir(output, { recursive: true });
const html = await fs.readFile(
    'docs/design/stitch-v2/originals/7356929996797649648/d90f121fb719421e880cc02309349add.html',
    'utf8'
);
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
try {
    for (const width of [1280, 768, 390]) {
        const source = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStaticAssets(source);
        await source.setContent(html, { waitUntil: 'networkidle' });
        await source.evaluate(() => document.fonts.ready);
        const original = await source.locator('#tab-holder').evaluate((el) => {
            const card = el.parentElement.parentElement.parentElement;
            return {
                headingCount: document.querySelectorAll('h1').length,
                filterHeight: card.getBoundingClientRect().height,
                inputHeight: document
                    .querySelector('#search-input')
                    .getBoundingClientRect().height,
                modeButtonHeight: el.getBoundingClientRect().height,
            };
        });
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(page, { admin: true });
        await installStaticAssets(page);
        await page.goto(base + '/mypage?tab=overview&view=holdings');
        await page
            .locator('.holding-card')
            .first()
            .waitFor({ state: 'attached' });
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await page.evaluate(() => document.fonts.ready);
        const implementation = await page
            .locator('.holdings-filter-card')
            .evaluate((el) => ({
                headingCount: document.querySelectorAll('h1').length,
                filterHeight: el.getBoundingClientRect().height,
                inputHeight: el.querySelector('input').getBoundingClientRect()
                    .height,
                modeButtonHeight: el
                    .querySelector('.p-togglebutton')
                    .getBoundingClientRect().height,
            }));
        rows.push({
            width,
            source: original,
            implementation,
            criteria: {
                singleHeading:
                    implementation.headingCount === original.headingCount,
                filterHeightExact:
                    Math.abs(
                        implementation.filterHeight - original.filterHeight
                    ) < 1,
                inputHeightExact:
                    implementation.inputHeight === original.inputHeight,
                modeHeightExact:
                    implementation.modeButtonHeight ===
                    original.modeButtonHeight,
            },
            visualAcceptance: 'fail: other material differences remain',
        });
        await page.close();
        await source.close();
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        { scope: 'component geometry only; not whole-screen acceptance', rows },
        null,
        2
    ) + '\n'
);
console.log(JSON.stringify(rows));
