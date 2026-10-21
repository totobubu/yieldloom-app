// Synthetic auth, PDF and API responses; no personal documents or ledger writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const dark of [false, true]) {
        const page = await browser.newPage({
            viewport: { width: 390, height: 780 },
            isMobile: true,
            hasTouch: true,
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/src/services/firebaseClient*', (route) =>
            route.fulfill({
                contentType: 'application/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref({uid:'mobile-fixture',email:'totobubu.lab@gmail.com',emailVerified:true,getIdToken:async()=> 'fixture'}),authLoading=ref(false),signedIn=computed(()=>true),firebaseReady=false,db=null,auth=null,googleProvider=null;`,
            })
        );
        const family = {
            id: 'family',
            name: '합성 가족',
            kind: 'personal',
            profiles: { owner: { uid: 'mobile-fixture', name: '검증 사용자' } },
        };
        const account = {
            id: 'account',
            familyId: 'family',
            ownerId: 'owner',
            institution: '토스증권',
            alias: '모바일 검증',
            type: 'general',
            maskedNumber: '****1234',
            pdfPasswordConfigured: true,
            permissions: { 'mobile-fixture': 'owner' },
        };
        let pending,
            previews = 0,
            writes = 0;
        await page.route('**/api/portfolio-capital*', (route) =>
            route.fulfill({
                json: { entries: [], classifications: [], allocations: [] },
            })
        );
        await page.route('**/api/family-portfolio*', (route) => {
            const action = new URL(route.request().url()).searchParams.get(
                'action'
            );
            if (action === 'preview') {
                previews++;
                pending = route;
                return;
            }
            if (['commit', 'validateImport'].includes(action)) writes++;
            return route.fulfill({
                json: {
                    families: [family],
                    accounts: [account],
                    summary: null,
                },
            });
        });
        await page.goto(
            (process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5175') +
                '/mypage?tab=upload'
        );
        await page
            .getByRole('button', { name: '자료 업로드', exact: true })
            .click();
        const overlay = page.locator('.portfolio-loading-overlay');
        const button = page.getByRole('button', {
            name: '추출·미리보기',
            exact: true,
        });
        await button.waitFor();
        await overlay.waitFor({ state: 'hidden' });
        if (dark)
            await page.evaluate(() =>
                document.documentElement.classList.add('p-dark')
            );
        await page
            .getByRole('combobox', { name: '파일 형식', exact: true })
            .click();
        await page
            .getByRole('option', { name: '토스 거래내역 PDF', exact: true })
            .click();
        // Even synchronous validation failures must finish loading and show feedback.
        await button.click();
        await page.waitForFunction(() =>
            document.activeElement?.classList.contains('import-error')
        );
        assert.match(
            await page.locator('.import-error').innerText(),
            /계좌와 파일을 선택/
        );
        assert.equal(previews, 0);
        await page.getByText('눌러서 PDF 파일 선택', { exact: true }).waitFor();
        assert.equal(
            await page.locator('.dropzone-desktop').first().isVisible(),
            false
        );
        const [chooser] = await Promise.all([
            page.waitForEvent('filechooser'),
            page
                .getByRole('button', { name: 'PDF 파일 선택', exact: true })
                .tap(),
        ]);
        assert.equal(chooser.isMultiple(), true);
        await chooser.setFiles({
            name: 'synthetic-mobile.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-fixture'),
        });
        // A document-provider read failure must be reported before any HTTP request.
        await page.evaluate(() => {
            window.originalFileArrayBuffer = File.prototype.arrayBuffer;
            File.prototype.arrayBuffer = () =>
                Promise.reject(
                    new DOMException(
                        'Fixture file unavailable',
                        'NotReadableError'
                    )
                );
        });
        await button.click();
        await page.waitForFunction(() =>
            document.activeElement?.classList.contains('import-error')
        );
        assert.match(
            await page.locator('.import-error').innerText(),
            /파일을 읽을 수 없습니다/
        );
        assert.equal(previews, 0);
        assert.equal(
            await page.locator('.import-file-list .import-file').count(),
            1
        );
        await page.evaluate(() => {
            File.prototype.arrayBuffer = window.originalFileArrayBuffer;
        });
        await button.click();
        await page.waitForFunction(
            () => document.querySelector('.preview-button')?.disabled === true
        );
        assert.equal(
            await page.getByRole('dialog', { name: /자료 업로드/ }).isVisible(),
            true,
            'Upload feedback stays in the active dialog'
        );
        const request = pending.request().postData();
        assert.match(request, /%PDF-fixture/);
        assert.match(request, /name="password"\r\n\r\n\r\n/); // Uses the configured password.
        await pending.fulfill({
            status: 400,
            json: {
                error: 'PDF를 해석하지 못했습니다. 지원 형식과 비밀번호를 확인하세요.',
            },
        });
        await page.waitForFunction(
            () => document.querySelector('.preview-button')?.disabled === false
        );
        const notice = page.locator('.import-error');
        await page.waitForFunction(() =>
            document.activeElement?.classList.contains('import-error')
        );
        async function inViewport(locator) {
            const box = await locator.boundingBox();
            assert.ok(
                box && box.y >= 0 && box.y + box.height < 710,
                JSON.stringify(box)
            );
        }
        await inViewport(notice);
        assert.match(await notice.innerText(), /비밀번호를 확인/);
        assert.equal(
            await page.locator('.import-file-list .import-file').count(),
            1
        );
        await page.screenshot({
            path: `/tmp/mobile-import-error-${dark ? 'dark' : 'light'}.png`,
        });
        // Password correction clears stale feedback, and retry sends the same file once.
        await page
            .getByLabel('PDF 비밀번호', { exact: true })
            .fill('corrected-fixture');
        assert.equal(await notice.count(), 0);
        pending = null;
        await button.click();
        await page.waitForFunction(
            () => document.querySelector('.preview-button')?.disabled === true
        );
        assert.match(pending.request().postData(), /corrected-fixture/);
        await pending.abort('failed');
        await page.waitForFunction(
            () => document.querySelector('.preview-button')?.disabled === false
        );
        await page.waitForFunction(() =>
            document.activeElement?.classList.contains('import-error')
        );
        await inViewport(notice);
        assert.equal(
            await page.locator('.import-file-list .import-file').count(),
            1
        );
        // Success, including saved-password account refresh, moves to the review heading.
        pending = null;
        await button.click();
        await page.waitForFunction(
            () => document.querySelector('.preview-button')?.disabled === true
        );
        await pending.fulfill({
            json: {
                reviewId: 'mobile-review',
                source: 'toss-pdf',
                asOf: '2026-10-20',
                passwordSaved: true,
                rows: [
                    {
                        date: '2026-10-20',
                        symbol: 'CASH',
                        currency: 'KRW',
                        amount: 100,
                        type: 'cash_in',
                        externalId: 'mobile-fixture',
                    },
                ],
                errors: [],
                batches: [{ reviewId: 'mobile-review', start: 0, count: 1 }],
                statementIdentity: {
                    customerName: '검증 사용자',
                    maskedNumber: '****1234',
                    accountMatch: 'matched',
                },
            },
        });
        await page.waitForFunction(
            () => document.querySelector('.preview-button')?.disabled === false
        );
        const heading = page.getByRole('heading', {
            name: '추출 결과 미리보기 · 저장 전 검토',
        });
        await page.waitForFunction(
            () => document.activeElement?.tagName === 'H2'
        );
        await inViewport(heading);
        assert.equal(previews, 3);
        assert.equal(writes, 0);
        assert.deepEqual(errors, []);
        await page.screenshot({
            path: `/tmp/mobile-import-success-${dark ? 'dark' : 'light'}.png`,
        });
        console.log(
            `PASS mobile ${dark ? 'dark' : 'light'}: visible password/network errors, preserved file, retry and focused review; 3 previews, 0 ledger writes`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
