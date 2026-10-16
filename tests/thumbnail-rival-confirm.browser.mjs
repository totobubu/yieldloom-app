import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage();
    let calls = [];
    await page.route('**/api/thumbnail-data?**', (route) => {
        const url = new URL(route.request().url());
        calls.push(url.href);
        const rivals = url.searchParams.has('rivals')
            ? url.searchParams.get('rivals').split(',').filter(Boolean)
            : ['TSII', 'TSLW', 'TSYY'];
        const ticker = (symbol) => ({
            symbol,
            tickerInfo: { price: 100, currency: 'USD' },
            backtestData: [
                { date: '2026-10-01', close: 100, amount: 0.2 },
                { date: '2026-10-08', close: 101, amount: 0.2 },
            ],
            sourceStatus: { freshness: 'fresh', priceDate: '2026-10-08' },
        });
        return route.fulfill({
            json: {
                ticker: ticker('TSLY'),
                catalog: { underlying: 'TSLA' },
                rivalOptions: ['CRSH', 'TEST', 'TSII', 'TSLW', 'TSYY'],
                rivals,
                series: Object.fromEntries(
                    [...rivals, 'TSLA'].map((s) => [s, ticker(s)])
                ),
                dataStatus: 'fresh',
            },
        });
    });
    await page.route('**/distribution-ticker-*.json', (route) =>
        route.fulfill({ json: { history: [] } })
    );
    await page.goto('http://127.0.0.1:5173/stock/TSLY?tab=share');
    const picker = page.locator('.rival-candidate-picker');
    await picker.waitFor();
    const before = calls.length;
    await picker.getByRole('button', { name: 'TSII', exact: true }).click();
    await picker.getByRole('button', { name: 'CRSH', exact: true }).click();
    assert.equal(calls.length, before);
    await picker.getByRole('button', { name: '확인', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.state'));
    assert.equal(calls.length, before + 1);
    assert.equal(
        new URL(calls.at(-1)).searchParams.get('rivals'),
        'TSLW,TSYY,CRSH'
    );
    await picker.getByRole('button', { name: '추가', exact: true }).click();
    await picker.getByRole('button', { name: 'CRSH', exact: true }).waitFor();
    assert.equal(calls.length, before + 1);
    const changed = page.waitForRequest(
        (r) =>
            r.url().includes('/api/thumbnail-data?') &&
            new URL(r.url()).searchParams.get('rivals') === 'TEST'
    );
    await page.evaluate(async () => {
        const router =
            document.querySelector('#app').__vue_app__.config.globalProperties
                .$router;
        await router.push({
            query: { ...router.currentRoute.value.query, rivals: 'TEST' },
        });
    });
    await changed;
    await page.waitForFunction(() => !document.querySelector('.state'));
    assert.equal(calls.length, before + 2);
    assert.equal(new URL(calls.at(-1)).searchParams.get('rivals'), 'TEST');
    const restored = page.waitForRequest(
        (r) =>
            r.url().includes('/api/thumbnail-data?') &&
            new URL(r.url()).searchParams.get('rivals') === 'TSLW,TSYY,CRSH'
    );
    await page.goBack();
    await restored;
    await page.waitForFunction(() => !document.querySelector('.state'));
    assert.equal(calls.length, before + 3);
    assert.equal(
        new URL(calls.at(-1)).searchParams.get('rivals'),
        'TSLW,TSYY,CRSH'
    );
    console.log(
        'PASS: selection sends no request; confirmation sends one request; add reopens picker without loading'
    );
} finally {
    await browser.close();
}
