// Synthetic public quotes/corporate actions only. No production data or writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
        });
        await installStitchFixtures(page);
        await page.route('**/api/thumbnail-data?*', (route) => {
            const symbol = new URL(route.request().url()).searchParams.get(
                'ticker'
            );
            return route.fulfill({
                json: {
                    catalog: { securityType: 'etf' },
                    ticker: {
                        symbol,
                        tickerInfo: {
                            symbol,
                            currency: 'USD',
                            price: 50,
                            longName: '합성 종목',
                        },
                        sourceStatus: {
                            priceDate: '2026-11-04',
                            freshness: 'fresh',
                        },
                        backtestData: [
                            {
                                date: '2026-11-01',
                                close: 50,
                                amount: symbol === 'DEMO-A' ? 0.16 : 0,
                            },
                        ],
                    },
                },
            });
        });
        let reads = 0;
        await page.route('**/api/stock-prices?*', (route) => {
            reads++;
            const symbol = new URL(route.request().url()).searchParams.get(
                'ticker'
            );
            return route.fulfill({
                json: {
                    symbol,
                    currency: 'USD',
                    candles: Array.from({ length: 35 }, (_, i) => ({
                        date: new Date(Date.UTC(2026, 9, i + 1))
                            .toISOString()
                            .slice(0, 10),
                        open: 49,
                        high: 51,
                        low: 48,
                        close: 50,
                        volume: i === 0 ? 0 : i === 1 ? null : 100,
                    })),
                    events:
                        symbol === 'DEMO-A'
                            ? [
                                  {
                                      date: '2026-11-01',
                                      kind: 'dividend',
                                      label: '중복 제공 레이블',
                                  },
                                  {
                                      date: '2026-11-02',
                                      kind: 'split',
                                      label: '분할 2:1 (합성)',
                                  },
                                  {
                                      date: '2026-11-03',
                                      kind: 'unknown',
                                      label: '종류 미확인 합성 기록',
                                  },
                                  {
                                      date: '2026-10-31',
                                      kind: 'dividend',
                                      label: '제공 배당락 0 USD',
                                  },
                                  {
                                      date: '2024-01-01',
                                      kind: 'split',
                                      label: '표 밖 합성 사건',
                                  },
                              ]
                            : [],
                },
            });
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(base + '/stock/DEMO-A?tab=prices');
        await page
            .locator('.price-observation-table tbody tr')
            .first()
            .waitFor({ state: 'attached' });
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.equal(
            await page
                .getByRole('button', { name: '1개월', exact: true })
                .getAttribute('aria-pressed'),
            'true'
        );
        assert.equal(
            await page
                .locator('.candle-plot')
                .evaluate((el) => el.getBoundingClientRect().height),
            280
        );
        assert.equal(
            await page
                .locator('.volume-plot')
                .evaluate((el) => el.getBoundingClientRect().height),
            80
        );
        assert.ok(
            (await page.locator('.chart-event text').allTextContents()).some(
                (text) => text.trim() === '?'
            ),
            'Unknown events cannot be marked as dividends'
        );
        await page.getByRole('button', { name: '3개월', exact: true }).click();
        assert.equal(await page.locator('.volume-bar').count(), 35);
        assert.equal(
            await page
                .locator('.volume-bar')
                .nth(0)
                .locator('rect')
                .getAttribute('height'),
            '0'
        );
        assert.equal(
            await page.locator('.volume-bar').nth(1).locator('rect').count(),
            0,
            'Missing volume is not zero'
        );
        const lastQuote = await page.locator('.quote-summary').innerText();
        await page.locator('.volume-plot').scrollIntoViewIfNeeded();
        const volumeBox = await page.locator('.volume-plot').boundingBox();
        await page.mouse.move(
            volumeBox.x + volumeBox.width / 2,
            volumeBox.y + 20
        );
        assert.notEqual(
            await page.locator('.quote-summary').innerText(),
            lastQuote,
            'Volume pointer follows the same date selection'
        );
        await page.mouse.move(0, 0);
        assert.equal(reads, 1, 'Period and pointer changes reuse price data');
        const host =
            width > 768
                ? page.locator('.price-observation-table')
                : page.locator('.price-observation-cards');
        const row = (date) =>
            host
                .locator(width > 768 ? 'tbody tr' : 'article')
                .filter({ hasText: date });
        const dividend = row('2026-11-01');
        assert.equal(
            await dividend.locator('.event-marker.dividend').count(),
            1
        );
        assert.match(await dividend.innerText(), /0\.16/);
        assert.doesNotMatch(await dividend.innerText(), /중복 제공 레이블/);
        assert.match(await row('2026-11-02').innerText(), /분할 2:1/);
        assert.equal(
            await row('2026-11-02').locator('.event-marker.split').count(),
            1
        );
        assert.equal(
            await row('2026-11-03').locator('.event-marker.dividend').count(),
            0
        );
        assert.match(await row('2026-11-03').innerText(), /종류 미확인/);
        assert.match(await row('2026-10-31').innerText(), /배당락 0 USD/);
        assert.equal(
            await row('2026-11-04')
                .getByLabel('제공된 이벤트 미확인', { exact: true })
                .count(),
            1
        );
        assert.doesNotMatch(await host.innerText(), /표 밖 합성 사건/);
        assert.equal(reads, 1, 'table events reuse the chart response');
        if (width > 768)
            assert.equal(await host.getByRole('columnheader').count(), 7);
        else {
            assert.equal(await host.locator('article').count(), 10);
            await host
                .getByRole('button', { name: /시세 이력 더 보기/ })
                .click();
            assert.equal(await host.locator('article').count(), 20);
            assert.equal(reads, 1);
        }
        await page.goto(base + '/stock/DEMO-B?tab=prices');
        await page
            .locator('.price-observation-table tbody tr')
            .first()
            .waitFor({ state: 'attached' });
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.equal(
            await host.locator('.event-marker').count(),
            1,
            'the new ticker retains its explicitly provided zero dividend'
        );
        assert.equal(
            await host.locator('.event-marker.split').count(),
            0,
            'old ticker splits never leak'
        );
        assert.match(await host.innerText(), /주당 0 USD/);
        assert.doesNotMatch(
            await host.innerText(),
            /0\.16|분할 2:1|종류 미확인 합성/
        );
        assert.equal(reads, 2);
        assert.deepEqual(errors, []);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        console.log(
            `PASS price-events/${width}: exact dates, source precedence, split/zero/unknown/missing, no invented row, one shared read, ticker isolation`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
