// Synthetic identities and in-memory authenticated report API. No financial originals.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { followupFixture } from './support/toss-followup-fixture.mjs';
import {
    verifiedFollowup,
    followupResponse,
} from '../lib/toss-followup-report.js';
const f = followupFixture(),
    report = followupResponse(
        verifiedFollowup(f.zip, f.evidence, f.descriptor),
        'wife',
        f.workbookSha256,
        f.descriptor
    );
const obs = Array.from({ length: 250 }, (_, i) => ({
    id: `fixture-order:${i}`,
    sourceId: `fixture:${i}`,
    accountId: 'wife',
    type: 'BUY',
    kind: i === 2 ? 'TOSS_TRANSACTION' : 'TOSS_ORDER',
    symbol: i === 249 ? 'LAST' : 'TEST',
    location: '합성 원문 위치',
    hasOriginal: true,
    values: {
        date: '2025-02-03',
        quantity: i === 1 ? 3 : 2,
        purchaseUsd: i === 1 ? 8 : 9.12,
        orderedAt: '2025-02-03 12:34',
        commissionUsd: null,
    },
}));
const rows = [
    {
        id: 'fixture-sheet',
        accountId: 'wife',
        type: 'BUY',
        symbol: 'TEST',
        date: '2025-02-03',
        quantity: 2,
        purchaseUsd: 8,
        status: '미확인',
        source: { spreadsheetId: 'fixture', sheetId: 1, sheet: '합성', row: 1 },
        fieldStatus: {},
        evidence: [],
        needsReview: true,
    },
];
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
        }),
        requests = [],
        errors = [];
    let denyReport = false;
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'fixture',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true;",
        })
    );
    await page.route('**/api/**', async (r) => {
        requests.push({ method: r.request().method(), url: r.request().url() });
        assert.equal(r.request().method(), 'GET');
        const u = new URL(r.request().url());
        if (u.pathname.endsWith('/sheet-ledger')) {
            if (u.searchParams.get('resource') === 'observation') {
                const o = obs.find((x) => x.id === u.searchParams.get('id'));
                return r.fulfill({
                    json: {
                        version: 1,
                        rows: [],
                        observation: o,
                        original: {
                            ...o,
                            rawText: '합성 원문 원래 값 · 수수료 미제공',
                        },
                    },
                });
            }
            return r.fulfill({ json: { version: 1, rows, observations: obs } });
        }
        if (u.searchParams.get('section') === 'followup') {
            assert.equal(r.request().headers().authorization, 'Bearer fixture');
            if (denyReport)
                return r.fulfill({
                    status: 403,
                    json: { error: '합성 권한 거부' },
                });
            if (u.searchParams.get('accountId') === 'husband')
                return r.fulfill({
                    status: 404,
                    json: {
                        error: '이 계좌의 후속 보고서 미연결',
                        code: 'REPORT_NOT_FOUND',
                    },
                });
            return r.fulfill({ json: report });
        }
        return r.fulfill({
            status: 409,
            json: { error: '합성 기존 보고서 미연결' },
        });
    });
    await page.goto(
        (process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5181') +
            '/admin/sheet-ledger'
    );
    const region = page.getByRole('region', {
        name: '토스 원본 중심 시험 장부',
    });
    await region.getByText(/토스 관측 254행/).waitFor();
    await region.getByText(/서버 검증 완료 · 체크포인트 SHA-256:/).waitFor();
    assert.equal(await region.locator('.review-finding').count(), 8);
    assert.equal(
        await region.getByText('보고서상 연결 확인', { exact: true }).count(),
        2
    );
    assert.equal(await region.getByText(/시트 매핑 미승인/).count(), 8);
    assert.equal(
        requests.filter((r) => r.url.includes('section=followup')).length,
        1
    );
    const reads = requests.length;
    assert(
        (await region.locator('tbody tr[data-ledger-index]').count()) <= 100
    );
    await region
        .getByRole('searchbox', { name: '전체 토스 검색' })
        .fill('LAST');
    await region
        .getByRole('cell', { name: 'LAST · BUY', exact: true })
        .waitFor();
    await region.getByRole('searchbox', { name: '전체 토스 검색' }).fill('');
    await region.getByRole('button', { name: '수량', exact: true }).click();
    await region
        .getByRole('button', { name: '토스 마지막 행', exact: true })
        .click();
    assert.equal(
        requests.length,
        reads,
        'Search/sort/scroll reuse loaded observations and report'
    );
    assert.equal(await region.locator('.p-paginator').count(), 0);
    assert(
        await region
            .locator('.broker-table-region')
            .evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight) < 2)
    );
    await region
        .getByRole('searchbox', { name: '전체 토스 검색' })
        .fill('fixture-order:0');
    await region
        .getByRole('button', { name: 'TEST 2 행 근거', exact: true })
        .click();
    const detail = page.getByRole('region', { name: '선택 토스 관측 근거' });
    await detail
        .getByText(/시트 수량 2 \/ 금액 \$8 · 차이 수량 0 \/ 금액 \$1.12/)
        .waitFor();
    await detail.getByRole('button', { name: '저장 원문 읽기' }).click();
    await detail.getByText(/합성 원문 원래 값/).waitFor({ state: 'attached' });
    assert.equal(requests.length, reads + 1, 'One targeted raw detail request');
    await page.screenshot({
        path: '/tmp/yieldloom-toss-trial-connected-desktop.png',
        fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({
        path: '/tmp/yieldloom-toss-trial-connected-mobile.png',
        fullPage: false,
    });
    assert(
        await region
            .locator('.broker-table-region')
            .evaluate(
                (el) =>
                    el.scrollWidth > el.clientWidth &&
                    Math.abs(el.scrollHeight - el.clientHeight) < 2
            )
    );
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 2
        ),
        false
    );
    await region
        .getByLabel('후속 보고서 계좌', { exact: true })
        .selectOption('husband');
    await region
        .getByRole('alert')
        .filter({ hasText: '이 계좌의 후속 보고서 미연결' })
        .waitFor();
    assert.equal(
        await region.locator('.review-finding').count(),
        0,
        'Account switch purges previous report'
    );
    await region
        .getByLabel('후속 보고서 계좌', { exact: true })
        .selectOption('wife');
    await region.getByText(/서버 검증 완료 · 체크포인트 SHA-256:/).waitFor();
    assert.equal(
        requests.filter((r) => r.url.includes('section=followup')).length,
        2,
        'Account return uses session cache'
    );
    denyReport = true;
    await region
        .getByRole('button', { name: '후속 보고서 새로고침', exact: true })
        .click();
    await region
        .getByRole('alert')
        .filter({ hasText: '합성 권한 거부' })
        .waitFor();
    assert.equal(await region.locator('.review-finding').count(), 0);
    assert.equal(await region.getByText(/서버 검증 완료/).count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: automatic authenticated eight-case report/four independent source orders, full search/sort, document scroll, raw detail, account/error purge, mobile/dark, zero writes.'
    );
} finally {
    await browser.close();
}
