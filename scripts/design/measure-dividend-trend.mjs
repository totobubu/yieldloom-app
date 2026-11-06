/* global getComputedStyle, document, innerWidth -- runs inside isolated browser pages. */
// Source-backed measurements only; fictional values are never copied into the app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5278';
const output = process.env.STITCH_TREND_EVIDENCE_DIR || '/tmp/phase78/after';
const before = process.env.STITCH_TREND_BASELINE === '1';
const html = await fs.readFile(
    'docs/design/stitch-v2/originals/7356929996797649648/bd619d24ceb74c92afad1787a364ab4b.html',
    'utf8'
);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = (root, source) => {
    const style = (el) => getComputedStyle(el);
    const box = (el) => ({
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
    });
    const title = root.querySelector('h2');
    const legend = source
        ? root.querySelector('.gap-3.font-label-sm')
        : root.querySelector('.trend-note');
    const swatch = legend?.querySelector(source ? 'span.w-3' : 'i');
    const properties = (el) => ({
        fontSize: style(el).fontSize,
        lineHeight: style(el).lineHeight,
        fontWeight: style(el).fontWeight,
        height: el.getBoundingClientRect().height,
        minHeight: style(el).minHeight,
    });
    const controls = root.querySelector(
        source ? '#year-toggle-group button' : '.trend-controls button'
    );
    const unit = root.querySelector(
        source ? '.flex.flex-col.gap-1 > span' : '.trend-unit'
    );
    const plot = root.querySelector(source ? '.h-56' : '.trend-plot');
    const bar = root.querySelector(source ? '.h-36' : '.bars');
    return {
        title: {
            fontSize: style(title).fontSize,
            lineHeight: style(title).lineHeight,
            fontWeight: style(title).fontWeight,
        },
        legendSwatch: swatch ? box(swatch) : null,
        legend: properties(legend),
        controls: properties(controls),
        unit: properties(unit),
        plot: plot ? box(plot) : null,
        bars: box(bar),
        padding: style(root).padding,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
};
try {
    for (const width of [1280, 834, 768, 390]) {
        const source = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const sourceErrors = [];
        source.on('pageerror', (e) => sourceErrors.push(e.message));
        const sourceAssets = await installStaticAssets(source);
        await source.setContent(html, { waitUntil: 'networkidle' });
        await source.evaluate(() => document.fonts.ready);
        const original = source.locator('section').filter({
            has: source.getByRole('heading', {
                name: '2. 월별 배당 추이',
                exact: true,
            }),
        });
        const originalMetrics = await original.evaluate(measure, true);
        await original.screenshot({
            path: `${output}/source-${width}.png`,
            animations: 'disabled',
        });
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const errors = [],
            requests = [];
        await installStitchFixtures(page);
        const assets = await installStaticAssets(page);
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
            if (
                r.url().includes('/api/') ||
                r.url().includes('/security-insights/')
            )
                requests.push(r.method() + ' ' + new URL(r.url()).pathname);
        });
        await page.goto(base + '/stock/DEMO-A?tab=dividends');
        const trend = page.locator('.dividend-trend');
        await trend.locator('.month-bar').first().waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await page.evaluate(() => document.fonts.ready);
        const appMetrics = await trend.evaluate(measure, false);
        await trend.screenshot({
            path: `${output}/app-${width}.png`,
            animations: 'disabled',
        });
        rows.push({
            width,
            original: originalMetrics,
            implementation: appMetrics,
            sourceErrors,
            sourceAssets,
            errors,
            assets,
            requests,
        });
        assert.deepEqual(sourceErrors, []);
        assert.deepEqual(sourceAssets, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(assets, []);
        assert.equal(appMetrics.overflow, false);
        if (!before) {
            assert.deepEqual(appMetrics.title, originalMetrics.title);
            assert.deepEqual(
                appMetrics.legendSwatch,
                originalMetrics.legendSwatch
            );
            assert.equal(appMetrics.plot.height, originalMetrics.plot.height);
            assert.equal(appMetrics.bars.height, originalMetrics.bars.height);
            assert.equal(appMetrics.padding, originalMetrics.padding);
            assert.ok(appMetrics.plot.width >= 620);
        }
        await page.close();
        await source.close();
    }
} finally {
    await browser.close();
    await fs.writeFile(
        `${output}/geometry.json`,
        JSON.stringify(
            {
                scope: 'Selected source-backed properties, not whole native PNG/font acceptance. Same fixed synthetic app data at all widths; source financial examples unchanged.',
                before,
                rows,
            },
            null,
            2
        ) + '\n'
    );
}
console.log(
    `PASS ${rows.length} widths: source-backed trend measurements; whole-screen acceptance remains incomplete`
);
