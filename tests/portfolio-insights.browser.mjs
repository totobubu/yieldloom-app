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
        overviewCount = 0,
        slow = false,
        release,
        notifyStarted;
    await page.route('**/api/family-portfolio?*', async (route) => {
        const url = new URL(route.request().url());
        requests.push(url.search);
        const id = url.searchParams.get('accountId');
        if (id) {
            if (slow)
                await new Promise((resolve) => {
                    release = resolve;
                    notifyStarted?.();
                });
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
    const summary = section.locator('.insights-summary');
    await summary.getByText('65 USD', { exact: true }).first().waitFor();
    await summary.getByText('62.5%', { exact: true }).waitFor();
    assert.ok(requests.some((url) => url.includes('cursor=page-2')));
    assert.ok(!requests.some((url) => url.includes('accountId=c')));
    await section
        .getByLabel('USD 목표 금액', { exact: true })
        .pressSequentially('100');
    await section.getByLabel('USD 목표 금액', { exact: true }).press('Tab');
    await section
        .getByText('선택 월의 기록 기준 달성률 65%', { exact: true })
        .waitFor();
    await section
        .getByText('감소액 11 USD · 적용 후 54 USD', { exact: true })
        .waitFor();
    await section
        .getByRole('button', { name: '연결 기초자산', exact: true })
        .click();
    const assetTable = section.getByRole('table', { name: '자산 집중도 내역' });
    await assetTable.getByText('TSLA', { exact: true }).waitFor();
    await section.getByRole('button', { name: '운용사', exact: true }).click();
    await assetTable.getByText('YieldMax', { exact: true }).waitFor();
    await section.getByLabel('계좌', { exact: true }).click();
    await page.getByRole('option', { name: '계좌 a', exact: true }).click();
    await summary.getByText('25 USD', { exact: true }).first().waitFor();
    assert.equal(
        await section.getByLabel('USD 목표 금액', { exact: true }).inputValue(),
        ''
    );
    await page
        .getByRole('button', { name: '가족 포트폴리오', exact: true })
        .click();
    await section.getByLabel('분석 월', { exact: true }).fill(month);
    await summary.getByText('115 USD', { exact: true }).first().waitFor();
    await section
        .getByRole('button', { name: '연결 기초자산', exact: true })
        .click();
    await assetTable
        .getByRole('row')
        .filter({ hasText: 'TSLA' })
        .getByText('200', { exact: true })
        .waitFor();
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `overflow ${width}`
        );
    }
    await page.getByRole('button', { name: '다크 모드', exact: true }).click();
    await section.screenshot({ path: '/tmp/portfolio-insights-dark.png' });
    await page
        .getByRole('button', { name: '라이트 모드', exact: true })
        .click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await section.screenshot({ path: '/tmp/portfolio-insights-light.png' });
    failLedger = true;
    await section.getByRole('button', { name: '분석 다시 조회' }).click();
    await section.getByText('합성 원장 조회 실패', { exact: true }).waitFor();
    assert.equal(await summary.count(), 0);
    failLedger = false;
    failMetadata = true;
    await section.getByRole('button', { name: '분석 다시 조회' }).click();
    await summary.getByText('115 USD', { exact: true }).first().waitFor();
    await section
        .getByText('분류 자료를 불러오지 못했습니다.', { exact: false })
        .waitFor();
    await assetTable.getByText('미분류 · TSLY', { exact: true }).waitFor();
    mutate = true;
    failMetadata = false;
    await section.getByRole('button', { name: '분석 다시 조회' }).click();
    await section
        .getByText('조회 중 계좌 권한 또는 거래 목록이 변경되었습니다.', {
            exact: false,
        })
        .waitFor();
    assert.equal(await summary.count(), 0);
    mutate = false;
    slow = true;
    const started = new Promise((resolve) => {
        notifyStarted = resolve;
    });
    await section.getByRole('button', { name: '분석 다시 조회' }).click();
    await started;
    await page.evaluate(() => {
        window.__insightsUser.value = null;
    });
    release?.();
    await page.waitForURL(/\/login/);
    assert.equal(await page.locator('.insights').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: pagination, reversals, monthly/yearly records, goals/scenario, account/family isolation, metadata fallback, revision change, error/retry, 4 widths, dark/light, logout race'
    );
} finally {
    await browser.close();
}
