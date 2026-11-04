/* global document -- isolated immutable reference. */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const output = `${process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review'}/dividend-year-references`;
const source =
    'docs/design/stitch-v2/originals/7356929996797649648/bd619d24ceb74c92afad1787a364ab4b.html';
const html = await fs.readFile(source, 'utf8');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const failures = await installStaticAssets(page),
            errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.setContent(html, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        for (const year of [2025, 2026]) {
            await page
                .locator('#year-toggle-group')
                .getByRole('button', { name: String(year), exact: true })
                .click();
            await page.screenshot({
                path: `${output}/year-${year}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
            rows.push({
                name: `year-${year}`,
                width,
                dpr: 2,
                source,
                failures,
                errors,
            });
        }
        await page.close();
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        { scope: 'actual original year controls; no source edits', rows },
        null,
        2
    ) + '\n'
);
console.log(JSON.stringify(rows));
