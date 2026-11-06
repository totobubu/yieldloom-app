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
    page.locator('.insights-month-table tbody tr').filter({
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
async function verifyModuleShortcuts(page, requests, width) {
    const modules = [
        ['원장 바로가기', 'insights-module-ledger'],
        ['자금 조회', 'insights-module-capital'],
        ['월간 기록', 'insights-module-monthly'],
        ['시나리오', 'insights-module-scenario'],
        ['설계 진입', 'insights-module-workbench'],
    ];
    const grid = page.locator('.analysis-module-grid');
    assert.equal(await grid.locator('.analysis-module-card').count(), 5);
    const columns = await grid.evaluate(
        (element) =>
            getComputedStyle(element).gridTemplateColumns.split(' ').length
    );
    assert.equal(columns, width > 1024 ? 5 : width > 640 ? 2 : 1);
    const before = requests.length;
    for (const [label, id] of modules) {
        const button = grid.getByRole('button', { name: label, exact: true });
        assert.equal(await button.isEnabled(), true);
        assert.equal(await button.getAttribute('aria-controls'), id);
        const target = page.locator(`#${id}`);
        assert.equal(await target.count(), 1);
        await button.focus();
        await page.keyboard.press('Enter');
        const focusTarget =
            label === '시나리오' ? target.locator(':scope > summary') : target;
        assert.equal(
            await focusTarget.evaluate(
                (element) => element === document.activeElement
            ),
            true,
            `${label} must focus the already rendered module`
        );
        assert.equal(
            await page
                .locator('#insights-module-scenario')
                .evaluate((element) => element.open),
            false,
            'Shortcut navigation must leave the lazy scenario closed'
        );
        assert.equal(
            await page
                .locator('#insights-module-scenario > :not(summary)')
                .count(),
            0,
            'Closed scenarios must not instantiate their calculation inputs/results'
        );
    }
    assert.equal(
        requests.length,
        before,
        'Module navigation adds no API requests'
    );
    console.log(
        `PASS analysis shortcuts/${width}:5 existing targets, keyboard focus, lazy scenario closed, no additional API requests`
    );
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
            await page.waitForLoadState('networkidle');
            assert.equal(
                await page.locator('.insights-month-table tbody tr').count(),
                12
            );
            assert.equal(
                await page.locator('.insights-month-table thead th').count(),
                3
            );
            const reads = requests.length;
            await verifyModuleShortcuts(page, requests, width);
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
    const empty = await browser.newPage({
        viewport: { width: 390, height: 900 },
    });
    await installStaticAssets(empty);
    await installStitchFixtures(empty, { admin: true });
    await empty.route('**/api/family-portfolio*', (route) => {
        if (new URL(route.request().url()).searchParams.has('accountId'))
            return route.fallback();
        return route.fulfill({
            json: {
                families: [
                    {
                        id: 'empty-family',
                        name: '합성 빈 가족',
                        kind: 'personal',
                        adminUid: 'stitch-review-user',
                        profiles: {},
                    },
                ],
                accounts: [],
                summary: {
                    positions: [],
                    knownValueByCurrency: {},
                    missingSnapshotAccounts: [],
                    valueComplete: true,
                },
            },
        });
    });
    const emptyRequests = [];
    empty.on('request', (request) => {
        if (request.url().includes('/api/'))
            emptyRequests.push(request.method());
    });
    await empty.goto(base + '/mypage?tab=insights');
    await empty.locator('.insights').waitFor();
    await empty.waitForLoadState('networkidle');
    const unavailableShortcuts = empty.locator('.analysis-module-grid button');
    assert.equal(await unavailableShortcuts.count(), 5);
    for (const button of await unavailableShortcuts.all()) {
        assert.equal(await button.isDisabled(), true);
        assert.equal(await button.getAttribute('aria-controls'), null);
    }
    assert.equal(await empty.locator('.analysis-module-target').count(), 0);
    assert.ok(emptyRequests.every((method) => method === 'GET'));
    await empty.close();
    console.log(
        'PASS analysis shortcuts/empty:5 disabled controls, no unavailable targets or writes'
    );
} finally {
    await browser.close();
}
