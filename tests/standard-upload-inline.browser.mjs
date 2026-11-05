// Local memory API and synthetic identity only. No production account writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { waitForPortfolioPage } from './portfolio-navigation.mjs';
const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5175';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const uid = `inline-upload-test-${Date.now()}`,
    requests = [],
    errors = [];
await page.route('**/src/services/firebaseClient*', (route) =>
    route.fulfill({
        contentType: 'application/javascript',
        body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'${uid}',displayName:'합성 테스트 본인',email:'totobubu.lab@gmail.com',emailVerified:true,getIdToken:async()=>'${uid}'});export const authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,db=null,auth=null,googleProvider=null;`,
    })
);
await page.route('**/api/portfolio-capital*', (route) =>
    route.fulfill({
        json: { entries: [], classifications: [], allocations: [] },
    })
);
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
    if (request.url().includes('/api/family-portfolio'))
        requests.push({
            method: request.method(),
            action: new URL(request.url()).searchParams.get('action'),
            rows:
                new URL(request.url()).searchParams.get('action') === 'commit'
                    ? request.postDataJSON()?.rows
                    : undefined,
        });
});
const count = (action) => requests.filter((r) => r.action === action).length;
const button = (name) => page.getByRole('button', { name, exact: true });
const csv =
    'date,symbol,quantity,amount,currency,type,externalId\n2026-03-01,DEMO-K,10,100000,KRW,buy,DEMO-001\n2026-03-02,DEMO-A,2,0,USD,buy,DEMO-002\n2026-03-03,DEMO-K,2,,,sell,DEMO-003\n2026-03-04,DEMO-A,0,10,USD,dividend,DEMO-004\n2026-03-05,CASH,0,1000000,KRW,cash_in,DEMO-005\n2026-03-06,CASH,0,50000,KRW,cash_out,DEMO-006\n';
const choose = async () => {
    const selected = page.waitForEvent('filechooser');
    await button('파일 선택').click();
    await (
        await selected
    ).setFiles({
        name: 'DEMO_SIX_ROWS.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
    });
    await page.locator('#import-confirmed').check();
};
const extract = async () => {
    await button('추출·미리보기').click();
    await button('다음: 데이터 검토').waitFor();
    await page
        .getByRole('heading', { name: '원본 데이터 미리보기', exact: true })
        .evaluate((el) => el.scrollIntoView());
};
try {
    await page.route('**/api/stock-prices*', (route) =>
        route.fulfill({ json: { prices: {}, errors: [] } })
    );
    await page.goto(base + '/');
    await page
        .getByRole('heading', { name: 'ETF·주식 검색', exact: true })
        .waitFor();
    const rootStyle = () =>
        page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            return {
                color: style.color,
                background: style.backgroundColor,
                border: style.borderTopColor,
            };
        });
    const beforeImportStyles = await rootStyle();
    await page.goto(base + '/mypage?tab=assets');
    await waitForPortfolioPage(page, '자산관리');
    assert.deepEqual(
        await rootStyle(),
        beforeImportStyles,
        'upload styles must not recolor the global root'
    );
    await button('계좌 추가').click();
    await button('직접 입력').click();
    const registration = page.locator('.account-registration-page');
    await registration.getByLabel('금융기관', { exact: true }).fill('합성증권');
    await registration
        .getByLabel('별칭', { exact: true })
        .fill('합성 미리보기 계좌');
    await registration.getByLabel('계좌 끝 4자리 (선택)').fill('4153');
    await registration
        .getByRole('button', { name: '계좌 등록', exact: true })
        .click();
    await page
        .getByRole('dialog', { name: '자료 업로드 · 합성 미리보기 계좌' })
        .waitFor();
    await page.getByLabel('조회 종료일', { exact: true }).fill('2026-03-06');
    await choose();
    await extract();
    assert.equal(count('preview'), 1);
    assert.equal(await page.locator('.asset-upload-dialog--upload').count(), 1);
    assert.equal(await page.locator('.asset-upload-dialog--review').count(), 0);
    assert.equal(count('commit'), 0);
    assert.equal(await page.locator('.upload-sample-row').count(), 3);
    assert.equal(
        await page
            .locator('.upload-sample-row')
            .nth(1)
            .locator('td')
            .nth(3)
            .innerText(),
        '0'
    );
    assert.equal(
        await page
            .locator('.upload-sample-row')
            .nth(2)
            .locator('td')
            .nth(3)
            .innerText(),
        '미제공'
    );
    assert.equal(
        await page
            .locator('.upload-sample-row')
            .nth(2)
            .locator('td')
            .nth(4)
            .innerText(),
        '미지정'
    );
    assert.match(await page.locator('.upload-preview').innerText(), /총 6건/);
    assert.equal(await page.locator('#portfolio-import-review').count(), 0);
    const beforeResize = requests.length;
    for (const width of [834, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
    }
    assert.equal(
        requests.length,
        beforeResize,
        'preview resize adds no API request'
    );
    assert.equal(await page.locator('.upload-sample-card').count(), 3);
    await page.locator('#import-confirmed').uncheck();
    assert.equal(await button('다음: 데이터 검토').isDisabled(), true);
    await page.locator('#import-confirmed').check();
    await page.locator('.upload-settings > summary').click();
    await page.getByLabel('조회 종료일', { exact: true }).fill('2026-03-07');
    await button('추출·미리보기').waitFor();
    assert.equal(await page.locator('.upload-sample-card').count(), 0);
    assert.equal(count('preview'), 1, 'date invalidation is local');
    await extract();
    assert.equal(count('preview'), 2);
    await button('DEMO_SIX_ROWS.csv 제거').click();
    await button('추출·미리보기').waitFor();
    assert.equal(
        await page.locator('.upload-sample-card').count(),
        0,
        'remove purges inline data'
    );
    await choose();
    await extract();
    assert.equal(count('preview'), 3);
    await page.setViewportSize({ width: 390, height: 1000 });
    const beforeNext = requests.length;
    await button('다음: 데이터 검토').click();
    assert.equal(await page.locator('.asset-upload-dialog--upload').count(), 0);
    assert.equal(await page.locator('.asset-upload-dialog--review').count(), 1);
    await page
        .getByRole('heading', {
            name: /추출 결과 미리보기 · 저장 전 검토|증권 데이터 검토 및 확정/,
        })
        .waitFor();
    assert.equal(
        requests.length,
        beforeNext,
        'next stage reuses the existing review without another API request'
    );
    assert.equal(
        count('commit'),
        0,
        'inline preview and next do not commit ledger rows'
    );
    await page.getByRole('button', { name: '2행 수정', exact: true }).click();
    if (
        (await page
            .getByRole('button', { name: '3행 수정', exact: true })
            .getAttribute('aria-expanded')) !== 'true'
    )
        await page
            .getByRole('button', { name: '3행 수정', exact: true })
            .click();
    await page.getByLabel('2행 amount', { exact: true }).fill('200');
    await page.getByLabel('3행 amount', { exact: true }).fill('24000');
    await page
        .getByRole('combobox', { name: '3행 currency', exact: true })
        .click();
    await page.getByRole('option', { name: 'KRW', exact: true }).click();
    await page
        .getByLabel(
            '[필수] 원본 파일 대조 및 선택 계좌 거래·잔고 반영에 동의합니다.',
            { exact: true }
        )
        .check();
    await button('배당달력 포트폴리오에 저장 및 반영').click();
    await page
        .getByRole('heading', { name: /^증권 거래내역 저장 영수증$/ })
        .waitFor();
    assert.equal(count('commit'), 1);
    assert.match(await page.locator('.import-result').innerText(), /6/);
    await button('추가 등록').click();
    await page
        .getByRole('combobox', { name: '파일 형식', exact: true })
        .click();
    await page.getByRole('option', { name: /^표준 XLSX/ }).click();
    await page.getByLabel('조회 종료일', { exact: true }).fill('2026-03-07');
    const workbook = execFileSync(process.env.FAMILY_TEST_PYTHON || 'python3', [
        '-c',
        "from openpyxl import Workbook; from io import BytesIO; import sys; b=Workbook(); b.active.append(['date','symbol','quantity','amount','currency','type','externalId']); b.active.append(['2026-03-01','DEMO-X',0,2,'USD','dividend','DEMO-X-001']); s=b.create_sheet('not-imported'); s.append(['date','symbol']); s.append(['2026-03-01','DEMO-SECOND']); out=BytesIO(); b.save(out); b.close(); sys.stdout.buffer.write(out.getvalue())",
    ]);
    await page.getByLabel('파일', { exact: true }).setInputFiles({
        name: 'DEMO_FIRST_SHEET.xlsx',
        mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: workbook,
    });
    await page.locator('#import-confirmed').check();
    await extract();
    assert.equal(count('preview'), 4);
    assert.equal(await page.locator('.upload-sample-row').count(), 1);
    assert.match(await page.locator('.upload-preview').innerText(), /DEMO-X/);
    assert.ok(
        !(await page.locator('.upload-preview').innerText()).includes(
            'DEMO-SECOND'
        ),
        'standard XLSX still reads first sheet only'
    );
    const beforeXlsxNext = requests.length;
    await button('다음: 데이터 검토').click();
    await page
        .getByRole('heading', {
            name: /추출 결과 미리보기 · 저장 전 검토|증권 데이터 검토 및 확정/,
        })
        .waitFor();
    assert.equal(requests.length, beforeXlsxNext);
    assert.equal(
        count('commit'),
        1,
        'XLSX preview never commits automatically'
    );
    await button('1단계: 파일 다시 선택하기').click();
    await page
        .locator('.import-kind-choice label')
        .filter({ hasText: '잔고 스냅샷 (보유주식)' })
        .click();
    await page
        .getByRole('combobox', { name: '파일 형식', exact: true })
        .click();
    await page.getByRole('option', { name: '표준 CSV', exact: true }).click();
    await page.getByLabel('잔고 기준일', { exact: true }).fill('2026-03-07');
    await page.getByLabel('파일', { exact: true }).setInputFiles({
        name: 'DEMO_HOLDINGS.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
            'date,symbol,quantity,amount,currency\n2026-03-07,DEMO-H,1.25,,USD\n'
        ),
    });
    await page.locator('#import-confirmed').check();
    await extract();
    assert.equal(count('preview'), 5);
    assert.match(
        await page.locator('.upload-preview').innerText(),
        /보유 잔고/
    );
    assert.match(await page.locator('.upload-preview').innerText(), /미제공/);
    await page
        .locator('.import-kind-choice label')
        .filter({ hasText: '거래내역 (배당입금)' })
        .click();
    await button('추출·미리보기').waitFor();
    assert.equal(
        await page.locator('.upload-sample-row').count(),
        0,
        'kind changes purge the pending preview'
    );
    assert.equal(
        count('preview'),
        5,
        'kind changes do not request another extraction'
    );
    assert.equal(count('commit'), 1);
    // Actual generic Mobile cards: page/filter edit original rows and commit the full review.
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.getByLabel('조회 종료일', { exact: true }).fill('2026-03-10');
    const pageCsv =
        'date,symbol,quantity,amount,currency,type,externalId\n' +
        Array.from(
            { length: 101 },
            (_, index) =>
                `2026-03-10,PAGE-K,1,${index + 1},KRW,buy,PAGE-${String(index + 1).padStart(4, '0')}`
        ).join('\n') +
        '\n';
    await page.getByLabel('파일', { exact: true }).setInputFiles({
        name: 'DEMO_101_ROWS.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(pageCsv),
    });
    await page.locator('#import-confirmed').check();
    await extract();
    assert.equal(count('preview'), 6);
    const beforePageNext = requests.length;
    await button('다음: 데이터 검토').click();
    await page
        .getByRole('region', { name: '모바일 추출 거래 카드', exact: true })
        .waitFor();
    assert.equal(requests.length, beforePageNext);
    assert.equal(await page.locator('.generic-review-card').count(), 50);
    const beforeCardEdits = requests.length;
    await button('다음 페이지').click();
    await page.getByRole('button', { name: '51행 수정', exact: true }).click();
    await page.getByLabel('51행 quantity', { exact: true }).fill('2');
    await page.getByLabel('추출 결과 검색', { exact: true }).fill('PAGE-0099');
    assert.equal(await page.locator('.generic-review-card').count(), 1);
    await page.getByRole('button', { name: '99행 수정', exact: true }).click();
    await page.getByLabel('99행 amount', { exact: true }).fill('9999');
    await page.setViewportSize({ width: 834, height: 1100 });
    await page.locator('.generic-review-table').waitFor();
    assert.equal(await page.locator('.generic-review-card').count(), 0);
    await page.getByRole('button', { name: '99행 수정', exact: true }).click();
    await page.getByLabel('99행 quantity', { exact: true }).fill('4');
    assert.equal(
        requests.length,
        beforeCardEdits,
        'pagination/filter/Mobile and Tablet edits stay local'
    );
    await page
        .getByLabel(
            '[필수] 원본 파일 대조 및 선택 계좌 거래·잔고 반영에 동의합니다.',
            { exact: true }
        )
        .check();
    await button('배당달력 포트폴리오에 저장 및 반영').click();
    await page
        .getByRole('heading', { name: /^증권 거래내역 저장 영수증$/ })
        .waitFor();
    assert.equal(count('commit'), 2);
    const committed = requests.filter((r) => r.action === 'commit').at(-1).rows;
    assert.equal(committed.length, 101);
    assert.equal(committed[50].externalId, 'PAGE-0051');
    assert.equal(Number(committed[50].quantity), 2);
    assert.equal(committed[98].externalId, 'PAGE-0099');
    assert.equal(Number(committed[98].amount), 9999);
    assert.equal(Number(committed[98].quantity), 4);
    assert.deepEqual(errors, []);
    console.log(
        'PASS actual CSV/XLSX (first sheet)/holdings → one explicit preview per extraction → three rows/zero/missing values → scope invalidation → next without API → Mobile edits/full six-row commit and Mobile→Tablet filtered101-row commit with original row identity; four widths, no page overflow, no production writes.'
    );
} catch (error) {
    console.error(
        JSON.stringify({
            url: page.url(),
            pageErrors: errors,
            body: (await page.locator('body').innerText()).slice(0, 600),
        })
    );
    throw error;
} finally {
    await browser.close();
}
