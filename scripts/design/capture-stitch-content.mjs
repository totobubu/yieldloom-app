/* global document, innerWidth -- Playwright page callback. */
// Captures the actual Vue pages with a fixed, isolated synthetic dataset.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output =
    process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const cases = [
    [
        'search',
        '6e69286f8e3d4f98b3cbc125f2b2ecd0',
        '/?q=DEMO&sort=symbol',
        '.stock-card-grid',
    ],
    [
        'stock-details',
        'd33c8e06e86f4404a4b5388c7aa33e13',
        '/stock/DEMO-A?tab=details',
        '.stock-facts',
    ],
    [
        'stock-prices',
        '87cd200796914464b7613003247de771',
        '/stock/DEMO-A?tab=prices',
        '.stock-price-history',
    ],
    [
        'stock-dividends',
        'bd619d24ceb74c92afad1787a364ab4b',
        '/stock/DEMO-A?tab=dividends',
        '.dividend-next',
    ],
    [
        'stock-share',
        '2b8b6a95d49a43a6b0ab02e71556ed0e',
        '/stock/DEMO-A?tab=share',
        '.share-workspace',
    ],
    [
        'compare-underlying',
        '41abb021992c4d1a9570cd5a03313cb6',
        '/compare?view=underlying&symbol=DEMO-BASE',
        '.explorer-filters',
    ],
    [
        'compare-similar',
        'ef89e781a5c54636b82ad0407924c21f',
        '/compare?view=similar',
        '.explorer-filters',
    ],
    [
        'compare-theme',
        '05b463a83d564c34886e0f9c018ac2a3',
        '/compare?view=theme&theme=semiconductors',
        '.explorer-filters',
    ],
    [
        'portfolio-summary',
        '008f9456b8c643d0b9f41957447b9afc',
        '/mypage?tab=overview&view=summary',
        '.valuation-comparison',
    ],
    [
        'portfolio-holdings',
        'd90f121fb719421e880cc02309349add',
        '/mypage?tab=overview&view=holdings',
        '.overview-tabs .p-datatable',
    ],
    [
        'portfolio-calendar',
        'fc276eb9388a48909296fb018f60771b',
        '/mypage?tab=calendar',
        '.calendar-navigation',
    ],
    [
        'portfolio-analysis',
        '2e3c6628d6c74eafa277d9f07d60fc57',
        '/mypage?tab=insights',
        '.insights-filters',
    ],
    [
        'asset-management',
        'b611bd07ed0c464581479140b9207afb',
        '/mypage?tab=assets',
        '.accounts',
    ],
    [
        'account-registration',
        'd04aa5557c114ec3a4b4895adc3eb724',
        '/mypage?tab=assets',
        '.accounts',
    ],
];
await fs.mkdir(`${output}/content-implementation`, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const selectedNames = new Set(
    (process.env.STITCH_CAPTURE_NAMES || '').split(',').filter(Boolean)
);
const previous = selectedNames.size
    ? JSON.parse(
          await fs.readFile(
              `${output}/content-implementation/results.json`,
              'utf8'
          )
      ).results
    : [];
const results = [];
try {
    for (const [name, screenId, path, selector] of cases.filter(
        ([name]) => !selectedNames.size || selectedNames.has(name)
    )) {
        for (const width of [1280, 768, 390]) {
            const context = await browser.newContext({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            await installStitchFixtures(page, {
                admin: path.startsWith('/mypage'),
            });
            // Register after the fixture HTTPS blocker so approved static fonts load.
            const assetFailures = await installStaticAssets(page);
            try {
                await page.goto(base + path);
                await page
                    .locator(
                        name === 'portfolio-holdings' && width < 1024
                            ? '.holding-cards'
                            : selector
                    )
                    .first()
                    .waitFor({ timeout: 20000 });
                await page
                    .locator('.portfolio-loading-overlay')
                    .waitFor({ state: 'hidden', timeout: 20000 });
                await page
                    .locator('.fullscreen-data-loading-mask')
                    .waitFor({ state: 'hidden', timeout: 20000 });
                if (name === 'portfolio-calendar')
                    await page.locator('.calendar-totals').waitFor();
                if (name === 'portfolio-analysis')
                    await page.locator('.insights-summary').waitFor();
                if (name === 'portfolio-summary')
                    await page.locator('.valuation-card').first().waitFor();
                if (name === 'stock-prices')
                    await page.locator('.candle-plot').waitFor();
                if (name === 'account-registration') {
                    await page
                        .getByRole('button', { name: '계좌 추가', exact: true })
                        .click();
                    await page.locator('.account-registration').waitFor();
                }
                await page.evaluate(() => document.fonts.ready);
                const overflow = await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth + 1
                );
                await page.screenshot({
                    path: `${output}/content-implementation/${name}-${width}.png`,
                    fullPage: true,
                    animations: 'disabled',
                });
                const contentBox = await page
                    .locator('.studio-main')
                    .boundingBox();
                await page.screenshot({
                    path: `${output}/content-implementation/${name}-${width}-content.png`,
                    fullPage: true,
                    animations: 'disabled',
                    clip: {
                        x: 0,
                        y: contentBox.y,
                        width,
                        height: contentBox.height,
                    },
                    style: '.studio-header, .studio-footer, .mobile-nav, .shell-submenu { visibility: hidden !important; }',
                });
                const typography = await page.evaluate(() => {
                    const fontFaces = [...document.fonts].map((face) => ({
                        family: face.family.replace(/["']/g, ''),
                        weight: face.weight,
                        status: face.status,
                    }));
                    const loaded = (family) =>
                        fontFaces.some(
                            (face) =>
                                face.family === family &&
                                face.status === 'loaded'
                        );
                    return {
                        fontEvidenceVersion: 2,
                        fontsReady: document.fonts.status,
                        hankenLoaded: loaded('Hanken Grotesk'),
                        shellFontLoaded: loaded('Noto Sans KR'),
                        monoLoaded: loaded('JetBrains Mono'),
                        fontFaces,
                    };
                });
                results.push({
                    name,
                    screenId,
                    path,
                    width,
                    status: errors.length
                        ? 'javascript-error'
                        : overflow
                          ? 'overflow'
                          : 'captured',
                    overflow,
                    assetFailures,
                    typography,
                    errors,
                });
                console.log(
                    name,
                    width,
                    errors.length
                        ? 'javascript-error'
                        : overflow
                          ? 'overflow'
                          : 'captured'
                );
            } catch (error) {
                await page.screenshot({
                    path: `${output}/content-implementation/${name}-${width}-failed.png`,
                    fullPage: true,
                    animations: 'disabled',
                });
                results.push({
                    name,
                    screenId,
                    path,
                    width,
                    status: 'capture-failed',
                    error: error.message,
                    errors,
                });
                console.log(name, width, 'capture-failed', errors);
            }
            await context.close();
        }
    }
} finally {
    await browser.close();
    await fs.writeFile(
        `${output}/content-implementation/results.json`,
        JSON.stringify(
            {
                clock: '2026-11-04T12:00:00Z',
                dataset:
                    'tests/stitch-fixtures.mjs; isolated synthetic accounts; all non-GET APIs rejected',
                deviceScaleFactor: 2,
                results: [
                    ...previous.filter((row) => !selectedNames.has(row.name)),
                    ...results,
                ],
            },
            null,
            2
        )
    );
}
