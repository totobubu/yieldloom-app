import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const out = 'design-review/portfolio-calendar';
await fs.mkdir(out, { recursive: true });
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
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (msg) => {
        if (msg.type() === 'error' && msg.text().includes('Error captured')) {
            console.log('browser error:', msg.text());
            errors.push(msg.text());
        }
    });
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
    await page.goto('http://127.0.0.1:5173/mypage?tab=calendar');
    const calendar = page.getByRole('region', { name: '개인 배당 캘린더' });
    await calendar.waitFor();
    await page
        .getByText('일정을 확인하지 못한 종목 1개', { exact: true })
        .waitFor();
    await calendar.getByText(/계좌별 기준일이 다릅니다/).waitFor();
    await calendar.getByText('2 USD', { exact: true }).first().waitFor();
    assert.equal(
        requests.filter((q) => q.includes('accountId=')).length,
        0,
        'schedule view must not load private transaction history'
    );
    await page
        .getByRole('button', {
            name: `${prefix}-28 배당 일정 1건`,
            exact: true,
        })
        .click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('공시 원문 확인', { exact: false }).waitFor();
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
    await calendar.getByText('16 USD', { exact: true }).waitFor();
    assert.equal(await page.locator('.month-events .event-row').count(), 4);
    assert.ok(requests.filter((q) => q.includes('accountId=')).length >= 2);
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
    await page
        .getByRole('button', { name: '가족 포트폴리오', exact: true })
        .click();
    await calendar.getByText(/계좌별 기준일이 다릅니다/).waitFor();
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `overflow ${width}`
        );
        await calendar.scrollIntoViewIfNeeded();
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
    slow = true;
    await page
        .getByRole('button', { name: '저장된 배당 거래', exact: true })
        .click();
    await page.waitForFunction(() =>
        document.body.textContent.includes('배당 자료를 확인하고 있습니다.')
    );
    await page.evaluate(() => (window.__calendarUser.value = null));
    if (release) release();
    await page.waitForURL(/\/login/);
    assert.equal(await page.locator('.event-row').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: private calendar, monthly/yearly, unknown history, account/date filters, read-only ledgers, 4 viewports, dark, reload and logout race'
    );
} finally {
    await browser.close();
}
