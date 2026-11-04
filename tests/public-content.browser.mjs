// Run Vite with VITE_PUBLIC_CONTENT_BASE_URL=https://snapshot.invalid
// and VITE_PUBLIC_CONTENT_CHANNEL=preview-aaaaaaaaaaaaaaaa. Synthetic data only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { storage } from './fixtures/public-content-fixture.mjs';

const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
});
const page = await browser.newPage();
const store = storage();
await page.addInitScript(() => {
    window.fixtureClock = Date.now();
    Date.now = () => window.fixtureClock;
});
await page.route('https://snapshot.invalid/**', async (route) => {
    const body = store.read(route.request().url());
    await route.fulfill({
        status: body ? 200 : 404,
        contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: body || '{}',
    });
});
try {
    await page.goto(
        process.env.PUBLIC_CONTENT_TEST_ORIGIN || 'http://127.0.0.1:5178/'
    );
    const read = () =>
        page.evaluate(async () => {
            const ledger = await import('/src/services/dividendLedger.js');
            const index = await ledger.loadDividendIndex();
            const row = index.tickers.find((row) => row.ticker === 'BAC');
            const value = await ledger.loadDividendHistory(row.historyUrl);
            return {
                latest: row.latest.distribution_per_share,
                history: value.history,
                path: row.historyUrl,
            };
        });
    const before = await read();
    assert.equal(before.latest, '0.32');
    assert.equal(before.history.length, 1);
    store.advance();
    await page.evaluate(() => {
        window.fixtureClock += 61_000;
    });
    const after = await read();
    assert.equal(after.latest, '0.33');
    assert.equal(after.history.length, 3);
    assert.notEqual(after.path, before.path);
    store.rollback();
    await page.evaluate(() => {
        window.fixtureClock += 61_000;
    });
    const rollback = await read();
    assert.equal(rollback.history.length, 1);
    assert.equal(rollback.path, before.path);
    console.log(
        'PASS: same browser and app process read v1 → v2 → v1; no app rebuild or deployment; public synthetic fixtures only'
    );
} finally {
    await browser.close();
}
