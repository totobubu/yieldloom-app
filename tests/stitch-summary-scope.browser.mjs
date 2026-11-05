// Reuse existing summary projection for account selection; never convert currency or substitute missing quotes.
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
        if (process.env.STITCH_SCOPE_STATE_DIR) await installStaticAssets(page);
        await installStitchFixtures(page, { admin: true });
        const requests = [],
            errors = [];
        page.on('request', (request) => {
            if (request.url().includes('/api/'))
                requests.push(request.method() + ' ' + request.url());
        });
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/mypage?tab=overview&view=summary'
        );
        const stored = page.locator('.stored-valuation-panel'),
            reference = page.locator('.reference-valuation-panel');
        await reference
            .getByText(/200,000/)
            .first()
            .waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        const capture = async (name) => {
            if (!process.env.STITCH_SCOPE_STATE_DIR) return;
            await fs.mkdir(process.env.STITCH_SCOPE_STATE_DIR, {
                recursive: true,
            });
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
                path: `${process.env.STITCH_SCOPE_STATE_DIR}/${name}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
        };
        const scope = page.getByRole('combobox', {
            name: '평가 계좌 범위',
            exact: true,
        });
        const baseline = requests.length;
        assert.match(await stored.innerText(), /190,000/);
        assert.match(await stored.innerText(), /1,430/);
        await capture('all-accounts');
        await scope.selectOption('a');
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /190,000/);
        assert.doesNotMatch(await stored.innerText(), /USD/);
        assert.match(await reference.innerText(), /200,000/);
        await capture('krw-account');
        await scope.selectOption('b');
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /980/);
        assert.doesNotMatch(await stored.innerText(), /KRW/);
        assert.match(await reference.innerText(), /1,000/);
        await capture('usd-account');
        await scope.selectOption('c');
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /450/);
        assert.doesNotMatch(await reference.innerText(), /450/);
        await capture('viewer-missing-quote');
        await scope.selectOption('');
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /190,000/);
        assert.match(await stored.innerText(), /1,430/);
        await capture('restored-all');
        assert.equal(
            requests.length,
            baseline,
            'Account scope must reuse loaded data/quotes'
        );
        assert.deepEqual(errors, []);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page.close();
        console.log(
            `PASS ${width}: all/single KRW/USD/viewer scopes, missing quote exclusion, restore-all, no new API calls or writes`
        );
    }
} finally {
    await browser.close();
}
