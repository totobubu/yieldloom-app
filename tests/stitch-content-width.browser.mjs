// Independent source frame contracts: catalog HTML max1240, comparison max1200,
// editorial HTML max1440; shell header/footer max1120 must not cap content.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage();
    await installStitchFixtures(page);
    for (const [url, selector, max, padding] of [
        ['/?q=DEMO', '.search-page', 1240, (width) => (width <= 768 ? 12 : 20)],
        [
            '/compare?view=similar',
            '.underlying-explorer',
            1200,
            (width) => (width <= 390 ? 12 : width <= 768 ? 16 : 24),
        ],
        [
            '/stock/DEMO-A?tab=share',
            '.ticker-thumbnail-page',
            1440,
            (width) => (width < 768 ? 16 : width < 1024 ? 24 : 32),
        ],
    ]) {
        for (const width of [1600, 1280, 768, 390]) {
            await page.setViewportSize({ width, height: 1024 });
            await page.goto(
                (process.env.UI_BASE_URL || 'http://127.0.0.1:5173') + url
            );
            await page.locator(selector).waitFor();
            const box = await page.locator(selector).boundingBox();
            assert.ok(
                Math.abs(
                    box.width - Math.min(max, width - padding(width) * 2)
                ) < 1,
                `${url}/${width}: independent content width ${box.width}`
            );
            const header = await page.locator('.header-inner').boundingBox();
            assert.ok(
                header.width <=
                    (width >= 1024 ? 1120 : width >= 768 ? 720 : width),
                'shell grid stays independent'
            );
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                )
            );
        }
    }
    const privatePage = await browser.newPage();
    await installStitchFixtures(privatePage, { admin: true });
    for (const width of [1600, 1280, 768, 390]) {
        await privatePage.setViewportSize({ width, height: 1024 });
        await privatePage.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5173') +
                '/mypage?tab=assets'
        );
        await privatePage.locator('.accounts li').first().waitFor();
        const content = await privatePage
            .locator('.asset-management-overview')
            .boundingBox();
        const header = await privatePage.locator('.header-inner').boundingBox();
        const expectedContent = width >= 1024 ? 984 : width === 768 ? 720 : 358;
        assert.ok(
            Math.abs(content.width - expectedContent) < 1,
            `source shell slot/${width}: ${content.width}`
        );
        assert.ok(
            Math.abs(
                header.width -
                    (width >= 1024 ? 1280 : width === 768 ? 720 : width)
            ) < 1
        );
        if (width >= 1024) {
            assert.ok(Math.abs(content.x - ((width - 1280) / 2 + 272)) < 1);
            await privatePage
                .getByRole('button', { name: '메뉴 접기', exact: true })
                .click();
            assert.ok(
                (await privatePage.locator('.header-inner').boundingBox())
                    .width <= 1120,
                'closed/public header retains its independent grid'
            );
            assert.equal(
                Math.round(
                    (
                        await privatePage
                            .locator('.portfolio-compact-rail')
                            .boundingBox()
                    ).width
                ),
                56
            );
            assert.equal(
                Math.round(
                    (
                        await privatePage
                            .locator('.asset-management-overview')
                            .boundingBox()
                    ).width
                ),
                1008
            );
            await privatePage
                .getByRole('button', { name: '서브메뉴 펼치기', exact: true })
                .click();
            await privatePage.locator('.shell-submenu').waitFor();
        }
        assert.ok(
            await privatePage.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
    }
    await privatePage.close();
    console.log(
        'PASS: 3 original content frame contracts at 1600/1280/768/390; shell header grid independent; source PC984/Tablet720/Mobile358 private slots; no horizontal overflow'
    );
} finally {
    await browser.close();
}
