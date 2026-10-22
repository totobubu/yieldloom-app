import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildThumbnailPayload } from '../api/thumbnail-data.js';

const base = process.env.LISTING_STATUS_BASE_URL || 'http://127.0.0.1:5173';
const output = '/tmp/yieldloom-listing-status';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
        if (
            request.resourceType() === 'fetch' ||
            request.resourceType() === 'xhr'
        )
            requests.push(request.url());
    });
    // A stale upstream directory must not restore active status. A missing entry is
    // covered by the unit test; here the old active entry is rendered end to end.
    await page.route('**/ticker-index.json*', (route) =>
        route.fulfill({
            json: {
                nav: [
                    { symbol: 'COII', active: true, currency: 'USD' },
                    {
                        symbol: 'AAPL',
                        active: true,
                        currency: 'USD',
                        koName: '애플',
                    },
                ],
            },
        })
    );
    await page.route('**/us-dividend-stocks.json*', (route) =>
        route.fulfill({ json: {} })
    );
    await page.route('**/content-studio/distribution-index.json*', (route) =>
        route.fulfill({ json: { tickers: [] } })
    );
    await page.goto(`${base}/?q=COII`);
    await page.getByText('검색 결과가 없습니다', { exact: true }).waitFor();
    const beforeToggle = requests.length;
    const checkbox = page.getByRole('checkbox', { name: '상장폐지 포함' });
    await checkbox.focus();
    await page.keyboard.press('Space');
    await page
        .locator('.stock-result-card .stock-symbol-link')
        .filter({ hasText: /^COII$/ })
        .waitFor();
    await page.waitForURL('**/*delisted=1*');
    assert.equal(
        requests.length - beforeToggle,
        0,
        'filter toggle must not fetch'
    );
    assert.equal(
        await page
            .locator('.stock-result-card')
            .getByText('상장폐지', { exact: true })
            .count(),
        1
    );
    await page.reload();
    await page
        .locator('.stock-result-card .stock-symbol-link')
        .filter({ hasText: /^COII$/ })
        .waitFor();
    await page.screenshot({ path: `${output}/search.png`, fullPage: true });

    let empty = false;
    await page.route('**/api/thumbnail-data?*', async (route) => {
        const payload = await buildThumbnailPayload(
            'COII',
            ['CONY'],
            async (symbol) => ({
                symbol,
                tickerInfo: {},
                sourceStatus: {
                    price: 'r2_projection',
                    dividends: 'official_projection',
                    priceDate: empty ? null : '2026-01-02',
                },
                backtestData: empty
                    ? []
                    : [
                          { date: '2026-01-01', close: 40, amount: 0.2 },
                          { date: '2026-01-02', close: 42, amount: 0.1 },
                      ],
            })
        );
        await route.fulfill({ json: payload });
    });
    await page.route('**/security-insights/*.json*', (route) =>
        route.fulfill({ json: { securities: {} } })
    );
    const beforeDetail = requests.length;
    await page.goto(`${base}/stock/COII?tab=share&rivals=CONY`);
    await page
        .getByText('상장폐지 · 과거 이력 열람', { exact: true })
        .waitFor();
    assert.equal(await page.getByRole('tab', { name: '공유정보' }).count(), 0);
    assert.equal(
        await page.getByRole('button', { name: '공유 카드 만들기' }).count(),
        0
    );
    assert.equal(
        await page.getByText('다음 배당락일', { exact: true }).count(),
        0
    );
    assert.equal(await page.locator('[data-thumbnail-kind]').count(), 0);
    assert.equal(
        requests
            .slice(beforeDetail)
            .filter((url) => url.includes('distribution-')).length,
        0,
        'archive detail must not load a dividend schedule'
    );
    for (const width of [1440, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page.screenshot({
            path: `${output}/archive-${width}.png`,
            fullPage: true,
        });
    }
    await page.getByRole('tab', { name: '시세정보' }).click();
    await page.getByText('일별 종가 표 보기', { exact: true }).click();
    await page.getByRole('cell', { name: '2026-01-02', exact: true }).waitFor();
    await page.getByRole('tab', { name: '배당정보' }).click();
    await page
        .getByRole('heading', { name: '배당·ROC 이력', exact: true })
        .waitFor();
    assert.equal(
        await page.getByText('다음 배당락일', { exact: true }).count(),
        0
    );
    const dark = page.getByRole('button', { name: '다크 모드', exact: true });
    if (await dark.count()) await dark.click();
    await page.screenshot({
        path: `${output}/archive-dark.png`,
        fullPage: true,
    });
    empty = true;
    await page.goto(`${base}/stock/COII`);
    await page
        .getByText('상장폐지 · 과거 이력 열람', { exact: true })
        .waitFor();
    await page
        .locator('.stock-overview')
        .getByText('자료 없음', { exact: true })
        .waitFor();
    await page.reload();
    await page
        .getByText('상장폐지 · 과거 이력 열람', { exact: true })
        .waitFor();
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            result: 'passed',
            filterAdditionalRequests: 0,
            archiveScheduleRequests: 0,
            screenshots: output,
        })
    );
} finally {
    await browser.close();
}
