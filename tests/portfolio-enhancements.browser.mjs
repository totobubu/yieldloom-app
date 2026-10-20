// Real Vue pages -> local Flask -> transactional in-memory store. No real users/data.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5175';
const api = process.env.FAMILY_TEST_API_BASE_URL || 'http://127.0.0.1:5011';
if (
    ![base, api].every((value) =>
        ['localhost', '127.0.0.1'].includes(new URL(value).hostname)
    )
)
    throw new Error('Synthetic tests require localhost servers.');
const uid = `enhancements-${Date.now()}`;
async function request(action = '', body, query = {}) {
    const response = await fetch(
        `${api}/api/family-portfolio?${new URLSearchParams({ ...query, ...(action ? { action } : {}) })}`,
        {
            method: body === undefined ? 'GET' : 'POST',
            headers: {
                Authorization: `Bearer ${uid}`,
                ...(body instanceof FormData || body === undefined
                    ? {}
                    : { 'Content-Type': 'application/json' }),
            },
            ...(body === undefined
                ? {}
                : {
                      body:
                          body instanceof FormData
                              ? body
                              : JSON.stringify(body),
                  }),
        }
    );
    const json = await response.json();
    assert.equal(response.status, 200, JSON.stringify(json));
    return json;
}
const { familyId } = await request('ensurePersonal', { profileName: '테스트' });
const family = (await request()).families.find((f) => f.id === familyId);
const ownerId = Object.keys(family.profiles)[0];
const { accountId } = await request('createAccount', {
    familyId,
    ownerId,
    institution: '합성증권',
    alias: '고도화 검증',
    type: 'general',
    last4: '1234',
});
const review = await request('previewManualHoldings', {
    accountId,
    asOf: '2026-01-01',
    baseSnapshot: null,
    identityConfirmed: true,
    completeSnapshotConfirmed: true,
    rows: [
        {
            date: '2026-01-01',
            symbol: 'AAPL',
            currency: 'USD',
            quantity: 1,
            amount: 100,
        },
        {
            date: '2026-01-01',
            symbol: 'CASH',
            currency: 'USD',
            quantity: 1,
            amount: 10,
        },
    ],
});
await request('commit', {
    accountId,
    reviewId: review.reviewId,
    rows: review.rows,
});
const form = new FormData();
for (const [key, value] of Object.entries({
    accountId,
    ownerId,
    institution: '합성증권',
    kind: 'transactions',
    asOf: '2026-01-01',
    identityConfirmed: 'true',
    format: 'standard-csv',
}))
    form.append(key, value);
form.append(
    'file',
    new Blob([
        'date,symbol,quantity,amount,currency,type,externalId,cashKind\n2025-01-01,CASH,,100,USD,cash_in,deposit,external_deposit\n2025-06-05,AAPL,,10,USD,dividend,dividend,\n',
    ]),
    'synthetic.csv'
);
const imported = await request('preview', form);
await request('commit', {
    accountId,
    reviewId: imported.reviewId,
    rows: imported.rows,
});

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
    });
    page.setDefaultTimeout(12000);
    const errors = [],
        requests = [],
        reads = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
        if (r.url().includes('/api/family-portfolio')) requests.push(r.url());
    });
    page.on('response', (r) => {
        if (r.url().includes('/api/family-portfolio'))
            reads.push({
                action:
                    new URL(r.url()).searchParams.get('action') ||
                    new URL(r.url()).searchParams.get('view') ||
                    'read',
                documents: Number(
                    r.headers()['x-portfolio-document-reads'] || 0
                ),
            });
    });
    await page.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'application/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref({uid:${JSON.stringify(uid)},getIdToken:async()=>${JSON.stringify(uid)}}),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),firebaseReady=false,db=null,auth=null,googleProvider=null;window.__enhancementUser=firebaseUser;`,
        })
    );
    await page.route('**/api/stock-prices*', (r) =>
        r.fulfill({ json: { prices: {}, errors: [] } })
    );
    await page.route('**/distribution-index.json', (r) =>
        r.fulfill({
            json: {
                tickers: [
                    {
                        ticker: 'AAPL',
                        historyUrl:
                            '/content-studio/distribution-ticker-aapl.json',
                    },
                ],
            },
        })
    );
    await page.route('**/distribution-ticker-aapl.json', (r) =>
        r.fulfill({
            json: {
                history: [
                    {
                        id: 1,
                        ticker: 'AAPL',
                        ex_date: '2025-06-01',
                        payable_date: '2025-06-05',
                        distribution_per_share: 10,
                        currency: 'USD',
                        verification_status: 'official',
                    },
                ],
            },
        })
    );
    await page.goto(`${base}/mypage?tab=assets`);
    await page
        .getByRole('button', { name: '자료 업로드', exact: true })
        .click();
    await page
        .getByRole('button', { name: '수동 잔고 입력', exact: true })
        .click();
    const manual = page.getByRole('form', {
        name: '수동 잔고 입력',
        exact: true,
    });
    const beforeCorrection = requests.length;
    await manual.getByLabel(/현재 잔고와 같은 기준일의 오류 정정/).check();
    assert.equal(
        await manual
            .getByLabel('수동 잔고 기준일', { exact: true })
            .inputValue(),
        '2026-01-01'
    );
    await manual
        .getByLabel('정정 사유', { exact: true })
        .fill('수량 정정 테스트');
    await manual.getByLabel('1행 수량', { exact: true }).fill('2');
    await manual.getByLabel(/선택 계좌의 명의/).check();
    assert.equal(
        requests.length,
        beforeCorrection,
        'editing adds no API requests'
    );
    await manual
        .getByRole('button', { name: '수동 잔고 검토', exact: true })
        .click();
    await page.getByText(/같은 기준일 정정 · 사유: 수량 정정 테스트/).waitFor();
    await page.getByRole('table', { name: '잔고 변경 전후' }).waitFor();
    await page
        .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
        .click();
    await page
        .getByRole('heading', {
            name: '자료 저장이 완료되었습니다',
            exact: true,
        })
        .waitFor();
    assert.equal(await manual.isVisible(), false);
    await page.getByRole('button', { name: '추가 등록', exact: true }).click();
    await manual.waitFor();
    assert.equal(
        await manual.getByLabel('1행 수량', { exact: true }).inputValue(),
        '2'
    );
    const history = page.getByRole('region', {
        name: '잔고 변경 이력',
        exact: true,
    });
    assert.equal(
        await history.getByRole('button', { name: '변경 전후 보기' }).count(),
        0,
        'history is lazy'
    );
    await history.getByRole('button', { name: '잔고 변경 이력 조회' }).click();
    const correction = history
        .getByRole('listitem')
        .filter({ hasText: '수량 정정 테스트' });
    await correction.getByRole('button', { name: '변경 전후 보기' }).click();
    await history.getByRole('table', { name: '잔고 변경 전후' }).waitFor();
    assert.match(await history.innerText(), /수량 정정 테스트/);
    assert.equal(
        reads.find((r) => r.action === 'previewManualHoldings').documents,
        2
    );
    // A holdings commit now also reads the ledger once to publish the
    // revision-checked calculated snapshot synchronously.
    assert.equal(reads.find((r) => r.action === 'commit').documents, 11);

    // Persist a layout, restore it, then detect a same-width reordered header.
    await page
        .getByRole('button', { name: '증권사 CSV·XLSX 열 연결', exact: true })
        .click();
    const broker = page.getByRole('region', {
        name: '증권사 CSV·XLSX 열 연결',
        exact: true,
    });
    const chooseFile = async (content, name = 'layout.csv') => {
        await broker
            .getByLabel('CSV 또는 XLSX 파일', { exact: true })
            .setInputFiles({
                name,
                mimeType: name.endsWith('.csv')
                    ? 'text/csv'
                    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                buffer: Buffer.from(content),
            });
        await broker.getByLabel(/명의와 계좌에 속하는/).check();
        await broker
            .getByRole('button', { name: '파일 열 확인', exact: true })
            .click();
        await broker.getByLabel('연결 종목 코드', { exact: true }).waitFor();
    };
    const layout = 'symbol,quantity,amount,currency\nAAPL,2,100,USD\n';
    await broker.getByLabel('잔고 기준일', { exact: true }).fill('2026-01-02');
    await chooseFile(layout);
    const beforePresets = requests.length;
    await broker
        .getByLabel('파일의 열 연결과 기본 통화를 확인했습니다.', {
            exact: true,
        })
        .check();
    await broker
        .getByRole('button', { name: '열 연결 설정 저장', exact: true })
        .click();
    await broker
        .getByText(/이 브라우저에 열 연결 설정을 저장했습니다/)
        .waitFor();
    await broker
        .getByRole('button', { name: '열 연결 설정 불러오기', exact: true })
        .click();
    assert.equal(
        requests.length,
        beforePresets,
        'preset operations add no API calls'
    );
    await chooseFile(layout);
    await broker.getByText(/저장된 열 연결을 불러왔습니다/).waitFor();
    await broker
        .getByRole('button', { name: '연결 자료 미리보기', exact: true })
        .click();
    await broker
        .getByText('불러온 열 연결과 통화를 확인한 뒤 확인란을 선택하세요.', {
            exact: true,
        })
        .waitFor();
    await chooseFile('quantity,symbol,amount,currency\n2,AAPL,100,USD\n');
    await broker.getByText(/저장된 양식과 파일의 열 구성이 다릅니다/).waitFor();
    const workbook = execFileSync(process.env.FAMILY_TEST_PYTHON || 'python3', [
        '-c',
        "from openpyxl import Workbook; import io,sys; b=Workbook(); b.active.title='First'; b.active.append(['symbol','quantity','amount','currency']); b.active.append(['AAPL',1,100,'USD']); s=b.create_sheet('Saved'); s.append(['symbol','quantity','amount','currency']); s.append(['AAPL',2,100,'USD']); out=io.BytesIO(); b.save(out); b.close(); sys.stdout.buffer.write(out.getvalue())",
    ]);
    await chooseFile(workbook, 'layout.xlsx');
    await broker.getByLabel('워크시트 (선택)', { exact: true }).fill('Saved');
    await broker
        .getByRole('button', { name: '파일 열 확인', exact: true })
        .click();
    await broker.getByLabel('연결 종목 코드', { exact: true }).waitFor();
    await broker
        .getByLabel('파일의 열 연결과 기본 통화를 확인했습니다.', {
            exact: true,
        })
        .check();
    await broker
        .getByRole('button', { name: '열 연결 설정 저장', exact: true })
        .click();
    await broker
        .getByText(/이 브라우저에 열 연결 설정을 저장했습니다/)
        .waitFor();
    await broker
        .getByRole('button', { name: '열 연결 설정 불러오기', exact: true })
        .click();
    await chooseFile(workbook, 'layout.xlsx');
    await broker.getByText(/저장된 설정은 2번째 시트입니다/).waitFor();
    await broker
        .getByRole('button', { name: '저장된 시트 선택', exact: true })
        .click();
    await broker
        .getByRole('button', { name: '파일 열 확인', exact: true })
        .click();
    await broker.getByText(/저장된 열 연결을 불러왔습니다/).waitFor();
    assert.equal(
        await broker
            .getByLabel('워크시트 (선택)', { exact: true })
            .inputValue(),
        'Saved'
    );
    await broker
        .getByRole('button', { name: '저장된 열 연결 삭제', exact: true })
        .click();
    await broker
        .getByText('저장된 설정을 삭제했습니다.', { exact: true })
        .waitFor();

    await page.keyboard.press('Escape');
    await broker.waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: '배당 분석', exact: true }).click();
    const insights = page.getByRole('region', {
        name: '원장 품질·청산 수익 분석',
        exact: true,
    });
    await insights.waitFor();
    const beforeXirr = requests.length;
    await insights.getByLabel(/계좌 개설 시점의 기초 자산은 0/).check();
    await insights
        .getByLabel('계좌 XIRR 결과')
        .getByText(/10% · 2025-01-01 ~ 2026-01-01/)
        .waitFor();
    assert.equal(
        requests.length,
        beforeXirr,
        'XIRR uses already loaded ledger'
    );
    await page.getByLabel('분석 월', { exact: true }).fill('2025-06');
    assert.equal(
        await insights.getByLabel(/계좌 개설 시점의 기초 자산은 0/).isChecked(),
        false
    );
    await page.getByRole('tab', { name: '배당 캘린더', exact: true }).click();
    const calendar = page.getByRole('region', {
        name: '개인 배당 캘린더',
        exact: true,
    });
    await calendar
        .getByRole('button', { name: '저장된 배당 거래', exact: true })
        .click();
    await calendar
        .getByText('배당 자료를 확인하고 있습니다.', { exact: true })
        .waitFor({ state: 'hidden' });
    const beforeReconciliation = requests.length;
    await calendar
        .getByRole('button', { name: '예상·기록 대조', exact: true })
        .click();
    await calendar.getByLabel('배당 조회 월', { exact: true }).fill('2025-06');
    const comparison = calendar.getByRole('region', {
        name: '예상 배당과 기록 대조',
        exact: true,
    });
    await comparison.getByText('거래 연결 후보', { exact: true }).waitFor();
    const beforeBasis = requests.length;
    await comparison.getByLabel(/조회 기간의 배당락일 보유 수량/).check();
    await comparison.getByText('금액 차이 확인', { exact: true }).waitFor(); // corrected quantity 2 x 10 vs recorded 10
    await comparison.getByLabel('확인할 항목만 보기', { exact: true }).check();
    assert.equal(
        requests.length,
        beforeBasis,
        'basis/filter changes add no requests'
    );
    assert.ok(
        requests.length - beforeReconciliation <= 2,
        'mode reentry reuses ledger with bounded permission checks'
    );
    for (const dark of [false, true]) {
        await page.evaluate(
            (v) => document.documentElement.classList.toggle('p-dark', v),
            dark
        );
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page.screenshot({
            path: `/tmp/yieldloom-enhancements-${dark ? 'dark' : 'light'}.png`,
            fullPage: true,
        });
    }
    await page.evaluate(() => {
        window.__enhancementUser.value = null;
    });
    await comparison.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log(
        'PASS: corrections/history, layout reuse/change detection, account XIRR, reconciliation, logout, mobile/themes; inputs/presets/calculations add zero API calls; correction preview/commit read 2/5 documents.'
    );
} finally {
    await browser.close();
}
