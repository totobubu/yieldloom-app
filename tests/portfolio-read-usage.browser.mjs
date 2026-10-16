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
        let reads = 0;
        const urls = [];
        await page.route('**/api/portfolio-capital*', async (route) => {
            const params = new URL(route.request().url()).searchParams;
            reads++;
            urls.push(params);
            const account = params.get('accountId');
            await route.fulfill({
                json: params.has('version')
                    ? { unchanged: true }
                    : {
                          version: `v1:0:${account}`,
                          ledgerVersion: 'v1:0',
                          entries: [],
                          trades: [],
                          importedCash: [],
                          classifications: [],
                          allocations: [],
                      },
            });
        });
        let familyFailure = false;
        let familyReads = 0;
        await page.route('**/api/family-portfolio*', async (route) => {
            familyReads++;
            if (familyFailure)
                return route.fulfill({
                    status: 429,
                    headers: { 'Retry-After': '60' },
                    json: {
                        code: 'DATA_RESOURCE_EXHAUSTED',
                        error: '데이터베이스 요청이 제한되었습니다.',
                    },
                });
            const params = new URL(route.request().url()).searchParams;
            if (params.has('accountId')) {
                assert.equal(params.get('accountId'), 'migrated');
                assert.equal(params.get('legacy'), 'true');
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
        const toggle = page.getByRole('button', {
            name: '원금 회수 · 자금 상세',
            exact: true,
        });
        await toggle.waitFor();
        assert.equal(reads, 0, 'collapsed capital must not query the ledger');
        await toggle.click();
        const overview = page.getByRole('region', {
            name: '전체 계좌 원금 회수 현황',
            exact: true,
        });
        await overview
            .getByRole('region', { name: '종목별 투자 비용 회수' })
            .waitFor();
        assert.equal(
            reads,
            2,
            'two accounts should each fetch once, sharing the selected account read'
        );
        await page
            .getByRole('button', { name: '새로고침', exact: true })
            .click();
        await page.waitForFunction(
            () =>
                !document.querySelector(
                    '.portfolio-actions button[aria-label="새로고침"]'
                )?.disabled
        );
        await page.getByRole('tab', { name: '계좌 관리', exact: true }).click();
        await page
            .getByRole('tab', { name: '한눈에 보기', exact: true })
            .click();
        await overview
            .getByRole('region', { name: '종목별 투자 비용 회수' })
            .waitFor();
        assert.ok(
            urls.filter((p) => !p.has('version')).length === 2,
            `refresh reads: ${reads}; ${urls.map((p) => p.toString()).join(', ')}`
        );
        assert.ok(urls.slice(2).every((params) => params.has('version')));
        const beforeFailure = familyReads;
        familyFailure = true;
        await page
            .getByRole('button', { name: '새로고침', exact: true })
            .click();
        await page
            .getByRole('alert')
            .filter({ hasText: '계좌 목록 조회에 실패했습니다' })
            .waitFor();
        await page
            .getByRole('button', { name: '새로고침', exact: true })
            .click();
        assert.equal(
            familyReads,
            beforeFailure + 1,
            'quota failures must not create repeat database requests'
        );
        assert.equal(
            await page
                .getByText('등록된 계좌가 없습니다.', { exact: false })
                .count(),
            0
        );
        assert.deepEqual(errors, []);
        await page.close();
    }
    console.log(
        'PASS: collapsed ledger makes zero requests; expanded summary/detail share account reads; refresh revalidates versions at desktop/mobile widths'
    );
} finally {
    await browser.close();
}
