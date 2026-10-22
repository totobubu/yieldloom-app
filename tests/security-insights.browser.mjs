import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
async function mockQuote(page) {
    await page.route('**/api/thumbnail-data?**', (route) => {
        const symbol = new URL(route.request().url()).searchParams.get(
            'ticker'
        );
        return route.fulfill({
            json: {
                ticker: {
                    symbol,
                    tickerInfo: {
                        symbol,
                        price: 40,
                        currency: 'USD',
                        longName: symbol,
                    },
                    sourceStatus: {
                        freshness: 'fresh',
                        priceDate: '2026-10-14',
                    },
                    backtestData: Array.from({ length: 16 }, (_, i) => ({
                        date: new Date(Date.UTC(2025, i, 5))
                            .toISOString()
                            .slice(0, 10),
                        close: 40 + i,
                        amount: 0.5,
                    })),
                },
                catalog: { symbol, securityType: 'etf' },
                rivals: [],
                rivalOptions: [],
                series: {},
                dataStatus: 'fresh',
            },
        });
    });
}
try {
    for (const width of [1440, 768, 390, 360]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        const errors = [],
            requests = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (r) => {
            if (r.url().includes('/security-insights/')) requests.push(r.url());
        });
        // Quote identity is synthetic; financial insights use the real public snapshot.
        await mockQuote(page);
        await page.goto(base + '/stock/QLDY?tab=details');
        const panel = page.locator('.security-insights');
        await panel.locator('.roc-table tbody tr').first().waitFor();
        assert.equal(
            await panel.locator('.metric-grid.core article').count(),
            3
        );
        assert.equal(await panel.locator('.roc-table tbody tr').count(), 4);
        assert.equal(await panel.locator('.roc-sources a').count(), 1);
        assert.equal(
            await panel.locator('.roc-sources a').getAttribute('href'),
            'https://www.defianceetfs.com/explore-our-etfs/'
        );
        assert.match(
            await panel.locator('.roc-sources').innerText(),
            /운용사 페이지/
        );
        assert.equal(await panel.locator('.roc-table a').count(), 0);
        assert.doesNotMatch(
            await panel.locator('.roc-section').innerText(),
            /미분류|분류 미확인|상태 · 범위/
        );
        assert.match(
            await panel.locator('.roc-table tbody tr').first().innerText(),
            /0\.1570/
        );
        assert.equal(
            await panel
                .locator('.roc-table tbody tr')
                .first()
                .locator('td')
                .nth(2)
                .innerText(),
            '—'
        );
        const before = requests.length;
        const fundamentals = panel.locator('.fundamentals');
        assert.equal(await fundamentals.evaluate((el) => el.open), width > 600);
        await fundamentals.locator('summary').click();
        assert.equal(
            await fundamentals.evaluate((el) => el.open),
            width <= 600
        );
        const help = panel.getByRole('button', {
            name: 'ROC 기준 및 금액 안내',
            exact: true,
        });
        await help.scrollIntoViewIfNeeded();
        await help.click();
        await page.locator('.p-popover').waitFor();
        assert.match(
            await page.locator('.p-popover').innerText(),
            /최종 세무 결과/
        );
        await page.keyboard.press('Escape');
        await page.locator('.p-popover').waitFor({ state: 'hidden' });
        assert.equal(requests.length, before);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await panel.screenshot({ path: `/tmp/roc-insights-${width}.png` });
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        await panel.screenshot({ path: `/tmp/roc-insights-dark-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}: QLDY real snapshot, precision, missing ROC amount, shared source, disclosure, help, no extra reads, light/dark layout`
        );
        await page.close();
    }
    const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
    });
    await mockQuote(page);
    await page.goto(base + '/stock/SPYI?tab=details');
    const panel = page.locator('.security-insights');
    await panel.locator('.roc-group').first().waitFor();
    assert.ok(await panel.getByText('0.48085208', { exact: true }).count());
    assert.ok(await panel.getByText('95.274833%', { exact: true }).count());
    assert.equal(await panel.locator('.roc-group').count(), 2);
    await panel
        .getByRole('heading', { name: '회계연도 누적 내역', exact: true })
        .waitFor();
    assert.equal(await panel.getByText('확정', { exact: true }).count(), 0);
    assert.equal(await panel.getByText('추정', { exact: true }).count(), 0);
    await page.goto(base + '/stock/TXN?tab=details');
    await panel
        .getByText('공개된 ROC 근거를 수집하지 못했습니다.', { exact: false })
        .waitFor();
    await panel
        .getByText('배당 지급 여력의 분기별 근거', { exact: true })
        .click();
    await panel.getByText('2026-06-30', { exact: true }).waitFor();
    console.log(
        'PASS: SPYI precision and separate fiscal scope; TXN empty ROC and quarterly evidence'
    );
} finally {
    await browser.close();
}
