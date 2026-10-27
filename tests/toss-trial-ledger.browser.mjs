// Synthetic identities, in-memory API and local report only. No real financial data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
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
const report = {
    schemaVersion: 2,
    sourceEvidence: { objectKey: 'fixture/review.json' },
    orders: [
        {
            caseId: 'case-04',
            account: 'wife',
            quantity: '2',
            purchaseAmountUsd: '9.12',
            orderNo: '1',
            uiSelectionUrlPanelVerified: true,
            evidenceFiles: ['fixture-a.json'],
        },
        {
            caseId: 'case-14',
            account: 'wife',
            quantity: '3',
            purchaseAmountUsd: '8',
            orderNo: '2',
            uiSelectionUrlPanelVerified: true,
            exactPriorOpaqueIdMatch: false,
            evidenceFiles: ['fixture-b.json'],
        },
    ],
    remainingEightRows: Array.from({ length: 8 }, (_, i) => ({
        caseId: i === 3 ? 'case-04' : i === 7 ? 'case-14' : `fixture-case-${i}`,
        symbol: 'TEST',
        referenceDate: '2025-02-03',
        category: 'fixture',
        availableFact: i % 2 ? '합성 금액·수량 혼합' : '합성 정밀도 차이',
        missingEvidence: '합성 기록 범위',
        nextAction: '시트 참고 연결 보류',
    })),
};
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    const requests = [],
        errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'fixture',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true;",
        })
    );
    await page.route('**/api/**', async (r) => {
        requests.push({ method: r.request().method(), url: r.request().url() });
        assert.equal(
            r.request().method(),
            'GET',
            'Broker view and report opening never write'
        );
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
        return r.fulfill({
            status: 409,
            json: { error: '합성 보고서 미연결' },
        });
    });
    await page.goto(
        (process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5181') +
            '/admin/sheet-ledger'
    );
    const region = page.getByRole('region', {
        name: '토스 원본 중심 시험 장부',
    });
    await region.getByText(/토스 관측 250행/).waitFor();
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
        'Search, full sort and document scroll use loaded memory'
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
    const afterDetail = requests.length;
    await region.getByLabel('검토 보고서 JSON', { exact: true }).setInputFiles({
        name: 'fixture-review.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(report)),
    });
    await region.getByText(/열어본 파일 SHA-256:/).waitFor();
    assert.equal(await region.locator('.review-finding').count(), 8);
    assert.equal(
        await region.getByText('보고서상 연결 확인', { exact: true }).count(),
        2
    );
    assert.equal(await region.getByText(/시트 매핑 미승인/).count(), 8);
    assert.equal(
        requests.length,
        afterDetail,
        'Local checkpoint files cause no HTTP or DB requests'
    );
    await page.screenshot({
        path: '/tmp/yieldloom-toss-trial-desktop.png',
        fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await region.scrollIntoViewIfNeeded();
    await page.screenshot({
        path: '/tmp/yieldloom-toss-trial-mobile.png',
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
        false,
        'No full-page horizontal overflow'
    );
    await region
        .getByRole('button', { name: '보고서 닫기', exact: true })
        .click();
    assert.equal(await region.locator('.review-finding').count(), 0);
    await region.getByLabel('검토 보고서 JSON', { exact: true }).setInputFiles({
        name: 'bad.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"schemaVersion":1}'),
    });
    await region.getByRole('alert').waitFor();
    assert.equal(requests.length, afterDetail);
    assert.deepEqual(errors, []);
    console.log(
        'Toss primary rows, all-row search/sort, document scroll, raw detail, local eight-case report, desktop/mobile, zero writes: passed'
    );
} finally {
    await browser.close();
}
