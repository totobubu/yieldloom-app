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
    await page.route('**/api/portfolio-capital*', (route) =>
        route.fulfill({
            json: { entries: [], classifications: [], allocations: [] },
        })
    );

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
    console.log('PASS: mobile tabs and empty portfolio routing');
} finally {
    await browser.close();
}
