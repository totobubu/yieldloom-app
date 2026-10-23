import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
// Frozen QLDY payment example as of 2026-10-22; automatic data refreshes must not change this case.
const qldy = [
    { date: '2026-10-05', amount: 0.1579 },
    { date: '2026-10-08', amount: 0.1608 },
    { date: '2026-10-13', amount: 0.1606 },
    { date: '2026-10-15', amount: 0.157 },
    { date: '2026-10-19', amount: 0.1523 },
    { date: '2026-10-22', amount: 0.1491 },
];
const daily = Array.from({ length: 61 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
    amount: 0.1,
}));
try {
    for (const width of [1440, 390]) {
        for (const [kind, rows, expected] of [
            ['QLDY', qldy, ['자료 없음', '자료 없음', '$0.9377']],
            [
                'daily',
                [
                    ...daily,
                    { date: '2026-10-05', amountFixed: 0.6, amount: 9 },
                    { date: '2026-10-30', amount: 100 },
                    { date: '2026-10-12', amount: 99, forecasted: true },
                ],
                ['$3.1', '$3', '$0.6'],
            ],
        ]) {
            const page = await browser.newPage({
                viewport: { width, height: 1000 },
            });
            await page.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
            let reads = 0;
            await page.route('**/api/thumbnail-data?**', (route) => {
                reads++;
                return route.fulfill({
                    json: {
                        ticker: {
                            symbol: 'QLDY',
                            tickerInfo: {
                                symbol: 'QLDY',
                                price: 40,
                                currency: 'USD',
                            },
                            sourceStatus: {
                                freshness: 'fresh',
                                priceDate: '2026-10-22',
                            },
                            backtestData: rows.map((row) => ({
                                ...row,
                                close: 40,
                            })),
                        },
                        catalog: { symbol: 'QLDY', securityType: 'etf' },
                        rivals: [],
                        rivalOptions: [],
                        series: {},
                        dataStatus: 'fresh',
                    },
                });
            });
            await page.goto(`${base}/stock/QLDY?tab=share`);
            const history = page.locator('.summary-card .history');
            await history.waitFor();
            assert.match(
                await history.locator('header b').innerText(),
                /3개월/
            );
            assert.equal(await history.locator('article').count(), 3);
            assert.deepEqual(
                await history.locator('article > span').allTextContents(),
                ['26.08', '26.09', '26.10']
            );
            assert.deepEqual(
                await history.locator('article > b').allTextContents(),
                expected
            );
            assert.equal(
                await history.locator('article em').innerText(),
                '집계 중'
            );
            assert.equal(reads, 1);
            assert(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth
                )
            );
            if (kind === 'QLDY') {
                await page
                    .locator('.fullscreen-data-loading-mask')
                    .waitFor({ state: 'hidden' });
                await page.locator('.summary-card').screenshot({
                    path: `/tmp/share-three-months-${width}.png`,
                });
            }
            console.log(
                `PASS ${kind} ${width}: three calendar months, missing data, full monthly totals and no extra reads`
            );
            await page.close();
        }
    }
} finally {
    await browser.close();
}
