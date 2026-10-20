// Local Vite + tests/family_portfolio_test_server.py; synthetic identity only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5175';
const output = path.join(os.tmpdir(), 'yieldloom-asset-management-review');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [],
    requests = [],
    reads = [];
const uid = `asset-test-${Date.now()}`;
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
    if (request.url().includes('/api/family-portfolio'))
        requests.push({ method: request.method(), url: request.url() });
});
page.on('response', (response) => {
    if (response.url().includes('/api/family-portfolio'))
        reads.push({
            url: response.url(),
            documents: response.headers()['x-portfolio-document-reads'],
            operations: response.headers()['x-portfolio-read-operations'],
        });
});
await page.route('**/src/services/firebaseClient*', (route) =>
    route.fulfill({
        contentType: 'application/javascript',
        body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js'; export const firebaseUser=ref({uid:'${uid}',displayName:'테스트 본인',getIdToken:async()=>'${uid}'}); export const authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,db=null,auth=null,googleProvider=null;`,
    })
);
await page.route('**/api/portfolio-capital*', (route) =>
    route.fulfill({
        json: { entries: [], classifications: [], allocations: [] },
    })
);
const button = (name) => page.getByRole('button', { name, exact: true });
const closeDialog = async () => {
    await page.locator('.p-dialog-close-button').waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () => document.querySelectorAll('[role="dialog"]').length === 0
    );
};
const addAccount = async (alias, last4) => {
    await button('계좌 추가').click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('금융기관', { exact: true }).fill('테스트증권');
    await dialog.getByLabel('별칭', { exact: true }).fill(alias);
    await dialog.getByLabel('계좌 끝 4자리 (선택)').fill(last4);
    await dialog
        .getByRole('button', { name: '계좌 등록', exact: true })
        .click();
    await page
        .getByRole('dialog', { name: `자료 업로드 · ${alias}` })
        .waitFor();
    await closeDialog();
};
try {
    await page.goto(base + '/mypage?tab=upload');
    await page.getByRole('tab', { name: '자산관리', exact: true }).waitFor();
    await button('계좌 추가').waitFor();
    await page.waitForURL('**/mypage?tab=assets');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(await page.getByRole('tab').allTextContents(), [
        '한눈에 보기',
        '배당 캘린더',
        '배당 분석',
        '자산관리',
    ]);
    assert.equal(requests.filter((r) => r.method === 'GET').length, 1);
    await addAccount('본인 계좌', '1234');
    await button('가족 추가').click();
    await page.getByLabel('가족 이름', { exact: true }).fill('배우자');
    await button('가족 등록').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: '배우자의 계좌' }).waitFor();
    assert.equal(await page.locator('.accounts li').count(), 0);
    await addAccount('가족 계좌', '4321');
    const before = requests.length;
    await button('테스트 본인').click();
    await page
        .getByText('테스트증권 · 본인 계좌 · ****1234', { exact: true })
        .waitFor();
    await button('배우자').click();
    await page
        .getByText('테스트증권 · 가족 계좌 · ****4321', { exact: true })
        .waitFor();
    await page.getByRole('tab', { name: '한눈에 보기', exact: true }).click();
    await page.getByRole('tab', { name: '자산관리', exact: true }).click();
    assert.equal(
        requests.length,
        before,
        'people and tab selection add no API requests'
    );
    await button('자료 업로드').click();
    await page
        .getByRole('dialog', { name: '자료 업로드 · 가족 계좌' })
        .waitFor();
    await closeDialog();
    await button('계좌 추가').click();
    await page
        .getByRole('dialog')
        .getByRole('button', { name: '문서로 등록', exact: true })
        .click();
    await page.getByLabel('토스 거래내역 PDF', { exact: true }).setInputFiles({
        name: 'invalid.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('invalid'),
    });
    await page.getByLabel('PDF 비밀번호', { exact: true }).fill('fixture');
    await button('계좌 정보 추출').click();
    await page
        .getByRole('dialog')
        .getByText('토스 거래내역 PDF를 선택하세요.', { exact: true })
        .waitFor();
    await closeDialog();
    if (process.env.FAMILY_TEST_SYNTHETIC_PDF === '1') {
        await button('계좌 추가').click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: '문서로 등록', exact: true })
            .click();
        await page
            .getByLabel('토스 거래내역 PDF', { exact: true })
            .setInputFiles({
                name: 'synthetic.pdf',
                mimeType: 'application/pdf',
                buffer: Buffer.from('%PDF-asset-management-fixture'),
            });
        await page.getByLabel('PDF 비밀번호', { exact: true }).fill('wrong');
        await button('계좌 정보 추출').click();
        await page
            .getByRole('dialog')
            .getByText('PDF 비밀번호를 확인하세요.', { exact: true })
            .waitFor();
        await page.getByLabel('PDF 비밀번호', { exact: true }).fill('fixture');
        await button('계좌 정보 추출').click();
        await page
            .getByText('추출된 명의: 배우자 · ****5678', { exact: true })
            .waitFor();
        await page.getByLabel('별칭', { exact: true }).last().fill('문서 계좌');
        await page
            .getByLabel('원본의 명의·계좌와 선택 가족을 확인했습니다.')
            .check();
        await button('계좌 등록').click();
        await page.getByRole('heading', { name: /검토 · toss-pdf/ }).waitFor();
        await page.getByLabel(/첨부한 모든 거래내역서/).check();
        await button('수정 내용 검증·저장').click();
        await page.getByText('저장 1행 · 중복 0행', { exact: true }).waitFor();
        await closeDialog();
        await page
            .getByText('토스증권 · 문서 계좌 · ****5678', { exact: true })
            .waitFor();
        await button('계좌 추가').click();
        await page
            .getByRole('dialog')
            .getByRole('button', { name: '문서로 등록', exact: true })
            .click();
        await page
            .getByLabel('토스 거래내역 PDF', { exact: true })
            .setInputFiles({
                name: 'synthetic.pdf',
                mimeType: 'application/pdf',
                buffer: Buffer.from('%PDF-asset-management-fixture'),
            });
        await page.getByLabel('PDF 비밀번호', { exact: true }).fill('fixture');
        await button('계좌 정보 추출').click();
        await page
            .getByText('추출된 명의: 배우자 · ****5678', { exact: true })
            .waitFor();
        await page
            .getByLabel('별칭', { exact: true })
            .last()
            .fill('업로드 재시도 계좌');
        await page.getByLabel('계좌 끝 4자리 (선택)').fill('6789');
        await page
            .getByLabel('원본의 명의·계좌와 선택 가족을 확인했습니다.')
            .check();
        await page.route('**/api/family-portfolio?action=preview', (route) =>
            route.fulfill({ status: 500, json: { error: '합성 업로드 실패' } })
        );
        await button('계좌 등록').click();
        await page.getByText('합성 업로드 실패', { exact: true }).waitFor();
        await closeDialog();
        await page.unroute('**/api/family-portfolio?action=preview');
        await page
            .getByText('토스증권 · 업로드 재시도 계좌 · ****6789', {
                exact: true,
            })
            .waitFor();
    }
    await page.screenshot({
        path: path.join(output, 'desktop.png'),
        fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
        path: path.join(output, 'mobile.png'),
        fullPage: true,
    });
    assert.equal(
        await page.evaluate(
            () => document.documentElement.scrollWidth > window.innerWidth
        ),
        false
    );
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    await button('가족 추가').click();
    await page.getByLabel('가족 이름', { exact: true }).waitFor();
    await page
        .getByRole('dialog')
        .evaluate((element) =>
            Promise.all(
                element
                    .getAnimations({ subtree: true })
                    .map((animation) => animation.finished)
            )
        );
    await page.screenshot({
        path: path.join(output, 'mobile-dark-dialog.png'),
        fullPage: true,
    });
    await closeDialog();
    assert.equal(
        await button('가족 추가').evaluate(
            (element) => element === document.activeElement
        ),
        true
    );
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify(
            {
                result: 'passed',
                screenshots: output,
                requests: requests.length,
                reads,
            },
            null,
            2
        )
    );
} catch (error) {
    console.log(await page.getByRole('dialog').allTextContents());
    await page.screenshot({
        path: path.join(output, 'failure.png'),
        fullPage: true,
    });
    throw error;
} finally {
    await browser.close();
}
