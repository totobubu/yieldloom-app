import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const prices = [
    { date: '2026-09-30', close: 38 },
    { date: '2026-10-01', close: 39 },
    { date: '2026-10-02', close: 40.5956 },
    { date: '2026-10-05', close: 41 },
    { date: '2026-10-07', close: 42 },
    { date: '2026-10-21', close: 43.25 },
    { date: '2026-10-22', close: 44 },
];
try {
    for (const width of [1440, 768, 390, 360]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        await page.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
        let quotes = 0,
            candles = 0;
        await page.route('**/api/thumbnail-data?**', (r) => {
            quotes++;
            return r.fulfill({
                json: {
                    ticker: {
                        symbol: 'QLDY',
                        tickerInfo: {
                            symbol: 'QLDY',
                            currency: 'USD',
                            price: 44,
                        },
                        sourceStatus: {
                            freshness: 'fresh',
                            priceDate: '2026-10-22',
                            adjustmentBasis: 'upstream_unverified',
                        },
                        backtestData: prices,
                    },
                    catalog: { symbol: 'QLDY', securityType: 'etf' },
                    rivals: [],
                    rivalOptions: [],
                    series: {},
                    dataStatus: 'fresh',
                },
            });
        });
        await page.route('**/api/stock-prices?**', (r) => {
            candles++;
            return r.fulfill({
                json: {
                    symbol: 'QLDY',
                    currency: 'USD',
                    source: 'fixture',
                    candles: prices.map((p) => ({
                        ...p,
                        open: p.close,
                        high: p.close,
                        low: p.close,
                        volume: 100,
                    })),
                },
            });
        });
        await page.goto(`${base}/stock/QLDY?tab=prices`);
        await page.locator('.price-history summary').click();
        const history = page.locator('.stock-price-history');
        await history.locator('.price-calendar').waitFor();
        assert.match(
            await history.locator('.month-navigation').innerText(),
            /2026년 10월/
        );
        assert.equal(
            await history
                .locator('[data-date="2026-10-22"] strong')
                .innerText(),
            '44'
        );
        assert.equal(
            await history
                .locator('[data-date="2026-10-02"] strong')
                .innerText(),
            '40.5956'
        );
        assert.equal(
            await history.locator('[data-date="2026-10-03"] .no-price').count(),
            1
        );
        assert.equal(
            await history.locator('[data-date="2026-10-06"] .no-price').count(),
            1
        );
        assert(
            await history
                .getByRole('button', { name: '다음 달 시세', exact: true })
                .isDisabled()
        );
        await history
            .getByRole('button', { name: '이전 달 시세', exact: true })
            .click();
        assert.equal(
            await history
                .locator('[data-date="2026-09-30"] strong')
                .innerText(),
            '38'
        );
        assert(
            await history
                .getByRole('button', { name: '이전 달 시세', exact: true })
                .isDisabled()
        );
        await history
            .getByRole('button', { name: '최근 시세 월', exact: true })
            .click();
        await history.getByRole('button', { name: '표', exact: true }).click();
        assert.equal(await history.locator('tbody tr').count(), 7);
        assert.match(
            await history.locator('tbody').innerText(),
            /40\.5956 USD/
        );
        await history
            .getByRole('button', { name: '달력', exact: true })
            .click();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.equal(quotes, 1);
        assert.equal(candles, 1);
        assert(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            )
        );
        await history.screenshot({
            path: `/tmp/stock-price-calendar-${width}.png`,
        });
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        await history.screenshot({
            path: `/tmp/stock-price-calendar-dark-${width}.png`,
        });
        console.log(
            `PASS ${width}: month navigation, exact close, missing/weekend dates, table toggle, no extra API reads`
        );
        await page.close();
    }
    const empty = await browser.newPage();
    await empty.route('**/api/thumbnail-data?**', (r) =>
        r.fulfill({
            json: {
                ticker: {
                    symbol: 'QLDY',
                    tickerInfo: { symbol: 'QLDY', currency: 'USD', price: 44 },
                    sourceStatus: {
                        freshness: 'fresh',
                        priceDate: '2026-10-22',
                    },
                    backtestData: [],
                },
                catalog: { symbol: 'QLDY', securityType: 'etf' },
                rivals: [],
                rivalOptions: [],
                series: {},
                dataStatus: 'fresh',
            },
        })
    );
    await empty.route('**/api/stock-prices?**', (r) =>
        r.fulfill({ json: { symbol: 'QLDY', candles: [] } })
    );
    await empty.goto(`${base}/stock/QLDY?tab=prices`);
    await empty.locator('.price-history summary').click();
    await empty.locator('.stock-price-history .empty').waitFor();
    assert.equal(await empty.locator('.price-calendar').count(), 0);
    console.log('PASS empty: no invented calendar prices');
} finally {
    await browser.close();
}
