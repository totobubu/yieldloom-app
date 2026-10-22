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
                    backtestData: [
                        { date: '2026-10-15', close: 40, amount: 0.157 },
                        ...Array.from({ length: 16 }, (_, i) => ({
                            date: new Date(Date.UTC(2025, i, 5))
                                .toISOString()
                                .slice(0, 10),
                            close: 40 + i,
                            amount: 0.5,
                        })),
                    ],
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
        await page
            .getByRole('heading', { name: 'QLDY 종목 개요', exact: true })
            .waitFor();
        assert.equal(await page.locator('.security-insights').count(), 0);
        assert.equal(requests.length, 0);
        await page.getByRole('tab', { name: '배당정보', exact: true }).click();
        const panel = page.locator('.security-insights');
        const ledger = page.locator('.dividend-roc-history');
        await ledger.locator('.history-sources a').first().waitFor();
        await ledger.locator('.history-table tbody tr').first().waitFor();
        assert.equal(
            await panel.locator('.metric-grid.core article').count(),
            3
        );
        assert.equal(
            await ledger.locator('.history-table tbody tr').count(),
            12
        );
        assert.equal(await ledger.locator('.history-sources a').count(), 1);
        assert.equal(
            await ledger.locator('.history-sources a').getAttribute('href'),
            'https://www.defianceetfs.com/explore-our-etfs/'
        );
        assert.match(
            await ledger.locator('.history-sources').innerText(),
            /운용사 페이지/
        );
        assert.equal(await ledger.locator('.history-table a').count(), 0);
        assert.doesNotMatch(
            await ledger.innerText(),
            /미분류|분류 미확인|상태 · 범위/
        );
        assert.match(
            await ledger.locator('.history-table tbody tr').first().innerText(),
            /0\.1570/
        );
        assert.equal(
            await ledger
                .locator('.history-table tbody tr')
                .first()
                .locator('td')
                .nth(2)
                .innerText(),
            '—'
        );
        const before = requests.length;
        assert.equal(before, 1);
        const fundamentals = panel.locator('.fundamentals');
        assert.equal(await fundamentals.evaluate((el) => el.open), width > 600);
        await fundamentals.locator('summary').click();
        assert.equal(
            await fundamentals.evaluate((el) => el.open),
            width <= 600
        );
        const help = ledger.getByRole('button', {
            name: '배당·ROC 연결 및 금액 안내',
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
        assert.equal(
            await page
                .getByRole('heading', { name: '배당 이력', exact: true })
                .count(),
            0
        );
        assert.equal(
            await ledger
                .locator('.history-table tbody tr')
                .filter({ hasText: '2026-10-15' })
                .count(),
            1
        );
        await ledger.getByRole('button', { name: '차트', exact: true }).click();
        await ledger.locator('.dividend-roc-chart svg').waitFor();
        assert.equal(await ledger.locator('.distribution-point').count(), 12);
        assert.equal(await ledger.locator('.roc-point').count(), 0);
        assert.equal(await ledger.locator('.ratio-point').count(), 4);
        assert.equal(await ledger.locator('.distribution-value').count(), 12);
        assert.equal(await ledger.locator('.ratio-value').count(), 4);
        assert.equal(await ledger.locator('.roc-value').count(), 0);
        assert.match(
            (await ledger.locator('.ratio-value').allTextContents()).join(' '),
            /100%/
        );
        await ledger
            .locator('.chart-payment')
            .filter({ has: page.getByText('26-10-08', { exact: true }) })
            .hover();
        assert.match(
            await ledger.locator('.chart-detail').innerText(),
            /2026-10-08/
        );
        await ledger.locator('.chart-payment').last().focus();
        await page.keyboard.press('Enter');
        assert.match(
            await ledger.locator('.chart-detail').innerText(),
            /2026-10-15/
        );
        await ledger.screenshot({
            path: `/tmp/dividend-roc-chart-${width}.png`,
        });
        await ledger.getByRole('button', { name: '표', exact: true }).click();
        assert.equal(
            await ledger.locator('.history-table tbody tr').count(),
            12
        );
        assert.equal(requests.length, before);
        await page.getByRole('tab', { name: '상세정보', exact: true }).click();
        assert.equal(await panel.count(), 0);
        await page.getByRole('tab', { name: '배당정보', exact: true }).click();
        await ledger.locator('.history-table tbody tr').first().waitFor();
        assert.equal(requests.length, before);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await ledger.screenshot({
            path: `/tmp/dividend-roc-table-${width}.png`,
        });
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        await ledger.screenshot({
            path: `/tmp/dividend-roc-dark-${width}.png`,
        });
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
    await page.goto(base + '/stock/SPYI?tab=dividends');
    const panel = page.locator('.security-insights');
    const ledger = page.locator('.dividend-roc-history');
    await ledger.locator('.annual-history').waitFor();
    await ledger.locator('.annual-history summary').click();
    let content = await ledger.innerText();
    for (let i = 0; i < 4 && !content.includes('0.48085208'); i++) {
        const next = ledger.getByRole('button', {
            name: '다음 페이지',
            exact: true,
        });
        if (!(await next.isEnabled())) break;
        await next.click();
        content = await ledger.innerText();
    }
    assert.match(content, /0\.48085208/);
    assert.match(content, /95\.274833%/);
    assert.equal(await ledger.locator('.annual-history').count(), 1);
    await ledger.getByRole('button', { name: '차트', exact: true }).click();
    assert.ok((await ledger.locator('.roc-point').count()) > 0);
    assert.ok((await ledger.locator('.ratio-point').count()) > 0);

    assert.equal(await panel.getByText('확정', { exact: true }).count(), 0);
    assert.equal(await panel.getByText('추정', { exact: true }).count(), 0);
    await page.goto(base + '/stock/TXN?tab=dividends');
    await ledger
        .getByText('공개된 ROC 근거를 수집하지 못했습니다.', { exact: false })
        .waitFor();
    await panel
        .getByText('배당 지급 여력의 분기별 근거', { exact: true })
        .click();
    await panel.getByText('2026-06-30', { exact: true }).waitFor();
    await page.route('**/security-insights/41.json', (route) =>
        route.fulfill({ status: 500, json: { error: 'snapshot unavailable' } })
    );
    await page.goto(base + '/stock/NVDA?tab=dividends');
    await ledger
        .getByText('ROC 자료를 불러오지 못했습니다.', { exact: false })
        .waitFor();
    assert.ok((await ledger.locator('.history-table tbody tr').count()) > 0);
    await ledger.getByRole('button', { name: '차트', exact: true }).click();
    assert.equal(await ledger.locator('.ratio-point').count(), 0);
    assert.equal(await ledger.locator('.roc-point').count(), 0);
    console.log(
        'PASS: SPYI precision and separate fiscal scope; TXN empty ROC and quarterly evidence'
    );
} finally {
    await browser.close();
}
