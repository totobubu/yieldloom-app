// Source controls preserve ledger month strings and scope across timezone/render changes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const [width, timezoneId] of [
        [1280, 'Etc/UTC'],
        [768, 'Asia/Seoul'],
        [390, 'America/Los_Angeles'],
    ]) {
        const context = await browser.newContext({
            viewport: { width, height: 1024 },
            timezoneId,
        });
        const page = await context.newPage();
        await installStaticAssets(page);
        await installStitchFixtures(page, { admin: true });
        const requests = [];
        const errors = [];
        page.on('request', (r) => {
            if (r.url().includes('/api/'))
                requests.push({ url: r.url(), method: r.method() });
        });
        page.on('pageerror', (e) => errors.push(e.message));
        const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
        await page.goto(base + '/mypage?tab=insights');
        await page.locator('.insights-summary').waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        const region = page.getByRole('region', {
            name: '배당 성과·집중도 분석',
            exact: true,
        });
        const input = region.getByLabel('분석 월 선택 (현재월 이하)', {
            exact: true,
        });
        assert.equal(await input.inputValue(), '2026년 11월');
        assert.equal(
            await page
                .getByRole('heading', {
                    name: '배당 성과·집중도 분석',
                    level: 1,
                })
                .count(),
            1
        );
        const readCount = requests.filter((r) => r.method === 'GET').length;
        await input.fill('2026년 10월');
        await page.keyboard.press('Tab');
        await page.waitForFunction(
            () =>
                document
                    .querySelector('.insights-summary article strong')
                    ?.textContent.trim() === '3 USD'
        );
        assert.equal(await input.inputValue(), '2026년 10월');
        assert.match(
            await region.locator('.insights-heading p').innerText(),
            /2026년 10월/
        );
        await input.fill('2026년 11월');
        await page.keyboard.press('Tab');
        await page.waitForFunction(
            () =>
                document
                    .querySelector('.insights-summary article strong')
                    ?.textContent.trim() === '3.6 USD'
        );
        assert.equal(
            requests.filter((r) => r.method === 'GET').length,
            readCount,
            'Month conversion/reprojection does not fetch more ledger data'
        );
        await input.click();
        await page.locator('.p-datepicker-month-view').waitFor();
        assert.equal(
            await page
                .locator('.p-datepicker-month')
                .filter({ hasText: '12월' })
                .getAttribute('data-p-disabled'),
            'true',
            'Future month is disabled'
        );
        await page.keyboard.press('Escape');
        await page.goto(base + '/mypage?tab=calendar');
        await page.locator('.calendar-totals').waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        const calendar = page.getByRole('region', {
            name: '개인 배당 캘린더',
            exact: true,
        });
        const period = calendar.locator('#dividend-period');
        assert.equal(
            await period.evaluate((el) => {
                const style = getComputedStyle(el),
                    canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                return (
                    ctx.measureText(el.value).width <=
                    el.clientWidth -
                        parseFloat(style.paddingLeft) -
                        parseFloat(style.paddingRight) +
                        1
                );
            }),
            true,
            'Entire visible calendar month fits the field'
        );
        const baseline = requests.filter((r) => r.method === 'GET').length;
        const formatPeriod = (month) =>
            width <= 640
                ? month.replace('-', '.')
                : `${month.slice(0, 4)}년 ${month.slice(5, 7)}월`;
        await period.fill(formatPeriod('2026-10'));
        await page.keyboard.press('Tab');
        assert.equal(await period.inputValue(), formatPeriod('2026-10'));
        await calendar
            .getByRole('button', {
                name: '오늘 배당 기간 (11.04)',
                exact: true,
            })
            .click();
        assert.equal(await period.inputValue(), formatPeriod('2026-11'));
        await calendar
            .getByRole('button', { name: '이전 배당 기간', exact: true })
            .click();
        assert.equal(await period.inputValue(), formatPeriod('2026-10'));
        await calendar
            .getByRole('button', { name: '다음 배당 기간', exact: true })
            .click();
        assert.equal(await period.inputValue(), formatPeriod('2026-11'));
        assert.equal(
            requests.filter((r) => r.method === 'GET').length,
            baseline,
            'Today and same-year period navigation reuse ledger/schedule data'
        );
        if (width === 390) {
            await page.setViewportSize({ width: 768, height: 1024 });
            await page.waitForFunction(
                () =>
                    document.querySelector('#dividend-period')?.value ===
                    '2026년 11월'
            );
            await page.setViewportSize({ width: 390, height: 1024 });
            await page.waitForFunction(
                () =>
                    document.querySelector('#dividend-period')?.value ===
                    '2026.11'
            );
        }
        assert.match(
            await calendar.locator('.calendar-left-heading strong').innerText(),
            /2026년 11월/
        );
        await period.click();
        const monthPanel = page.locator('.period-picker .p-datepicker-panel');
        await monthPanel.waitFor();
        assert.equal(
            await monthPanel.evaluate((el) => {
                const r = el.getBoundingClientRect();
                return r.left >= 0 && r.right <= innerWidth + 1;
            }),
            true,
            'Month picker popup fits viewport'
        );
        await monthPanel
            .locator('.p-datepicker-month')
            .filter({ hasText: '10월' })
            .click();
        assert.equal(await period.inputValue(), formatPeriod('2026-10'));
        await calendar
            .getByRole('button', {
                name: '오늘 배당 기간 (11.04)',
                exact: true,
            })
            .click();
        assert.equal(await period.inputValue(), formatPeriod('2026-11'));
        assert.equal(
            requests.filter((r) => r.method === 'GET').length,
            baseline,
            'Popup selection reuses loaded schedules'
        );
        assert.deepEqual(
            requests.filter(
                (r) => r.method !== 'GET' && !r.url.includes('/analytics')
            ),
            []
        );
        assert.deepEqual(errors, []);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        console.log(
            `PASS controls/${width}/${timezoneId}: localized month and limits, original KPI values, today/prev/next, resize, popup selection/bounds, full text fit, no extra data reads/writes/overflow`
        );
        await context.close();
    }
} finally {
    await browser.close();
}
