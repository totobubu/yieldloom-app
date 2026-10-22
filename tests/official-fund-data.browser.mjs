import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5178';
let ready = false;
for (let attempt = 0; attempt < 60 && !ready; attempt++) {
    ready = await fetch(base)
        .then((r) => r.ok)
        .catch(() => false);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.ok(ready, 'Vite server did not become ready');
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1280, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        const errors = [],
            calls = [];
        let fail = false;
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/api/thumbnail-data?**', (route) =>
            route.fulfill({
                json: {
                    ticker: {
                        symbol: 'IVV',
                        tickerInfo: {
                            symbol: 'IVV',
                            price: 100,
                            currency: 'USD',
                            longName: 'Fixture ETF',
                        },
                        sourceStatus: {
                            freshness: 'fresh',
                            priceDate: '2026-10-21',
                        },
                        backtestData: [
                            { date: '2026-10-21', close: 100, amount: 0.5 },
                        ],
                    },
                    catalog: { symbol: 'IVV', securityType: 'etf' },
                    rivals: [],
                    rivalOptions: [],
                    series: {},
                    dataStatus: 'fresh',
                },
            })
        );
        await page.route('**/official-fixture/**', (route) => {
            const url = route.request().url();
            calls.push(url);
            if (fail)
                return route.fulfill({
                    status: 503,
                    json: { error: 'fixture failure' },
                });
            const dataset = url.includes('/holdings/')
                ? 'holdings'
                : 'fund-observations';
            const entityId = 'instrument:isin:US4642872000';
            const common = { schemaVersion: 1, dataset, releaseId: 'fixture' };
            const row = {
                entityId,
                dataset,
                sourceId: 'fixture',
                sourceUrl: 'https://www.ishares.com/',
                asOfDate: '2026-10-21',
                qualifiers: { rowKey: 'one' },
                field: 'nav',
                value: '100.0000',
                currency: 'USD',
                unit: 'currency_per_share',
            };
            return route.fulfill({
                json: url.endsWith('/current.json')
                    ? {
                          ...common,
                          manifestKey: `datasets/${dataset}/releases/fixture/manifest.json`,
                      }
                    : url.endsWith('/manifest.json')
                      ? {
                            ...common,
                            symbols: { IVV: entityId },
                            entities: {
                                [entityId]: {
                                    path: `entities/${'a'.repeat(64)}.json`,
                                },
                            },
                            policies: {
                                fixture: { citation: 'Fixture issuer' },
                            },
                        }
                      : {
                            ...common,
                            entityId,
                            positionCount: 2,
                            observations:
                                dataset === 'holdings'
                                    ? [
                                          {
                                              ...row,
                                              field: 'position',
                                              value: {
                                                  Ticker: 'AAA',
                                                  Name: 'AAA INC',
                                                  'Weight (%)': '0.00',
                                              },
                                          },
                                          {
                                              ...row,
                                              field: 'position',
                                              qualifiers: { rowKey: 'two' },
                                              value: {
                                                  Ticker: 'USD',
                                                  Name: 'CASH',
                                                  'Weight (%)': '-1.50',
                                              },
                                          },
                                      ]
                                    : [row],
                        },
            });
        });
        await page.goto(base + '/stock/IVV?tab=details');
        const panel = page.locator('.official-fund-data');
        await panel
            .getByRole('link', { name: '공식 출처', exact: true })
            .waitFor();
        assert.equal(calls.length, 3);
        assert.ok(calls.every((url) => !url.includes('/holdings/')));
        await panel.getByRole('button', { name: '보유자산 요약 보기' }).click();
        await panel.getByText('CASH (USD) · -1.5%').waitFor();
        assert.equal(calls.length, 6);
        await panel.getByRole('button', { name: '보유자산 요약 보기' }).click();
        assert.equal(calls.length, 6);
        await page.getByRole('tab', { name: '시세정보', exact: true }).click();
        await page.getByRole('tab', { name: '상세정보', exact: true }).click();
        await panel
            .getByRole('link', { name: '공식 출처', exact: true })
            .waitFor();
        assert.equal(calls.length, 6);
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        assert.ok(await panel.isVisible());
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            )
        );
        fail = true;
        await page.reload();
        await panel.getByText('공식 운용정보를 불러오지 못했습니다.').waitFor();
        fail = false;
        await panel.getByRole('button', { name: '다시 시도' }).click();
        await panel
            .getByRole('link', { name: '공식 출처', exact: true })
            .waitFor();
        assert.deepEqual(errors, []);
        await page.close();
    }
    console.log(
        'Official fund UI: lazy holdings, cache reuse, retry, mobile and dark mode passed'
    );
} finally {
    await browser.close();
}
