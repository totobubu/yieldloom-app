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
export const firebaseUser = ref({ uid: 'owner', getIdToken: async () => 'owner' });
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

    await page.goto(`${base}/mypage`);
    await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="tab"]')].some(
            (tab) =>
                tab.textContent?.includes('자산관리') &&
                tab.getAttribute('aria-selected') === 'true'
        )
    );
    assert.equal(
        await page
            .getByRole('tab', { name: '자산관리' })
            .getAttribute('aria-selected'),
        'true'
    );
    assert.equal(
        await page.locator('html').evaluate((el) => el.scrollWidth),
        390
    );

    const tabs = page.getByRole('tab');
    assert.ok((await tabs.first().boundingBox()).width >= 60);
    assert.equal(
        await page.locator('html').evaluate((el) => el.scrollWidth),
        390
    );
    assert.equal(
        capitalRequests,
        0,
        'inactive capital tab does not fetch cash'
    );
    await page.getByRole('tab', { name: '한눈에 보기', exact: true }).click();
    await page.getByRole('tab', { name: '원금·자금', exact: true }).click();
    await page.waitForURL('**/mypage?tab=overview&view=capital');
    const capital = page.getByRole('region', {
        name: '투자 원금 대비 회수 현황',
        exact: true,
    });
    await capital.locator('summary').click();
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
            const menu = page.locator('.portfolio-tabs > .p-tablist');
            if (width <= 767) {
                await page.evaluate(() => window.scrollTo(0, 1000));
                const header = await page
                    .locator('.studio-header')
                    .boundingBox();
                const menuBounds = await menu.boundingBox();
                assert.ok(
                    Math.abs(menuBounds.y - header.y - header.height) < 1,
                    'mobile tabs stay below the header while scrolling'
                );
                assert.equal(
                    await menu.evaluate((el) =>
                        el.contains(
                            document.elementFromPoint(
                                el.getBoundingClientRect().x + 20,
                                el.getBoundingClientRect().y + 20
                            )
                        )
                    ),
                    true,
                    'menu is not covered by content'
                );
                if (width === 390)
                    await page.screenshot({
                        path: `/tmp/portfolio-sticky-menu-${dark ? 'dark' : 'light'}.png`,
                    });
            } else {
                assert.notEqual(
                    await menu.evaluate((el) => getComputedStyle(el).position),
                    'sticky',
                    'desktop menu stays in normal flow'
                );
            }
            if (width <= 430) {
                const table = capital.locator('.table-wrap');
                assert.equal(
                    await table.evaluate(
                        (el) => el.scrollWidth > el.clientWidth
                    ),
                    true
                );
                await table.evaluate((el) => {
                    el.scrollLeft = 150;
                });
                assert.ok((await table.evaluate((el) => el.scrollLeft)) > 0);
            }
        }
    }
    await page.getByRole('tab', { name: '요약', exact: true }).click();
    await page.getByRole('tab', { name: '원금·자금', exact: true }).click();
    await capital.waitFor();
    assert.equal(
        capitalRequests,
        requestsAfterOpen,
        'resize/theme/tab revisit reuses loaded cash'
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole('tab', { name: '자산관리', exact: true }).click();
    assert.equal(
        await page
            .getByRole('tab', { name: '자산관리', exact: true })
            .getAttribute('aria-selected'),
        'true'
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: mobile tabs, empty routing, capital tab width, local table scrolling and cached revisit'
    );
} finally {
    await browser.close();
}
