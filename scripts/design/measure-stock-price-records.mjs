/* global document, getComputedStyle, innerWidth -- isolated Playwright callbacks. */
// Synthetic public fixture only; source HTML is immutable; never writes to live accounts.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const repo = process.cwd(),
    require = createRequire(repo + '/package.json');
const { chromium } = require('playwright');
const { installStitchFixtures } = await import(
    repo + '/tests/stitch-fixtures.mjs'
);
const { installStaticAssets } = await import(
    repo + '/scripts/design/browser-static-assets.mjs'
);
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5234';
const out = process.env.STITCH_PRICE_RECORDS_DIR || '/tmp/stitch-price-records',
    stage = process.env.PRICE_STAGE || 'after',
    results = [];
await fs.mkdir(out, { recursive: true });
const sourceHtml = await fs.readFile(
    repo +
        '/docs/design/stitch-v2/originals/7356929996797649648/87cd200796914464b7613003247de771.html',
    'utf8'
);
const rows = [
    ['2026-11-03', 49.7, 50.4, 49.6, 50, 142500],
    ['2026-11-02', 49.8, 50.1, 49.3, 49.5, 118200],
    ['2026-10-30', 49.1, 49.9, 48.9, 49.7, 135000],
    ['2026-10-27', 48.8, 49.4, 48.5, 49, null],
    ['2026-10-20', 48.5, 49.2, 48.2, 49.1, 164800],
    ['2026-10-15', 48.2, 48.9, 48, 48.7, 210300],
].map(([date, open, high, low, close, volume]) => ({
    date,
    open,
    high,
    low,
    close,
    volume,
}));
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
function inspect(el) {
    const s = getComputedStyle(el),
        r = el.getBoundingClientRect();
    return {
        width: r.width,
        height: r.height,
        font: s.fontSize,
        weight: s.fontWeight,
        line: s.lineHeight,
        padding: s.padding,
        gap: s.gap,
        borderBottom: s.borderBottom,
        borderRadius: s.borderRadius,
        textAlign: s.textAlign,
        color: s.color,
        background: s.backgroundColor,
    };
}
try {
    for (const width of [1280, 1024, 834, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await page.setContent(sourceHtml);
        await page.evaluate(() => document.fonts.ready);
        const source = await page
            .locator('.history-table tbody tr')
            .first()
            .evaluate(inspect);
        const sourceCell = await page
            .locator('.history-table tbody tr td')
            .nth(1)
            .evaluate(inspect);
        await page
            .locator(
                width <= 1024 ? '.history-table tbody tr' : '.history-table'
            )
            .first()
            .screenshot({ path: `${out}/reference-${width}.png` });
        await page.close();
        const p = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(p);
        const assetFailures = await installStaticAssets(p);
        let reads = 0;
        await p.route('**/api/stock-prices?*', (r) => {
            reads++;
            return r.fulfill({
                json: {
                    symbol: 'DEMO-A',
                    currency: 'USD',
                    candles: rows,
                    events: [
                        {
                            date: '2026-10-20',
                            kind: 'split',
                            label: '분할 예시',
                        },
                        {
                            date: '2026-10-15',
                            kind: 'dividend',
                            label: '배당락 $0.18',
                        },
                    ],
                },
            });
        });
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        await p.route('**/api/thumbnail-data?*', (r) =>
            r.fulfill({
                json: {
                    catalog: { securityType: 'etf' },
                    ticker: {
                        symbol: 'DEMO-A',
                        tickerInfo: {
                            symbol: 'DEMO-A',
                            currency: 'USD',
                            price: 50,
                            longName: '가상 고배당 인덱스 ETF',
                        },
                        sourceStatus: {
                            priceDate: '2026-11-03',
                            freshness: 'fresh',
                        },
                        backtestData: rows.map(({ date, close }) => ({
                            date,
                            close,
                        })),
                    },
                },
            })
        );
        await p.goto(base + '/stock/DEMO-A?tab=prices');
        await p
            .locator('.price-observation-table tbody tr')
            .first()
            .waitFor({ state: 'attached' });
        await p
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await p.evaluate(() => document.fonts.ready);
        const cardVisible = await p
            .locator('.price-observation-cards')
            .isVisible();
        const table = p.locator(
            cardVisible
                ? '.price-observation-cards'
                : '.price-observation-table'
        );
        const app = await table
            .locator(cardVisible ? 'article' : 'tbody tr')
            .first()
            .evaluate(inspect);
        const appCell = await table
            .locator(cardVisible ? 'dl > div' : 'tbody td')
            .nth(cardVisible ? 0 : 1)
            .evaluate(inspect);
        await table
            .locator(cardVisible ? 'article' : 'table')
            .first()
            .screenshot({ path: `${out}/${stage}-${width}.png` });
        const header = await p.locator('.history-title h2').evaluate(inspect);
        const data = {
            width,
            source,
            sourceCell,
            app,
            appCell,
            header,
            cardVisible,
            reads,
            errors,
            assetFailures,
            overflow: await p.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
        };
        results.push(data);
        console.log(JSON.stringify(data));
        if (stage === 'after') {
            await p.evaluate(() =>
                document.documentElement.classList.add('p-dark')
            );
            await table
                .locator(cardVisible ? 'article' : 'table')
                .first()
                .screenshot({ path: `${out}/after-dark-${width}.png` });
        }
        await p.close();
    }
} finally {
    await browser.close();
    await fs.writeFile(
        `${out}/${stage}.json`,
        JSON.stringify(results, null, 2) + '\n'
    );
}
