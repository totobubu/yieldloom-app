/* global document, getComputedStyle */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const evidence =
    process.env.STITCH_EVIDENCE_DIR || '/workspace/stitch-v2-evidence';
const out = `${evidence}/checks/phase25/${process.env.STITCH_CONTROL_STAGE || 'after'}`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = ({ source }) => {
    const selectors = source
        ? {
              panels: 'main [class~="md:grid-cols-2"]',
              storedPanel: 'main [class~="md:grid-cols-2"] > div:first-child',
              referencePanel:
                  'main [class~="md:grid-cols-2"] > div:nth-child(2)',
              title: 'main [class~="md:grid-cols-2"] h2',
              currencyGrid:
                  'main [class~="md:grid-cols-2"] > div:first-child > [class~="sm:grid-cols-2"]',
              currencyCard:
                  'main [class~="md:grid-cols-2"] > div:first-child > [class~="sm:grid-cols-2"] > div',
              amount: 'main [class~="font-headline-lg"]',
              referenceAmount:
                  'main [class~="md:grid-cols-2"] > div:nth-child(2) [class~="font-headline-lg"]',
              tableHeader: 'main table th',
              tableCell: 'main table td',
              detailCard: 'main [class~="lg:hidden"] > div',
          }
        : {
              panels: '.valuation-comparison',
              storedPanel: '.stored-valuation-panel',
              referencePanel: '.reference-valuation-panel',
              title: '.stored-valuation-panel h2',
              currencyGrid: '.portfolio-value-grid',
              currencyCard: '.portfolio-value-card .p-card-body',
              amount: '.portfolio-value-card strong',
              referenceAmount: '.valuation-card > strong',
              tableHeader: '.valuation .p-datatable thead th',
              tableCell: '.valuation .p-datatable tbody td',
              detailCard: '.valuation-detail-card',
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
            'portfolio-summary',
            '008f9456b8c643d0b9f41957447b9afc',
            '/mypage?tab=overview&view=summary',
            '.valuation-grid',
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
