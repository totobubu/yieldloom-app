import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage();
    const requests = [],
        errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(
            new URL(route.request().url()).hostname
        )
            ? route.continue()
            : route.abort()
    );
    await page.route('**/api/stock-prices?*', (route) => {
        assert.equal(route.request().headers().authorization, undefined);
        requests.push('prices');
        return route.fulfill({
            json: {
                symbol: 'AAA',
                currency: 'USD',
                candles: [{ date: '2026-10-16', close: 10 }],
                events: [],
            },
        });
    });
    await page.route('**/content-studio/distribution-index.json', (route) => {
        requests.push('index');
        return route.fulfill({
            json: {
                tickers: ['AAA', 'BBB'].map((ticker) => ({
                    ticker,
                    historyUrl: `/content-studio/distribution-ticker-${ticker.toLowerCase()}.json`,
                })),
            },
        });
    });
    await page.route(
        '**/content-studio/distribution-ticker-*.json',
        (route) => {
            const ticker = route.request().url().includes('aaa.json')
                ? 'AAA'
                : 'BBB';
            requests.push(ticker);
            return route.fulfill({
                json: {
                    history: [
                        {
                            ticker,
                            distribution_per_share: '0.1',
                            declared_date: '2026-10-14',
                            ex_date: '2026-10-15',
                            record_date: '2026-10-15',
                            payable_date: '2026-10-16',
                            frequency: 'weekly',
                            currency: 'USD',
                            verification_status: 'official',
                        },
                    ],
                },
            });
        }
    );
    await page.goto('http://127.0.0.1:5173/legal');
    const result = await page.evaluate(async () => {
        const { loadStockPrices } = await import(
            '/src/services/stockPrices.js'
        );
        const { loadValuationQuotes } = await import(
            '/src/services/portfolioValuation.js'
        );
        const { loadDividendSchedule, loadPortfolioSchedules } = await import(
            '/src/services/thumbnail/dividendSchedule.ts'
        );
        const [price, quotes] = await Promise.all([
            loadStockPrices('aaa'),
            loadValuationQuotes(['AAA']),
        ]);
        await loadValuationQuotes(['AAA']);
        const [single, portfolio] = await Promise.all([
            loadDividendSchedule('AAA'),
            loadPortfolioSchedules(['AAA', 'BBB']),
        ]);
        await loadDividendSchedule('AAA');
        return {
            price: price.candles[0].close,
            quote: quotes.quotes.AAA.price,
            single: single.history.length,
            portfolio: Object.keys(portfolio.schedules),
        };
    });
    assert.deepEqual(result, {
        price: 10,
        quote: 10,
        single: 1,
        portfolio: ['AAA', 'BBB'],
    });
    assert.equal(requests.filter((value) => value === 'prices').length, 1);
    assert.equal(requests.filter((value) => value === 'index').length, 1);
    assert.equal(requests.filter((value) => value === 'AAA').length, 1);
    assert.equal(requests.filter((value) => value === 'BBB').length, 1);
    await page.evaluate(async () => {
        const { loadPortfolioSchedules } = await import(
            '/src/services/thumbnail/dividendSchedule.ts'
        );
        await loadPortfolioSchedules(['AAA', 'BBB'], undefined, true);
    });
    assert.equal(requests.filter((value) => value === 'index').length, 2);
    assert.equal(requests.filter((value) => value === 'AAA').length, 2);
    assert.deepEqual(errors, []);
    const denied = await browser.newPage();
    denied.setDefaultTimeout(10000);
    denied.on('pageerror', (error) => errors.push(error.message));
    await denied.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(
            new URL(route.request().url()).hostname
        )
            ? route.continue()
            : route.abort()
    );
    await denied.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'denied-fixture',getIdToken:async()=>'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,auth=null,db=null,googleProvider=null;`,
        })
    );
    await denied.route('**/api/family-portfolio*', (route) =>
        route.fulfill({
            status: 403,
            json: { error: 'fixture permission denied' },
        })
    );
    await denied.goto('http://127.0.0.1:5173/mypage');
    await denied
        .getByText('fixture permission denied', { exact: true })
        .waitFor();
    assert.deepEqual(errors, []);
    await denied.close();
    console.log(
        'PASS: browser chart/valuation share 1 price request; detail/portfolio schedules share 1 index and 1 history per ticker; warm reads add 0; explicit refresh refetches; 403 refresh shows its error.'
    );
} finally {
    await browser.close();
}
