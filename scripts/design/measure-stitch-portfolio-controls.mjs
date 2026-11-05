/* global document, getComputedStyle */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const evidence =
    process.env.STITCH_EVIDENCE_DIR || '/workspace/stitch-v2-evidence';
const out = `${evidence}/checks/${process.env.STITCH_CONTROL_PHASE || 'phase22'}/${process.env.STITCH_CONTROL_STAGE || 'after'}`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = ({ name, source }) => {
    const selectors =
        name === 'analysis'
            ? source
                ? {
                      heading: '.header-bar h1',
                      filters: '.filter-grid',
                      label: '.control-label',
                      field: '.select-box',
                      refresh: '.filter-grid .btn-base',
                  }
                : {
                      heading: '.insights-heading h1,.insights-heading h2',
                      filters: '.insights-filters',
                      label: '.insights-filters label',
                      field: '.insights-filters .p-select',
                      refresh: '.insights-filters > .p-button',
                  }
            : source
              ? {
                    navigation: '.card:has(> .mode-row)',
                    mode: '.mode-pill',
                    pager: '.nav-pager',
                    button: '.nav-pager .btn-base',
                    period: '.nav-pager > span',
                    today: '.nav-pager .btn-base:nth-child(2)',
                }
              : {
                    navigation: '.calendar-navigation',
                    mode: '.calendar-navigation .p-togglebutton',
                    pager: '.period-picker',
                    button: '.period-picker .p-button',
                    period: '.period-picker input',
                    today: '.period-picker .p-button:nth-child(2)',
                };
    return Object.fromEntries(
        Object.entries(selectors).map(([key, sel]) => {
            const el = document.querySelector(sel);
            if (!el) return [key, null];
            const r = el.getBoundingClientRect(),
                s = getComputedStyle(el);
            return [
                key,
                {
                    width: r.width,
                    height: r.height,
                    contentHeight:
                        r.height -
                        parseFloat(s.paddingTop) -
                        parseFloat(s.paddingBottom) -
                        parseFloat(s.borderTopWidth) -
                        parseFloat(s.borderBottomWidth),
                    fontFamily: s.fontFamily,
                    fontSize: s.fontSize,
                    lineHeight: s.lineHeight,
                    weight: s.fontWeight,
                    gap: s.gap,
                    padding: s.padding,
                    columns: s.gridTemplateColumns,
                },
            ];
        })
    );
};
try {
    for (const [name, id, url, ready] of [
        [
            'analysis',
            '2e3c6628d6c74eafa277d9f07d60fc57',
            '/mypage?tab=insights',
            '.insights-summary',
        ],
        [
            'calendar',
            'fc276eb9388a48909296fb018f60771b',
            '/mypage?tab=calendar',
            '.calendar-totals',
        ],
    ])
        for (const width of [1280, 768, 390]) {
            const source = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            const assets = await installStaticAssets(source);
            await source.setContent(
                await fs.readFile(
                    `docs/design/stitch-v2/originals/7356929996797649648/${id}.html`,
                    'utf8'
                ),
                { waitUntil: 'networkidle' }
            );
            await source.evaluate(() => document.fonts.ready);
            const original = await source.evaluate(measure, {
                name,
                source: true,
            });
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            await installStaticAssets(page);
            await installStitchFixtures(page, { admin: true });
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(
                (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') + url
            );
            await page.locator(ready).waitFor();
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
            await page.evaluate(() => document.fonts.ready);
            rows.push({
                name,
                width,
                id,
                original,
                implementation: await page.evaluate(measure, {
                    name,
                    source: false,
                }),
                errors,
                assets,
            });
            await page.screenshot({
                path: `${out}/${name}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
            await page.close();
            await source.close();
        }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${out}/results.json`,
    JSON.stringify(
        {
            scope: 'Control geometry only; independent financial data and widths; not whole-screen acceptance',
            rows,
        },
        null,
        2
    ) + '\n'
);
console.log(
    JSON.stringify({
        pairs: rows.length,
        errors: rows.flatMap((r) => r.errors),
    })
);
