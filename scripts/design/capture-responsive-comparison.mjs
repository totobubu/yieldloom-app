/* global document, getComputedStyle, innerWidth */
// Read-only local visual evidence. Original HTML is never rewritten.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const out =
    process.env.COMPARISON_EVIDENCE_DIR ||
    '/workspace/scratch/compare-stitch/visual';
await fs.mkdir(out, { recursive: true });
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5185';
const baseline = process.env.COMPARISON_BASELINE_URL;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const states = [];
const geometry = (source) => {
    const root = document.querySelector(
        source ? 'main' : '[data-responsive-view]'
    );
    const box = (e) => {
        const r = e.getBoundingClientRect(),
            s = getComputedStyle(e);
        return {
            width: r.width,
            height: r.height,
            padding: s.padding,
            gap: s.gap,
            radius: s.borderRadius,
            font: s.fontSize,
            line: s.lineHeight,
            fontFamily: s.fontFamily,
            color: s.color,
            border: s.borderColor,
        };
    };
    const cards = [
        ...root.querySelectorAll(
            source ? 'article' : '.responsive-product-card'
        ),
    ];
    return {
        root: box(root),
        title: box(root.querySelector('h1')),
        selects: [
            ...root.querySelectorAll(
                source ? 'select' : '.explorer-filters .p-select'
            ),
        ].map(box),
        cards: cards.slice(0, 3).map(box),
        table: root.querySelector('table')
            ? box(root.querySelector('table'))
            : null,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        fonts: [...document.fonts].map((font) => ({
            family: font.family,
            status: font.status,
        })),
    };
};
try {
    for (const [view, width, id] of [
        ['similar', 834, '77fdbd798a3941c68f098120a210c44d'],
        ['similar', 390, '2476bb94e3174e6182500d8f520a6424'],
        ['theme', 834, '12bcd42390bb468eb1700a909aec3f5d'],
        ['theme', 390, '4dbfbf717c75483e88e6d1186ecbdb2b'],
    ]) {
        const reference = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 1,
        });
        const sourceAssetFailures = await installStaticAssets(reference);
        const html = await fs.readFile(
            `docs/design/stitch-v3/originals/17382728461495959991/${id}.html`
        );
        await reference.setContent(html.toString(), {
            waitUntil: 'networkidle',
        });
        await reference.evaluate(() => document.fonts.ready);
        const sourceGeometry = await reference.evaluate(geometry, true);
        await reference.screenshot({
            path: `${out}/${view}-${width}-source.png`,
            fullPage: true,
        });
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 1,
        });
        await installStitchFixtures(page);
        const appAssetFailures = await installStaticAssets(page);
        const failedResponses = [];
        page.on('response', (r) => {
            if (r.status() >= 400)
                failedResponses.push({ url: r.url(), status: r.status() });
        });
        await page.goto(
            `${base}/compare?view=${view}${view === 'theme' ? '&theme=semiconductors' : ''}`
        );
        await page
            .locator('.matrix-product')
            .first()
            .waitFor({ state: 'attached' });
        await page.evaluate(() => document.fonts.ready);
        const appGeometry = await page.evaluate(geometry, false);
        await page.addStyleTag({
            content: '.studio-header, .mobile-nav { visibility:hidden; }',
        });
        await page.locator('[data-responsive-view]').screenshot({
            path: `${out}/${view}-${width}-app.png`,
            animations: 'disabled',
        });
        states.push({
            view,
            width,
            id,
            htmlSha256: createHash('sha256').update(html).digest('hex'),
            sourceGeometry,
            appGeometry,
            sourceAssetFailures,
            appAssetFailures,
            failedResponses,
        });
        await reference.close();
        await page.close();
    }
    if (baseline) {
        for (const [width, view] of [
            [1280, 'similar'],
            [1280, 'theme'],
            [390, 'underlying'],
        ]) {
            const screenshots = [];
            for (const [label, host] of [
                ['baseline', baseline],
                ['app', base],
            ]) {
                const page = await browser.newPage({
                    viewport: { width, height: 1024 },
                });
                await installStitchFixtures(page);
                await installStaticAssets(page);
                await page.goto(
                    `${host}/compare?view=${view}&symbol=DEMO-BASE${view === 'theme' ? '&theme=semiconductors' : ''}`
                );
                await page
                    .locator(
                        width > 1024
                            ? '.comparison-summary tbody tr'
                            : '.product-grid article'
                    )
                    .first()
                    .waitFor();
                await page.evaluate(() => document.fonts.ready);
                await page.addStyleTag({
                    content:
                        '.studio-header, .mobile-nav { visibility: hidden; }',
                });
                const png = await page
                    .locator('.underlying-explorer')
                    .screenshot({
                        path: `${out}/${view}-${width}-${label}.png`,
                        animations: 'disabled',
                    });
                screenshots.push(
                    createHash('sha256').update(png).digest('hex')
                );
                await page.close();
            }
            states.push({
                view,
                width,
                baselineExactScreenshotMatch: screenshots[0] === screenshots[1],
                screenshotHashes: screenshots,
            });
            assert.equal(
                screenshots[0],
                screenshots[1],
                `${view} ${width} changed outside the responsive scope`
            );
        }
    }
} finally {
    await fs.writeFile(`${out}/geometry.json`, JSON.stringify(states, null, 2));
    await browser.close();
}
console.log(`${states.length} comparisons written to ${out}`);
