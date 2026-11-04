import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const out = '/tmp/yieldloom-expansion-calendar';
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    const errors = [],
        requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error' && msg.text().includes('Error captured')) {
            console.log('browser error:', msg.text());
            errors.push(msg.text());
        }
    });
    await page.route('**/lib/portfolio-admin.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: 'export function isPortfolioAdmin(user) { return !!user; }',
        })
    );
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'calendar-user',email:'calendar@example.test',getIdToken:async()=>'fixture-token'}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),auth={},googleProvider={},firebaseReady=true,db=null;window.__calendarUser=firebaseUser;`,
        })
    );
    const year = new Date().getUTCFullYear(),
        month = String(new Date().getUTCMonth() + 1).padStart(2, '0'),
        prefix = `${year}-${month}`;
    const family = {
        id: 'f',
        name: '테스트 가족',
        kind: 'personal',
        adminUid: 'calendar-user',
        profiles: {
            p: { uid: 'calendar-user', name: '나' },
            q: { uid: 'shared-user', name: '가족' },
        },
    };
    const account = (id, owner, asOf, symbol = 'TSLY') => ({
        id,
        alias: `계좌 ${id}`,
        ownerId: owner,
        authorityUid: 'other-user',
        permissions: { 'calendar-user': 'viewer' },
        entriesRevision: 1,
        snapshot: {
            asOf,
            source: 'fixture',
            rows: [{ symbol, quantity: 10, currency: 'USD', amount: 100 }],
        },
    });
    let accounts = [
        account('a', 'p', `${prefix}-01`),
        account('b', 'p', `${prefix}-02`, 'UNSUPPORTED'),
        account('c', 'q', `${prefix}-03`),
    ];
    const overview = () => ({
        families: [family],
        accounts,
        summary: {
            positions: accounts.flatMap((a) =>
                a.snapshot.rows.map((row) => ({
                    ...row,
                    accountId: a.id,
                    ownerId: a.ownerId,
                    asOf: a.snapshot.asOf,
                }))
            ),
            knownValueByCurrency: { USD: 300 },
            missingSnapshotAccounts: [],
            valueComplete: true,
        },
    });
    let failIndex = false,
        denyLedger = false;
    let slow = false,
        release;
    await page.route('**/api/family-portfolio?*', async (r) => {
        const url = new URL(r.request().url()),
            id = url.searchParams.get('accountId');
        requests.push(url.search);
        if (id) {
            if (denyLedger)
                return r.fulfill({
                    status: 403,
                    json: { error: '계좌 조회 권한이 변경되었습니다.' },
                });
            if (slow) await new Promise((resolve) => (release = resolve));
            return r.fulfill({
                json: {
                    entries: [
                        {
                            id: `${id}-1`,
                            asOf: `${prefix}-16`,
                            row: {
                                type: 'dividend',
                                date: `${prefix}-10`,
                                symbol: 'TSLY',
                                currency: 'USD',
                                amount: 10,
                            },
                        },
                        {
                            id: `${id}-2`,
                            row: {
                                type: 'dividend_reversal',
                                date: `${prefix}-11`,
                                symbol: 'TSLY',
                                currency: 'USD',
                                amount: 2,
                            },
                        },
                    ],
                    nextCursor: null,
                },
            });
        }
        return r.fulfill({ json: overview() });
    });
    await page.route('**/api/portfolio-capital*', (r) =>
        r.fulfill({
            json: { entries: [], classifications: [], allocations: [] },
        })
    );
    await page.route('**/distribution-index.json', (r) =>
        failIndex
            ? r.fulfill({ status: 503, json: { error: 'unavailable' } })
            : r.fulfill({
                  json: {
                      tickers: [
                          {
                              ticker: 'TSLY',
                              historyUrl:
                                  '/content-studio/distribution-ticker-tsly.json',
                          },
                      ],
                  },
              })
    );
    await page.route('**/distribution-ticker-tsly.json', (r) =>
        r.fulfill({
            json: {
                history: [
                    {
                        id: 1,
                        ticker: 'TSLY',
                        ex_date: `${prefix}-25`,
                        payable_date: `${prefix}-28`,
                        distribution_per_share: 0.2,
                        currency: 'USD',
                        verification_status: 'official',
                        official_url: 'https://example.test/source',
                    },
                    {
                        id: 2,
                        ticker: 'TSLY',
                        ex_date: `${prefix}-05`,
                        payable_date: `${prefix}-08`,
                        distribution_per_share: 0.3,
                        currency: 'USD',
                        verification_status: 'official',
                    },
                ],
            },
        })
    );
    let browserAlerts = 0,
        permissionRequests = 0;
    await page.exposeFunction('__unexpectedAlert', () => browserAlerts++);
    await page.exposeFunction(
        '__unexpectedPermission',
        () => permissionRequests++
    );
    await page.addInitScript(() => {
        window.Notification = class {
            static permission = 'granted';
            static requestPermission() {
                window.__unexpectedPermission();
                return Promise.resolve('granted');
            }
            constructor() {
                window.__unexpectedAlert();
            }
        };
    });
    const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5173';
    await page.goto(`${base}/mypage?tab=settings&view=capital`);
    await page.waitForURL('**/mypage?tab=overview&view=capital');
    await page.getByRole('tab', { name: '한눈에 보기', exact: true }).waitFor();
    assert.equal(
        await page.getByRole('tab', { name: '설정', exact: true }).count(),
        0
    );
    await page.reload();
    await page.getByRole('tab', { name: '배당 캘린더', exact: true }).click();
    const calendar = page.getByRole('region', { name: '개인 배당 캘린더' });
    await calendar.waitFor();
    await page
        .getByRole('combobox', { name: '배당 통화 필터', exact: true })
        .getByText('모든 통화', { exact: true })
        .waitFor();
    await page
        .getByText('일정을 확인하지 못한 종목 1개', { exact: true })
        .waitFor();
    await calendar.getByText(/계좌별 기준일이 다릅니다/).waitFor();
    await calendar.getByText('2 USD', { exact: true }).first().waitFor();
    const initialLedgerReads = requests.filter((q) =>
        q.includes('accountId=')
    ).length;
    assert.equal(
        initialLedgerReads,
        accounts.length,
        'schedule view reads each ledger once to reconstruct historical holdings'
    );
    assert.equal(
        await calendar.getByText('캘린더 일정·알림 내보내기').count(),
        1
    );
    const calendarExport = calendar.getByRole('region', {
        name: '캘린더 일정·알림 내보내기',
    });
    await calendarExport.getByRole('checkbox').check();
    const downloaded = page.waitForEvent('download');
    await calendarExport
        .getByRole('button', { name: '배당 일정 ICS 다운로드' })
        .click();
    const download = await downloaded;
    const file = await fs.readFile(await download.path(), 'utf8');
    assert.match(file, /BEGIN:VCALENDAR/);
    assert.match(file, /BEGIN:VALARM/);
    assert.ok(!file.includes('계좌 a'));
    await page
        .getByRole('button', {
            name: `${prefix}-28 배당 일정 2건`,
            exact: true,
        })
        .click();
    const dialog = page.getByRole('dialog');
    await dialog
        .getByText('공시 원문 확인', { exact: false })
        .first()
        .waitFor();
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '연간', exact: true }).click();
    assert.equal(await page.locator('.year-month').count(), 12);
    await page
        .locator('.year-month')
        .nth(Number(month) - 1)
        .click();
    await page
        .getByRole('button', { name: '저장된 배당 거래', exact: true })
        .click();
    await calendar.getByText('24 USD', { exact: true }).waitFor();
    assert.equal(await page.locator('.month-events .event-row').count(), 6);
    assert.equal(
        requests.filter((q) => q.includes('accountId=')).length,
        initialLedgerReads,
        'recorded view reuses the verified session ledger cache'
    );
    await page
        .getByRole('combobox', { name: '배당 계좌 필터', exact: true })
        .click();
    await page.getByRole('option', { name: '계좌 a', exact: true }).click();
    await calendar.getByText('8 USD', { exact: true }).waitFor();
    await page
        .getByRole('button', { name: '공시 일정·예상', exact: true })
        .click();
    await page
        .getByRole('combobox', { name: '배당 일정 날짜 기준', exact: true })
        .click();
    await page.getByRole('option', { name: '배당락일', exact: true }).click();
    await page
        .getByRole('combobox', { name: '배당 계좌 필터', exact: true })
        .click();
    await page.getByRole('option', { name: '모든 계좌', exact: true }).click();
    await page.getByRole('tab', { name: '한눈에 보기', exact: true }).click();
    await page.getByRole('tab', { name: '배당 캘린더', exact: true }).click();
    await calendar.getByText(/계좌별 기준일이 다릅니다/).waitFor();
    assert.equal(
        requests.filter((q) =>
            /view=preferences|action=savePreferences/.test(q)
        ).length,
        0
    );
    assert.equal(
        await page
            .getByRole('region', { name: '자동 배당 알림', exact: true })
            .count(),
        0
    );
    assert.equal(
        await page
            .getByRole('status', { name: '다가오는 배당 알림', exact: true })
            .count(),
        0
    );
    assert.equal(browserAlerts, 0);
    assert.equal(permissionRequests, 0);
    // Wait for the closed Select overlay to leave before resizing the viewport.
    await page.waitForFunction(
        () => !document.querySelector('.p-select-overlay')
    );
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        // Let the responsive layout settle before measuring overflow.
        await page.evaluate(
            () =>
                new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                )
        );
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `overflow ${width}`
        );
        await page.evaluate(() => {
            document.activeElement?.blur();
            window.scrollTo(0, 0);
        });
        await page.screenshot({ path: `${out}/${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '다크 모드', exact: true }).click();
    await page.screenshot({ path: `${out}/360-dark.png`, fullPage: true });
    failIndex = true;
    await page
        .getByRole('button', { name: '일정·거래 새로고침', exact: true })
        .click();
    await page
        .getByText('배당 일정 목록을 불러오지 못했습니다.', { exact: false })
        .waitFor();
    failIndex = false;
    await page
        .getByRole('button', { name: '배당 자료 다시 시도', exact: true })
        .click();
    await calendar
        .getByText('일정을 확인하지 못한 종목 1개', { exact: true })
        .waitFor();
    denyLedger = true;
    await page
        .getByRole('button', { name: '저장된 배당 거래', exact: true })
        .click();
    await page
        .getByRole('button', { name: '일정·거래 새로고침', exact: true })
        .click();
    await calendar
        .getByText('계좌 조회 권한이 변경되었습니다.', { exact: false })
        .waitFor();
    assert.equal(await page.locator('.event-row').count(), 0);
    denyLedger = false;
    await page
        .getByRole('button', { name: '배당 자료 다시 시도', exact: true })
        .click();
    await calendar.getByText('24 USD', { exact: true }).waitFor();
    await page.reload();
    await calendar.waitFor();
    assert.match(page.url(), /tab=calendar/);
    await page.waitForFunction(
        () =>
            !document.querySelector('button[aria-label="일정·거래 새로고침"]')
                ?.disabled
    );
    slow = true;
    await page
        .getByRole('button', { name: '일정·거래 새로고침', exact: true })
        .click();
    await page.waitForFunction(() =>
        document.body.textContent.includes('배당 자료를 확인하고 있습니다.')
    );
    await page.evaluate(() => (window.__calendarUser.value = null));
    if (release) release();
    await page.waitForURL(/\/admin\/login/);
    assert.equal(await page.locator('.event-row').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: private calendar, monthly/yearly, unknown history, account/date filters, read-only ledgers, 4 viewports, dark, reload and logout race'
    );
} finally {
    await browser.close();
}
