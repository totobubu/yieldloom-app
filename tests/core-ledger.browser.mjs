// Run against a dev server started with VITE_DATA_RELEASE_BASE_URL=https://core.fixture.test on port 5174.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mapCoreDividend } from '../lib/dividend-contract.js';
const legacyMode = process.argv.includes('--legacy');

const event = (ticker) => ({
    eventId: ticker,
    provider: 'fixture',
    ticker,
    amount: { raw: '0.123400', decimal: '0.123400', currency: 'USD' },
    declaredDate: '2026-10-14',
    exDate: '2026-10-15',
    recordDate: '2026-10-15',
    payableDate: '2026-10-16',
    frequency: 'weekly',
    verificationStatus: 'official',
    source: {
        url: 'https://issuer.fixture.test',
        contentSha256: 'a'.repeat(64),
    },
});
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage();
    const calls = [],
        errors = [],
        legacy = [];
    let fail = false;
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(
            new URL(route.request().url()).hostname
        )
            ? route.continue()
            : route.abort()
    );
    await page.route('**/ticker-index.json', (route) =>
        route.fulfill({
            json: {
                nav: ['AAA', 'BBB'].map((symbol) => ({
                    symbol,
                    market: 'NYSE',
                    currency: 'USD',
                    active: true,
                })),
            },
        })
    );
    await page.route('**/content-studio/distribution-*.json', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (!legacyMode) {
            legacy.push(path);
            return route.abort();
        }
        calls.push(path);
        if (fail) return route.fulfill({ status: 503, body: 'unavailable' });
        const payload = path.endsWith('distribution-index.json')
            ? {
                  tickers: ['AAA', 'BBB'].map((ticker) => ({
                      ticker,
                      latest: mapCoreDividend(event(ticker)),
                      historyUrl: `/content-studio/distribution-ticker-${ticker.toLowerCase()}.json`,
                  })),
              }
            : {
                  ticker: path.includes('-aaa.') ? 'AAA' : 'BBB',
                  history: [
                      mapCoreDividend(
                          event(path.includes('-aaa.') ? 'AAA' : 'BBB')
                      ),
                  ],
              };
        return route.fulfill({ json: payload });
    });
    await page.route('https://core.fixture.test/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        calls.push(path);
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (fail)
            return route.fulfill({ status: 503, headers, body: 'unavailable' });
        let payload;
        if (path.endsWith('current.json'))
            payload = {
                schemaVersion: 2,
                releaseId: 'fixture',
                manifestKey: 'core/releases/fixture/manifest.json',
            };
        else if (path.endsWith('manifest.json'))
            payload = {
                schemaVersion: 2,
                releaseId: 'fixture',
                indexPath: 'index.json',
                catalogSearchIndexPath: 'catalog/search-index.json',
            };
        else if (path.endsWith('search-index.json'))
            payload = {
                instruments: ['AAA', 'BBB'].map((symbol) => ({
                    symbol,
                    market: 'NYSE',
                    currency: 'USD',
                    active: true,
                    officialProvider: 'fixture',
                })),
            };
        else if (path.endsWith('index.json'))
            payload = {
                providers: ['fixture'],
                tickers: ['AAA', 'BBB'].map((ticker) => ({
                    ticker,
                    provider: 'fixture',
                    latest: event(ticker),
                    historyPath: `tickers/${ticker}.json`,
                    historyCount: 1,
                })),
            };
        else {
            const ticker = path.split('/').at(-1).replace('.json', '');
            payload = { ticker, events: [event(ticker)] };
        }
        return route.fulfill({ headers, json: payload });
    });
    await page.goto(`http://127.0.0.1:${legacyMode ? 5173 : 5174}/legal`);
    const result = await page.evaluate(async () => {
        const { loadSecurityDirectory } = await import(
            '/src/services/securityDirectory.js'
        );
        const { loadDividendSchedule, loadPortfolioSchedules } = await import(
            '/src/services/thumbnail/dividendSchedule.ts'
        );
        const [directory, single, portfolio] = await Promise.all([
            loadSecurityDirectory(),
            loadDividendSchedule('AAA'),
            loadPortfolioSchedules(['AAA', 'BBB']),
        ]);
        await loadDividendSchedule('AAA');
        await loadSecurityDirectory();
        return {
            amount: single.history[0].amount,
            date: single.history[0].payableDate,
            rows: directory.rows.filter((row) =>
                ['AAA', 'BBB'].includes(row.symbol)
            ).length,
            portfolio: Object.keys(portfolio.schedules),
        };
    });
    assert.deepEqual(result, {
        amount: '0.123400',
        date: '2026-10-16',
        rows: 2,
        portfolio: ['AAA', 'BBB'],
    });
    const suffixes = legacyMode
        ? [
              'distribution-index.json',
              'distribution-ticker-aaa.json',
              'distribution-ticker-bbb.json',
          ]
        : [
              'current.json',
              'manifest.json',
              'catalog/search-index.json',
              'fixture/index.json',
              'tickers/AAA.json',
              'tickers/BBB.json',
          ];
    for (const suffix of suffixes)
        assert.equal(
            calls.filter((path) => path.endsWith(suffix)).length,
            1,
            suffix
        );
    const warmCount = calls.length;
    await page.evaluate(async () =>
        (
            await import('/src/services/thumbnail/dividendSchedule.ts')
        ).loadPortfolioSchedules(['AAA', 'BBB'], undefined, true)
    );
    assert.equal(calls.length - warmCount, legacyMode ? 3 : 5);
    fail = true;
    const rejected = await page.evaluate(async () => {
        try {
            await (
                await import('/src/services/dividendLedger.js')
            ).loadDividendIndex({ force: true });
            return false;
        } catch {
            return true;
        }
    });
    assert.equal(rejected, true);
    assert.deepEqual(legacy, []);
    assert.deepEqual(errors, []);
    console.log(
        `PASS: ${legacyMode ? 'legacy compatibility' : 'core release'} search/detail/portfolio share ledger requests, preserve decimal strings/dates, warm reads add 0 requests, refresh reloads ${legacyMode ? 3 : 5} assets, failures remain visible.`
    );
} finally {
    await browser.close();
}
