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
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const rows = Array.from({ length: 16 }, (_, i) => ({
        date: new Date(Date.UTC(2025, i, 2)).toISOString().slice(0, 10),
        close: 30 + i / 10,
        amount: 0.22,
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
    await page.getByRole('heading', { name: 'TOPW 누적 데이터' }).waitFor();
    assert.match(page.url(), /\/stock\/TOPW\?rivals=/);
    await page.getByRole('button', { name: '시세정보', exact: true }).click();
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
