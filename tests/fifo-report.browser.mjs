// Synthetic adopted snapshot + actual handler and memory-only transactions.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fifoReportHandler } from '../lib/fifo-report-handler.js';
import { readFinalLedger } from '../lib/final-ledger-snapshot.js';
import {
    overlayIncrements,
    incrementHash,
} from '../lib/toss-ledger-increments.js';
import { order } from './support/toss-orders-fixture.mjs';
import { finalLedgerFixture } from './support/final-ledger-fixture.mjs';
const f = finalLedgerFixture();
const baseline = await readFinalLedger(
    async (k) => f.objects.get(k),
    f.checkpoint
);
const snapshot = overlayIncrements(baseline, {
    revision: incrementHash('synthetic-increment'),
    entryCount: 1,
    verified: [
        {
            marker: { accountId: 'husband' },
            apiAccountHash: incrementHash('synthetic-account'),
            observations: [],
            apiOrders: [
                {
                    observedAt: '2026-01-03T00:00:00Z',
                    sourceHash: incrementHash('synthetic-source'),
                    order: order('synthetic-order-1', { symbol: 'HUSBAND' }),
                },
            ],
        },
    ],
});
const values = new Map([
    ['sheetTrialLedgers/synthetic', { pageCount: 1 }],
    [
        'sheetTrialLedgers/synthetic/pages/0',
        {
            rows: [
                {
                    accountId: 'wife',
                    source: { spreadsheetId: 'synthetic-workbook' },
                },
            ],
        },
    ],
]);
let reads = 0,
    writes = 0,
    snapshots = 0,
    denied = false,
    uncertain = false;
const doc = (path) => ({
    path,
    get: async () => {
        reads++;
        return {
            exists: values.has(path),
            data: () => structuredClone(values.get(path)),
        };
    },
    collection: (name) => ({ doc: (id) => doc(`${path}/${name}/${id}`) }),
});
const db = {
    collection: (name) => ({ doc: (id) => doc(`${name}/${id}`) }),
    runTransaction: async (fn) =>
        fn({
            get: (ref) => ref.get(),
            set: (ref, value) => {
                assert.equal(
                    ref.path,
                    'sheetTrialLedgers/synthetic/fifoAdjustments/state'
                );
                values.set(ref.path, structuredClone(value));
                writes++;
            },
        }),
};
const handler = fifoReportHandler({
    verify: async () => ({
        uid: 'synthetic',
        email: denied ? 'denied@example.invalid' : 'jomalkeun@gmail.com',
        email_verified: true,
    }),
    database: () => db,
    checkpoint: f.checkpoint,
    store: {
        readFinalSnapshot: async () => {
            snapshots++;
            return snapshot;
        },
    },
    now: () => '2026-01-31T00:00:00Z',
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
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: "import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'synthetic',email:'jomalkeun@gmail.com',emailVerified:true,getIdToken:async(force)=>{if(force)throw Error('forced token');return 'synthetic'}}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),firebaseReady=false,auth=null,db=null,googleProvider=null;",
        })
    );
    await page.route('**/api/**', async (r) => {
        const url = new URL(r.request().url());
        requests.push({
            requestId:
                r.request().method() === 'POST'
                    ? r.request().postDataJSON().requestId
                    : null,
            method: r.request().method(),
            view: url.searchParams.get('view'),
        });
        if (url.pathname.endsWith('/stock-prices')) {
            assert.deepEqual([...url.searchParams.keys()], ['ticker']);
            return r.fulfill({
                json: {
                    symbol: url.searchParams.get('ticker'),
                    currency: 'USD',
                    candles: [{ date: '2026-01-31', close: 150 }],
                    events: [],
                },
            });
        }
        assert.equal(url.searchParams.get('view'), 'fifo-report');
        const res = {
            statusCode: 200,
            setHeader() {},
            status(n) {
                this.statusCode = n;
                return this;
            },
            json(body) {
                this.body = body;
                return this;
            },
        };
        await handler(
            {
                method: r.request().method(),
                query: Object.fromEntries(url.searchParams),
                body:
                    r.request().method() === 'POST'
                        ? r.request().postDataJSON()
                        : undefined,
            },
            res
        );
        if (uncertain && r.request().method() === 'POST') {
            uncertain = false;
            return r.fulfill({
                status: 502,
                json: { error: '합성 gateway 응답 유실' },
            });
        }
        return r.fulfill({ status: res.statusCode, json: res.body });
    });
    const base =
        process.env.SHEET_LEDGER_UI_BASE_URL || 'http://127.0.0.1:5185';
    await page.goto(base + '/admin/sheet-ledger?view=assets');
    const main = page.locator('main.fifo-report'),
        table = main.getByRole('region', { name: '계좌별 FIFO lot' });
    await main.getByRole('heading', { name: '보정 이력 · 버전 0' }).waitFor();
    assert.equal(requests.length, 1);
    assert.equal(reads, 3);
    assert.equal(snapshots, 1);
    assert.equal(writes, 0);
    await table
        .getByText(/아내 · 토스/)
        .first()
        .waitFor();
    await table
        .getByText(/남편 · 토스/)
        .first()
        .waitFor();
    const choose = async (label, option) => {
        await main.getByRole('combobox', { name: label, exact: true }).click();
        await page.getByRole('option', { name: option, exact: true }).click();
    };
    await choose('조회 범위', '남편');
    assert.equal(await table.getByText(/아내 · 토스/).count(), 0);
    await table.getByText(/HUSBAND/).waitFor();
    await choose('조회 범위', '아내');
    assert.equal(await table.getByText(/HUSBAND/).count(), 0);
    await choose('조회 범위', '가족 전체');
    assert.equal(requests.length, 1);
    await main
        .getByRole('textbox', { name: '종목', exact: true })
        .fill('MANUAL');
    await main
        .getByRole('textbox', { name: '원 취득일·실제 사건 시각', exact: true })
        .fill('2020-01-01');
    await main
        .getByRole('textbox', { name: '보정 수량', exact: true })
        .fill('0');
    await main
        .getByRole('textbox', { name: '수수료 포함 취득원가', exact: true })
        .fill('100');
    await main
        .getByRole('textbox', { name: '확인 근거·보정 이유', exact: true })
        .fill('합성 이전 명세서 원 취득일 확인');
    await main.getByRole('button', { name: '보정 저장 후 재계산' }).click();
    await main
        .getByText('양수 금액·수량을 확인해 주세요.', { exact: true })
        .waitFor();
    assert.equal(writes, 0);
    await main
        .getByRole('textbox', { name: '보정 수량', exact: true })
        .fill('1.123456789123456789');
    uncertain = true;
    await main.getByRole('button', { name: '보정 저장 후 재계산' }).click();
    await main.getByText(/저장 결과가 미확정입니다/).waitFor();
    assert.equal(writes, 1);
    await main.getByRole('button', { name: '보정 저장 후 재계산' }).click();
    await main.getByRole('heading', { name: '보정 이력 · 버전 1' }).waitFor();
    assert.equal(writes, 1);
    const firstPosts = requests.filter((r) => r.method === 'POST');
    assert.equal(firstPosts.length, 2);
    assert.equal(firstPosts[0].requestId, firstPosts[1].requestId);
    assert.equal(
        await main
            .getByRole('textbox', { name: '종목', exact: true })
            .inputValue(),
        ''
    );
    let manual = table.getByRole('row').filter({ hasText: 'MANUAL' });
    await manual.waitFor();
    assert.match(await manual.innerText(), /1\.123456789123456789/);
    assert.match(await manual.innerText(), /100/);
    assert.match(await manual.innerText(), /미상 KRW/);
    await main.getByRole('button', { name: '평가 시세 조회' }).click();
    await page.waitForFunction(() =>
        document
            .querySelector('main.fifo-report')
            ?.textContent.includes('68.51851836851851835')
    );
    assert.equal(
        requests.filter((r) => r.view === 'fifo-report' && r.method === 'GET')
            .length,
        2
    );
    await choose('보정 종류', '실제 원화 환전 원가·수취액');
    await main
        .getByRole('combobox', { name: '대상 거래', exact: true })
        .click();
    await page.getByRole('option').filter({ hasText: 'MANUAL' }).click();
    await main
        .getByRole('textbox', { name: '실제 금액', exact: true })
        .fill('140000');
    await main
        .getByRole('textbox', { name: '확인 근거·보정 이유', exact: true })
        .fill('합성 실제 환전 원가 명세');
    await main.getByRole('button', { name: '보정 저장 후 재계산' }).click();
    await main.getByRole('heading', { name: '보정 이력 · 버전 2' }).waitFor();
    assert.match(await manual.innerText(), /140,000 KRW/);
    await page.reload();
    await main.getByRole('heading', { name: '보정 이력 · 버전 2' }).waitFor();
    assert.match(await manual.innerText(), /140,000 KRW/);
    await main
        .getByRole('button', { name: '이 보정 되돌리기' })
        .first()
        .click();
    await main.getByRole('heading', { name: '보정 이력 · 버전 3' }).waitFor();
    assert.match(await manual.innerText(), /미상 KRW/);
    assert.match(await manual.innerText(), /100/);
    await main
        .getByRole('textbox', { name: '종목', exact: true })
        .fill('PRIVATEFORM');
    await main
        .getByRole('textbox', { name: '수수료 포함 취득원가', exact: true })
        .fill('987654');
    await main
        .getByRole('textbox', { name: '확인 근거·보정 이유', exact: true })
        .fill('합성 이전 사용자 비공개 입력');
    await page.evaluate(async () => {
        const m = await import('/src/services/firebaseClient.js');
        m.firebaseUser.value = { ...m.firebaseUser.value };
    });
    await main.getByRole('heading', { name: '보정 이력 · 버전 3' }).waitFor();
    assert.equal(
        await main
            .getByRole('textbox', { name: '종목', exact: true })
            .inputValue(),
        ''
    );
    assert.equal(
        await main
            .getByRole('textbox', { name: '수수료 포함 취득원가', exact: true })
            .inputValue(),
        ''
    );
    assert.equal(
        await main
            .getByRole('textbox', { name: '확인 근거·보정 이유', exact: true })
            .inputValue(),
        ''
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
    );
    await page.screenshot({
        path: join(tmpdir(), 'yieldloom-fifo-mobile.png'),
        fullPage: false,
    });
    await main.getByRole('button', { name: '이 보정 되돌리기' }).click();
    await main.getByRole('heading', { name: '보정 이력 · 버전 4' }).waitFor();
    assert.equal(await manual.count(), 0);
    assert.equal(writes, 4);
    denied = true;
    await main.getByRole('button', { name: '리포트 새로고침' }).click();
    await main
        .getByText('관리자 권한이 필요합니다.', { exact: true })
        .waitFor();
    assert.equal(
        await main.getByRole('region', { name: '계좌별 FIFO lot' }).count(),
        0
    );
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
        JSON.stringify({
            result: 'passed',
            correctionWrites: writes,
            dbReads: reads,
            snapshotReads: snapshots,
            reportGets: requests.filter(
                (r) => r.view === 'fifo-report' && r.method === 'GET'
            ).length,
            reportPosts: requests.filter((r) => r.method === 'POST').length,
            pageErrors: errors.length,
        })
    );
} finally {
    await browser.close();
}
