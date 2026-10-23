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
                    candles: prices
                        .filter((p) => p.date !== '2026-10-21')
                        .map((p) => ({
                            ...p,
                            open: p.close - 0.5,
                            high: p.close + 1,
                            low: p.close - 1,
                            close: p.date === '2026-10-22' ? 44.5 : p.close,
                            volume: p.date === '2026-10-22' ? 0 : 100,
                        })),
                },
            });
        });
        await page.goto(`${base}/stock/QLDY?tab=prices`);
        const history = page.locator('.stock-price-history');
        await history.locator('.price-calendar').waitFor();
        assert.equal(await page.locator('.price-history summary').count(), 0);
        assert.equal(await history.locator('.calendar-note').count(), 0);
        await history
            .getByRole('button', { name: '시세 이력 안내', exact: true })
            .click();
        const help = page.getByRole('dialog', {
            name: '시세 이력 안내',
            exact: true,
        });
        await help.waitFor();
        assert.match(await help.innerText(), /시세 미제공/);
        await page.keyboard.press('Escape');
        assert.match(
            await history.locator('.month-navigation').innerText(),
            /2026년 10월/
        );
        assert.equal(
            await history
                .locator('[data-date="2026-10-22"] strong')
                .innerText(),
            '$ 44.5'
        );
        assert.equal(
            await history
                .locator('[data-date="2026-10-02"] strong')
                .innerText(),
            '$ 40.5956'
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
            '$ 38'
        );
        assert(
            await history
                .getByRole('button', { name: '이전 달 시세', exact: true })
                .isDisabled()
        );
        await history
            .getByRole('button', { name: '현재 월', exact: true })
            .click();
        const day = history.getByRole('button', {
            name: '2026-10-22 시세 상세',
            exact: true,
        });
        await day.focus();
        await page.keyboard.press('Enter');
        const detail = page.getByRole('dialog', {
            name: '2026-10-22 시세 상세',
            exact: true,
        });
        await detail.waitFor();
        assert.deepEqual(await detail.locator('dd').allTextContents(), [
            '$ 43.5',
            '$ 45',
            '$ 43',
            '$ 44.5',
            '0주',
        ]);
        await detail.screenshot({
            path: `/tmp/stock-price-detail-${width}.png`,
        });
        await page.keyboard.press('Escape');
        await detail.waitFor({ state: 'hidden' });
        assert(await day.evaluate((el) => el === document.activeElement));
        await history
            .getByRole('button', { name: '2026-10-21 시세 상세', exact: true })
            .click();
        const fallback = page.getByRole('dialog', {
            name: '2026-10-21 시세 상세',
            exact: true,
        });
        await fallback.waitFor();
        assert.deepEqual(await fallback.locator('dd').allTextContents(), [
            '—',
            '—',
            '—',
            '$ 43.25',
            '—',
        ]);
        await page.keyboard.press('Escape');
        await history.getByRole('button', { name: '표', exact: true }).click();
        assert.deepEqual(await history.locator('thead th').allTextContents(), [
            '기준일',
            '시가',
            '고가',
            '저가',
            '종가',
            '거래량',
        ]);
        assert.match(
            await history.locator('tbody tr').first().innerText(),
            /43\.5[\s\S]*45[\s\S]*43[\s\S]*44\.5[\s\S]*0주/
        );
        assert.equal(await history.locator('tbody tr').count(), 7);
        assert.match(await history.locator('tbody').innerText(), /\$ 40\.5956/);
        await history
            .getByRole('button', { name: '달력', exact: true })
            .click();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.equal(quotes, 1);
        assert.equal(candles, 1);
        if (width === 1440) {
            await page
                .getByRole('tab', { name: '상세정보', exact: true })
                .click();
            await page
                .getByRole('tab', { name: '시세정보', exact: true })
                .click();
            await history
                .getByRole('button', {
                    name: '2026-10-22 시세 상세',
                    exact: true,
                })
                .filter({ hasText: '$ 44.5' })
                .waitFor();
            assert.equal(quotes, 1);
            assert.equal(candles, 1);
        }
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
    const stale = await browser.newPage();
    await stale.clock.setFixedTime(new Date('2026-11-05T12:00:00Z'));
    await stale.route('**/api/thumbnail-data?**', (r) =>
        r.fulfill({
            json: {
                ticker: {
                    symbol: 'QLDY',
                    tickerInfo: { symbol: 'QLDY', currency: 'USD', price: 44 },
                    sourceStatus: {
                        freshness: 'stale',
                        priceDate: '2026-10-22',
                    },
                    backtestData: prices,
                },
                catalog: { symbol: 'QLDY', securityType: 'etf' },
                rivals: [],
                rivalOptions: [],
                series: {},
                dataStatus: 'stale',
            },
        })
    );
    await stale.route('**/api/stock-prices?**', (r) =>
        r.fulfill({ json: { symbol: 'QLDY', candles: [] } })
    );
    await stale.goto(`${base}/stock/QLDY?tab=prices`);
    const staleHistory = stale.locator('.stock-price-history');
    await staleHistory.locator('.price-calendar').waitFor();
    await staleHistory
        .getByRole('button', { name: '현재 월', exact: true })
        .click();
    assert.match(
        await staleHistory.locator('.month-navigation').innerText(),
        /2026년 11월/
    );
    assert.equal(
        await staleHistory.locator('.price-calendar td strong').count(),
        0
    );
    assert(
        await staleHistory
            .getByRole('button', { name: '현재 월', exact: true })
            .isDisabled()
    );
    await staleHistory
        .getByRole('button', { name: '이전 달 시세', exact: true })
        .click();
    await staleHistory
        .getByRole('button', { name: '2026-10-22 시세 상세', exact: true })
        .click();
    const failedDetail = stale.getByRole('dialog', {
        name: '2026-10-22 시세 상세',
        exact: true,
    });
    await failedDetail.waitFor();
    assert.deepEqual(await failedDetail.locator('dd').allTextContents(), [
        '—',
        '—',
        '—',
        '$ 44',
        '—',
    ]);
    await stale.keyboard.press('Escape');
    assert.match(
        await staleHistory.locator('.history-status').innerText(),
        /상세 일봉을 불러오지 못했습니다/
    );
    await stale.route('**/api/stock-prices?**', (r) =>
        r.fulfill({
            json: {
                symbol: 'QLDY',
                currency: 'USD',
                candles: [
                    {
                        date: '2026-10-22',
                        open: 43,
                        high: 45,
                        low: 42,
                        close: 44.5,
                        volume: 1200,
                    },
                ],
            },
        })
    );
    await stale.getByRole('button', { name: '다시 시도', exact: true }).click();
    await staleHistory
        .getByRole('button', { name: '2026-10-22 시세 상세', exact: true })
        .filter({ hasText: '$ 44.5' })
        .click();
    const retried = stale.getByRole('dialog', {
        name: '2026-10-22 시세 상세',
        exact: true,
    });
    await retried.waitFor();
    assert.deepEqual(await retried.locator('dd').allTextContents(), [
        '$ 43',
        '$ 45',
        '$ 42',
        '$ 44.5',
        '1,200주',
    ]);
    assert.equal(await staleHistory.locator('.history-status').count(), 0);
    await stale.close();
    console.log(
        'PASS stale history: current month uses today rather than latest quoted month'
    );
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
    await empty.locator('.stock-price-history .empty').waitFor();
    assert.equal(await empty.locator('.price-calendar').count(), 0);
    console.log('PASS empty: no invented calendar prices');
} finally {
    await browser.close();
}
