// Fixed synthetic history; calendar navigation must never fetch or invent data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output = process.env.STITCH_DIVIDEND_NAV_DIR;
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const captures = [];
async function capture(page, width, name) {
    if (!output) return;
    await fs.mkdir(output, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
        path: `${output}/${name}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
    });
    captures.push({ name, width, dpr: 2 });
    if (name === 'navigation' && process.env.STITCH_DIALOG_EVIDENCE_DIR) {
        const folder = process.env.STITCH_DIALOG_EVIDENCE_DIR;
        await fs.mkdir(folder, { recursive: true });
        await page.screenshot({
            path: `${folder}/dialog-${width}.png`,
            animations: 'disabled',
        });
        if (width === 390) {
            const region = page.getByRole('region', {
                name: '선택 월 배당·ROC 회차 상세',
                exact: true,
            });
            assert.ok(
                await region.evaluate((el) => el.scrollWidth > el.clientWidth)
            );
            await region.focus();
            await page.keyboard.press('ArrowRight');
            await page.waitForFunction(
                () =>
                    document.querySelector('.p-dialog .selected-month-scroll')
                        ?.scrollLeft > 0
            );
            await page.screenshot({
                path: `${folder}/dialog-mobile-scroll.png`,
                animations: 'disabled',
            });
        }
    }
}
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(page);
        if (output) await installStaticAssets(page);
        const requests = [],
            errors = [];
        page.on('request', (r) => {
            if (
                r.url().includes('/api/') ||
                r.url().includes('/security-insights/')
            )
                requests.push(r.method() + ' ' + r.url());
        });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(base + '/stock/DEMO-A?tab=dividends');
        const trend = page.locator('.dividend-trend'),
            roc = page.locator('.dividend-roc-history');
        await roc.locator('.monthly-cell').first().waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        const initialReads = requests.length;
        const monthlyPages = roc.getByRole('navigation', {
            name: '월별 요약 페이지',
            exact: true,
        });
        assert.equal(
            await monthlyPages
                .getByRole('button', {
                    name: '이전 월별 요약 페이지',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        assert.equal(
            await monthlyPages
                .getByRole('button', {
                    name: '다음 월별 요약 페이지',
                    exact: true,
                })
                .isDisabled(),
            true
        );

        const bars = trend.locator('.month-bar');
        assert.equal(await bars.count(), 12);
        assert.match(await bars.first().getAttribute('aria-label'), /2026-01/);
        assert.match(
            await bars.last().getAttribute('aria-label'),
            /2026-12.*미확인/
        );
        assert.equal(await bars.last().locator('.actual').count(), 0);
        assert.equal(
            await bars.nth(10).locator('.month-status').innerText(),
            '부분'
        );
        assert.equal(
            await bars.last().locator('.month-status').innerText(),
            '미확인'
        );
        await bars.last().focus();
        await page.keyboard.press('Enter');
        assert.match(
            await trend.locator('.trend-detail').innerText(),
            /2026-12.*미확인/s
        );
        if (width === 390)
            assert.ok(
                await trend
                    .locator('.trend-chart')
                    .evaluate((el) => el.scrollLeft > 0),
                'Keyboard focus must reveal the final month inside the chart, not overflow the page'
            );
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        const selectedBeforeResize = await trend
            .locator('.trend-detail')
            .innerText();
        const originalFocused = await bars.last().getAttribute('aria-label');
        for (const nextWidth of [width === 390 ? 1280 : 390, width]) {
            await page.setViewportSize({ width: nextWidth, height: 1024 });
            await page.waitForFunction(() => {
                const scroller = document.querySelector('.trend-chart');
                const active = document.activeElement;
                if (!scroller?.contains(active)) return false;
                const box = active.getBoundingClientRect(),
                    clip = scroller.getBoundingClientRect();
                return box.left >= clip.left - 1 && box.right <= clip.right + 1;
            });
            assert.equal(
                await bars
                    .last()
                    .evaluate((el) => el === document.activeElement),
                true
            );
            assert.equal(
                await bars.last().getAttribute('aria-label'),
                originalFocused
            );
            assert.equal(
                await trend.locator('.trend-detail').innerText(),
                selectedBeforeResize
            );
            assert.equal(
                requests.length,
                initialReads,
                'Resize must not refetch or change the selected month'
            );
        }
        await trend.getByRole('button', { name: '2025', exact: true }).click();
        assert.match(await bars.first().getAttribute('aria-label'), /2025-01/);
        assert.equal(await trend.locator('.previous').count(), 0);
        await capture(page, width, 'year-2025');
        const prior = await bars.allTextContents();
        await trend.getByRole('button', { name: '2026', exact: true }).click();
        assert.equal(await bars.count(), 12);
        await capture(page, width, 'year-2026');
        await trend
            .getByRole('button', { name: '전체 비교', exact: true })
            .click();
        assert.ok((await trend.locator('.previous').count()) > 0);
        await trend.getByText('최근 기간 보기', { exact: true }).click();
        await trend
            .getByRole('button', { name: '24개월', exact: true })
            .click();
        assert.equal(await bars.count(), 24);
        assert.match(
            await trend.locator('.trend-note').innerText(),
            /전년 동월/
        );
        await trend
            .getByRole('button', { name: '전체 비교', exact: true })
            .click();
        await trend.getByText('최근 기간 보기', { exact: true }).click();
        await roc
            .getByRole('button', { name: '상세 조회', exact: true })
            .click();
        const detail = page.getByRole('dialog', {
            name: '달 상세',
            exact: true,
        });
        await detail.waitFor();
        await page.waitForFunction(() =>
            document.activeElement?.classList.contains('selected-month')
        );
        assert.equal(
            await detail
                .locator('.selected-month')
                .evaluate((el) => el === document.activeElement),
            true
        );
        assert.equal(
            await detail
                .getByRole('columnheader', { name: 'ROC 금액', exact: true })
                .count(),
            1
        );
        assert.match(await detail.innerText(), /원문 미제공/);
        await capture(page, width, 'navigation');
        await page.keyboard.press('Escape');
        await detail.waitFor({ state: 'hidden' });
        assert.equal(
            await roc
                .getByRole('button', { name: '상세 조회', exact: true })
                .evaluate((el) => el === document.activeElement),
            true
        );
        assert.match(
            await roc.locator('.history-note').first().innerText(),
            /ROC 0%를 의미하지 않습니다/
        );
        assert.equal(
            await roc
                .getByRole('button', { name: '원문 공시 미제공', exact: true })
                .isDisabled(),
            true
        );
        await roc
            .getByRole('button', { name: '회차별 이력', exact: true })
            .click();
        await roc
            .getByRole('table', { name: '배당·ROC 지급 이력', exact: true })
            .waitFor();
        await roc
            .getByRole('button', { name: '월별 요약', exact: true })
            .click();
        assert.equal(
            requests.length,
            initialReads,
            'year/period/ROC presentation must reuse the existing responses'
        );
        assert.ok(prior.length === 12);
        assert.deepEqual(errors, []);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        console.log(
            `PASS dividend-navigation/${width}: calendar/future unknown, both years, rolling retained, month focus, missing source disabled, no extra reads`
        );
        await page.close();
    }
    const inactivePage = await browser.newPage({
        viewport: { width: 390, height: 1024 },
    });
    await installStitchFixtures(inactivePage);
    const inactiveErrors = [];
    inactivePage.on('pageerror', (e) => inactiveErrors.push(e.message));
    await inactivePage.goto(base + '/stock/DEMO-A?tab=dividends');
    const inactiveTrend = inactivePage.locator('.dividend-trend');
    const inactiveChart = inactiveTrend.locator('.trend-chart');
    await inactiveChart.waitFor();
    assert.equal(
        await inactiveChart.evaluate((el) => el.scrollLeft),
        0,
        'Initial unfocused chart must retain the source first-month position'
    );
    await inactiveTrend
        .getByRole('button', { name: '전체 비교', exact: true })
        .focus();
    await inactiveChart.evaluate((el) => (el.scrollLeft = 100));
    await inactivePage.setViewportSize({ width: 360, height: 1024 });
    await inactivePage.evaluate(
        () =>
            new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
    );
    assert.equal(
        await inactiveChart.evaluate((el) => el.scrollLeft),
        100,
        'Resize outside the chart must not chase its selected month'
    );
    await inactivePage
        .getByRole('tab', { name: '상세정보', exact: true })
        .click();
    await inactivePage.locator('.stock-facts').waitFor();
    await inactivePage.setViewportSize({ width: 1280, height: 1024 });
    await inactivePage.evaluate(
        () =>
            new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
            )
    );
    assert.deepEqual(inactiveErrors, []);
    await inactivePage.close();
    console.log(
        'PASS dividend-navigation/inactive: initial position, outside focus unchanged, observer cleanup on tab/empty view'
    );
    // A current month without an observed distribution remains unknown, not a partial value or zero.
    const missingPage = await browser.newPage({
        viewport: { width: 390, height: 1024 },
    });
    await installStitchFixtures(missingPage);
    await missingPage.route('**/api/thumbnail-data?**', (route) =>
        route.fulfill({
            json: {
                catalog: { company: '예시 운용사', securityType: 'etf' },
                ticker: {
                    symbol: 'DEMO-A',
                    tickerInfo: {
                        symbol: 'DEMO-A',
                        longName: '가상 검증 ETF',
                        currency: 'USD',
                        price: 50,
                    },
                    backtestData: [
                        { date: '2026-09-01', close: 50, amount: 0.25 },
                    ],
                    sourceStatus: {
                        priceDate: '2026-11-03',
                        freshness: 'fresh',
                    },
                },
                series: {},
                rivals: [],
                rivalOptions: [],
                dataStatus: 'fresh',
            },
        })
    );
    await missingPage.goto(base + '/stock/DEMO-A?tab=dividends');
    const missingTrend = missingPage.locator('.dividend-trend');
    const missingBars = missingTrend.locator('.month-bar');
    await missingBars.first().waitFor();
    assert.equal(await missingBars.nth(10).locator('.actual').count(), 0);
    assert.equal(
        await missingBars.nth(10).locator('.month-status').innerText(),
        '미확인'
    );
    await missingTrend
        .getByRole('button', { name: '2025', exact: true })
        .click();
    await missingTrend
        .getByText('아직 표시할 월별 배당 이력이 없습니다', { exact: true })
        .waitFor();
    assert.equal(await missingTrend.locator('.actual').count(), 0);
    await missingPage.close();
    console.log(
        'PASS dividend-navigation/missing: unobserved current month and empty prior year stay unknown'
    );
    if (output)
        await fs.writeFile(
            `${output}/results.json`,
            JSON.stringify({ dataset: 'synthetic only', captures }, null, 2) +
                '\n'
        );
} finally {
    await browser.close();
}
