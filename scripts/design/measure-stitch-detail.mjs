/* global document, getComputedStyle -- Playwright page callbacks. */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5188';
const output =
    process.env.STITCH_DETAIL_OUTPUT ||
    '/workspace/stitch-v2-evidence/checks/phase27/details';
await fs.mkdir(output, { recursive: true });
const html = await fs.readFile(
    'docs/design/stitch-v2/originals/7356929996797649648/d33c8e06e86f4404a4b5388c7aa33e13.html',
    'utf8'
);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = (original) => {
    const selectors = original
        ? {
              heading: '.detail-grid h2',
              reports: '.detail-grid h3',
              feedback: '.feedback-section h2',
              select: '.select-input',
              textarea: '.textarea-input',
              count: '.char-count',
              privacy: '.privacy-notice',
              submit: '.submit-btn',
          }
        : {
              heading: '.stock-detail-main .stock-section h2',
              reports: '.stock-official-pending h3',
              feedback: '.stock-feedback h2',
              select: '.stock-feedback .p-select',
              textarea: '.stock-feedback textarea',
              count: '.feedback-character-count',
              privacy: '#feedback-help',
              submit: '.stock-feedback button[type="submit"]',
          };
    return Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => {
            const el = document.querySelector(selector);
            if (!el) return [name, null];
            const s = getComputedStyle(el),
                r = el.getBoundingClientRect();
            return [
                name,
                {
                    text: el.textContent.trim(),
                    fontSize: s.fontSize,
                    lineHeight: s.lineHeight,
                    weight: s.fontWeight,
                    width: r.width,
                    height: r.height,
                    padding: s.padding,
                    marginBottom: s.marginBottom,
                },
            ];
        })
    );
};
try {
    for (const width of [1280, 768, 390]) {
        const source = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const sourceFailures = await installStaticAssets(source);
        await source.setContent(html, { waitUntil: 'networkidle' });
        await source.evaluate(() => document.fonts.ready);
        const original = await source.evaluate(measure, true);
        await source.screenshot({
            path: `${output}/source-${width}.png`,
            fullPage: true,
        });
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await installStitchFixtures(page);
        const failures = await installStaticAssets(page);
        await page.goto(`${base}/stock/DEMO-A?tab=details`);
        await page.locator('.stock-facts').waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await page.evaluate(() => document.fonts.ready);
        const implementation = await page.evaluate(measure, false);
        await page.screenshot({
            path: `${output}/implementation-${width}.png`,
            fullPage: true,
        });
        const checks = Object.fromEntries(
            [
                'heading',
                'reports',
                'feedback',
                'select',
                'textarea',
                'count',
                'privacy',
                'submit',
            ].map((name) => {
                const a = original[name],
                    b = implementation[name];
                const fields = ['select', 'textarea', 'submit'].includes(name)
                    ? ['height', 'fontSize']
                    : ['fontSize', 'lineHeight'];
                return [
                    name,
                    {
                        fields,
                        pass: Boolean(
                            a &&
                                b &&
                                fields.every((field) => a[field] === b[field])
                        ),
                    },
                ];
            })
        );
        rows.push({
            width,
            screenId: 'd33c8e06e86f4404a4b5388c7aa33e13',
            original,
            implementation,
            checks,
            sourceFailures,
            failures,
            errors,
        });
        await source.close();
        await page.close();
    }
    await fs.writeFile(
        `${output}/measurements.json`,
        JSON.stringify(
            {
                scope: 'Named typography/control dimensions only; not full-screen visual acceptance',
                rows,
            },
            null,
            2
        )
    );
    const pass = rows.every(
        (row) =>
            Object.values(row.checks).every((check) => check.pass) &&
            !row.errors.length &&
            !row.failures.length &&
            !row.sourceFailures.length
    );
    console.log(
        JSON.stringify({
            pass,
            rows: rows.map((row) => ({ width: row.width, checks: row.checks })),
        })
    );
    if (!pass) process.exitCode = 1;
} finally {
    await browser.close();
}
