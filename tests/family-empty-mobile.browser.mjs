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
                tab.textContent?.includes('자료 업로드') &&
                tab.getAttribute('aria-selected') === 'true'
        )
    );
    assert.equal(
        await page
            .getByRole('tab', { name: '자료 업로드' })
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
        await page.getByRole('combobox', { name: '자료 종류' }).textContent(),
        '거래내역'
    );
    assert.equal(
        await page.locator('html').evaluate((el) => el.scrollWidth),
        390
    );
    assert.equal(capitalRequests, 0, 'collapsed details do not fetch cash');
    await page.getByRole('tab', { name: '한눈에 보기', exact: true }).click();
    const toggle = page.getByRole('button', {
        name: '원금 회수 · 자금 상세',
        exact: true,
    });
    await toggle.click();
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
    for (const width of [320, 360, 390, 430, 768, 1280]) {
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
            const wrapper = await page
                .locator('.capital-details .p-panel-content-wrapper')
                .boundingBox();
            assert.ok(wrapper.width <= panel.width);
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
    await toggle.click();
    await toggle.click();
    await capital.waitFor();
    assert.equal(
        capitalRequests,
        requestsAfterOpen,
        'resize/theme/reopen reuse loaded cash'
    );
    console.log(
        'PASS: mobile tabs, empty routing, expanded capital panel width, local table scrolling and cached reopen'
    );
} finally {
    await browser.close();
}
