import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const officialUrl =
    'https://newsroom.bankofamerica.com/content/newsroom/press-releases/2026/10/bank-of-america-declares-fourth-quarter-2026-stock-dividends.html';
const fixture = {
    ticker: {
        symbol: 'BAC',
        tickerInfo: { symbol: 'BAC', currency: 'USD', price: 51 },
        backtestData: [
            {
                date: '2026-09-04',
                close: 50,
                amount: 0.32,
                amountFixed: 0.32,
                verificationStatus: 'needs_review',
                isReference: true,
            },
            { date: '2026-10-22', close: 51 },
        ],
        issuerAnnouncements: [
            {
                ticker: 'BAC',
                amountRaw: '0.32',
                currency: 'USD',
                declaredDate: '2026-10-21',
                recordDate: '2026-12-04',
                payableDate: '2026-12-24',
                exDate: null,
                sourceUrl: officialUrl,
                verificationStatus: 'partial_evidence',
            },
        ],
        stockCollection: { status: 'partial', message: '배당락일 미확인' },
        sourceStatus: {
            price: 'stock_reference',
            priceDate: '2026-10-22',
            freshness: 'partial',
            asOf: '2026-10-26',
            dividends: 'reference_observations',
        },
    },
    catalog: { symbol: 'BAC', securityType: 'stock' },
    rivals: [],
    rivalOptions: [],
    series: {},
    dataStatus: 'partial',
};
const payload = process.env.STOCK_COLLECTION_PAYLOAD
    ? JSON.parse(
          await fs.readFile(process.env.STOCK_COLLECTION_PAYLOAD, 'utf8')
      )
    : fixture;
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const [width, dark] of [
        [1440, false],
        [390, true],
    ]) {
        const page = await browser.newPage({
            viewport: { width, height: 1050 },
        });
        const errors = [];
        let reads = 0,
            indexReads = 0,
            posts = 0,
            evidenceReads = 0;
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/src/services/firebaseClient*', (r) =>
            r.fulfill({
                contentType: 'text/javascript',
                body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref(null),authLoading=ref(false),signedIn=computed(()=>false),firebaseReady=false,auth=null,db=null,googleProvider=null;",
            })
        );
        await page.route('**/api/thumbnail-data?**', (r) => {
            reads++;
            return r.fulfill({ json: payload });
        });
        await page.route('**/content-studio/stock-evidence-*.json*', (r) => {
            if (
                new URL(r.request().url()).pathname.endsWith(
                    'stock-evidence-index.json'
                )
            ) {
                indexReads++;
                return r.fulfill({ json: { schemaVersion: 1, tickers: [] } });
            }
            evidenceReads++;
            return r.fulfill({
                status: 404,
                json: { error: 'should use ticker payload' },
            });
        });
        await page.route('**/api/stock-collection**', (r) => {
            if (r.request().method() === 'POST') posts++;
            return r.fulfill({ status: 403, json: { error: 'forbidden' } });
        });
        await page.goto(`${base}/stock/BAC?tab=dividends`);
        const section = page.getByRole('region', { name: '기업 배당 공시' });
        await section.waitFor();
        if (dark)
            await page.evaluate(() =>
                document.documentElement.classList.add('p-dark')
            );
        const latest = section.locator('article').first();
        assert.match(await latest.innerText(), /0\.32/);
        assert.equal(
            await latest.locator('dl > div').nth(1).locator('dd').innerText(),
            '미확인'
        );
        assert.equal(
            await latest
                .getByRole('link', { name: '기업 공식 원문' })
                .getAttribute('href'),
            officialUrl
        );
        assert(await section.getByText(/분할 보정 기준/).isVisible());
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            )
        );
        await section.screenshot({
            path: `/tmp/general-stock-evidence-${width}.png`,
        });
        await page.getByRole('tab', { name: '공유정보', exact: true }).click();
        await page.locator('.summary-card .hero strong').waitFor();
        await page
            .locator('.summary-card')
            .getByText('참고 배당 · 검토 필요', { exact: true })
            .waitFor();
        assert.equal(reads, 1);
        assert.equal(posts, 0);
        assert.equal(evidenceReads, 0);
        assert.equal(indexReads, 1);
        await page.route('**/content-studio/stock-evidence-index.json', (r) =>
            r.fulfill({ status: 503, json: { error: 'unavailable' } })
        );
        const isolated = await page.evaluate(async () => {
            const { loadDividendIndex } = await import(
                '/src/services/dividendLedger.js'
            );
            const value = await loadDividendIndex({ force: true });
            return {
                officialAvailable: Array.isArray(value.tickers),
                stockUnavailable: value.stockReferenceUnavailable,
            };
        });
        assert.deepEqual(isolated, {
            officialAvailable: true,
            stockUnavailable: true,
        });
        assert.deepEqual(errors, []);
        console.log(
            `PASS BAC ${width} ${dark ? 'dark' : 'light'}: official partial evidence, unknown ex-date, reference share data, one ticker read, no collection writes`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
