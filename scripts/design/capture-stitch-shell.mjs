/* global document, innerWidth -- Playwright callbacks. */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
import { installStaticAssets } from './browser-static-assets.mjs';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const output =
    process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const states = [
    ['pc-public', 1280, '49347f73d53b45cdbe8eb47a465795fe', 'public'],
    ['pc-closed', 1280, '6fa38540cd064d57a93be9dab4eba5fb', 'closed'],
    ['pc-submenu', 1280, '1170392357232825899', 'submenu'],
    ['pc-drawer', 1280, '00a43fae36f645aca872c1758f55ad7b', 'drawer'],
    ['tablet-public', 768, '8db2e91cf0394d78bcdd6f777b49af04', 'public'],
    ['tablet-closed', 768, 'c249cc414f09495aadd23f86e9164e53', 'closed'],
    ['tablet-submenu', 768, '1d714c4d559f4d3c915559180fc797fb', 'submenu'],
    ['tablet-drawer', 768, 'a5dd6d78385b465b8e508ba3a4e6338f', 'drawer'],
    ['mobile-public', 390, '01993440e0064d12b0d50c2f1b633c57', 'public'],
    ['mobile-closed', 390, '03d52a821e5442d584ef0ea65b9c2e24', 'closed'],
    ['mobile-submenu', 390, 'c91050313ebb4fd0a1e0752c31376716', 'submenu'],
    ['mobile-drawer', 390, 'b767530a942a4b0d82d795a0a7cd8b3b', 'drawer'],
];
await fs.mkdir(`${output}/shell-comparison`, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const results = [];
try {
    for (const [name, width, screenId, state] of states) {
        const context = await browser.newContext({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const assetFailures = await installStaticAssets(context);
        const original = await context.newPage();
        const html = await fs.readFile(
            `${repo}/docs/design/stitch-v2/originals/2458864221184522893/${screenId}.html`,
            'utf8'
        );
        await original.setContent(html, { waitUntil: 'networkidle' });
        await original.evaluate(() => document.fonts.ready);
        await original.screenshot({
            path: `${output}/shell-comparison/${name}-original.png`,
            fullPage: true,
            animations: 'disabled',
        });
        const page = await context.newPage();
        await installStitchFixtures(page, { admin: state !== 'public' });
        const implementationAssetFailures = await installStaticAssets(page);
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(
            base +
                (state === 'public' ? '/' : '/mypage?tab=overview&view=capital')
        );
        await page.locator('.studio-header').waitFor();
        if (state === 'public')
            await page.locator('.stock-result-item').first().waitFor();
        else {
            await page
                .locator('.family-page[data-stitch-view="capital"]')
                .waitFor();
            await page.locator('.capital-panel').waitFor();
            if (width >= 1024) await page.locator('.shell-submenu').waitFor();
        }

        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await page
            .locator('.portfolio-loading-overlay')
            .waitFor({ state: 'hidden' });
        if (state === 'closed' && width >= 1024)
            await page
                .getByRole('button', { name: '메뉴 접기', exact: true })
                .click();
        if (state === 'submenu' && width < 1024) {
            await page
                .getByRole('button', { name: '포트폴리오 메뉴', exact: true })
                .click();
            await page.locator('#portfolio-submenu-drawer').waitFor();
        }
        if (state === 'drawer') {
            await page
                .getByRole('button', { name: '계정 및 설정', exact: true })
                .click();
            await page.locator('#account-drawer').waitFor();
        }
        await page.evaluate(() => document.fonts.ready);
        // Visibility alone can precede a Drawer transition or async route content.
        await page.evaluate(() =>
            Promise.all(
                document
                    .getAnimations()
                    .filter((a) =>
                        Number.isFinite(
                            a.effect?.getComputedTiming().iterations
                        )
                    )
                    .map((a) => a.finished.catch(() => {}))
            )
        );

        const geometry = await page.evaluate(() => ({
            viewport: innerWidth,
            contentReady: true,
            mainWidth: document
                .querySelector('#studio-main')
                .getBoundingClientRect().width,
            headerContainerWidth: document
                .querySelector('.header-inner')
                .getBoundingClientRect().width,
            railWidth: document
                .querySelector('.portfolio-compact-rail')
                ?.getBoundingClientRect().width,

            header: document
                .querySelector('.studio-header')
                .getBoundingClientRect().height,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            drawer: document
                .querySelector('#account-drawer')
                ?.getBoundingClientRect()
                .toJSON(),
            submenu: document
                .querySelector('#portfolio-submenu-drawer')
                ?.getBoundingClientRect()
                .toJSON(),
        }));
        await page.screenshot({
            path: `${output}/shell-comparison/${name}-implementation.png`,
            fullPage: true,
            animations: 'disabled',
        });
        results.push({
            name,
            width,
            screenId,
            state,
            geometry,
            assetFailures: [...assetFailures, ...implementationAssetFailures],
            errors,
            visualStatus:
                'differences-remain; source HTML re-render compared at intended viewport; content slot differs',
        });
        console.log(name, geometry.overflow ? 'overflow' : 'captured');
        await context.close();
    }
} finally {
    await browser.close();
    await fs.writeFile(
        `${output}/shell-comparison/results.json`,
        JSON.stringify({ deviceScaleFactor: 2, results }, null, 2)
    );
}
