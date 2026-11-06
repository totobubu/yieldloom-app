// Public request form with entirely intercepted loopback feedback responses.
// No customer content, real feedback submission or production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const out = process.env.STOCK_FEEDBACK_EVIDENCE_DIR;
if (out) await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const results = [];
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1100 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(page);
        await installStaticAssets(page);
        const pending = [],
            errors = [],
            privateRequests = [];
        let arrived;
        const nextSubmission = () =>
            new Promise((resolve) => {
                arrived = resolve;
            });
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('request', (request) => {
            if (
                /\/api\/(family-portfolio|portfolio-capital|monthly-statements)/.test(
                    new URL(request.url()).pathname
                )
            )
                privateRequests.push(request.method());
        });
        await page.route('**/api/stock-feedback', (route) => {
            assert.equal(
                new URL(route.request().url()).origin,
                new URL(base).origin
            );
            assert.equal(route.request().method(), 'POST');
            const submission = { route, body: route.request().postDataJSON() };
            pending.push(submission);
            arrived?.(submission);
            arrived = undefined;
        });
        await page.goto(base + '/stock/DEMO-A?tab=details');
        const form = page.locator('#stock-feedback');
        await form.waitFor();
        await page.evaluate(() => document.fonts.ready);
        const capture = async (state) => {
            if (out) {
                await page.mouse.move(0, 0);
                await page.evaluate(() =>
                    Promise.allSettled(
                        document
                            .getAnimations()
                            .filter(
                                (a) =>
                                    a.effect?.getComputedTiming().iterations !==
                                    Infinity
                            )
                            .map((a) => a.finished)
                    )
                );
                if (state === 'dark')
                    await form.locator('#feedback-message').focus();
                await form.screenshot({
                    path: `${out}/${width}-${state}.png`,
                    animations: 'disabled',
                });
            }
        };
        await capture('idle');
        const message = form.locator('#feedback-message');
        const category = form.getByRole('combobox');
        const submit = form.getByRole('button', {
            name: '요청 전송하기',
            exact: true,
        });
        await message.fill('짧음');
        assert.equal(await submit.isDisabled(), true);
        assert.equal(pending.length, 0);
        await category.click();
        await page.getByRole('option', { name: '질문', exact: true }).click();
        const text = '합성 검증: 제공된 종목 설명을 다시 확인해 주세요.';
        await message.fill(text);
        const firstArrival = nextSubmission();
        await submit.click();
        const first = await firstArrival;
        await form.locator('.p-button[data-p~="loading"]').waitFor();
        assert.equal(await form.getAttribute('aria-busy'), 'true');
        assert.equal(await message.isDisabled(), true);
        assert.equal(await category.isDisabled(), true);
        assert.equal(await submit.isDisabled(), true);
        assert.equal(await message.inputValue(), text);
        assert.equal(first.body.symbol, 'DEMO-A');
        assert.equal(first.body.category, 'question');
        assert.equal(first.body.message, text);
        assert.equal(first.body.website, '');
        // Keep the existing handler guard even if a submit event bypasses the button.
        await form
            .locator('form')
            .evaluate((element) =>
                element.dispatchEvent(
                    new Event('submit', { bubbles: true, cancelable: true })
                )
            );
        await page.waitForTimeout(30);
        assert.equal(pending.length, 1);
        await capture('pending');
        await first.route.fulfill({
            status: 503,
            json: { error: '합성 일시 오류: 다시 시도해 주세요.' },
        });
        await form
            .getByText('합성 일시 오류: 다시 시도해 주세요.', { exact: true })
            .waitFor();
        assert.equal(await form.getAttribute('aria-busy'), 'false');
        assert.equal(await message.isEnabled(), true);
        assert.equal(await category.isEnabled(), true);
        assert.equal(await message.inputValue(), text);
        assert.equal((await category.innerText()).trim(), '질문');
        await capture('error');
        const retryArrival = nextSubmission();
        await submit.click();
        const retry = await retryArrival;
        assert.equal(retry.body.message, text);
        assert.equal(retry.body.category, 'question');
        assert.equal(
            retry.body.requestId,
            first.body.requestId,
            'Failed requests retain the existing idempotency key'
        );
        await retry.route.fulfill({ json: { status: 'received' } });
        await form
            .getByText('의견을 접수했습니다. 검토에 참고하겠습니다.', {
                exact: true,
            })
            .waitFor();
        assert.equal(await form.getAttribute('aria-busy'), 'false');
        assert.equal(await message.inputValue(), '');
        assert.equal((await category.innerText()).trim(), '질문');
        assert.equal(await message.isEnabled(), true);
        assert.equal(await category.isEnabled(), true);
        assert.equal(pending.length, 2);
        await capture('success');
        // Match the existing server's request-ID deduplication, including a
        // committed submission whose acknowledgement was lost.
        for (const changedField of ['message', 'category']) {
            const initialText =
                '합성 검증: 응답 유실 전 접수된 원래 의견입니다.';
            await message.fill(initialText);
            const initialCategory = (await category.innerText()).trim();
            const initialArrival = nextSubmission();
            await submit.click();
            const original = await initialArrival;
            const stored = new Map([[original.body.requestId, original.body]]);
            await original.route.fulfill({
                status: 503,
                json: {
                    error: '합성 응답 유실: 접수 여부를 확인하지 못했습니다.',
                },
            });
            await form.getByRole('alert').waitFor();
            await message.fill(initialText + ' 임시 수정');
            await message.fill(initialText);
            const identicalArrival = nextSubmission();
            await submit.click();
            const identical = await identicalArrival;
            assert.equal(
                identical.body.requestId,
                original.body.requestId,
                'Editing then restoring the same payload preserves its retry identity'
            );
            await identical.route.fulfill({
                status: 503,
                json: {
                    error: '합성 응답 유실: 접수 여부를 확인하지 못했습니다.',
                },
            });
            await form.getByRole('alert').waitFor();
            if (changedField === 'message') {
                await message.fill(
                    '합성 검증: 오류 후 내용을 바꾼 별개의 의견입니다.'
                );
            } else {
                await category.click();
                await page
                    .getByRole('option', {
                        name: initialCategory === '질문' ? '정보 오류' : '질문',
                        exact: true,
                    })
                    .click();
            }
            const changedArrival = nextSubmission();
            await submit.click();
            const changed = await changedArrival;
            const duplicate = stored.has(changed.body.requestId);
            if (!duplicate) stored.set(changed.body.requestId, changed.body);
            await changed.route.fulfill({
                json: { status: 'received', duplicate },
            });
            await form
                .getByText('의견을 접수했습니다. 검토에 참고하겠습니다.', {
                    exact: true,
                })
                .waitFor();
            assert.equal(
                stored.get(changed.body.requestId)[changedField],
                changed.body[changedField],
                'Success must refer to the changed content actually stored, not the prior submission'
            );
            assert.notEqual(changed.body.requestId, original.body.requestId);
            assert.equal(stored.size, 2);
            assert.equal(
                stored.get(original.body.requestId).message,
                initialText
            );
            assert.equal(await message.inputValue(), '');
            await capture('changed-' + changedField + '-retry');
        }
        await category.click();
        await page.getByRole('option', { name: '질문', exact: true }).click();
        assert.equal(pending.length, 8);
        await message.fill(
            '합성 검증: 완료 후 다음 의견도 다시 작성할 수 있습니다.'
        );
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        await capture('dark');
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth + 1
            ),
            false
        );
        assert.deepEqual(privateRequests, []);
        assert.deepEqual(errors, []);
        results.push({
            width,
            mockPosts: 8,
            lockedPendingFields: true,
            originalPayloadSnapshot: true,
            failurePreservesTypeAndMessage: true,
            retryUsesSameRequestId: true,
            successClearsOnlyCompletedRequest: true,
            duplicateSubmitSuppressed: true,
            changedMessageAndCategoryActuallyStored: true,
            revertedInputReusesIdentity: true,
            privateRequests: 0,
            errors,
            scope: 'fully intercepted loopback synthetic feedback only; no real stock feedback, accounts or PDF validation',
        });
        await page.close();
    }
} finally {
    if (out)
        await fs.writeFile(
            `${out}/results.json`,
            JSON.stringify(results, null, 2) + '\n'
        );
    await browser.close();
}
console.log(
    'PASS public feedback:3 viewports, pending locks/snapshot, failure retention, idempotent retry, success reset, duplicate guard, dark/no overflow/private requests0'
);
