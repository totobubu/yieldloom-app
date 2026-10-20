// Synthetic identity, extraction response and writes; local in-memory account API only.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5175';
const output =
    process.env.IMPORT_REVIEW_SCREENSHOTS || '/tmp/yieldloom-import-review';
await mkdir(output, { recursive: true });
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/src/services/firebaseClient*', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: `import { ref, computed } from '/node_modules/.vite/deps/vue.js';
            export const firebaseUser = ref({ uid: 'review-ui-${Date.now()}', displayName: '테스트', getIdToken: async function() { return this.uid; } });
            export const authLoading = ref(false), signedIn = computed(() => true);
            export const firebaseReady = false, db = null, auth = null, googleProvider = null;`,
        })
    );
    await page.route('**/api/portfolio-capital*', (route) =>
        route.fulfill({
            json: { entries: [], classifications: [], allocations: [] },
        })
    );
    const rows = Array.from({ length: 120 }, (_, index) => ({
        date: '2026-10-15',
        symbol: index % 2 ? 'SCHD' : 'AAPL',
        securityName: index % 2 ? 'Schwab US Dividend Equity ETF' : 'Apple',
        quantity: 2,
        amount: 50,
        currency: 'USD',
        type: index % 3 ? 'buy' : 'dividend',
        externalId: `review-row-${index + 1}`,
    }));
    rows[56] = {
        ...rows[56],
        symbol: 'UNKNOWN',
        _mappingStatus: 'unresolved',
        type: 'unknown',
        quantity: '',
    };
    const calls = [];
    let committedRows;
    await page.route('**/api/family-portfolio*', async (route) => {
        const action = new URL(route.request().url()).searchParams.get(
            'action'
        );
        calls.push(action);
        if (action === 'preview')
            return route.fulfill({
                json: {
                    reviewId: 'review-fixture',
                    source: 'toss-pdf',
                    statementIdentity: {
                        customerName: '합성 사용자',
                        maskedNumber: '****1234',
                        accountMatch: 'unregistered',
                    },
                    rows,
                    errors: [{ row: 57, error: '수량을 확인하세요.' }],
                    batches: [
                        {
                            reviewId: 'review-fixture',
                            start: 0,
                            count: rows.length,
                        },
                    ],
                    asOf: '2026-10-15',
                },
            });
        if (action === 'validateImport')
            return route.fulfill({ json: { valid: true } });
        if (action === 'commit') {
            committedRows = route.request().postDataJSON().rows;
            return route.fulfill({
                json: { inserted: rows.length, duplicates: 0 },
            });
        }
        return route.continue();
    });
    await page.goto(base + '/mypage');
    await page.getByLabel('금융기관', { exact: true }).fill('토스증권');
    await page.getByLabel('별칭', { exact: true }).fill('검토 테스트');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page
        .getByRole('heading', { name: '선택 계좌: 검토 테스트' })
        .waitFor();
    await page.getByRole('tab', { name: '자료 업로드', exact: true }).click();
    await page
        .getByRole('combobox', { name: '파일 형식', exact: true })
        .click();
    await page
        .getByRole('option', { name: '토스 거래내역 PDF', exact: true })
        .click();
    await page.getByLabel('파일', { exact: true }).setInputFiles({
        name: 'synthetic.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('synthetic extraction fixture'),
    });
    await page
        .getByRole('button', { name: '추출·미리보기', exact: true })
        .click();
    const review = page.locator('#portfolio-import-review');
    await review
        .getByRole('heading', {
            name: '추출 결과 미리보기 · 저장 전 검토',
            exact: true,
        })
        .waitFor();
    assert.equal(
        await page
            .getByRole('form', { name: '파일 업로드', exact: true })
            .isVisible(),
        false
    );
    await review.getByLabel(/첨부한 모든 거래내역서의 성명/).check();
    const baseline = calls.length;
    await review
        .getByRole('button', { name: '다음 페이지', exact: true })
        .click();
    await review.getByLabel('51행 종목', { exact: true }).waitFor();

    await review
        .getByRole('button', { name: '검토 필요 1', exact: true })
        .click();
    await review.getByLabel('57행 수량', { exact: true }).fill('3');
    await review.getByLabel('57행 거래 유형', { exact: true }).click();
    await page.getByRole('option', { name: '매수', exact: true }).click();
    await review.getByLabel('57행 종목', { exact: true }).fill('MSFT');
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    await review
        .getByLabel('추출 결과 검색', { exact: true })
        .fill('review-row-99');
    await review.getByLabel('99행 금액', { exact: true }).fill('125');
    assert.equal(
        await review.getByLabel('99행 종목', { exact: true }).inputValue(),
        'AAPL'
    );
    assert.equal(
        calls.length,
        baseline,
        'filtering, searching and editing do not call the API'
    );
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    await review
        .getByRole('button', { name: '주식 매수 80', exact: true })
        .click();
    assert.equal(
        await review.getByLabel('2행 종목', { exact: true }).inputValue(),
        'SCHD'
    );
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    await review.screenshot({
        path: `${output}/desktop.png`,
        style: 'header { visibility: hidden !important; }',
    });
    for (const width of [390, 768]) {
        await page.setViewportSize({ width, height: 900 });
        for (const dark of [false, true]) {
            await page.evaluate(
                (value) =>
                    document.documentElement.classList.toggle('p-dark', value),
                dark
            );
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth > innerWidth
                ),
                false,
                `${width}px ${dark ? 'dark' : 'light'}: no page overflow`
            );
            await review.screenshot({
                path: `${output}/${width}-${dark ? 'dark' : 'light'}.png`,
                style: 'header { visibility: hidden !important; }',
            });
        }
    }
    // Save with an active filter: all rows, including edits to off-screen rows, must be validated and sent.
    await review
        .getByLabel('추출 결과 검색', { exact: true })
        .fill('review-row-99');
    await review
        .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
        .click();
    await page
        .getByRole('heading', {
            name: '자료 저장이 완료되었습니다',
            exact: true,
        })
        .waitFor();
    assert.equal(committedRows.length, 120);
    assert.equal(committedRows[56].symbol, 'MSFT');
    assert.equal(committedRows[56].quantity, '3');
    assert.equal(committedRows[56].type, 'buy');
    assert.equal(committedRows[98].amount, '125');
    assert.equal(committedRows[0].amount, 50);
    assert.equal(
        calls.filter((action) => action === 'validateImport').length,
        1
    );
    assert.equal(calls.filter((action) => action === 'commit').length, 1);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: review filters preserve original row identity; all 120 rows and off-screen edits are validated/saved with an active filter; no API calls during edits; desktop/mobile light/dark layouts. Extraction and writes are synthetic fixtures.'
    );
} finally {
    await browser.close();
}
