/* global document -- isolated browser callback. */
// Capture the actual mode controls from immutable Stitch HTML; no synthesized data.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const root = process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const output = `${root}/holdings-view-references`;
const source =
    'docs/design/stitch-v2/originals/7356929996797649648/d90f121fb719421e880cc02309349add.html';
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
        for (const mode of ['holder', 'symbol']) {
            await page.locator(`#tab-${mode}`).click();
            await page
                .locator(
                    mode === 'holder'
                        ? '#view-holder-balance'
                        : '#view-symbol-aggregate'
                )
                .waitFor();
            await page.screenshot({
                path: `${output}/${mode}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
            rows.push({ mode, width, dpr: 2, source, failures, errors });
            console.log(mode, width, failures.length, errors.length);
        }
        await page.close();
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        { kind: 'actual original HTML mode controls; immutable source', rows },
        null,
        2
    )
);
