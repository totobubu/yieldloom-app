/* global document */
// Render only existing onclick states from the immutable Stitch HTML. No new designs.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const evidence =
    process.env.STITCH_EVIDENCE_DIR || '/workspace/stitch-v2-evidence';
const screenId = '2b8b6a95d49a43a6b0ab02e71556ed0e';
const file = `docs/design/stitch-v2/originals/7356929996797649648/${screenId}.html`;
const html = await fs.readFile(file, 'utf8');
const hash = crypto.createHash('sha256').update(html).digest('hex');
const mapping = JSON.parse(
    await fs.readFile('docs/design/stitch-v2/mapping.json', 'utf8')
);
if (
    mapping.screens.find((row) => row.screenId === screenId)?.htmlSha256 !==
    hash
)
    throw new Error('Source hash mismatch');
const output = `${evidence}/checks/phase20/share-type-references`;
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
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const assetFailures = await installStaticAssets(page);
        await page.setContent(html, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        for (const type of [
            'div-summary',
            'div-compare',
            'asset-compare',
            'schedule',
            'yield-history',
        ]) {
            await page.locator(`.card-type-btn[data-type="${type}"]`).click();
            const box = page.locator('#share-generator .aspect-square');
            await box.screenshot({
                path: `${output}/${type}-${width}.png`,
                animations: 'disabled',
            });
            const metadata = await box.evaluate((el) => ({
                artworkWidth: el.getBoundingClientRect().width,
                artworkHeight: el.getBoundingClientRect().height,
                body: el
                    .querySelector('#preview-content-box')
                    .textContent.trim(),
            }));
            rows.push({
                type,
                width,
                dpr: 2,
                ...metadata,
                errors: [...errors],
                assetFailures: [...assetFailures],
            });
        }
        await page.close();
    }
} finally {
    await browser.close();
}
if (
    rows.length !== 15 ||
    new Set(rows.map((row) => `${row.type}:${row.width}`)).size !== 15 ||
    rows.some((row) => row.errors.length || row.assetFailures.length)
)
    throw new Error('Incomplete or unhealthy source reference states');
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        {
            source: file,
            screenId,
            sha256: hash,
            scope: '15 existing source onclick states, fictional source examples only; no application data substituted; no new Stitch generation or visual acceptance',
            rows,
        },
        null,
        2
    ) + '\n'
);
console.log('PASS15 existing source share states at3 widths');
