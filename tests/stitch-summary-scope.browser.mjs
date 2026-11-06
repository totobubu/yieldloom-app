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
        let overview;
        page.on('response', async (response) => {
            if (
                new URL(response.url()).pathname.endsWith(
                    '/family-portfolio'
                ) &&
                !new URL(response.url()).searchParams.has('accountId')
            )
                overview = await response.json();
        });
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
        const menu = page.locator('.summary-scope');
        const scope = async (ids) => {
            if ((await menu.getAttribute('open')) === null)
                await menu.locator('summary').click();
            const boxes = menu.getByRole('checkbox');
            for (const [index, id] of ['a', 'b', 'c'].entries())
                await boxes.nth(index).setChecked(ids.includes(id));
        };
        const baseline = requests.length;
        const storageBefore = await page.evaluate(() => ({
            url: location.href,
            local: { ...localStorage },
            session: { ...sessionStorage },
        }));
        assert.match(await stored.innerText(), /190,000/);
        assert.match(await stored.innerText(), /1,430/);
        await capture('all-accounts');
        await scope(['a']);
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /190,000/);
        assert.doesNotMatch(await stored.innerText(), /USD/);
        assert.match(await reference.innerText(), /200,000/);
        await capture('krw-account');
        await scope(['b']);
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /980/);
        assert.doesNotMatch(await stored.innerText(), /KRW/);
        assert.match(await reference.innerText(), /1,000/);
        await capture('usd-account');
        await scope(['c']);
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /450/);
        assert.doesNotMatch(await reference.innerText(), /450/);
        await capture('viewer-missing-quote');
        await menu
            .getByRole('button', { name: '전체선택', exact: true })
            .click();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        assert.match(await stored.innerText(), /190,000/);
        assert.match(await stored.innerText(), /1,430/);
        await capture('restored-all');
        await scope(['a', 'b']);
        assert.match(await stored.innerText(), /190,000/);
        assert.match(await stored.innerText(), /980/);
        assert.doesNotMatch(await stored.innerText(), /1,430/);
        assert.match(await reference.innerText(), /200,000/);
        assert.match(await reference.innerText(), /1,000/);
        await capture('two-of-three');
        await scope([]);
        await page
            .getByText('선택한 계좌가 없습니다.', { exact: false })
            .waitFor();
        assert.equal(
            await stored.isVisible(),
            false,
            'Empty selection must not imply an empty ledger or zero valuation'
        );
        await capture('empty-selection');
        await menu
            .getByRole('button', { name: '전체선택', exact: true })
            .click();
        assert.equal(await stored.isVisible(), true);
        await menu.locator('summary').focus();
        await page.keyboard.press('Escape');
        assert.equal(await menu.getAttribute('open'), null);
        assert.equal(
            await menu
                .locator('summary')
                .evaluate((el) => el === document.activeElement),
            true
        );
        await page
            .getByRole('button', { name: '선택 초기화', exact: true })
            .click();
        assert.match(await menu.innerText(), /3\/3/);
        assert.equal(
            requests.length,
            baseline,
            'Account scope must reuse loaded data/quotes'
        );
        assert.deepEqual(
            await page.evaluate(() => ({
                url: location.href,
                local: { ...localStorage },
                session: { ...sessionStorage },
            })),
            storageBefore,
            'Scope selection stays in memory, with no URL or storage writes'
        );
        assert.deepEqual(errors, []);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        // A server refresh removes a formerly allowed account. It must not restore all.
        await scope(['b']);
        const overviewWithoutB = structuredClone(overview);
        overviewWithoutB.accounts = overviewWithoutB.accounts.filter(
            (account) => account.id !== 'b'
        );
        overviewWithoutB.accounts.find(
            (account) => account.id === 'c'
        ).calculatedSnapshot = null;
        await page.route('**/api/family-portfolio*', (route) => {
            const url = new URL(route.request().url());
            if (url.searchParams.has('accountId')) return route.fallback();
            return route.fulfill({ json: overviewWithoutB });
        });
        await page
            .getByRole('button', { name: '새로고침', exact: true })
            .click();
        await page
            .getByText('선택한 계좌가 없습니다.', { exact: false })
            .waitFor();
        assert.match(await menu.innerText(), /0\/2/);
        assert.equal(await stored.isVisible(), false);
        if ((await menu.getAttribute('open')) === null)
            await menu.locator('summary').click();
        assert.equal(
            await menu.getByRole('checkbox').count(),
            2,
            'Removed account cannot remain selectable'
        );
        // Restore only currently authorized accounts. No stale removed ID is reintroduced.
        await page
            .getByRole('button', { name: '선택 초기화', exact: true })
            .click();
        assert.match(await menu.innerText(), /2\/2/);
        assert.doesNotMatch(await stored.innerText(), /980|1,430/);
        assert.match(
            await page.locator('.valuation-review').innerText(),
            /잔고 자료가 없는 계좌 1개/
        );
        await capture('removed-selection');
        const afterRefresh = requests.length;
        if ((await menu.getAttribute('open')) === null)
            await menu.locator('summary').click();
        await menu.getByRole('checkbox').nth(0).uncheck();
        assert.match(
            await page.locator('.valuation-review').innerText(),
            /잔고 자료가 없는 계좌 1개/
        );
        assert.doesNotMatch(await stored.innerText(), /KRW/);
        assert.equal(
            requests.length,
            afterRefresh,
            'Unknown snapshot scope changes must not trigger reads/writes'
        );
        assert.deepEqual(errors, []);
        assert.equal(
            requests.every((request) => request.startsWith('GET ')),
            true,
            'All interactions and explicit refresh remain read-only'
        );
        await page.close();
        console.log(
            `PASS ${width}: all/single/two-of-three/empty/restore, KRW/USD separation, missing quote, keyboard, no additional requests`
        );
    }
} finally {
    await browser.close();
}
