import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 390, 360]) {
        const page = await browser.newPage({
            viewport: { width, height: 1100 },
        });
        const errors = [];
        const insightRequests = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
            if (r.url().includes('/security-insights/'))
                insightRequests.push(r.url());
        });
        await page.route('**/api/thumbnail-data?*', (r) =>
            r.fulfill({
                json: {
                    ticker: {
                        symbol: 'GIS',
                        tickerInfo: {
                            symbol: 'GIS',
                            price: 55,
                            currency: 'USD',
                            longName: 'General Mills',
                        },
                        sourceStatus: {
                            freshness: 'fresh',
                            priceDate: '2026-10-13',
                        },
                        backtestData: Array.from({ length: 46 }, (_, i) => ({
                            date: new Date(Date.UTC(2023, i, 5))
                                .toISOString()
                                .slice(0, 10),
                            close: 50 + i,
                            amount: 0.5,
                        })),
                    },
                    catalog: { symbol: 'GIS', securityType: 'stock' },
                    rivals: [],
                    rivalOptions: [],
                    series: {},
                    dataStatus: 'fresh',
                },
            })
        );
        await page.route('**/distribution-index.json', (r) =>
            r.fulfill({ json: { tickers: [] } })
        );
        await page.route('**/security-insights/*.json', (r) =>
            r.fulfill({
                json: {
                    asOfDate: '2026-10-14',
                    securities: {
                        GIS: {
                            status: 'collected',
                            source: 'Yahoo Finance',
                            sourceUrl: 'https://finance.yahoo.com/quote/GIS/',
                            dividendEtfs: [
                                {
                                    ticker: 'SCHD',
                                    weightPercent: 0.4299,
                                    asOfDate: '2026-10-13',
                                    sourceUrl:
                                        'https://www.schwabassetmanagement.com/products/schd',
                                },
                                {
                                    ticker: 'VYM',
                                    weightPercent: 0.09,
                                    asOfDate: '2026-08-31',
                                    sourceUrl:
                                        'https://investor.vanguard.com/investment-products/etfs/profile/vym',
                                },
                            ],
                        },
                    },
                },
            })
        );
        await page.goto(base + '/stock/GIS?tab=dividends');
        const cards = page.locator('.holding-etf-card');
        await cards.first().waitFor();
        assert.equal(await cards.count(), 2);
        const schd = cards.filter({
            has: page.getByRole('link', { name: 'SCHD', exact: true }),
        });
        assert.match(await schd.innerText(), /Schwab U.S. Dividend Equity ETF/);
        assert.match(await schd.innerText(), /ETF 내 GIS 비중\s*0.4299%/);
        assert.match(await schd.innerText(), /2026-10-13/);
        assert.equal(
            await schd
                .getByRole('link', { name: 'ETF 상세 보기' })
                .getAttribute('href'),
            '/stock/SCHD'
        );
        const vym = cards.filter({
            has: page.getByRole('link', { name: 'VYM', exact: true }),
        });
        assert.match(await vym.innerText(), /FTSE High Dividend Yield Index/);
        assert.match(await vym.innerText(), /0.09%/);
        const a = await schd.boundingBox(),
            b = await vym.boundingBox();
        assert.ok(width < 768 ? b.y > a.y : b.x > a.x);
        const help = page.getByRole('button', {
            name: '누적 데이터 기준 및 출처 안내',
            exact: true,
        });
        await help.scrollIntoViewIfNeeded();
        if (width === 1440) {
            await help.hover();
            await page.locator('.p-popover').waitFor();
            const hoverText = await page.locator('.p-popover').innerText();
            await help.click();
            assert.equal(
                await page.locator('.p-popover').innerText(),
                hoverText
            );
            await page.keyboard.press('Escape');
            await page.locator('.p-popover').waitFor({ state: 'hidden' });
            await page.mouse.move(1, 1);
        }
        await help.focus();
        await page.keyboard.press('Enter');
        const pop = page.locator('.p-popover');
        await pop.waitFor();
        assert.match(await pop.innerText(), /미확인은 0/);
        assert.equal(
            await pop
                .getByRole('link', { name: 'Yahoo Finance', exact: true })
                .getAttribute('href'),
            'https://finance.yahoo.com/quote/GIS/'
        );
        await page.keyboard.press('Escape');
        await pop.waitFor({ state: 'hidden' });
        assert.equal(
            insightRequests.length,
            1,
            'Cards and help must reuse the existing insights payload'
        );
        await page.locator('.holding-etfs').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `/tmp/holding-etf-cards-${width}.png` });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page
            .getByRole('button', { name: '다크 모드', exact: true })
            .click();
        assert.equal(await page.locator('html.p-dark').count(), 1);
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}: SCHD/VYM metadata and weights/source, responsive cards, keyboard help/source, 1 shared insights request, dark and no overflow/errors`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
