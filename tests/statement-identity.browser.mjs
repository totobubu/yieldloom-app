// Vite on :5173. All identities, statements and API responses are synthetic fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const base = process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5173';
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 900 },
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (msg) => {
            if (msg.text().includes('Error captured')) errors.push(msg.text());
        });
        await page.route('**/src/services/firebaseClient*', (r) =>
            r.fulfill({
                contentType: 'application/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'statement-fixture',getIdToken:async()=> 'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,db=null,auth=null,googleProvider=null;`,
            })
        );
        await page.route('**/api/portfolio-capital*', (r) =>
            r.fulfill({
                json: { entries: [], classifications: [], allocations: [] },
            })
        );
        const family = {
            id: 'family',
            name: '합성 가족',
            kind: 'personal',
            profiles: {
                owner: { uid: 'statement-fixture', name: '등록된 별명' },
            },
        };
        const account = {
            id: 'account',
            familyId: 'family',
            ownerId: 'owner',
            institution: '토스증권',
            alias: '선택 계좌',
            type: 'general',
            maskedNumber: '****1234',
            permissions: { 'statement-fixture': 'owner' },
        };
        let pending = [],
            writes = 0,
            previews = 0;
        await page.route('**/api/family-portfolio*', (route) => {
            const action = new URL(route.request().url()).searchParams.get(
                'action'
            );
            if (action === 'preview') {
                previews++;
                pending.push({ action, route });
                return;
            }
            if (['validateImport', 'commit'].includes(action)) {
                assert.equal(
                    route.request().postDataJSON().identityConfirmed,
                    true
                );
                if (action === 'commit') writes++;
                pending.push({ action, route });
                return;
            }
            return route.fulfill({
                json: {
                    families: [family],
                    accounts: [account],
                    summary: null,
                },
            });
        });
        async function next(action) {
            const deadline = Date.now() + 10000;
            while (!pending.length && Date.now() < deadline)
                await page.waitForTimeout(20);
            assert.ok(pending.length, `Missing ${action} request`);
            const item = pending.shift();
            assert.equal(item.action, action);
            return item.route;
        }
        async function open() {
            await page.goto(base + '/mypage?tab=upload');
            await page
                .getByRole('button', { name: '추출·미리보기', exact: true })
                .waitFor();
            await page
                .locator('.portfolio-loading-overlay')
                .waitFor({ state: 'hidden' });
            assert.equal(
                await page
                    .getByText(/파일에서 확실히 확인할 수 없으면/)
                    .count(),
                0
            );
            await page
                .getByRole('combobox', { name: '파일 형식', exact: true })
                .click();
            await page
                .getByRole('option', { name: '토스 거래내역 PDF', exact: true })
                .click();
            await page
                .getByLabel('PDF 비밀번호', { exact: true })
                .fill('synthetic');
            await page
                .getByLabel('이 계좌의 기본 비밀번호로 암호화 저장')
                .uncheck();
        }
        async function upload(count) {
            await page.locator('input[type=file]').setInputFiles(
                Array.from({ length: count }, (_, i) => ({
                    name: `statement-${i + 1}.pdf`,
                    mimeType: 'application/pdf',
                    buffer: Buffer.from('%PDF-fixture'),
                }))
            );
            assert.equal(
                await page.getByLabel(/첨부한 모든 거래내역서/).count(),
                0
            );
            await page
                .getByRole('button', { name: '추출·미리보기', exact: true })
                .click();
        }
        function preview(index, status = 'matched') {
            return {
                reviewId: `review-${index}`,
                source: 'toss-pdf',
                asOf: '2026-10-20',
                rows: [
                    {
                        date: '2026-10-20',
                        symbol: 'CASH',
                        currency: 'KRW',
                        amount: 100,
                        type: 'cash_in',
                        externalId: `fixture-${index}`,
                    },
                ],
                errors: [],
                batches: [{ reviewId: `review-${index}`, start: 0, count: 1 }],
                statementIdentity: {
                    customerName: 'PDF에서 읽은 이름',
                    maskedNumber:
                        status === 'missing'
                            ? null
                            : status === 'mismatch'
                              ? '****9999'
                              : '****1234',
                    accountMatch: status,
                },
            };
        }
        await open();
        await upload(4);
        const dialog = page.getByRole('dialog', {
            name: '거래내역서를 읽고 있습니다',
            exact: true,
        });
        await dialog.waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), true);
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('Tab');
            assert.equal(
                await page.evaluate(
                    () => !!document.activeElement.closest('[role=dialog]')
                ),
                true
            );
        }
        for (let i = 0; i < 4; i++) {
            const route = await next('preview');
            await page
                .getByText(`${i} / 4개 파일 완료`, { exact: true })
                .waitFor();
            await dialog.getByText(`${i + 1}번째 파일 처리 중`).waitFor();
            await dialog
                .getByText('서버로 전송하고 거래내역을 추출하고 있습니다.')
                .waitFor();
            assert.equal(
                await dialog.locator('.p-progressbar-indeterminate').count(),
                1
            );
            assert.equal(
                await dialog
                    .getByRole('progressbar')
                    .getAttribute('aria-valuenow'),
                null
            );
            if (i === 0) {
                await page.clock.install();
                await page.clock.fastForward(21000);
                await dialog
                    .getByText('처리 시간 21초', { exact: true })
                    .waitFor();
                await dialog.getByText(/응답을 기다리고 있습니다/).waitFor();
                assert.equal(writes, 0);
                assert.equal(previews, 1);
            }
            if (i === 1) {
                await page.waitForTimeout(350);
                await page.screenshot({
                    path: `/tmp/portfolio-file-progress-${width}.png`,
                    fullPage: false,
                });
            }
            await route.fulfill({ json: preview(i) });
        }
        await page
            .getByRole('region', { name: '거래내역서 계좌 확인' })
            .waitFor();
        assert.equal(
            await page
                .getByText('PDF에서 추출한 성명: PDF에서 읽은 이름', {
                    exact: true,
                })
                .count(),
            4
        );
        assert.equal(
            await page
                .getByText('PDF에서 추출한 계좌번호: ****1234', { exact: true })
                .count(),
            4
        );
        const save = page.getByRole('button', {
            name: '수정 내용 검증·저장',
            exact: true,
        });
        assert.equal(await save.isDisabled(), true);
        assert.equal(writes, 0);
        await page.getByLabel(/첨부한 모든 거래내역서/).check();
        await save.click();
        for (let i = 0; i < 4; i++)
            await (
                await next('validateImport')
            ).fulfill({ json: { valid: true } });
        await page
            .getByRole('dialog', {
                name: '거래내역을 저장하고 있습니다',
                exact: true,
            })
            .waitFor();
        for (let i = 0; i < 4; i++)
            await (
                await next('commit')
            ).fulfill({ json: { inserted: 1, duplicates: 0 } });
        await page
            .getByRole('heading', {
                name: '자료 저장이 완료되었습니다',
                exact: true,
            })
            .waitFor();
        assert.equal(writes, 4);
        assert.equal(previews, 4);
        await page.waitForFunction(() =>
            document.activeElement?.matches('.import-result h2')
        );
        assert.equal(await page.locator('.import-workspace').count(), 0);
        assert.equal(await page.locator('input[type=file]').count(), 0);
        const resultHeading = await page
            .locator('.import-result h2')
            .boundingBox();
        assert.ok(resultHeading.y > 0 && resultHeading.y < 900);
        if (width === 390) {
            const another = await page
                .getByRole('button', { name: '추가 등록', exact: true })
                .boundingBox();
            const navigation = await page.locator('.mobile-nav').boundingBox();
            assert.ok(another.y + another.height <= navigation.y);
        }
        await page.getByText('STEP 3 · 저장 결과', { exact: true }).waitFor();
        await page
            .getByRole('button', { name: '추가 등록', exact: true })
            .click();
        assert.equal(await page.locator('.import-result').count(), 0);
        assert.equal(writes, 4);
        assert.equal(previews, 4);
        await page.waitForFunction(() =>
            document.activeElement?.matches('.import-heading h2')
        );
        assert.equal(await page.locator('input[type=file]').inputValue(), '');
        assert.equal(
            await page.getByLabel('PDF 비밀번호', { exact: true }).inputValue(),
            ''
        );
        for (const status of ['mismatch', 'missing']) {
            await open();
            await upload(2);
            await (await next('preview')).fulfill({ json: preview(0) });
            await (await next('preview')).fulfill({ json: preview(1, status) });
            await page
                .getByRole('region', { name: '거래내역서 계좌 확인' })
                .waitFor();
            assert.equal(await save.isDisabled(), true);
            assert.equal(
                await page.getByLabel(/첨부한 모든 거래내역서/).count(),
                0
            );
            assert.equal(writes, 4);
        }
        await page.getByRole('button', { name: '취소', exact: true }).click();
        assert.equal(
            await page.getByLabel(/첨부한 모든 거래내역서/).count(),
            0
        );
        await page
            .getByLabel('PDF 비밀번호', { exact: true })
            .fill('synthetic');
        await upload(1);
        await (
            await next('preview')
        ).fulfill({ status: 503, json: { error: '추출 실패 검증' } });
        await page.getByText('추출 실패 검증', { exact: true }).waitFor();
        await page
            .locator('.portfolio-loading-overlay')
            .waitFor({ state: 'hidden' });
        assert.equal(
            await page
                .getByRole('button', { name: '추출·미리보기', exact: true })
                .isEnabled(),
            true
        );
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}px: PDF identity after extraction, four-file progress, confirmed save, mixed/missing account blocking, cancellation and extraction error recovery`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
