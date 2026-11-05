import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const scheduleCaptures = [];
try {
    for (const partial of [false, true])
        for (const width of [1280, 768, 390]) {
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            if (process.env.STITCH_DIVIDEND_METRICS_DIR)
                await installStaticAssets(page);
            await installStitchFixtures(page, {
                dividendCoverageComplete: !partial,
            });
            const requests = [],
                errors = [];
            page.on('request', (r) => {
                if (r.url().includes('/security-insights/'))
                    requests.push(r.url());
            });
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(base + '/stock/DEMO-A?tab=dividends');
            await page.locator('.dividend-core-metrics').waitFor();
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
            const cards = page.locator('.dividend-core-grid .insight-metric');
            assert.equal(await cards.count(), 9);
            assert.equal(
                (await cards.nth(1).locator('strong').innerText()).trim(),
                partial ? '—' : '1.04'
            );
            assert.equal(
                (await cards.nth(2).locator('strong').innerText()).trim(),
                partial ? '—' : '2.08'
            );
            for (const i of [0, 3, 4, 5, 6, 7, 8])
                assert.equal(
                    (await cards.nth(i).locator('strong').innerText()).trim(),
                    '—'
                );
            assert.equal(
                requests.length,
                1,
                'Nine cards must reuse the single existing public dataset read'
            );
            await page
                .getByRole('tab', { name: '상세정보', exact: true })
                .click();
            await page
                .getByRole('tab', { name: '배당정보', exact: true })
                .click();
            await page.locator('.dividend-core-metrics').waitFor();
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
            assert.equal(
                requests.length,
                1,
                'Tab re-entry must use the existing public JSON cache'
            );
            if (process.env.STITCH_DIVIDEND_METRICS_DIR) {
                await fs.mkdir(process.env.STITCH_DIVIDEND_METRICS_DIR, {
                    recursive: true,
                });
                await page.evaluate(() => document.fonts.ready);
                await page.locator('.dividend-core-metrics').screenshot({
                    path: `${process.env.STITCH_DIVIDEND_METRICS_DIR}/${partial ? 'partial' : 'complete'}-${width}.png`,
                    animations: 'disabled',
                });
            }
            assert.deepEqual(errors, []);
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                )
            );
            console.log(
                `PASS metrics/${partial ? 'partial' : 'complete'}/${width}: nine cards, strict TTM, unknown fields, one cached public read`
            );
            await page.close();
        }
    for (const scenario of ['announced', 'forecast', 'unconfirmed']) {
        for (const width of [1280, 768, 390]) {
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            if (process.env.STITCH_SCHEDULE_DIR)
                await installStaticAssets(page);
            await installStitchFixtures(page);
            const requests = [];
            page.on('request', (r) => {
                if (r.url().endsWith('/distribution-ticker-demo-a.json'))
                    requests.push(r.url());
            });
            await page.route('**/distribution-ticker-demo-a.json', (r) =>
                r.fulfill({
                    json: {
                        history: [
                            {
                                ticker: 'DEMO-A',
                                ex_date:
                                    scenario === 'announced'
                                        ? '2026-11-15'
                                        : '2026-10-15',
                                payable_date: '2026-11-20',
                                distribution_per_share:
                                    scenario === 'announced' ? 0 : 0.18,
                                currency:
                                    scenario === 'announced' ? 'EUR' : 'USD',
                                verification_status:
                                    scenario === 'unconfirmed'
                                        ? 'needs_review'
                                        : 'official',
                                frequency: 'monthly',
                            },
                            {
                                ticker: 'DEMO-A',
                                ex_date:
                                    scenario === 'announced'
                                        ? '2026-10-15'
                                        : '2026-09-15',
                                distribution_per_share: 0.18,
                                currency: 'USD',
                                verification_status:
                                    scenario === 'unconfirmed'
                                        ? 'needs_review'
                                        : 'official',
                                frequency: 'monthly',
                            },
                        ],
                    },
                })
            );
            await page.goto(base + '/stock/DEMO-A?tab=dividends');
            const panel = page.locator('.dividend-schedule-panels');
            await panel.waitFor();
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
            assert.equal(await panel.locator('article').count(), 2);
            assert.equal(
                (
                    await panel.locator('.schedule-current-amount').innerText()
                ).trim(),
                scenario === 'announced'
                    ? '0 EUR'
                    : scenario === 'forecast'
                      ? '0.18 USD'
                      : '미확인'
            );
            const next = panel.locator('.next-dividend-panel');
            assert.match(
                await next.innerText(),
                scenario === 'announced'
                    ? /다음 공시 확정/
                    : scenario === 'forecast'
                      ? /다음 주기 추정/
                      : /다음 일정 미확인/
            );
            assert.equal(
                (await next.locator('strong').innerText()).trim(),
                scenario === 'announced'
                    ? '2026-11-15'
                    : scenario === 'forecast'
                      ? '2026-11-14'
                      : '공시 대기'
            );
            const columns = await panel.evaluate(
                (el) =>
                    getComputedStyle(el).gridTemplateColumns.split(' ').length
            );
            assert.equal(columns, width >= 768 ? 2 : 1);
            assert.equal(requests.length, 1);
            await page
                .getByRole('tab', { name: '상세정보', exact: true })
                .click();
            await page
                .getByRole('tab', { name: '배당정보', exact: true })
                .click();
            await panel.waitFor();
            assert.equal(
                requests.length,
                1,
                'schedule cards must reuse the existing history cache'
            );
            if (process.env.STITCH_SCHEDULE_DIR) {
                await fs.mkdir(process.env.STITCH_SCHEDULE_DIR, {
                    recursive: true,
                });
                await page.evaluate(() => document.fonts.ready);
                await panel.screenshot({
                    path: `${process.env.STITCH_SCHEDULE_DIR}/${scenario}-${width}.png`,
                    animations: 'disabled',
                });
                scheduleCaptures.push({
                    name: scenario,
                    width,
                    dpr: 2,
                    kind: 'component crop at actual viewport; synthetic records only',
                });
            }
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                )
            );
            await page.close();
            console.log(
                `PASS schedule/${scenario}/${width}: confirmed vs forecast vs unknown, actual zero/event currency, two responsive panels, one cached read`
            );
        }
    }
    if (process.env.STITCH_SCHEDULE_DIR)
        await fs.writeFile(
            `${process.env.STITCH_SCHEDULE_DIR}/results.json`,
            JSON.stringify(
                {
                    dataset: 'isolated synthetic schedule records only',
                    captured: scheduleCaptures,
                },
                null,
                2
            ) + '\n'
        );
} finally {
    await browser.close();
}
