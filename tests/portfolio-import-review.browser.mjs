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
    const rows = Array.from({ length: 4716 }, (_, index) => ({
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
    rows[0] = {
        ...rows[0],
        date: '2026-03-25',
        symbol: 'SCHD',
        securityName: 'Schwab US Dividend Equity ETF',
        quantity: 180,
        amount: 148.32,
        nativeTax: 22.25,
        nativeSettlementAmount: 126.07,
    };
    rows[1] = {
        ...rows[1],
        symbol: 'A039980',
        securityName: '폴라리스AI',
        quantity: 1,
        amount: 3025,
        currency: 'KRW',
    };
    rows[2] = {
        ...rows[2],
        symbol: 'A041020',
        securityName: '폴라리스오피스',
        quantity: 1,
        amount: 9870,
        currency: 'KRW',
    };
    rows[3] = {
        ...rows[3],
        symbol: 'CASH',
        securityName: '',
        type: 'cash_out',
        currency: 'KRW',
        quantity: null,
        amount: 14775,
        cashKind: 'exchange',
        rawType: '즉시환전 원화출금',
        exchangeRate: 1477.48,
    };
    rows[4] = {
        ...rows[4],
        symbol: 'CASH',
        securityName: '',
        type: 'cash_in',
        currency: 'USD',
        quantity: null,
        amount: 10,
        cashKind: 'exchange',
        rawType: '즉시환전 외화입금',
        exchangeRate: 1477.48,
    };
    rows[5] = {
        ...rows[5],
        symbol: 'YMAX',
        securityName: 'YieldMax Universe Fund of Option Income ETFs',
        _mappingIsin: 'US88636J6597',
        type: 'buy',
        amount: 9.999968,
        nativeSettlementAmount: 10,
        settlementAmount: 14775,
        exchangeRate: 1477.48,
        quantity: 0.110754,
    };
    rows[6] = {
        ...rows[6],
        symbol: 'UNKNOWN',
        securityName: '미식별 종목',
        type: 'unknown',
        _mappingStatus: 'unresolved',
        quantity: null,
    };
    rows[98].externalId = 'edit-target-99';
    const batches = Array.from(
        { length: Math.ceil(rows.length / 200) },
        (_, index) => ({
            reviewId: `review-fixture-${index}`,
            start: index * 200,
            count: Math.min(200, rows.length - index * 200),
        })
    );
    const initialBuyCount = rows.filter((row) => row.type === 'buy').length;
    const calls = [];
    const committedRows = [];
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
                    batches,
                    asOf: '2026-10-15',
                },
            });
        if (action === 'validateImport')
            return route.fulfill({ json: { valid: true } });
        if (action === 'commit') {
            committedRows.push(...route.request().postDataJSON().rows);
            return route.fulfill({
                json: {
                    inserted: route.request().postDataJSON().rows.length,
                    duplicates: 0,
                },
            });
        }
        return route.continue();
    });
    await page.goto(base + '/mypage');
    await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="tab"]')].some(
            (tab) =>
                tab.textContent?.includes('자산관리') &&
                tab.getAttribute('aria-selected') === 'true'
        )
    );
    await page.getByRole('button', { name: '계좌 추가', exact: true }).click();
    await page.getByLabel('금융기관', { exact: true }).fill('토스증권');
    await page.getByLabel('별칭', { exact: true }).fill('검토 테스트');
    await page.getByRole('button', { name: '계좌 등록', exact: true }).click();
    await page
        .getByRole('heading', { name: '선택 계좌: 검토 테스트' })
        .waitFor();
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
    assert.equal(
        await review
            .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
            .isEnabled(),
        true
    );
    await review
        .getByRole('button', { name: '다음 페이지', exact: true })
        .click();
    await review
        .getByRole('button', { name: '8행 수정', exact: true })
        .waitFor();

    await review
        .getByRole('button', { name: '검토 필요 2', exact: true })
        .click();
    await review
        .getByRole('button', { name: '57행 수정', exact: true })
        .click();
    await review.getByLabel('57행 수량', { exact: true }).fill('3');
    await review.getByLabel('57행 거래 유형', { exact: true }).click();
    await page.getByRole('option', { name: '매수', exact: true }).click();
    await review.getByLabel('57행 종목', { exact: true }).fill('MSFT');
    assert.equal(await review.locator('.money-input > span').innerText(), '$');
    await review
        .getByRole('button', { name: '수정 적용', exact: true })
        .click();
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    await review
        .getByLabel('추출 결과 검색', { exact: true })
        .fill('edit-target-99');
    await review
        .getByRole('button', { name: '99행 수정', exact: true })
        .click();
    await review.getByLabel('99행 금액', { exact: true }).fill('125');
    assert.equal(
        await review.getByLabel('99행 종목', { exact: true }).inputValue(),
        'AAPL'
    );
    await review
        .getByRole('button', { name: '수정 적용', exact: true })
        .click();
    assert.equal(
        calls.length,
        baseline,
        'filtering, searching and editing do not call the API'
    );
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    await review
        .getByRole('button', {
            name: `주식 매수 ${initialBuyCount + 1}`,
            exact: true,
        })
        .click();
    assert.equal(
        await review
            .locator('tbody')
            .getByText('폴라리스AI', { exact: true })
            .count(),
        1
    );
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    assert.equal(
        await review.locator('tbody .p-inputtext').count(),
        0,
        'default rows render text, not input forms'
    );
    assert.equal(
        await review
            .locator('tbody .quantity-cell')
            .nth(5)
            .evaluate((cell) => getComputedStyle(cell).whiteSpace),
        'nowrap',
        'fractional share quantities stay on one line'
    );
    assert.equal(
        await review
            .getByRole('columnheader', { name: '통화', exact: true })
            .count(),
        0
    );
    assert.equal(
        await review
            .locator('.p-datatable-table-container')
            .evaluate(
                (element) => element.scrollWidth > element.clientWidth + 1
            ),
        false,
        'desktop table has no horizontal scroll'
    );
    await review
        .getByRole('button', { name: '폴라리스AI 1건 보기', exact: true })
        .click();
    await review.getByLabel('선택 종목 정보', { exact: true }).waitFor();
    await review.screenshot({
        path: `${output}/domestic.png`,
        style: 'header, .skip-link, .mobile-nav { visibility: hidden !important; } .review-save-bar { position: static !important; }',
    });

    assert.match(
        await review.getByLabel('선택 종목 정보', { exact: true }).innerText(),
        /폴라리스AI.*A039980/s
    );
    assert.equal(
        await review
            .getByRole('columnheader', { name: '종목명 / 티커', exact: true })
            .count(),
        0
    );
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    await review
        .getByRole('combobox', { name: '추출 종목 필터', exact: true })
        .click();
    await page.getByRole('option', { name: 'YMAX', exact: true }).click();
    assert.match(
        await review.getByLabel('선택 종목 정보', { exact: true }).innerText(),
        /US88636J6597/
    );
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    await review
        .getByRole('button', { name: '현금·환전 2', exact: true })
        .click();
    const excludeConversions = review.getByRole('checkbox', {
        name: '구매 결제에 연결된 환전 출금 제외 (1건)',
        exact: true,
    });
    assert.equal(await excludeConversions.isChecked(), true);
    assert.equal(
        await review.getByLabel('4행 선택', { exact: true }).count(),
        0,
        'purchase conversion withdrawal is filtered'
    );
    assert.equal(
        await review.getByLabel('5행 선택', { exact: true }).count(),
        1,
        'paired USD deposit stays auditable'
    );
    await excludeConversions.uncheck();
    assert.equal(
        await review.getByLabel('4행 선택', { exact: true }).count(),
        1,
        'original withdrawal can be shown'
    );
    await excludeConversions.check();
    await review.screenshot({
        path: `${output}/cash.png`,
        style: 'header, .skip-link, .mobile-nav { visibility: hidden !important; } .review-save-bar { position: static !important; }',
    });
    await review
        .getByLabel('추출 결과 검색', { exact: true })
        .fill('no-such-cash');
    assert.equal(
        await review.locator('.funding-preview').count(),
        0,
        'empty cash filter does not show unrelated funding matches'
    );
    await review.getByLabel('추출 결과 검색', { exact: true }).fill('');
    await review.locator('.funding-preview button').first().click();
    const funding = review.getByRole('dialog', {
        name: '매수 결제 구성',
        exact: true,
    });
    await funding.waitFor();
    await funding.screenshot({ path: `${output}/funding-dialog.png` });

    assert.match(await funding.innerText(), /₩14,775/);
    assert.match(await funding.innerText(), /\$10.00/);
    assert.match(await funding.innerText(), /YMAX/);
    assert.match(await funding.innerText(), /최초 출처는 별도 확인/);
    assert.match(await funding.innerText(), /같은 날짜 환전 자금을/);
    await funding.locator('.p-dialog-close-button').click();
    await review
        .getByRole('button', { name: '필터 초기화', exact: true })
        .click();
    assert.equal(
        calls.length,
        baseline,
        'names, symbol context, currency display and funding preview are local'
    );
    await page.setViewportSize({ width: 1280, height: 1000 });
    assert.equal(
        await review
            .locator('.p-datatable-table-container')
            .evaluate(
                (element) => element.scrollWidth > element.clientWidth + 1
            ),
        false,
        '1280px reference width has no horizontal table scroll'
    );
    await review.screenshot({
        path: `${output}/desktop.png`,
        style: 'header, .skip-link, .mobile-nav { visibility: hidden !important; } .review-save-bar { position: static !important; }',
    });
    for (const width of [320, 360, 390, 430, 768, 1024, 1201, 1280]) {
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
            const metricOverflow = await review
                .locator('.review-metrics')
                .evaluate((region) => {
                    const problems = [];
                    for (const card of region.querySelectorAll(
                        '.metric-card'
                    )) {
                        const bounds = card.getBoundingClientRect();
                        if (card.scrollWidth > card.clientWidth + 1)
                            problems.push('card scroll overflow');
                        const walker = document.createTreeWalker(
                            card,
                            NodeFilter.SHOW_TEXT
                        );
                        while (walker.nextNode()) {
                            const node = walker.currentNode;
                            if (!node.textContent.trim()) continue;
                            const textBounds =
                                node.parentElement
                                    .closest('.trade-counts > div')
                                    ?.getBoundingClientRect() || bounds;
                            const range = document.createRange();
                            range.selectNodeContents(node);
                            for (const rect of range.getClientRects()) {
                                if (
                                    rect.left < textBounds.left - 1 ||
                                    rect.right > textBounds.right + 1
                                )
                                    problems.push(node.textContent.trim());
                            }
                        }
                    }
                    for (const value of region.querySelectorAll(
                        '.trade-counts b, .issue-metric button'
                    )) {
                        if (
                            value.getBoundingClientRect().height >
                            parseFloat(getComputedStyle(value).lineHeight) + 1
                        )
                            problems.push(
                                `wrapped value/action: ${value.textContent}`
                            );
                    }
                    return problems;
                });
            assert.deepEqual(
                metricOverflow,
                [],
                `${width}px: metric content stays inside cards`
            );
            await review.locator('.review-metrics').screenshot({
                path: `${output}/metrics-${width}-${dark ? 'dark' : 'light'}.png`,
            });
            await review.screenshot({
                path: `${output}/${width}-${dark ? 'dark' : 'light'}.png`,
                style: 'header, .skip-link, .mobile-nav { visibility: hidden !important; } .review-save-bar { position: static !important; }',
            });
        }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await review.getByLabel('1행 선택', { exact: true }).check();
    await review.getByLabel('2행 선택', { exact: true }).check();
    await review
        .getByRole('combobox', { name: '일괄 변경할 거래 유형', exact: true })
        .click();
    await page.getByRole('option', { name: '매도', exact: true }).click();
    await review.getByRole('button', { name: '적용', exact: true }).click();
    // Save with an active filter: all rows, including edits to off-screen rows, must be validated and sent.
    await review
        .getByLabel('추출 결과 검색', { exact: true })
        .fill('edit-target-99');
    await review
        .getByRole('button', { name: '수정 내용 검증·저장', exact: true })
        .click();
    await page
        .getByRole('heading', {
            name: '자료 저장이 완료되었습니다',
            exact: true,
        })
        .waitFor();
    assert.equal(committedRows.length, rows.length);
    assert.equal(committedRows[56].symbol, 'MSFT');
    assert.equal(committedRows[56].quantity, '3');
    assert.equal(committedRows[56].type, 'buy');
    assert.equal(committedRows[98].amount, '125');
    assert.equal(committedRows[0].amount, 148.32);
    assert.equal(committedRows[0].type, 'sell');
    assert.equal(committedRows[1].type, 'sell');
    assert.equal(
        committedRows[2].type,
        rows[2].type,
        'bulk edit changes only selected original indices'
    );
    assert.equal(
        calls.filter((action) => action === 'validateImport').length,
        batches.length
    );
    assert.equal(
        calls.filter((action) => action === 'commit').length,
        batches.length
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: review filters preserve original row identity; all 4716 rows in 24 batches and off-screen edits are validated/saved with an active filter; no API calls during edits; desktop/mobile light/dark layouts. Extraction and writes are synthetic fixtures.'
    );
} finally {
    await browser.close();
}
