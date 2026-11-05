/* global document, getComputedStyle -- isolated comparison pages. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output = `${process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review'}/checks/phase17/search-structure`;
const html = await fs.readFile(
    'docs/design/stitch-v2/originals/7356929996797649648/6e69286f8e3d4f98b3cbc125f2b2ecd0.html',
    'utf8'
);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
try {
    for (const width of [1280, 768, 390]) {
        const source = await browser.newPage({
            viewport: { width, height: 1024 },
        });
        await installStaticAssets(source);
        await source.setContent(html, { waitUntil: 'networkidle' });
        await source.evaluate(() => document.fonts.ready);
        const original = await source.evaluate(() => ({
            name: document.querySelector('.stock-name').getBoundingClientRect()
                .width,
            heading: document.querySelector('.card-top').getBoundingClientRect()
                .width,
            pageButton: document
                .querySelector('.page-btn')
                .getBoundingClientRect().height,
            chipFont: getComputedStyle(document.querySelector('.type-pill'))
                .fontSize,
        }));
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
        });
        await installStitchFixtures(page);
        await installStaticAssets(page);
        await page.goto(base + '/?q=DEMO&sort=symbol');
        await page.locator('.stock-result-item').first().waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await page.evaluate(() => document.fonts.ready);
        const implementation = await page.evaluate(() => ({
            name: document
                .querySelector('.stock-card-heading > div > span')
                .getBoundingClientRect().width,
            heading: document
                .querySelector('.stock-card-heading')
                .getBoundingClientRect().width,
            pageButton: document
                .querySelector('.search-pagination .p-paginator-page')
                .getBoundingClientRect().height,
            chipFont: getComputedStyle(
                document.querySelector('.filter-chips .p-button')
            ).fontSize,
        }));
        const checks = {
            sourceNameUsesFullHeading:
                Math.abs(original.name - original.heading) < 1,
            implementationNameUsesFullHeading:
                Math.abs(implementation.name - implementation.heading) < 1,
            pageButtonHeight: original.pageButton === implementation.pageButton,
            mobileChipFont: original.chipFont === implementation.chipFont,
        };
        rows.push({ width, original, implementation, checks });
        assert.ok(Object.values(checks).every(Boolean));
        await page.close();
        await source.close();
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        {
            scope: 'Specific source-backed layout properties only; not whole-screen acceptance or equal fictional financial data',
            rows,
        },
        null,
        2
    ) + '\n'
);
console.log(JSON.stringify(rows));
