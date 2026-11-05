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
    if (output)
        await fs.writeFile(
            `${output}/results.json`,
            JSON.stringify({ dataset: 'synthetic only', captures }, null, 2) +
                '\n'
        );
} finally {
    await browser.close();
}
