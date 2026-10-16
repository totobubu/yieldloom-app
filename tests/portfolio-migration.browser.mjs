// Local Vite server; authentication and account data are fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5175';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/src/services/firebaseClient*', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';
                export const firebaseUser=ref({uid:'A',email:'test@example.test',getIdToken:async()=> 'A'}),
                    authLoading=ref(false),firebaseReady=false,db=null,auth=null;
                export const signedIn=computed(()=>Boolean(firebaseUser.value));`,
            })
        );
        await page.route('**/api/portfolio-capital*', (route) =>
            route.fulfill({
                json: { entries: [], classifications: [], allocations: [] },
            })
        );
        let finishRequest;
        let requestStarted;
        let delay = false;
        await page.route('**/api/family-portfolio*', async (route) => {
            const params = new URL(route.request().url()).searchParams;
            if (params.has('accountId')) {
                assert.equal(params.get('accountId'), 'migrated');
                assert.equal(params.get('legacy'), 'true');
                if (delay)
                    await new Promise((resolve) => {
                        finishRequest = resolve;
                        requestStarted();
                    });
                await route.fulfill({
                    json: {
                        entries: [
                            {
                                id: 'old',
                                row: { symbol: 'PRESERVED', quantity: 2 },
                            },
                        ],
                        nextCursor: null,
                    },
                });
                return;
            }
            const account = (id, alias) => ({
                id,
                alias,
                familyId: 'f',
                ownerId: 'self',
                authorityUid: 'A',
                permissions: { A: 'owner' },
                institution: '테스트증권',
                type: 'general',
                maskedNumber: '****1234',
            });
            await route.fulfill({
                json: {
                    families: [
                        {
                            id: 'f',
                            kind: 'personal',
                            adminUid: 'A',
                            profiles: { self: { uid: 'A', name: '본인' } },
                        },
                    ],
                    accounts: [
                        {
                            ...account('migrated', '이전 계좌'),
                            legacyMigration: {
                                assets: 2,
                                transactions: 1,
                                migratedAt: '2026-10-15T01:00:00+00:00',
                                status: 'unverified-balance-date',
                            },
                        },
                        account('fresh', '신규 계좌'),
                    ],
                    summary: null,
                },
            });
        });
        await page.goto(base + '/mypage');
        await page.getByRole('tab', { name: '계좌 관리', exact: true }).click();
        const details = page.getByRole('region', { name: '이전 완료 내역' });
        await details.waitFor();
        assert.match(
            await details.innerText(),
            /보존 종목\s*2개\s*· 거래\s*1건/
        );
        assert.match(
            await details.innerText(),
            /2026\. 10\. 15\. 오전 10:00:00/
        );
        assert.equal(await page.locator('a[href="/mypage/legacy"]').count(), 0);
        assert.equal(
            await page
                .getByText('이전 단일 계좌 데이터 보존 이전', { exact: true })
                .count(),
            0
        );
        await page
            .getByRole('button', { name: '보존 이전 원장 확인', exact: true })
            .click();
        await page.getByRole('cell').filter({ hasText: 'PRESERVED' }).waitFor();
        assert.equal(
            await page
                .getByLabel('보존 이전 원장', { exact: true })
                .isChecked(),
            true
        );
        // Changing the ledger mode while a response is pending must discard it.
        delay = true;
        const pendingRequest = new Promise((resolve) => {
            requestStarted = resolve;
        });
        await page
            .getByRole('button', { name: '보존 이전 원장 확인', exact: true })
            .click();
        await pendingRequest;
        assert.equal(typeof finishRequest, 'function');
        await page.getByLabel('보존 이전 원장', { exact: true }).uncheck();
        finishRequest();
        await page.getByRole('button', { name: '조회', exact: true }).waitFor();
        await page.waitForFunction(() => {
            const button = [...document.querySelectorAll('button')].find(
                (item) => item.textContent.includes('보존 이전 원장 확인')
            );
            return button && !button.disabled;
        });
        assert.equal(
            await page.getByText('PRESERVED', { exact: false }).count(),
            0
        );
        await page.getByRole('button').filter({ hasText: '신규 계좌' }).click();
        await details.waitFor({ state: 'hidden' });
        await page
            .getByText('이전 단일 계좌 데이터 보존 이전', { exact: true })
            .waitFor();
        assert.equal(
            await page
                .getByLabel('보존 이전 원장', { exact: true })
                .isChecked(),
            false
        );
        assert.deepEqual(errors, []);
        await page.close();
    }
    console.log(
        'PASS: migration details, preserved ledger, stale response protection, account switching at desktop/mobile widths'
    );
} finally {
    await browser.close();
}
