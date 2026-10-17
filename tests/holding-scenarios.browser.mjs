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
    await page.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(
            new URL(route.request().url()).hostname
        )
            ? route.continue()
            : route.abort()
    );
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'insights-user',email:'fixture@example.test',getIdToken:async()=>'fixture-token'}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),auth={},googleProvider={},firebaseReady=true,db=null;window.__insightsUser=firebaseUser;`,
        })
    );
    const now = new Date();
    now.setUTCDate(1);
    now.setUTCMonth(now.getUTCMonth() - 1);
    const month = now.toISOString().slice(0, 7),
        year = Number(month.slice(0, 4));
    const previous = `${year - 1}${month.slice(4)}`;
    const family = {
        id: 'f',
        name: '합성 가족',
        kind: 'personal',
        adminUid: 'insights-user',
        profiles: {
            p: { uid: 'insights-user', name: '나' },
            q: { uid: 'other', name: '가족' },
        },
    };
    const account = (id, ownerId, symbol) => ({
        id,
        alias: `계좌 ${id}`,
        ownerId,
        authorityUid: 'other',
        permissions: { 'insights-user': 'viewer' },
        entriesRevision: 1,
        snapshot: {
            asOf: `${month}-01`,
            source: 'fixture',
            rows: [{ symbol, quantity: 10, amount: 100, currency: 'USD' }],
        },
    });
    const accounts = [
        account('a', 'p', 'TSLY'),
        account('b', 'p', 'APLY'),
        account('c', 'q', 'CRSH'),
    ];
    const entry = (id, symbol, amount, prefix = month, type = 'dividend') => ({
        id,
        row: { symbol, amount, date: `${prefix}-10`, currency: 'USD', type },
    });
    const ledgers = {
        a: [
            entry('1', 'TSLY', 20),
            entry('2', 'TSLY', 5, month, 'dividend_reversal'),
            entry('3', 'APLY', 10),
            entry('4', 'TSLY', 20, previous),
        ],
        b: [entry('1', 'TSLY', 40), entry('2', 'TSLY', 20, previous)],
        c: [entry('1', 'CRSH', 50)],
    };
    let failLedger = false,
        failMetadata = false,
        mutate = false,
        overviewCount = 0;
    await page.route('**/api/family-portfolio?*', async (route) => {
        const url = new URL(route.request().url());
        requests.push(url.search);
        const id = url.searchParams.get('accountId');
        if (id) {
            if (failLedger)
                return route.fulfill({
                    status: 503,
                    json: { error: '합성 원장 조회 실패' },
                });
            const cursor = url.searchParams.get('cursor');
            return route
                .fulfill({
                    json:
                        id === 'a'
                            ? {
                                  entries: cursor
                                      ? ledgers.a.slice(2)
                                      : ledgers.a.slice(0, 2),
                                  nextCursor: cursor ? null : 'page-2',
                              }
                            : { entries: ledgers[id], nextCursor: null },
                })
                .catch(() => {});
        }
        overviewCount++;
        return route.fulfill({
            json: {
                families: [family],
                accounts: accounts.map((a) => ({
                    ...a,
                    entriesRevision: mutate ? overviewCount : 1,
                })),
                summary: {
                    positions: accounts.flatMap((a) =>
                        a.snapshot.rows.map((row) => ({
                            ...row,
                            accountId: a.id,
                            ownerId: a.ownerId,
                            asOf: a.snapshot.asOf,
                        }))
                    ),
                    notice: '합성 잔고',
                    knownValueByCurrency: { USD: 300 },
                    missingSnapshotAccounts: [],
                    valueComplete: true,
                },
            },
        });
    });
    await page.route('**/api/portfolio-capital?*', (route) => {
        const id = new URL(route.request().url()).searchParams.get('accountId');
        const entries =
            id === 'a'
                ? [
                      {
                          id: 'deposit',
                          date: `${month}-01`,
                          currency: 'USD',
                          amount: 1000,
                      },
                      {
                          id: 'withdrawal',
                          date: `${month}-25`,
                          currency: 'USD',
                          amount: 200,
                      },
                  ]
                : [];
        const classifications =
            id === 'a'
                ? [
                      { id: 'deposit', classification: 'external_deposit' },
                      {
                          id: 'withdrawal',
                          classification: 'external_withdrawal',
                      },
                  ]
                : [];
        const trades =
            id === 'a'
                ? [
                      {
                          id: 'buy',
                          date: `${month}-02`,
                          currency: 'USD',
                          symbol: 'TSLY',
                          type: 'buy',
                          nativeAmount: 800,
                          nativeSettlementAmount: 800,
                          quantity: 10,
                      },
                      {
                          id: 'dividend',
                          date: `${month}-10`,
                          currency: 'USD',
                          symbol: 'TSLY',
                          type: 'dividend',
                          nativeAmount: 100,
                          nativeSettlementAmount: 100,
                      },
                  ]
                : [];
        return route.fulfill({
            json: { entries, classifications, trades, allocations: [] },
        });
    });
    await page.route('**/portfolio-classifications.json', (route) =>
        route.fulfill(
            failMetadata
                ? { status: 503, json: {} }
                : {
                      json: {
                          schemaVersion: 1,
                          securities: {
                              TSLY: {
                                  provider: 'YieldMax',
                                  underlying: 'TSLA',
                              },
                              CRSH: {
                                  provider: 'YieldMax',
                                  underlying: 'TSLA',
                              },
                              APLY: {
                                  provider: 'YieldMax',
                                  underlying: 'AAPL',
                              },
                          },
                      },
                  }
        )
    );
    await page.goto('http://127.0.0.1:5173/mypage?tab=insights');
    const section = page.getByRole('region', { name: '배당 성과·집중도 분석' });
    await section.getByLabel('분석 월', { exact: true }).fill(month);
    await section
        .locator('.insights-summary')
        .getByText('65 USD', { exact: true })
        .first()
        .waitFor();
    const before = requests.length;
    const model = section.locator('.holding-scenarios');
    await model.locator('summary').click();
    await model.getByLabel('연간 주당 배당금 가정 (세전)').first().fill('1.2');
    await model.getByLabel('연간 주당 배당금 가정 (세전)').nth(1).fill('1.2');
    await model
        .getByRole('button', { name: '선택 종목 가정 비교', exact: true })
        .click();
    await model
        .getByRole('region', { name: '보유 종목 시뮬레이션 결과' })
        .waitFor();
    assert.equal(
        requests.length,
        before,
        'scenario uses already loaded ledger without requests'
    );
    await model.getByLabel('배당 감소율 (%)').fill('50');
    await model.getByLabel('배당 감소율 (%)').press('Tab');
    assert.equal(
        await model
            .getByRole('region', { name: '보유 종목 시뮬레이션 결과' })
            .count(),
        0,
        'edited assumptions invalidate results'
    );
    await model
        .getByRole('button', { name: '선택 종목 가정 비교', exact: true })
        .click();
    await model.getByText('배당 50% 감소 후 재투자', { exact: true }).waitFor();
    assert.equal(requests.length, before);
    await page.setViewportSize({ width: 390, height: 1000 });
    await model.scrollIntoViewIfNeeded();
    assert.ok(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        'mobile overflow'
    );
    await page.screenshot({
        path: '/tmp/yieldloom-enhancements/holding-mobile.png',
        fullPage: true,
    });
    await page.evaluate(() => {
        window.__insightsUser.value = null;
    });
    await page.waitForTimeout(100);
    assert.equal(
        await page
            .locator(
                '.holding-scenarios [aria-label="보유 종목 시뮬레이션 결과"]'
            )
            .count(),
        0,
        'logout removes results'
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: holding scenarios with existing account/ledger, explicit assumptions, reduction, invalidation, logout; additional ledger requests: 0'
    );
} finally {
    await browser.close();
}
