import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { summarizePortfolio } from '../src/services/portfolioSummary.js';

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/src/services/firebaseClient.js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';
            export const firebaseUser=ref({uid:'A',getIdToken:async()=> 'fixture-token'}),
                authLoading=ref(false),firebaseReady=false,db=null,auth=null;
            export const signedIn=computed(()=>Boolean(firebaseUser.value));`,
        })
    );
    await page.route('**/src/services/portfolio.js*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `window.__pendingPortfolios={};
            export const loadPortfolioDashboard=uid=>new Promise(resolve=>{window.__pendingPortfolios[uid]=resolve});`,
        })
    );
    await page.route('**/api/portfolio-capital*', (route) =>
        route.fulfill({
            json: { entries: [], classifications: [], allocations: [] },
        })
    );
    await page.goto('http://127.0.0.1:5173/mypage/legacy');
    await page.waitForFunction(() => Boolean(window.__pendingPortfolios?.A));
    await page.evaluate(async () => {
        const { firebaseUser } = await import(
            '/src/services/firebaseClient.js'
        );
        firebaseUser.value = {
            uid: 'B',
            getIdToken: async () => 'fixture-token',
        };
    });
    await page.waitForFunction(() => Boolean(window.__pendingPortfolios?.B));
    const data = (symbol) =>
        summarizePortfolio([
            {
                id: symbol,
                symbol,
                portfolioPriority: 'current',
                holdingShares: 1,
                transactions: [],
            },
        ]);
    await page.evaluate(
        (result) => window.__pendingPortfolios.B(result),
        data('B_SAFE')
    );
    await page.getByRole('heading', { name: 'B_SAFE', exact: true }).waitFor();
    await page.evaluate(
        (result) => window.__pendingPortfolios.A(result),
        data('A_PRIVATE')
    );
    // A subsequent render must retain the latest identity's data.
    await page
        .locator('.asset-card')
        .filter({
            has: page.getByRole('heading', { name: 'B_SAFE', exact: true }),
        })
        .getByRole('button', { name: '거래 상세', exact: true })
        .click();
    assert.equal(await page.getByText('A_PRIVATE', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: legacy view retains B after delayed A response; private data is not restored'
    );
} finally {
    await browser.close();
}
