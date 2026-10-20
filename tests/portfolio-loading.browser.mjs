// Run with Vite on :5173. Authentication and all portfolio responses use synthetic fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 900 },
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/src/services/firebaseClient*', (r) =>
            r.fulfill({
                contentType: 'application/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'loading-fixture',getIdToken:async()=> 'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,db=null,auth=null,googleProvider=null;`,
            })
        );
        let requests = [],
            calls = 0;
        await page.route('**/api/family-portfolio*', (r) => {
            calls++;
            requests.push(r);
        });
        await page.goto(
            (process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5173') +
                '/mypage?tab=upload'
        );
        const overlay = page.locator('.portfolio-loading-overlay');
        await overlay.waitFor();
        await page.waitForFunction(
            () => document.querySelector('.portfolio-content-body').inert
        );
        const bounds = await overlay.boundingBox();
        assert.equal(bounds.width, width);
        assert.equal(bounds.height, 900);
        await page
            .getByRole('tab', { name: '계좌 관리', exact: true })
            .click({ timeout: 500 })
            .then(
                () => assert.fail('Blocked tab accepted click'),
                (e) => assert.match(e.message, /Timeout/)
            );
        for (let i = 0; i < 12; i++) {
            await page.keyboard.press('Tab');
            assert.equal(
                await page.evaluate(
                    () =>
                        !!document.activeElement.closest(
                            '.portfolio-content-body'
                        )
                ),
                false
            );
        }
        assert.equal(calls, 1);
        await page.screenshot({
            path: `/tmp/portfolio-loading-${width}.png`,
            fullPage: true,
        });
        await requests.shift().fulfill({
            json: {
                families: [
                    {
                        id: 'loading-family',
                        kind: 'personal',
                        adminUid: 'loading-fixture',
                    },
                ],
            },
        });
        while (!requests.length) await page.waitForTimeout(20);
        assert.equal(await overlay.isVisible(), true);
        assert.equal(
            await page
                .locator('.portfolio-content-body')
                .evaluate((e) => e.inert),
            true
        );
        await requests
            .shift()
            .fulfill({ json: { families: [], accounts: [] } });
        await overlay.waitFor({ state: 'hidden' });
        assert.equal(
            await page
                .locator('.portfolio-content-body')
                .evaluate((e) => e.inert),
            false
        );
        await page.getByRole('tab', { name: '계좌 관리', exact: true }).click();
        assert.match(page.url(), /tab=accounts/);
        await page
            .getByRole('button', { name: '새로고침', exact: true })
            .click();
        await overlay.waitFor();
        await page.waitForFunction(
            () => document.querySelector('.portfolio-content-body').inert
        );
        while (!requests.length) await page.waitForTimeout(20);
        await requests
            .shift()
            .fulfill({ status: 503, json: { error: '검증용 처리 실패' } });
        await overlay.waitFor({ state: 'hidden' });
        await page.getByText('검증용 처리 실패', { exact: true }).waitFor();
        assert.equal(
            await page
                .getByRole('button', {
                    name: '계좌 목록 다시 시도',
                    exact: true,
                })
                .isEnabled(),
            true
        );
        assert.equal(
            await page
                .locator('.portfolio-content-body')
                .evaluate((e) => e.inert),
            false
        );
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        await page
            .getByRole('button', { name: '계좌 목록 다시 시도', exact: true })
            .click();
        await overlay.waitFor();
        await page.screenshot({
            path: `/tmp/portfolio-loading-dark-${width}.png`,
            fullPage: true,
        });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        while (!requests.length) await page.waitForTimeout(20);
        await requests.shift().fulfill({ json: { families: [] } });
        await overlay.waitFor({ state: 'hidden' });
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}px: content coverage, click/keyboard blocking, success/error recovery, dark layout; ${calls} requests`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
