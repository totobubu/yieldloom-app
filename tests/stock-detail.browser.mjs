import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    await page.route('**/security-insights/*.json', (r) =>
        r.fulfill({ json: { securities: {}, asOfDate: '2026-10-15' } })
    );
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const rows = Array.from({ length: 16 }, (_, i) => ({
        date: new Date(Date.UTC(2025, i, 2)).toISOString().slice(0, 10),
        close: 30 + i / 10,
        amount: i === 15 ? 0.219894 : 0.253607,
    }));
    await page.route('**/api/thumbnail-data?*', (r) =>
        r.fulfill({
            json: {
                catalog: { company: 'Test issuer' },
                ticker: {
                    symbol: 'TOPW',
                    tickerInfo: {
                        symbol: 'TOPW',
                        longName: 'TOPW weekly income ETF',
                        price: 34.43,
                        currency: 'USD',
                    },
                    backtestData: rows,
                    sourceStatus: {
                        priceDate: '2026-10-13',
                        freshness: 'fresh',
                    },
                },
                series: {},
                rivals: [],
                rivalOptions: [],
                dataStatus: 'fresh',
            },
        })
    );
    await page.route('**/content-studio/distribution-index.json', (r) =>
        r.fulfill({
            json: {
                tickers: [
                    {
                        ticker: 'TOPW',
                        historyUrl:
                            '/content-studio/distribution-ticker-topw.json',
                    },
                ],
            },
        })
    );
    await page.route('**/content-studio/distribution-ticker-topw.json', (r) =>
        r.fulfill({
            json: {
                history: [
                    {
                        id: 1,
                        ticker: 'TOPW',
                        ex_date: '2026-10-13',
                        payable_date: '2026-10-14',
                        frequency: 'weekly',
                        verification_status: 'official',
                        distribution_per_share: 0.22,
                    },
                    {
                        id: 2,
                        ticker: 'TOPW',
                        ex_date: '2026-10-06',
                        payable_date: '2026-10-07',
                        frequency: 'weekly',
                        verification_status: 'official',
                        distribution_per_share: 0.25,
                    },
                ],
            },
        })
    );
    await page.goto('http://127.0.0.1:5173/thumbnail/TOPW?rivals=');
    await page.getByRole('heading', { name: 'TOPW 종목 개요' }).waitFor();
    assert.match(page.url(), /\/stock\/TOPW\?rivals=/);
    const candleRows = Array.from({ length: 150 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
        open: 30 + i / 10,
        high: 32 + i / 10,
        low: 29 + i / 10,
        close: 31 + i / 10,
        volume: 1000 + i,
    }));
    await page.route('**/api/stock-prices?*', (r) =>
        r.fulfill({
            json: {
                symbol: 'TOPW',
                currency: 'USD',
                source: 'Yahoo Finance',
                candles: candleRows,
            },
        })
    );
    await page.getByRole('button', { name: '시세정보', exact: true }).click();
    await page.locator('.candle-plot').waitFor();
    const threeMonths = await page.locator('.candle').count();
    await page.getByRole('button', { name: '1개월', exact: true }).click();
    assert.ok((await page.locator('.candle').count()) < threeMonths);
    await page.locator('.candle-plot').focus();
    await page.keyboard.press('Home');
    assert.ok(
        (await page.locator('.quote-summary').innerText()).includes(
            '2026-04-30'
        )
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
        )
    );
    await page.screenshot({
        path: '/tmp/candlestick-mobile.png',
        fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByText('일별 종가 표 보기', { exact: true }).click();
    await page
        .getByRole('heading', { name: '시세 이력', exact: true })
        .waitFor();
    assert.equal(await page.locator('.stock-table tbody tr').count(), 16);
    await page.getByRole('button', { name: '배당정보', exact: true }).click();
    await page.locator('.cycle article').first().waitFor();
    assert.equal(await page.locator('.cycle article').count(), 5);
    assert.ok(await page.getByText('W-2', { exact: true }).isVisible());
    await page
        .getByRole('button', { name: '다음 주 보기', exact: true })
        .click();
    assert.ok(await page.getByText('W+3', { exact: true }).isVisible());
    assert.equal(await page.locator('.cycle article').count(), 5);
    await page.getByRole('button', { name: '공유정보', exact: true }).click();
    await page
        .getByRole('button', { name: '요약 PNG 다운로드', exact: true })
        .waitFor({ state: 'visible' });
    await page
        .getByText(
            '확인 가능한 4개 월별 표본만 표시합니다. 실제 보유 기간과는 별개입니다.'
        )
        .waitFor();
    for (const name of ['summary', 'comparison']) {
        const card = page.locator(`[data-thumbnail-kind="${name}"]`).first();
        await card.screenshot({ path: `/tmp/${name}-larger-type.png` });
        assert.ok(
            await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
            `${name} overflow`
        );
    }
    await page.getByRole('button', { name: '상세정보', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
        ),
        'Mobile details overflow'
    );
    await page.screenshot({
        path: '/tmp/stock-detail-mobile.png',
        fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
        'PASS: legacy redirect, four tabs, history, limited sample display, five calendar weeks, W-2/W+3 navigation, mobile details'
    );
} finally {
    await browser.close();
}
