// Synthetic PDF identity inspection only. No account creation, upload commit or user data writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const output =
    process.env.STITCH_STATE_DIR || '/tmp/yieldloom-stitch-registration-states';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const results = [];
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(page, { admin: true });
        const failures = await installStaticAssets(page);
        const mutations = [],
            errors = [];
        let mode = 'success',
            inspectCount = 0,
            release;
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (
                request.url().includes('/api/') &&
                request.method() !== 'GET' &&
                !request.url().includes('action=inspectAccountDocument')
            )
                mutations.push(request.url());
        });
        await page.route(
            '**/api/family-portfolio?action=inspectAccountDocument',
            async (route) => {
                inspectCount++;
                if (mode === 'pending')
                    await new Promise((resolve) => {
                        release = resolve;
                    });
                if (mode === 'error')
                    return route.fulfill({
                        status: 422,
                        json: { error: '합성 문서 식별 오류' },
                    });
                return route.fulfill({
                    json: {
                        customerName: mode === 'viewer' ? '이모음' : '김모음',
                        institution:
                            mode === 'viewer' ? '미래에셋' : '토스증권',
                        maskedNumber:
                            mode === 'viewer' ? '****0884' : '****0115',
                    },
                });
            }
        );
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/mypage?tab=assets'
        );
        await page
            .getByRole('button', { name: '계좌 추가', exact: true })
            .click();
        const form = page.locator('.account-registration');
        const register = form.getByRole('button', {
            name: '계좌 등록',
            exact: true,
        });
        const inspect = form.getByRole('button', {
            name: '계좌 정보 추출',
            exact: true,
        });
        const pdf = form.getByLabel('토스 거래내역 PDF', { exact: true });
        const password = form.getByLabel('PDF 비밀번호', { exact: true });
        const capture = async (name) => {
            await page.evaluate(() => document.fonts.ready);
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                )
            );
            await page.screenshot({
                path: `${output}/${name}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
            results.push({ name, width, status: 'passed' });
        };
        assert.equal(await register.isDisabled(), true);
        assert.equal(await inspect.isDisabled(), true);
        await capture('document-empty');
        await form
            .getByRole('button', { name: '직접 입력', exact: true })
            .click();
        assert.equal(await pdf.count(), 0);
        assert.equal(await register.isDisabled(), false);
        await form.getByLabel('금융기관', { exact: true }).fill('합성 증권');
        await form.getByLabel('별칭', { exact: true }).fill('직접 입력 예시');
        await capture('manual-input');
        await form
            .getByRole('button', { name: '문서로 등록', exact: true })
            .click();
        await pdf.focus();
        assert.equal(
            await page.evaluate(() => document.activeElement?.id),
            'registration-pdf'
        );
        const keyboardChooser = page.waitForEvent('filechooser');
        await page.keyboard.press('Enter');
        await (await keyboardChooser).setFiles({
            name: 'oversize.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
        });
        await password.fill('fixture');
        await inspect.click();
        await form
            .getByText('2MB 이하 PDF를 선택하세요.', { exact: true })
            .waitFor();
        assert.equal(inspectCount, 0);
        await capture('document-oversize');
        const pointerChooser = page.waitForEvent('filechooser');
        await form.locator('.document-upload').click();
        await (await pointerChooser).setFiles({
            name: 'synthetic.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-synthetic-identity-only'),
        });
        assert.match(
            await form.locator('.document-file-info').innerText(),
            /synthetic\.pdf.*선택됨/
        );
        mode = 'error';
        await inspect.click();
        await form.getByText('합성 문서 식별 오류', { exact: true }).waitFor();
        assert.equal(await register.isDisabled(), true);
        await capture('inspection-error');
        mode = 'pending';
        await inspect.click();
        await page.waitForFunction(
            () => document.querySelector('#registration-password')?.disabled
        );
        assert.equal(await pdf.isDisabled(), true);
        await capture('inspection-pending');
        release();
        mode = 'success';
        await form
            .getByText('추출된 명의: 김모음 · ****0115', { exact: true })
            .waitFor();
        assert.equal(await register.isDisabled(), true);
        assert.equal(
            await form.getByLabel('금융기관', { exact: true }).inputValue(),
            '토스증권'
        );
        await capture('identified-unconfirmed-duplicate');
        await form
            .getByLabel('원본의 명의·계좌와 선택 가족을 확인했습니다.')
            .check();
        assert.equal(await register.isDisabled(), false);
        await capture('identified-confirmed');
        await password.fill('changed-fixture');
        assert.equal(await register.isDisabled(), true);
        assert.equal(
            await form.getByText('추출된 명의:', { exact: false }).count(),
            0
        );
        await capture('identity-invalidated');
        mode = 'viewer';
        await inspect.click();
        await form
            .getByText('추출된 명의: 이모음 · ****0884', { exact: true })
            .waitFor();
        assert.equal(
            await form
                .getByRole('button', {
                    name: '미래에셋 예시 계좌에 자료 업로드',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        await capture('duplicate-viewer-upload-disabled');
        mode = 'success';
        await password.fill('last-fixture');

        await inspect.click();
        await form
            .getByText('추출된 명의: 김모음 · ****0115', { exact: true })
            .waitFor();
        await form
            .getByRole('button', {
                name: '토스증권 예시 계좌에 자료 업로드',
                exact: true,
            })
            .click();
        await page
            .getByRole('dialog', {
                name: '자료 업로드 · 토스증권 예시 계좌',
                exact: true,
            })
            .waitFor();
        assert.equal(await form.count(), 0);
        await capture('duplicate-existing-upload');
        assert.deepEqual(mutations, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        await page.close();
        console.log(
            `PASS ${width}: 10 registration states; extraction-only POST; no account writes, errors or overflow`
        );
    }
} finally {
    await browser.close();
    await fs.writeFile(
        `${output}/results.json`,
        JSON.stringify(
            {
                dataset:
                    'synthetic inspection responses and PDF bytes; no real identity document',
                results,
            },
            null,
            2
        )
    );
}
