import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
    for (const width of [1440, 390]) {
        for (const symbol of ['MSTY', 'TSLY']) {
            // Freeze the 2026-10-29 issuer example; scheduled data refreshes
            // must not change the expected comparison or the clock.
            const dividends = [
                { date: '2026-10-22', amount: symbol === 'MSTY' ? 0.1671 : 0.1909 },
                { date: '2026-10-29', amount: symbol === 'MSTY' ? 0.163 : 0.2233 },
            ];
            for (const scenario of ['historical', 'crossing', 'legacy', 'first', 'zero']) {
                const page = await browser.newPage({ viewport: { width, height: 1000 } });
                let reads = 0;
                const rows = scenario === 'first' ? dividends.slice(-1) : dividends.map(row => ({ ...row }));
                if (scenario === 'zero') rows[0].amount = rows[1].amount;
                const enabled = ['historical', 'zero'].includes(scenario);
                await page.clock.setFixedTime(new Date('2026-10-29T03:00:00Z'));
                await page.route('**/api/thumbnail-data?**', route => {
                    reads++;
                    return route.fulfill({ json: {
                        ticker: { symbol, tickerInfo: { price: 20, currency: 'USD' }, backtestData: rows,
                            sourceStatus: { freshness: 'fresh', dividends: 'official_projection', priceDate: '2026-10-27', corporateActionReview: true,
                                ...(scenario === 'legacy' ? {} : { corporateActionDates: [scenario === 'crossing' ? rows.at(-1).date : '2025-12-01'] }) } },
                        catalog: { symbol, securityType: 'etf' }, rivals: [], rivalOptions: [], series: {}, dataStatus: 'fresh',
                    } });
                });
                await page.goto(`${base}/stock/${symbol}?tab=share`);
                const summary = page.locator('.summary-card');
                await summary.waitFor();
                const checkbox = page.locator('.share-selector label').filter({ hasText: '배당 비교' }).getByRole('checkbox');
                assert.equal(await checkbox.isDisabled(), !enabled);
                const hero = await summary.locator('.hero').innerText();
                const copy = await page.locator('.toss-copy pre').innerText();
                assert(!copy.includes('null'));
                if (enabled) {
                    assert(!hero.includes('비교 불가'));
                    assert(!copy.includes('비교 불가'));
                    if (scenario === 'zero') assert.match(hero, /0.00%/);
                    else assert(!hero.includes('+0.00%'));
                    await checkbox.check();
                    await page.locator('.comparison-card').waitFor({ state: 'visible' });
                    if (width === 1440 && symbol === 'MSTY' && scenario === 'historical') {
                        const download = page.waitForEvent('download');
                        await page.getByRole('button', { name: '비교 PNG 다운로드', exact: true }).click();
                        await (await download).saveAs('/tmp/dividend-comparison-msty.png');
                    }
                } else {
                    assert.match(hero, /비교 불가/);
                    assert(!hero.includes('+0.00%'));
                    assert.match(copy, /직전 배당 대비 비교 불가/);
                    if (scenario !== 'first') assert.match(await page.locator('.share-selector').innerText(), /분할·병합 보정 확인 필요/);
                }
                await page.evaluate(() => document.documentElement.classList.add('p-dark'));
                assert.equal(await checkbox.isDisabled(), !enabled);
                assert.equal(reads, 1);
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                if (symbol === 'MSTY' && ['historical', 'crossing'].includes(scenario))
                    await summary.screenshot({ path: `/tmp/dividend-${scenario}-${width}.png` });
                console.log(`PASS ${symbol} ${scenario} ${width}: eligibility, missing values, light/dark, single API read`);
                await page.close();
            }
        }
    }
} finally {
    await browser.close();
}
