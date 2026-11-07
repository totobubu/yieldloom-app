// Synthetic identity only. All personal APIs and external connections are blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-shell';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const admin of [false, true]) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/*', (route) => {
            const host = new URL(route.request().url()).hostname;
            return ['127.0.0.1', 'localhost'].includes(host)
                ? route.continue()
                : route.abort();
        });
        await page.route('**/src/services/firebaseClient*', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref(${admin ? "{uid:'visual-admin',email:'visual@example.test',emailVerified:true,getIdToken:async()=>'visual-token'}" : 'null'}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),auth={},googleProvider={},firebaseReady=true,db=null;`,
            })
        );
        // Changes the test identity contract only; production RBAC stays intact.
        await page.route('**/lib/portfolio-admin.js*', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: 'export const PORTFOLIO_ADMIN_EMAILS=[];export const isPortfolioAdmin=user=>user?.uid === "visual-admin";',
            })
        );
        await page.route('**/api/**', (route) =>
            route.fulfill({ status: 403, json: { error: 'Visual fixture' } })
        );
        for (const width of [1280, 834, 768, 390, 320]) {
            console.log(`CHECK shell ${admin ? 'admin' : 'public'}/${width}`);
            await page.setViewportSize({ width, height: 1024 });
            await page.goto(base + (admin ? '/mypage?view=summary' : '/'));
            await page.locator('.studio-header').waitFor();
            if (admin) await page.locator('.family-page').waitFor();
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
            await page
                .locator('.portfolio-loading-overlay')
                .waitFor({ state: 'hidden' });
            const account = page.getByRole('button', {
                name: '계정 및 설정',
                exact: true,
            });
            assert.equal(await account.count(), admin ? 1 : 0);
            assert.equal(await page.locator('.mobile-nav a').count(), 4);
            const expectedHeader = admin
                ? width < 768
                    ? 86.5
                    : width < 1024
                      ? 65
                      : 64
                : width < 768
                  ? 56
                  : 64;
            const actualHeader = (
                await page.locator('.studio-header').boundingBox()
            ).height;
            assert.ok(
                Math.abs(actualHeader - expectedHeader) < 0.1,
                `header ${admin}/${width}: ${actualHeader} vs ${expectedHeader}`
            );
            const location = page.getByRole('navigation', {
                name: '현재 포트폴리오 위치',
                exact: true,
            });
            assert.equal(await location.count(), admin && width < 768 ? 1 : 0);
            if (admin && width < 768) {
                assert.match(
                    await location.innerText(),
                    /포트폴리오[\s\S]*개요[\s\S]*요약/
                );
                assert.equal(
                    await location.locator('[aria-current="page"]').innerText(),
                    '요약'
                );
            }
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                ),
                `overflow: ${admin}/${width}`
            );
            if (!admin) {
                assert.equal(
                    await page
                        .getByRole('link', { name: '로그인', exact: true })
                        .count(),
                    0
                );
                continue;
            }
            await account.click();
            const drawer = page.locator('#account-drawer');
            await drawer.waitFor();
            assert.equal(await location.count(), 0);
            assert.ok(
                Math.abs(
                    (await page.locator('.studio-header').boundingBox())
                        .height - (width < 768 ? 56 : 64)
                ) < 0.1
            );
            assert.equal(
                await drawer
                    .getByRole('link', { name: '요약', exact: true })
                    .getAttribute('href'),
                '/mypage?tab=overview&view=summary'
            );
            await page.screenshot({ path: `${output}/drawer-${width}.png` });
            await page.keyboard.press('Escape');
            await drawer.waitFor({ state: 'hidden' });
            await account.focus();
            await page.keyboard.press('Enter');
            await drawer
                .getByRole('link', { name: '보유 종목', exact: true })
                .click();
            await page.waitForURL(
                (url) => url.searchParams.get('view') === 'holdings'
            );
            await drawer.waitFor({ state: 'hidden' });
            if (width < 768) {
                assert.equal(
                    await location.locator('[aria-current="page"]').innerText(),
                    '보유 종목'
                );
                assert.ok(!(await location.innerText()).includes('원금'));
            }
            if (width >= 1024) {
                await page
                    .getByRole('button', { name: '메뉴 접기', exact: true })
                    .click();
                assert.equal(await page.locator('.shell-submenu').count(), 0);
                await page
                    .getByRole('button', { name: '메뉴 펼치기', exact: true })
                    .click();
                await page.locator('.shell-submenu').waitFor();
            } else {
                await page
                    .getByRole('button', {
                        name: '포트폴리오 메뉴',
                        exact: true,
                    })
                    .click();
                const submenu = page.locator('#portfolio-submenu-drawer');
                await submenu.waitFor();
                if (width >= 768) {
                    const toggle = page.getByRole('button', {
                        name: '포트폴리오 메뉴',
                        exact: true,
                    });
                    await toggle.click();
                    await submenu.waitFor({ state: 'hidden' });
                    await toggle.click();
                    await submenu.waitFor();
                }
                await submenu
                    .getByRole('link', {
                        name: width >= 768 ? '월별 배당 일정' : '캘린더',
                        exact: true,
                    })
                    .click();
                await page.waitForURL(
                    (url) => url.searchParams.get('tab') === 'calendar'
                );
                await submenu.waitFor({ state: 'hidden' });
            }
            await page.screenshot({ path: `${output}/submenu-${width}.png` });
        }
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${admin ? 'synthetic admin' : 'public'}: 1280/834/768/390/320px, navigation, RBAC visibility, no overflow or JS errors`
        );
        await context.close();
    }
} finally {
    await browser.close();
}
