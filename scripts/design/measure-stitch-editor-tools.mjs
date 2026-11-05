/* global document, getComputedStyle */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const evidence =
    process.env.STITCH_EVIDENCE_DIR || '/workspace/stitch-v2-evidence';
const output = `${evidence}/checks/${process.env.STITCH_MEASURE_PHASE || 'phase19'}/${process.env.STITCH_MEASURE_STAGE || 'after'}`;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = ({ name, source }) => {
    const targets =
        name === 'share'
            ? source
                ? {
                      editor: '#share-generator',
                      selector: '#card-type-group',
                      selectionPanel:
                          '#share-generator > div:first-child > section:first-child',
                      previewPanel:
                          '#share-generator > div:first-child > section:nth-child(2)',
                      square: '#share-generator .aspect-square',
                      choice: '.card-type-btn',
                      tone: '.tone-btn',
                  }
                : {
                      editor: '.share-editor',
                      selector: '.share-selector fieldset',
                      choice: '.card-choice',
                      tone: '.share-controls .p-togglebutton',
                      preview: '.share-preview-column',
                      settings: '.share-editor-settings',
                  }
            : source
              ? {
                    toolbar: '.chart-header-row',
                    period: '.control-btn-group',
                    button: '.chart-toggle-btn',
                    plot: '.svg-chart-container',
                    volume: '.volume-chart-container',
                    tools: '.chart-tools',
                    tool: '.chart-tool-btn',
                }
              : {
                    toolbar: '.chart-controls',
                    period: '.periods',
                    button: '.periods .p-button',
                    plot: '.candle-plot',
                    volume: '.volume-plot',
                    tools: '.zoom-controls',
                    tool: '.zoom-controls .p-button',
                    summary: '.quote-summary',
                };
    return Object.fromEntries(
        Object.entries(targets).map(([key, sel]) => {
            const el = document.querySelector(sel);
            if (!el) return [key, null];
            const r = el.getBoundingClientRect(),
                s = getComputedStyle(el);
            return [
                key,
                {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    columns: s.gridTemplateColumns,
                    gap: s.gap,
                    padding: s.padding,
                    font: s.fontFamily,
                    fontSize: s.fontSize,
                    lineHeight: s.lineHeight,
                },
            ];
        })
    );
};
try {
    for (const [name, id] of [
        ['share', '2b8b6a95d49a43a6b0ab02e71556ed0e'],
        ['prices', '87cd200796914464b7613003247de771'],
    ])
        for (const width of [1280, 768, 390]) {
            const source = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            await installStaticAssets(source);
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
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await installStaticAssets(page);
            await installStitchFixtures(page);
            await page.goto(
                (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                    `/stock/DEMO-A?tab=${name}`
            );
            await page
                .locator(name === 'share' ? '.share-selector' : '.candle-plot')
                .waitFor();
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
            await page.evaluate(() => document.fonts.ready);
            const implementation = await page.evaluate(measure, {
                name,
                source: false,
            });
            rows.push({ name, width, original, implementation, errors });
            await page.screenshot({
                path: `${output}/${name}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
            await source.close();
            await page.close();
        }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        {
            scope: 'Geometry diagnostics only; different financial examples remain; no whole-screen acceptance',
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
