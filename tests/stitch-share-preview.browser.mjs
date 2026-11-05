// Preview focus and ZIP inclusion are independent; never substitute prototype financial values.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        if (process.env.STITCH_SHARE_STATE_DIR) await installStaticAssets(page);
        await installStitchFixtures(page);
        const requests = [],
            errors = [];
        page.on('request', (request) => {
            if (request.url().includes('/api/')) requests.push(request.url());
        });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/stock/DEMO-A?tab=share'
        );
        await page.locator('.summary-card .hero strong').waitFor();
        const capture = async (name) => {
            if (!process.env.STITCH_SHARE_STATE_DIR) return;
            await fs.mkdir(process.env.STITCH_SHARE_STATE_DIR, {
                recursive: true,
            });
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
                path: `${process.env.STITCH_SHARE_STATE_DIR}/${name}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
        };
        const visible = page.locator('.artwork-panel:visible');
        const included = (label) =>
            page.getByRole('checkbox', { name: label, exact: true });
        const all = included('선택한 카드 모두 보기');
        const baseline = requests.length;
        assert.equal(await visible.count(), 1);
        assert.equal(await all.isChecked(), false);
        await capture('source-single-preview');
        await page
            .getByRole('button', { name: '배당 일정 미리보기', exact: true })
            .click();
        assert.equal(await visible.count(), 1);
        assert.equal(
            await visible.locator('[data-thumbnail-kind="calendar"]').count(),
            1
        );
        assert.equal(await included('배당 일정').isChecked(), false);
        assert.equal(await included('배당 요약').isChecked(), true);
        await capture('preview-zip-independent');
        await included('배당 일정').check();
        assert.equal(await visible.count(), 1);
        await capture('two-zip-single-preview');
        await all.check();
        assert.equal(await visible.count(), 2);
        await capture('all-selected-previews');
        await included('배당 요약').uncheck();
        assert.equal(await visible.count(), 1);
        await included('배당 일정').uncheck();
        assert.equal(await visible.count(), 0);
        await page
            .getByText('선택한 카드가 없습니다.', { exact: false })
            .waitFor();
        await capture('all-preview-empty');
        await page
            .getByRole('button', { name: '배당 요약 미리보기', exact: true })
            .click();
        assert.equal(await all.isChecked(), false);
        assert.equal(await included('배당 요약').isChecked(), false);
        assert.equal(
            await visible.locator('[data-thumbnail-kind="summary"]').count(),
            1
        );
        assert.equal(
            await page
                .getByRole('button', {
                    name: '기초자산·종목 비교 미리보기',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        await capture('unchecked-single-preview-disabled-rival');
        assert.equal(
            requests.length,
            baseline,
            'Preview/ZIP controls must reuse loaded data'
        );
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        assert.deepEqual(errors, []);
        const currentPng = page.getByRole('button', {
            name: '현재 카드 PNG 다운로드',
            exact: true,
        });
        const downloadCurrent = async () => {
            const pending = page.waitForEvent('download');
            await currentPng.click();
            const download = await pending;
            const chunks = [];
            for await (const chunk of await download.createReadStream())
                chunks.push(chunk);
            const bytes = Buffer.concat(chunks);
            assert.equal(bytes.readUInt32BE(16), 720);
            assert.equal(bytes.readUInt32BE(20), 720);
            await currentPng.waitFor({ state: 'visible' });
            return download.suggestedFilename();
        };

        // Export retains its existing aggregate analytics POST. Keep the original
        // preview/ZIP no-request assertion above separate from the new PNG action.
        const beforeExports = requests.length;
        const summaryFilename = await downloadCurrent();
        await page
            .getByRole('button', { name: '배당 일정 미리보기', exact: true })
            .click();
        const calendarFilename = await downloadCurrent();
        assert.notEqual(
            calendarFilename,
            summaryFilename,
            'Current PNG follows preview, independent of ZIP'
        );
        assert.ok(
            requests
                .slice(beforeExports)
                .every((url) => new URL(url).pathname === '/api/analytics'),
            'PNG export must not add financial data reads'
        );
        console.log(
            `PASS ${width}: single preview/ZIP independent, current PNG dispatch and720px, no new data reads; legacy export analytics retained; no errors/overflow`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
