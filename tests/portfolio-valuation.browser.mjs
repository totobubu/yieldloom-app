import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    const errors = [],
        requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Never send synthetic credentials or account requests to a deployed service.
    await page.route('**/*', (route) => {
        const host = new URL(route.request().url()).hostname;
        return host === '127.0.0.1' || host === 'localhost'
            ? route.continue()
            : route.abort();
    });
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'valuation-user',email:'fixture@example.test',getIdToken:async()=>'fixture-token'}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),auth={},googleProvider={},firebaseReady=true,db=null;window.__valuationUser=firebaseUser;`,
        })
    );
    const today = new Date().toISOString().slice(0, 10);
    const family = {
        id: 'f',
        name: '합성 가족',
        kind: 'personal',
        adminUid: 'valuation-user',
        profiles: {
            p: { uid: 'valuation-user', name: '나' },
            q: { uid: 'other', name: '가족' },
        },
    };
    const account = (id, ownerId, symbol, amount = 100) => ({
        id,
        alias: `테스트 ${id}`,
        ownerId,
        authorityUid: 'other',
        permissions: { 'valuation-user': 'viewer' },
        entriesRevision: 1,
        snapshot: {
            asOf: today,
            source: 'fixture',
            rows: [{ symbol, quantity: 2, amount, currency: 'USD' }],
        },
    });
    let accounts = [
        account('a', 'p', 'AAPL'),
        account('b', 'p', 'FAIL'),
        account('c', 'q', 'OTHER'),
    ];
    await page.route('**/api/family-portfolio?*', (route) =>
        route.fulfill({
            json: {
                families: [family],
                accounts,
                summary: {
                    positions: accounts.flatMap((a) =>
                        a.snapshot
                            ? a.snapshot.rows.map((row) => ({
                                  ...row,
                                  accountId: a.id,
                                  ownerId: a.ownerId,
                                  asOf: a.snapshot.asOf,
                              }))
                            : []
                    ),
                    notice: '합성 잔고',
                    knownValueByCurrency: { USD: 300 },
                    missingSnapshotAccounts: [],
                    valueComplete: true,
                },
            },
        })
    );
    let fail = true,
        slow = false,
        release,
        slowStarted;
    await page.route('**/api/stock-prices?*', async (route) => {
        const request = route.request();
        requests.push(request.url());
        assert.equal(request.headers().authorization, undefined);
        const ticker = new URL(request.url()).searchParams.get('ticker');
        if (slow)
            await new Promise((resolve) => {
                release = resolve;
                slowStarted?.();
            });
        await route
            .fulfill(
                fail && ticker === 'FAIL'
                    ? { status: 503, json: { error: 'fixture unavailable' } }
                    : {
                          json: {
                              symbol: ticker,
                              currency: 'USD',
                              source: '합성 시세',
                              candles: [
                                  {
                                      date: today,
                                      close: ticker === 'OTHER' ? 90 : 60,
                                  },
                              ],
                              events: [],
                          },
                      }
            )
            .catch(() => {});
    });
    await page.goto('http://127.0.0.1:5173/mypage');
    const section = page.getByRole('region', {
        name: '최근 종가 기준 평가',
        exact: true,
    });
    await section.getByText('120 USD', { exact: true }).waitFor();
    await section
        .getByText('시세 조회 실패 · 다시 시도해 주세요', { exact: true })
        .waitFor();
    await section
        .getByText('1 / 2개 보유 항목 평가 · 일부 합계', { exact: true })
        .waitFor();
    assert.ok(
        requests.every((url) => !/account|quantity|valuation-user/.test(url))
    );
    fail = false;
    await section.getByRole('button', { name: '시세 다시 조회' }).click();
    await section.getByText('240 USD', { exact: true }).waitFor();
    await page
        .getByRole('button', { name: '가족 포트폴리오', exact: true })
        .click();
    await section.getByText('420 USD', { exact: true }).waitFor();
    await page.getByRole('button', { name: '내 계좌', exact: true }).click();
    await section.getByText('240 USD', { exact: true }).waitFor();
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `overflow at ${width}`
        );
    }
    await page.getByRole('button', { name: '다크 모드', exact: true }).click();
    assert.ok(
        await page
            .locator('html')
            .evaluate((node) => node.classList.contains('p-dark'))
    );
    await section.screenshot({ path: '/tmp/portfolio-valuation-dark.png' });
    await page
        .getByRole('button', { name: '라이트 모드', exact: true })
        .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await section.screenshot({ path: '/tmp/portfolio-valuation-light.png' });
    // Empty and missing snapshot states must not imply a zero balance.
    accounts = [{ ...accounts[0], snapshot: null }];
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await section
        .getByText('평가할 잔고 자료가 없습니다.', { exact: false })
        .waitFor();
    await section
        .getByText('잔고 자료가 없는 계좌 1개는 평가에서 제외했습니다.', {
            exact: true,
        })
        .waitFor();
    accounts = [account('a', 'p', 'AAPL')];
    slow = true;
    const started = new Promise((resolve) => {
        slowStarted = resolve;
    });
    await page.getByRole('button', { name: '새로고침', exact: true }).click();
    await section.getByRole('status').waitFor();
    await started;
    await page.waitForFunction(
        () =>
            document.querySelector('.valuation')?.getAttribute('aria-busy') ===
            'true'
    );
    await page.evaluate(() => {
        window.__valuationUser.value = null;
    });
    release?.();
    await page.waitForURL(/\/login/);
    assert.equal(await page.locator('.valuation').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: partial valuation, retry, scope isolation, 4 viewport widths, light/dark, empty/missing snapshots, logout race'
    );
} finally {
    await browser.close();
}
