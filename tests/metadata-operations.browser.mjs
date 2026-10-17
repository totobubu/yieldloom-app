import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import registry from '../data-v2/security-underlyings.json' with { type: 'json' };
import { reviewDataset } from '../lib/metadata/reviews.js';
import { PORTFOLIO_ADMIN_EMAILS } from '../lib/portfolio-admin.js';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const output = '/tmp/yieldloom-enhancements';
await fs.mkdir(output, { recursive: true });
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    const errors = [],
        api = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) =>
        ['localhost', '127.0.0.1'].includes(
            new URL(route.request().url()).hostname
        )
            ? route.continue()
            : route.abort()
    );
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import{ref,computed}from'/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'metadata-admin',email:${JSON.stringify(PORTFOLIO_ADMIN_EMAILS[0])},emailVerified:true,getIdToken:async()=>'fixture-token'}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),auth={},googleProvider={},firebaseReady=true,db=null;window.__metadataUser=firebaseUser;`,
        })
    );
    const data = reviewDataset(
        registry,
        {
            generatedAt: '2026-10-17',
            summary: { etfsAudited: 1601, verified: 185 },
            sourceFailures: [],
            instruments: [{ symbol: 'AAPY', status: 'needs-review' }],
        },
        [
            {
                symbol: 'AAPY',
                koName: '애플 인컴 ETF',
                market: 'NYSE',
                currency: 'USD',
            },
        ],
        {
            providers: {
                kurv: {
                    status: 'degraded',
                    lastAttemptAt: '2026-10-17',
                    lastSuccessAt: '2026-10-16',
                    failureCount: 1,
                    verifiedLinks: 6,
                },
            },
        }
    );
    let reviews = [],
        history = [],
        gets = 0,
        posts = 0;
    await page.route('**/api/security-metadata', async (route) => {
        api.push(route.request().method());
        assert.equal(
            route.request().headers().authorization,
            'Bearer fixture-token'
        );
        if (route.request().method() === 'POST') {
            posts++;
            const body = route.request().postDataJSON();
            assert.equal(body.datasetRevision, data.revision);
            assert.ok(body.requestId);
            assert.equal(body.expectedRevision, 0);
            const row = {
                ...body,
                revision: 1,
                status: 'approve',
                createdAt: '2026-10-17T00:00:00Z',
            };
            reviews = [row];
            history = [row];
            return route.fulfill({ json: { revision: 1, status: 'approve' } });
        }
        gets++;
        return route.fulfill({ json: { ...data, reviews, history } });
    });
    await page.goto('http://127.0.0.1:5173/admin/metadata');
    await page
        .getByRole('heading', { name: 'ETF 데이터 검토', exact: true })
        .waitFor();
    await page.getByLabel('티커·기초자산 검색').fill('AAPY');
    await page
        .locator('.queue button')
        .filter({ has: page.locator('strong', { hasText: /^AAPY$/ }) })
        .click();
    await page.getByLabel('검토 결과', { exact: true }).click();
    await page.getByRole('option', { name: '승인', exact: true }).click();
    await page
        .getByLabel('검토 근거 (8~1,000자)')
        .fill('공식 투자 목적에서 AAPL 연결을 확인했습니다.');
    await page.getByRole('button', { name: '검토 저장', exact: true }).click();
    await page
        .getByRole('status')
        .filter({ hasText: '승인을 저장했습니다' })
        .waitFor();
    assert.equal(posts, 1);
    assert.equal(gets, 2);
    await page.getByRole('heading', { name: '최근 변경 이력' }).waitFor();
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.waitForFunction(
        () => document.documentElement.scrollWidth <= innerWidth + 1
    );
    assert.ok(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
        )
    );
    await page.screenshot({
        path: `${output}/review-mobile.png`,
        fullPage: true,
    });
    await page.evaluate(() => {
        window.__metadataUser.value = null;
    });
    await page.getByText('로그인 후 관리자 권한을 확인해 주세요.').waitFor();
    assert.equal(await page.locator('.review-layout').count(), 0);
    assert.equal(gets, 2);
    // Public explorer reuses index/insight cache and does no authenticated account lookup.
    let quotes = 0,
        shards = 0,
        active = 0,
        maxActive = 0;
    await page.route('**/api/stock-prices?*', async (route) => {
        quotes++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        const symbol = new URL(route.request().url()).searchParams.get(
            'ticker'
        );
        return route.fulfill({
            json: {
                symbol,
                currency: 'USD',
                events: [],
                candles: [
                    { date: '2026-10-01', close: 10 },
                    { date: '2026-10-02', close: 12 },
                    { date: '2026-10-03', close: 9 },
                ],
            },
        });
    });
    await page.route('**/security-insights/*.json', async (route) => {
        shards++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return route.fulfill({
            json: {
                securities: Object.fromEntries(
                    ['AAPB', 'AAPD', 'AAPU', 'AAPW', 'AAPY', 'APLY'].map(
                        (symbol) => [
                            symbol,
                            {
                                performance: {
                                    totalReturn1Y: {
                                        value: 10,
                                        status: 'provider_adjusted_estimate',
                                        asOfDate: '2026-10-03',
                                        actualStartDate: '2025-10-03',
                                    },
                                },
                                fund: {
                                    expenseRatio: {
                                        value: 0.99,
                                        status: 'available',
                                        asOfDate: null,
                                    },
                                },
                            },
                        ]
                    )
                ),
            },
        });
    });
    await page.goto('http://127.0.0.1:5173/underlying/AAPL');
    await page.getByRole('heading', { name: 'AAPL 기반 · 6개' }).waitFor();
    assert.equal(quotes, 0);
    assert.equal(shards, 0);
    await page
        .getByRole('button', { name: '수익률·수수료·가격 하락 조회' })
        .click();
    await page
        .locator('.product-grid article small')
        .filter({ hasText: '제공처 조정 종가 추정' })
        .first()
        .waitFor();
    assert.equal(quotes, 6);
    assert.ok(maxActive <= 4, `network concurrency ${maxActive}`);
    const previous = { quotes, shards };
    await page
        .getByRole('button', { name: '수익률·수수료·가격 하락 조회' })
        .click();
    await page.waitForFunction(
        () => !document.querySelector('button .p-button-loading-icon')
    );
    assert.deepEqual({ quotes, shards }, previous);
    await page.getByLabel('방향', { exact: true }).click();
    await page.getByRole('option', { name: '인버스', exact: true }).click();
    await page.getByRole('heading', { name: 'AAPL 기반 · 1개' }).waitFor();
    assert.equal(await page.locator('.product-grid article').count(), 1);
    await page.screenshot({
        path: `${output}/explorer-mobile.png`,
        fullPage: true,
    });
    assert.ok(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
        )
    );
    await page.getByRole('button', { name: /다크 모드/ }).click();
    await page
        .locator('.p-dark.underlying-explorer, .p-dark .underlying-explorer')
        .waitFor();
    await page.screenshot({
        path: `${output}/explorer-dark-mobile.png`,
        animations: 'disabled',
        fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
        `PASS: admin review save/history/logout; GET ${gets}, POST ${posts}; public explorer six quotes, repeat requests zero, concurrency <=4, mobile layout`
    );
} finally {
    await browser.close();
}
