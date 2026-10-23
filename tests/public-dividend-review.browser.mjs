import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { PORTFOLIO_ADMIN_EMAILS } from '../lib/portfolio-admin.js';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [
    {
        date: '2026-10-13',
        close: 40,
        amount: 0.1606,
        amountFixed: 0.1606,
        verificationStatus: 'needs_review',
        payableDate: '2026-10-15',
        officialUrl: 'https://issuer.example/distributions',
    },
    {
        date: '2026-10-15',
        close: 40,
        amount: 0.157,
        amountFixed: 0.157,
        verificationStatus: 'needs_review',
        payableDate: '2026-10-17',
        officialUrl: 'javascript:alert(1)',
    },
];
try {
    for (const [role, width] of [
        ['anonymous', 1440],
        ['member', 390],
        ['unverified-admin', 390],
        ['admin', 1440],
        ['admin', 390],
    ]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
            acceptDownloads: true,
        });
        const user =
            role === 'anonymous'
                ? null
                : {
                      uid: 'review-fixture',
                      email:
                          role === 'member'
                              ? 'member@example.test'
                              : PORTFOLIO_ADMIN_EMAILS[0],
                      emailVerified: role !== 'unverified-admin',
                  };
        await page.route('**/src/services/firebaseClient*', (route) =>
            route.fulfill({
                contentType: 'text/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref(${JSON.stringify(user)}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),firebaseReady=false,auth=null,db=null,googleProvider=null; window.__dividendReviewUser=firebaseUser;`,
            })
        );
        let reads = 0;
        await page.route('**/api/thumbnail-data?**', (route) => {
            reads++;
            return route.fulfill({
                json: {
                    ticker: {
                        symbol: 'QLDY',
                        tickerInfo: {
                            symbol: 'QLDY',
                            price: 40,
                            currency: 'USD',
                        },
                        sourceStatus: {
                            freshness: 'fresh',
                            priceDate: '2026-10-16',
                            dividends: 'official_projection',
                            dividendReviewCount: 2,
                        },
                        backtestData: rows,
                    },
                    catalog: { symbol: 'QLDY', securityType: 'etf' },
                    rivals: [],
                    rivalOptions: [],
                    series: {},
                    dataStatus: 'fresh',
                },
            });
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${base}/stock/QLDY?tab=share`);
        await page.locator('.summary-card .hero strong').waitFor();
        assert.match(
            await page.locator('.summary-card .hero strong').innerText(),
            /0\.157/
        );
        assert.equal(
            await page.locator('.summary-card .unavailable').count(),
            0
        );
        assert.equal(
            await page
                .locator('.thumbnail-preview-artboard .dividend-review-prompt')
                .count(),
            0
        );
        if (role === 'admin') {
            await page
                .getByRole('button', { name: '배당 검증하기', exact: true })
                .click();
            const dialog = page.getByRole('dialog', {
                name: 'QLDY 배당 검증',
                exact: true,
            });
            await dialog.waitFor();
            assert.equal(await dialog.locator('tbody tr').count(), 2);
            assert.equal(
                await dialog.getByRole('link', { name: '원문 대조' }).count(),
                1
            );
            assert.equal(
                await dialog
                    .getByRole('link', { name: '원문 대조' })
                    .getAttribute('href'),
                'https://issuer.example/distributions'
            );
            await page.evaluate(() =>
                document.documentElement.classList.add('p-dark')
            );
            await dialog.screenshot({
                path: `/tmp/dividend-review-admin-${width}.png`,
            });
            const downloadPromise = page.waitForEvent('download');
            await dialog
                .getByRole('button', {
                    name: '검토 자료 다운로드',
                    exact: true,
                })
                .click();
            const download = await downloadPromise;
            assert.equal(
                download.suggestedFilename(),
                'QLDY-dividend-review.json'
            );
            await page.evaluate(() => {
                window.__dividendReviewUser.value = null;
            });
            await dialog.waitFor({ state: 'hidden' });
            assert.equal(
                await page
                    .getByRole('button', { name: '배당 검증하기', exact: true })
                    .count(),
                0
            );
        } else {
            assert.equal(
                await page
                    .getByRole('button', { name: '배당 검증하기', exact: true })
                    .count(),
                0
            );
            assert.equal(
                await page.locator('.dividend-review-prompt').count(),
                0
            );
        }
        assert.equal(reads, 1);
        assert(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            )
        );
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${role} ${width}: public review payment, admin boundary, no extra quote requests`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
