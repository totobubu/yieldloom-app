// Published public dividend fixtures, synthetic prices, no personal data or writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { toBacktestData } from '../api/thumbnail-data.js';
const base = process.env.SHARE_UI_BASE_URL || 'http://127.0.0.1:5173';
const output = 'design-review/share-card-actions';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
            timezoneId: width === 390 ? 'Asia/Seoul' : 'America/Los_Angeles',
        });
        await page.clock.setFixedTime(new Date('2026-11-03T18:00:00Z'));
        await page.route('https://fonts.googleapis.com/**', (route) =>
            route.abort()
        );
        await page.route('**/api/thumbnail-data?*', async (route) => {
            const symbol = new URL(route.request().url()).searchParams
                .get('ticker')
                .toUpperCase();
            const { history } = JSON.parse(
                await fs.readFile(
                    `public/content-studio/distribution-ticker-${symbol.toLowerCase()}.json`,
                    'utf8'
                )
            );
            await route.fulfill({
                json: {
                    ticker: {
                        symbol,
                        tickerInfo: {
                            symbol,
                            price: 10,
                            currency: 'USD',
                            longName: `${symbol} Test`,
                        },
                        sourceStatus: {
                            dividends: 'official_projection',
                            freshness: 'fresh',
                            priceDate: '2026-11-03',
                        },
                        backtestData: toBacktestData(history).map((row) => ({
                            ...row,
                            ...(row.date < '2026-11-04' ? { close: 10 } : {}),
                        })),
                    },
                    catalog: {},
                    rivals: [],
                    rivalOptions: [],
                    series: {},
                    dataStatus: 'fresh',
                },
            });
        });
        for (const symbol of ['YMAX', 'JEPQ']) {
            await page.goto(`${base}/stock/${symbol}?tab=share`);
            await page
                .getByRole('button', {
                    name: '배당 요약 PNG 다운로드',
                    exact: true,
                })
                .waitFor();
            const summary = page.locator('[data-thumbnail-kind="summary"]');
            if (symbol === 'YMAX') {
                assert.match(
                    await summary.locator('.history-cells').innerText(),
                    /26\.11\s+\$0\.0528\s+집계 중/
                );
                assert.match(
                    await summary.locator('.history-cells').innerText(),
                    /\$0\.2973/
                );
                assert.match(
                    await summary.locator('.history-cells').innerText(),
                    /\$0\.2314/
                );
            }
            if (symbol === 'JEPQ') {
                assert.match(
                    await summary.locator('.history-cells').innerText(),
                    /\$0\.6825/
                );
                assert.match(
                    await summary.locator('.history-cells').innerText(),
                    /\$0\.5669/
                );
                assert.match(
                    await summary.locator('.history-cells').innerText(),
                    /\$0\.5392/
                );
            }
            await page
                .getByRole('checkbox', { name: '배당 요약', exact: true })
                .uncheck();
            for (const [kind, label] of [
                ['summary', '배당 요약'],
                ['comparison', '배당 비교'],
                ['calendar', '배당 일정'],
                ['entry-efficiency', '과거 매수 시점별 배당률'],
            ]) {
                const button = page.getByRole('button', {
                    name: `${label} PNG 다운로드`,
                    exact: true,
                });
                assert.equal(
                    await button.locator('..').locator('input:checked').count(),
                    0
                );
                const box = await button.boundingBox();
                assert.ok(box.width >= 44 && box.height >= 44);
                assert.equal(
                    await button.getAttribute('title'),
                    `${label} PNG 다운로드`
                );
                const card = page.locator(`[data-thumbnail-kind="${kind}"]`);
                assert.doesNotMatch(
                    await card.textContent(),
                    /tot+t?obubu|토[또토]부부/i
                );
                const event = page.waitForEvent('download');
                await button.click();
                const download = await event;
                const chunks = [];
                for await (const chunk of await download.createReadStream())
                    chunks.push(chunk);
                const png = Buffer.concat(chunks);
                assert.equal(png.readUInt32BE(16), 720);
                assert.equal(png.readUInt32BE(20), 720);
                assert.ok(
                    png.length > 20000,
                    'unchecked card must render content'
                );
                await fs.writeFile(
                    `${output}/${symbol}-${width}-${kind}.png`,
                    png
                );
                assert.equal(
                    await page
                        .getByRole('checkbox', { name: label, exact: true })
                        .isChecked(),
                    false
                );
                await button.waitFor({ state: 'visible' });
            }
            for (const label of ['배당 요약', '배당 비교', '배당 일정'])
                await page
                    .getByRole('checkbox', { name: label, exact: true })
                    .check();
            for (const kind of ['summary', 'comparison', 'calendar']) {
                const panel = page.locator('.artwork-panel').filter({
                    has: page.locator(`[data-thumbnail-kind="${kind}"]`),
                });
                assert.equal(
                    await panel
                        .locator('.card-share-actions, :scope > button')
                        .count(),
                    0,
                    `${kind}: card-level actions must be removed`
                );
            }
            assert.equal(
                await page
                    .getByRole('button', {
                        name: '선택 카드 ZIP (3)',
                        exact: true,
                    })
                    .isEnabled(),
                true
            );
            await page.locator('.share-selector').scrollIntoViewIfNeeded();
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth
                ),
                true
            );
            await page.screenshot({
                path: `${output}/${symbol}-${width}.png`,
                fullPage: true,
            });
            console.log(
                `${symbol} ${width}px: market date, selection, PNG, branding and actions passed`
            );
        }
        await page.close();
    }
} finally {
    await browser.close();
}
