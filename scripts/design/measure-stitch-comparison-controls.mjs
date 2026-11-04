/* global document, getComputedStyle */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const evidence =
    process.env.STITCH_EVIDENCE_DIR || '/workspace/stitch-v2-evidence';
const out = `${evidence}/checks/${process.env.STITCH_COMPARISON_PHASE || 'phase23'}/comparison-${process.env.STITCH_CONTROL_STAGE || 'after'}`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = ({ source }) => {
    const selectors = source
        ? {
              title: '.filter-title',
              table: '.table-responsive',
              tableGrid: '.compare-table',
              tableHead: '.compare-table thead th',
              tableCell: '.compare-table tbody td',
              card: '.m-card',
              fieldGrid: '.m-field-grid',
              metrics: '.m-metrics',
              metric: '.m-metric-item',
              meta: '.m-meta',
              action: '.action-banner',
              guidance: '.action-disclaimer',
              notice: '.notice-banner',
              context: '.context-name',
              field: '.select-control',
              filters: '.pipeline-steps',
              reset: '.btn-reset',
          }
        : {
              title: '.comparison-filter-header h2',
              table: '.comparison-table-wrap',
              tableGrid: '.comparison-table-wrap table',
              tableHead: '.comparison-table-wrap thead th',
              tableCell: '.comparison-table-wrap tbody th',
              card: '.product-grid article',
              fieldGrid: '.product-fields',
              metrics: '.product-metrics',
              metric: '.product-metric:nth-child(2)',
              meta: '.product-meta',
              action: '.comparison-action-banner',
              guidance: '.comparison-action-banner p',
              notice: '.similar-reference-notice',
              context: '.comparison-basis-context strong',
              field: '.explorer-filters .p-select',
              filters: '.explorer-filters',
              reset: '.comparison-filter-header .p-button',
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
                    minWidth: s.minWidth,
                    verticalAlign: s.verticalAlign,
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
            'compare-underlying',
            '41abb021992c4d1a9570cd5a03313cb6',
            '/compare?view=underlying&symbol=DEMO-BASE',
            '.comparison-filter-card',
        ],
        [
            'compare-similar',
            'ef89e781a5c54636b82ad0407924c21f',
            '/compare?view=similar',
            '.comparison-filter-card',
        ],
        [
            'compare-theme',
            '05b463a83d564c34886e0f9c018ac2a3',
            '/compare?view=theme&theme=semiconductors',
            '.comparison-filter-card',
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
