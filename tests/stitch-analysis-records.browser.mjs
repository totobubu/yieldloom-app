// Actual ledger projection with isolated synthetic entries; no production reads/writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const out = process.env.STITCH_ANALYSIS_STATE_DIR;
if (out) await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
async function capture(page, name) {
    if (!out) return;
    await page.evaluate(async () => {
        await document.fonts.ready;
        scrollTo(0, 0);
        await new Promise(requestAnimationFrame);
    });
    await page.screenshot({
        path: `${out}/${name}.png`,
        fullPage: true,
        animations: 'disabled',
    });
}
async function ready(page) {
    await page.locator('.insights-summary').waitFor();
    await page
        .locator('.fullscreen-data-loading-mask')
        .waitFor({ state: 'hidden' });
}
const row = (page, month) =>
    page
        .locator('.insights-month-table tbody tr')
        .filter({
            has: page.getByRole('cell', {
                name: `2026년 ${month}월`,
                exact: true,
            }),
        });
async function selectMonth(page, month) {
    await page
        .getByLabel('분석 월 선택 (현재월 이하)', { exact: true })
        .fill(`2026년 ${month}월`);
    await page.keyboard.press('Tab');
}
try {
    for (const width of [1280, 768, 390]) {
        for (const variant of ['normal', 'unknown']) {
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            await installStaticAssets(page);
            await installStitchFixtures(page, { admin: true });
            if (variant === 'unknown')
                await page.route('**/api/family-portfolio?*', (route) => {
                    const u = new URL(route.request().url());
                    if (u.searchParams.get('accountId') !== 'b')
                        return route.fallback();
                    return route.fulfill({
                        json: {
                            entries: [
                                {
                                    id: 'unknown',
                                    row: {
                                        date: '2026-11-01',
                                        type: 'dividend',
                                        symbol: 'DEMO-A',
                                        currency: 'USD',
                                        amount: null,
                                    },
                                },
                                {
                                    id: 'zero-in',
                                    row: {
                                        date: '2026-10-01',
                                        type: 'dividend',
                                        symbol: 'DEMO-A',
                                        currency: 'USD',
                                        amount: 1,
                                    },
                                },
                                {
                                    id: 'zero-cancel',
                                    row: {
                                        date: '2026-10-02',
                                        type: 'dividend_reversal',
                                        symbol: 'DEMO-A',
                                        currency: 'USD',
                                        amount: 1,
                                    },
                                },
                            ],
                            nextCursor: null,
                        },
                    });
                });
            const requests = [],
                errors = [];
            page.on('request', (r) => {
                if (r.url().includes('/api/'))
                    requests.push({ url: r.url(), method: r.method() });
            });
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(base + '/mypage?tab=insights');
            await ready(page);
            assert.equal(
                await page.locator('.insights-month-table tbody tr').count(),
                12
            );
            assert.equal(
                await page.locator('.insights-month-table thead th').count(),
                3
            );
            const reads = requests.length;
            assert.match(
                await row(page, '01').innerText(),
                /기록 없음 \(0건\)/
            );
            assert.equal(
                await row(page, '01').locator('td').nth(1).innerText(),
                '-'
            );
            assert.match(await row(page, '12').innerText(), /분석 범위 밖/);
            assert.equal(
                await row(page, '12').locator('td').nth(1).innerText(),
                '-'
            );
            assert.match(
                await row(page, '11').getAttribute('class'),
                /insights-selected-month/
            );
            if (variant === 'normal') {
                assert.match(
                    await page
                        .locator('.insights-summary article')
                        .first()
                        .innerText(),
                    /3\.6\s+USD/
                );
                assert.match(await row(page, '11').innerText(), /3\.6/);
                await capture(page, `november-${width}`);
                await selectMonth(page, '01');
                assert.match(
                    await page
                        .locator('.insights-summary article')
                        .first()
                        .innerText(),
                    /기록 없음/
                );
                assert.equal(
                    await row(page, '01').locator('td').nth(1).innerText(),
                    '-'
                );
                await capture(page, `no-records-${width}`);
                await selectMonth(page, '10');
                assert.match(
                    await page
                        .locator('.insights-summary article')
                        .first()
                        .innerText(),
                    /3\s+USD/
                );
                assert.match(await row(page, '11').innerText(), /분석 범위 밖/);
                await capture(page, `october-${width}`);
            } else {
                assert.match(
                    await page
                        .locator('.insights-summary article')
                        .first()
                        .innerText(),
                    /금액 미확인/
                );
                assert.match(
                    await row(page, '11').innerText(),
                    /금액 미확인 1건/
                );
                assert.match(
                    await row(page, '11')
                        .locator('.insights-record-status')
                        .getAttribute('class'),
                    /status-missing/
                );
                assert.doesNotMatch(
                    await page
                        .locator('.insights-summary article')
                        .first()
                        .innerText(),
                    /(^|\s)0\s+USD/
                );
                await capture(page, `unknown-${width}`);
                await selectMonth(page, '10');
                assert.match(
                    await page
                        .locator('.insights-summary article')
                        .first()
                        .innerText(),
                    /0\s+USD/
                );
                assert.equal(
                    await row(page, '10').locator('td').nth(1).innerText(),
                    '0'
                );
                assert.match(
                    await row(page, '10').innerText(),
                    /저장 기록 \(2건\)/
                );
                await capture(page, `net-zero-${width}`);
            }
            assert.equal(
                await page.locator('.insights-summary article').count(),
                4
            );
            assert.equal(
                await page
                    .locator('.insights-records')
                    .evaluate(
                        (el) =>
                            [...el.children].findIndex((x) =>
                                x.classList.contains('insights-tools')
                            ) <
                            [...el.children].findIndex((x) =>
                                x.classList.contains('insights-month-chart')
                            )
                    ),
                true,
                'Reference tools precede retained additional chart'
            );
            assert.equal(
                requests.length,
                reads,
                'Month projection adds no API calls'
            );
            assert.equal(
                requests.some((r) => r.method !== 'GET'),
                false
            );
            assert.deepEqual(errors, []);
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                ),
                true
            );
            console.log(
                `PASS analysis/${variant}/${width}:12 months, actual cancellation amounts, no-record/outside/unknown/zero distinction, preserved tools/chart, no extra reads/writes/errors/overflow`
            );
            await page.close();
        }
    }
} finally {
    await browser.close();
}
