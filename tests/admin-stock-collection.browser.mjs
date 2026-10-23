import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const data = (price = 40) => ({
    ticker: {
        symbol: 'QLDY',
        tickerInfo: { symbol: 'QLDY', currency: 'USD', price },
        backtestData: [{ date: '2026-10-22', close: price, amount: 0.15 }],
        sourceStatus: {
            freshness: 'fresh',
            priceDate: '2026-10-22',
            asOf: String(price),
        },
    },
    catalog: { symbol: 'QLDY', securityType: 'etf' },
    rivals: [],
    rivalOptions: [],
    series: {},
    dataStatus: 'fresh',
});
try {
    for (const [role, width] of [
        ['anonymous', 1440],
        ['member', 390],
        ['admin', 1440],
        ['admin', 390],
    ]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
        const user =
            role === 'anonymous'
                ? null
                : {
                      uid: 'test-admin',
                      email:
                          role === 'admin'
                              ? 'jomalkeun@gmail.com'
                              : 'member@example.test',
                      emailVerified: true,
                  };
        await page.route('**/src/services/firebaseClient*', (r) =>
            r.fulfill({
                contentType: 'text/javascript',
                body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';const value=${JSON.stringify(user)}; if(value)value.getIdToken=async()=> 'fixture-token'; export const firebaseUser=ref(value),authLoading=ref(false),signedIn=computed(()=>!!firebaseUser.value),firebaseReady=false,auth=null,db=null,googleProvider=null; window.__testCollectionUser=firebaseUser;`,
            })
        );
        let reads = 0,
            posts = 0,
            polls = 0,
            simulateFailure = false;
        await page.route('**/api/thumbnail-data?**', (r) => {
            reads++;
            return r.fulfill({ json: data() });
        });
        await page.route('**/api/stock-collection**', async (r) => {
            assert.equal(
                r.request().headers().authorization,
                'Bearer fixture-token'
            );
            if (r.request().method() === 'POST') {
                posts++;
                assert.deepEqual(r.request().postDataJSON(), {
                    symbol: 'QLDY',
                });
                return r.fulfill({
                    status: 202,
                    json: {
                        symbol: 'QLDY',
                        requestId: 'test-request',
                        state: 'queued',
                    },
                });
            }
            if (
                new URL(r.request().url()).searchParams.get('history') ===
                'latest'
            )
                return r.fulfill({ json: { state: 'idle' } });
            polls++;
            if (simulateFailure)
                return r.fulfill({
                    json: {
                        state: 'failed',
                        error: '수집 실패',
                        requestedAt: '2026-10-23T01:00:00Z',
                        startedAt: '2026-10-23T01:01:00Z',
                        completedAt: '2026-10-23T01:05:00Z',
                        runUrl: 'https://github.com/totobubu/yieldloom-app/actions/runs/123',
                        diagnostics: {
                            code: 'unsupported_source',
                            reason: '공식 수집 대상 목록에 등록되어 있지 않습니다.',
                            nextAction:
                                '공식 자료 출처와 수집 대상 등록이 필요합니다.',
                            steps: [
                                {
                                    name: '공식 자료 수집',
                                    state: 'failure',
                                    startedAt: '2026-10-23T01:02:00Z',
                                    completedAt: '2026-10-23T01:03:00Z',
                                    logUrl: 'https://github.com/totobubu/yieldloom-app/actions/runs/123/job/456#step:10:1',
                                },
                            ],
                        },
                    },
                });
            return r.fulfill({
                json:
                    polls === 1
                        ? { state: 'collecting' }
                        : polls === 2
                          ? { state: 'publishing' }
                          : { state: 'ready', data: data(41) },
            });
        });
        await page.goto(`${base}/stock/QLDY?tab=details`);
        await page.locator('.stock-overview').waitFor();
        if (role !== 'admin') {
            assert.equal(
                await page
                    .getByRole('button', { name: '데이터 수집', exact: true })
                    .count(),
                0
            );
            assert(
                await page
                    .getByRole('button', {
                        name: '공유 카드 만들기',
                        exact: true,
                    })
                    .isVisible()
            );
            assert.equal(posts, 0);
        } else {
            assert.equal(
                await page
                    .getByRole('button', {
                        name: '공유 카드 만들기',
                        exact: true,
                    })
                    .count(),
                0
            );
            await page
                .getByRole('tab', { name: '공유정보', exact: true })
                .click();
            const button = page.getByRole('button', {
                name: '데이터 수집',
                exact: true,
            });
            await page
                .getByRole('button', { name: '수집 기록', exact: true })
                .click();
            await page
                .getByText('이 종목의 최근 수집 실행 기록이 없습니다.', {
                    exact: true,
                })
                .waitFor();
            assert.equal(posts, 0);
            await page.keyboard.press('Escape');
            await page
                .getByRole('dialog', { name: 'QLDY 수집 기록' })
                .waitFor({ state: 'hidden' });
            await button.click();
            await page
                .getByText('QLDY 데이터를 수집하고 있습니다.', { exact: true })
                .waitFor();
            const loadingDialog = page.locator('.fullscreen-data-loading');
            await loadingDialog.waitFor({ state: 'hidden' });
            await page.screenshot({
                path: `/tmp/admin-stock-collection-loading-${width}.png`,
            });
            assert(await button.isDisabled());
            assert(
                await page
                    .getByRole('button', {
                        name: '수집 기록',
                        exact: true,
                    })
                    .isEnabled()
            );
            assert.equal(posts, 1);
            await page.clock.runFor(15050);
            await page
                .getByText('수집 완료 · 화면 반영 중입니다.', { exact: true })
                .waitFor();
            await page.clock.runFor(15050);
            await page
                .getByText('최신 데이터로 업데이트했습니다.', { exact: true })
                .waitFor();
            assert.equal(
                await page
                    .locator('.stock-overview article strong')
                    .first()
                    .innerText(),
                '41'
            );
            assert.equal(posts, 1);
            assert.equal(polls, 3);
            assert.equal(reads, 1);
            assert(await button.isEnabled());
            await loadingDialog.waitFor({ state: 'hidden' });
            await page.screenshot({
                path: `/tmp/admin-stock-collection-${width}.png`,
                fullPage: true,
            });
            simulateFailure = true;
            await button.click();
            await page
                .getByText('공식 수집 대상 목록에 등록되어 있지 않습니다.', {
                    exact: true,
                })
                .waitFor();
            await loadingDialog.waitFor({ state: 'hidden' });
            await page
                .getByRole('button', { name: '수집 기록', exact: true })
                .click();
            const recordDialog = page.getByRole('dialog', {
                name: 'QLDY 수집 기록',
            });
            await recordDialog.waitFor();
            assert(
                await recordDialog
                    .getByText('실패', { exact: true })
                    .isVisible()
            );
            assert(
                await recordDialog
                    .getByText('2026. 10. 23. 10:05:00 KST', { exact: true })
                    .isVisible()
            );
            assert(
                await recordDialog.getByText('5분', { exact: true }).isVisible()
            );
            assert(
                await recordDialog
                    .getByText('완료 2026. 10. 23. 10:03:00 KST', {
                        exact: true,
                    })
                    .isVisible()
            );
            assert.equal(
                await recordDialog
                    .getByRole('link', { name: 'GitHub 원본 실행 기록' })
                    .getAttribute('href'),
                'https://github.com/totobubu/yieldloom-app/actions/runs/123'
            );
            assert(
                await recordDialog
                    .getByText(
                        '공식 자료 출처와 수집 대상 등록이 필요합니다.',
                        { exact: true }
                    )
                    .isVisible()
            );
            await page.screenshot({
                path: `/tmp/collection-diagnostics-${width}.png`,
            });
            await page.keyboard.press('Escape');
            await recordDialog.waitFor({ state: 'hidden' });
            assert.equal(reads, 1);
            await page.evaluate(
                () => (window.__testCollectionUser.value = null)
            );
            assert.equal(
                await page
                    .getByRole('button', { name: '데이터 수집', exact: true })
                    .count(),
                0
            );
        }
        assert(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            )
        );
        console.log(
            `PASS ${role} ${width}: role visibility, single ticker collection, publication wait, update without extra ticker reads`
        );
        await page.close();
    }
    const login = await browser.newPage();
    await login.route('**/src/services/firebaseClient*', (r) =>
        r.fulfill({
            contentType: 'text/javascript',
            body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref(null),authLoading=ref(false),signedIn=computed(()=>false),firebaseReady=true,auth={},db=null,googleProvider={};`,
        })
    );
    await login.goto(`${base}/admin/login`);
    await login
        .getByRole('button', { name: 'Google로 계속하기', exact: true })
        .waitFor();
    const stray = await login
        .locator('.google-button')
        .evaluate(
            (el) =>
                Array.from(el.parentNode.childNodes).filter(
                    (n) =>
                        n.nodeType === Node.TEXT_NODE &&
                        n.textContent.trim() === '>'
                ).length
        );
    assert.equal(stray, 0);
    console.log('PASS login: no stray > beside Google button');
    await login.close();
} finally {
    await browser.close();
}
