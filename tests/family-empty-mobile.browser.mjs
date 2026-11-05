import {
    openPortfolioPage,
    waitForPortfolioPage,
} from './portfolio-navigation.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});

try {
    const page = await browser.newPage({
        viewport: { width: 390, height: 900 },
        isMobile: true,
        hasTouch: true,
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.text().includes('Error captured'))
            errors.push(message.text());
    });
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import { ref, computed } from '/node_modules/.vite/deps/vue.js';
export const firebaseUser = ref({ uid: 'owner', email: 'totobubu.lab@gmail.com', emailVerified: true, getIdToken: async () => 'owner' });
export const authLoading = ref(false), signedIn = computed(() => true);
export const firebaseReady = false, db = null, auth = null, googleProvider = null;`,
        })
    );
    await page.route('**/api/family-portfolio*', (route) => {
        const url = new URL(route.request().url());
        const family = {
            id: 'personal-owner',
            name: '검증 가족',
            kind: 'personal',
            adminUid: 'owner',
            profiles: { self: { uid: 'owner', name: '본인' } },
        };
        const hasFamily = url.searchParams.has('familyId');
        return route.fulfill({
            json: hasFamily
                ? {
                      families: [family],
                      accounts: [
                          {
                              id: 'account-1',
                              familyId: family.id,
                              ownerId: 'self',
                              authorityUid: 'owner',
                              alias: '주식 계좌',
                              institution: '테스트증권',
                              type: 'general',
                              maskedNumber: '****1234',
                              permissions: { owner: 'owner' },
                              entriesRevision: 0,
                          },
                      ],
                      summary: {
                          positions: [],
                          knownValueByCurrency: {},
                          missingSnapshotAccounts: ['account-1'],
                          notice: '',
                      },
                  }
                : { families: [family] },
        });
    });
    let capitalRequests = 0;
    await page.route('**/api/portfolio-capital*', (route) => {
        capitalRequests++;
        assert.equal(route.request().method(), 'GET');
        return route.fulfill({
            json: {
                entries: Array.from({ length: 50 }, (_, index) => ({
                    id: `cash-${index}`,
                    date: '20261015',
                    currency: 'KRW',
                    amount: 1000,
                    rawType: '환전원화출금',
                    suggestedKind: 'exchange',
                })),
                classifications: [],
                allocations: [],
                trades: [],
            },
        });
    });

    // Resize/theme assertions exercise cache reuse within its TTL.
    // Keep Date fixed while real browser transitions continue normally.
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00Z'));
    await page.goto(`${base}/mypage`);
    await waitForPortfolioPage(page, '한눈에 보기');
    assert.equal(
        await page.locator('html').evaluate((el) => el.scrollWidth),
        390
    );

    const menu = page.getByRole('button', {
        name: '포트폴리오 메뉴',
        exact: true,
    });
    assert.ok((await menu.boundingBox()).width >= 44);
    assert.equal(
        await page.locator('html').evaluate((el) => el.scrollWidth),
        390
    );
    assert.equal(
        capitalRequests,
        0,
        'inactive capital tab does not fetch cash'
    );
    await openPortfolioPage(page, '한눈에 보기');
    await openPortfolioPage(page, '원금·자금');
    await page.waitForURL('**/mypage?tab=overview&view=capital');
    const capital = page.getByRole('region', {
        name: '투자 원금 대비 회수 현황',
        exact: true,
    });
    const capitalDetails = capital.locator('details').first();
    if (!(await capitalDetails.getAttribute('open')))
        await capitalDetails.locator(':scope > summary').click();
    await capital.locator('tbody tr').first().waitFor();
    await page.waitForFunction(
        () => !document.querySelector('.p-collapsible-enter-active')
    );
    const requestsAfterOpen = capitalRequests;
    for (const width of [320, 360, 390, 430, 767, 768, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        for (const dark of [false, true]) {
            await page.evaluate(
                (dark) =>
                    document.documentElement.classList.toggle('p-dark', dark),
                dark
            );
            // Mobile Chromium can expand innerWidth to fit overflowing content;
            // compare against the configured viewport, not innerWidth.
            assert.ok(
                (await page.locator('html').evaluate((el) => el.scrollWidth)) <=
                    width,
                `${width}px: page stays within viewport`
            );
            const panel = await page.locator('.capital-details').boundingBox();
            assert.ok(panel.width <= width);
            if (width <= 767) {
                await page.evaluate(() => window.scrollTo(0, 1000));
                const header = await page
                    .locator('.studio-header')
                    .boundingBox();
                assert.ok(
                    Math.abs(header.y) < 1,
                    'mobile header remains visible while scrolling'
                );
                const trigger = page.getByRole('button', {
                    name: '포트폴리오 메뉴',
                    exact: true,
                });
                await trigger.scrollIntoViewIfNeeded();
                await trigger.click();
                const submenu = page.locator('#portfolio-submenu-drawer');
                await submenu.waitFor();
                const bounds = await submenu.boundingBox();
                assert.ok(
                    bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
                    'submenu stays within viewport'
                );
                await page.keyboard.press('Escape');
                await submenu.waitFor({ state: 'hidden' });
            } else {
                assert.equal(
                    await page.locator('.portfolio-tabs > .p-tablist').count(),
                    0,
                    'duplicate portfolio tabs remain removed'
                );
            }
        }
    }
    await openPortfolioPage(page, '요약');
    await openPortfolioPage(page, '원금·자금');
    await capital.waitFor();
    assert.equal(
        capitalRequests,
        requestsAfterOpen,
        'resize/theme/tab revisit reuses loaded cash'
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await openPortfolioPage(page, '자산관리');
    assert.equal(
        await page.locator('.family-page').getAttribute('data-stitch-view'),
        'assets'
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: responsive shell menu, empty routing, capital width, local table scrolling and cached revisit within TTL'
    );
} finally {
    await browser.close();
}
