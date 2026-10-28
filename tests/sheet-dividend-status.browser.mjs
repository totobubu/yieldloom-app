// Synthetic identities and an in-memory API only. No user browser or remote financial writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import {
    submitObservationBatch,
    observationHash,
} from '../lib/sheet-observation-store.js';
import { numericFields } from '../lib/sheet-ledger.js';
import { memoryDb } from './helpers/sheet-memory-db.mjs';
const row = {
    ...Object.fromEntries(numericFields.map((f) => [f, null])),
    id: 'synthetic-receipt',
    accountId: 'wife',
    type: 'DEPOSIT',
    symbol: '',
    date: '2024-01-10',
    cashUsd: 1,
    source: { sheet: '합성 입금 원장', row: 1 },
    sourceValues: { cashUsd: 1 },
    fieldStatus: {},
    evidence: [],
    needsReview: true,
    status: '미확인',
    fundingSource: '미확인',
    reinvested: null,
};
const canonicalRows = [
    row,
    ...Array.from({ length: 2284 }, (_, i) => ({
        ...row,
        id: `synthetic-buy-${i}`,
        type: 'BUY',
        symbol: 'TEST',
        date: '2024-01-02',
        cashUsd: null,
        purchaseUsd: 1,
        quantity: 1,
        sourceValues: { purchaseUsd: 1, quantity: 1 },
    })),
];
const db = memoryDb([
    [
        'sheetTrialLedgers/browser-admin',
        { version: 1, pageCount: 23, rowCount: 2285 },
    ],
    ['sheetTrialLedgers/browser-admin/pages/0', { rows: [row] }],
]);
for (let i = 0; i < 23; i++)
    db.store.set(`sheetTrialLedgers/browser-admin/pages/${i}`, {
        rows: canonicalRows.slice(i * 100, i * 100 + 100),
    });
const observations = [
    ['확정', '지급', '합성 지급 완료'],
    ['확정', '미지급', '합성 확정 미지급'],
    ['미확정', '미지급', '합성 미확정 미지급'],
    ['', '', '합성 상태 불명'],
].map(([c, p, location], i) => ({
    kind: 'TOSS_EXPECTED_DIVIDEND',
    sourceId: `synthetic-${i}`,
    accountId: 'wife',
    type: 'DIVIDEND',
    symbol: 'TEST',
    location,
    dividendState: { confirmationStatusRaw: c, paymentStatusRaw: p },
    values: {
        date: '2024-01-02',
        netDividendUsd: 1,
        ...(p === '지급' ? { paidAt: '2024-01-10' } : {}),
    },
    rawText: `합성 원문 ${c} ${p}`,
}));
await submitObservationBatch(db, db.doc('sheetTrialLedgers/browser-admin'), {
    accountId: 'wife',
    batchId: 'synthetic-dividends',
    checkpoint: { sourceHash: 'a'.repeat(64), offset: 0, count: 4 },
    observations,
});
const canonicalHash = observationHash(
    db.store.get('sheetTrialLedgers/browser-admin/pages/0')
);
const handler = sheetLedgerHandler({
    database: () => db,
    verify: async () => ({
        uid: 'browser-admin',
        email: 'jomalkeun@gmail.com',
        email_verified: true,
    }),
    now: () => new Date('2026-10-25T00:00:00Z'),
});
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
            viewport: { width: 1440, height: 1000 },
        }),
        errors = [],
        requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
        if (m.type() === 'warning' && m.text().includes('[Vue warn]'))
            errors.push(m.text());
    });
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref({uid:'browser-admin',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async()=>'synthetic'}),authLoading=ref(false),signedIn=computed(()=>true),auth=null,db=null,googleProvider=null,firebaseReady=true;`,
        })
    );
    await page.route('**/api/sheet-ledger*', async (route) => {
        requests.push(route.request().method());
        const res = {
            setHeader() {},
            status(code) {
                this.code = code;
                return this;
            },
            json(payload) {
                this.payload = payload;
                return this;
            },
        };
        await handler(
            {
                method: route.request().method(),
                body: route.request().postDataJSON(),
                query: Object.fromEntries(
                    new URL(route.request().url()).searchParams
                ),
            },
            res
        );
        await route.fulfill({ status: res.code, json: res.payload });
    });
    const readsBeforeUi = db.reads.length;
    await page.goto(
        `${process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5181'}/admin/sheet-ledger?view=source-tools`
    );
    const panel = page.getByRole('region', { name: '출처 대조와 원금 검증' });
    await panel
        .getByRole('cell', { name: '확정 · 지급', exact: true })
        .waitFor();
    assert.equal(requests.length, 7); // Five row pages, one observation page, one version check.
    const readOperations = db.reads.slice(readsBeforeUi);
    assert.equal(
        readOperations.filter((path) => path.includes('/pages/')).length,
        23
    );
    assert.equal(
        readOperations.filter((path) => !path.endsWith(':query')).length,
        33
    );
    assert.equal(
        readOperations.filter((path) => path.endsWith(':query')).length,
        1
    ); // Query returns four documents; this is not one billed read.
    for (const label of ['확정 · 미지급', '미확정 · 미지급', '미확인 · 미확인'])
        assert.equal(
            await panel.getByRole('cell', { name: label, exact: true }).count(),
            1
        );
    async function inspect(location) {
        await panel
            .getByRole('row')
            .filter({
                has: page.getByRole('cell', { name: location, exact: true }),
            })
            .getByRole('button', { name: '출처 비교' })
            .click();
        await panel
            .getByRole('button', {
                name: '배당 근거를 기존 입금에 연결',
                exact: true,
            })
            .waitFor();
    }
    await inspect('합성 지급 완료');
    await panel
        .getByLabel('관리자 확인 근거')
        .fill('합성 배당 실제 지급일과 입금액 일치 확인');
    const button = panel.getByRole('button', {
        name: '배당 근거를 기존 입금에 연결',
        exact: true,
    });
    await button.click();
    await panel
        .getByRole('cell', {
            name: '확정 · 지급 · 입금 근거 연결됨',
            exact: true,
        })
        .waitFor();
    assert.equal(
        observationHash(
            db.store.get('sheetTrialLedgers/browser-admin/pages/0')
        ),
        canonicalHash
    );
    for (const location of [
        '합성 확정 미지급',
        '합성 미확정 미지급',
        '합성 상태 불명',
    ]) {
        await inspect(location);
        await panel
            .getByLabel('관리자 확인 근거')
            .fill('합성 대조: 미지급/미확인 자료');
        assert(await button.isDisabled());
    }
    assert.equal(requests.filter((m) => m === 'POST').length, 1);
    assert.equal(
        db.writes.filter((p) => p === 'sheetTrialLedgers/browser-admin/pages/0')
            .length,
        0
    );
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 2
        )
    );
    assert.deepEqual(errors, []);
    console.log(
        'Passed: paid/confirmed-unpaid/unconfirmed/unknown labels, explicit receipt-only association, no financial/canonical rewrite, mobile/dark; remote writes=0.'
    );
} finally {
    await browser.close();
}
