// Synthetic identities and in-memory annotations only. No real account access.
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { cashClassification } from '../lib/portfolio-capital.js';
const base = process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5181';
const harness = new URL('../.tmp-cash-review.html', import.meta.url);
await writeFile(
    harness,
    `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module">
import {createApp,h,ref,watch} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Panel from '/src/components/portfolio/PortfolioCapitalPanel.vue';import {portfolioCapitalRequest} from '/src/services/portfolioCapital.js';import '/src/styles/style.scss';import '/src/styles/studio.scss';
createApp({setup(){const user={uid:'synthetic-stitch-owner',getIdToken:async()=>'synthetic-only'};const account=ref('A'),state=ref({entries:[],classifications:[]}),readOnly=ref(false),error=ref('');let generation=0;async function load(){const request=++generation,id=account.value;error.value='';try{const result=await portfolioCapitalRequest(user,undefined,id,{force:true});if(request===generation)state.value=result;}catch(e){if(request===generation)error.value=e.message;}}watch(account,()=>{state.value={entries:[],classifications:[]};load();},{immediate:true});return()=>h('main',{class:'thumbnail-app',style:'max-width:1280px;margin:auto;padding:16px;'},[h('header',{style:'margin:12px 0 24px'},[h('h1','원금 회수 · 자금 상세'),h('button',{onClick:()=>account.value=account.value==='A'?'B':'A'},'계좌 전환'),h('button',{onClick:()=>readOnly.value=!readOnly.value},'조회 권한 전환')]),h(Panel,{key:account.value,user,accountId:account.value,state:state.value,readOnly:readOnly.value,error:error.value,onRefresh:load})]);}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');</script></html>`
);
const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        await page.clock.install({ time: new Date('2026-10-15T12:00:00Z') });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const entries = [
            {
                id: 'deposit',
                date: '20261001',
                amount: 1000000,
                currency: 'KRW',
                rawType: '원화입금',
                source: 'toss-pdf',
                suggestedKind: 'external_deposit',
            },
            {
                id: 'withdrawal',
                date: '20261005',
                amount: 30000,
                currency: 'KRW',
                rawType: '원화출금',
                source: 'toss-pdf',
                suggestedKind: 'external_withdrawal',
            },
            {
                id: 'usd',
                date: '20261007',
                amount: 100,
                currency: 'USD',
                rawType: '달러입금',
                source: 'toss-pdf',
                suggestedKind: 'external_deposit',
            },
            {
                id: 'locked',
                date: '20261009',
                amount: 140000,
                currency: 'KRW',
                rawType: '구매환전',
                source: 'toss-pdf',
                purchaseExchange: true,
                suggestedKind: 'exchange',
            },
        ];
        const ledger = structuredClone(entries),
            annotations = { A: [], B: [] },
            reads = [],
            writes = [];
        let failure = 0,
            releaseWrite = null,
            holdWrite = false;
        await page.route('**/api/portfolio-capital*', async (route) => {
            const req = route.request(),
                id = new URL(req.url()).searchParams.get('accountId') || 'A';
            if (req.method() === 'POST') {
                const input = req.postDataJSON();
                writes.push({ account: id, ...input });
                if (holdWrite) {
                    await new Promise((resolve) => (releaseWrite = resolve));
                    holdWrite = false;
                }
                if (failure) {
                    const code = failure;
                    failure = 0;
                    return route.fulfill({
                        status: code,
                        json: {
                            error:
                                code === 409
                                    ? '다른 화면에서 변경했습니다.'
                                    : '합성 저장 실패',
                        },
                    });
                }
                const entry = entries.find((x) => x.id === input.id);
                const previous = annotations[id].find((x) => x.id === input.id);
                assert.equal(input.revision, previous?.revision || 0);
                const annotation = {
                    id: input.id,
                    ...cashClassification(input, entry),
                    note: input.note,
                    revision: input.revision + 1,
                };
                annotations[id] = [
                    ...annotations[id].filter((x) => x.id !== input.id),
                    annotation,
                ];
                return route.fulfill({ json: { id: input.id } });
            }
            reads.push(id);
            return route.fulfill({
                json: {
                    entries:
                        id === 'A'
                            ? entries
                            : [
                                  {
                                      ...entries[0],
                                      id: 'other',
                                      rawType: '다른 계좌',
                                  },
                              ],
                    classifications: annotations[id],
                    allocations: [],
                    trades: [],
                    version: 'fixture-' + id + '-' + writes.length,
                    ledgerVersion: 'fixture-' + id,
                },
            });
        });
        await page.goto(base + '/.tmp-cash-review.html');
        const panel = page.getByRole('region', {
            name: '투자 원금 대비 회수 현황',
        });
        const review = panel.locator('.cash-entry-review');
        await review
            .getByText('거래 내역 검토 및 분류', { exact: false })
            .waitFor();
        const row = (id) => review.locator('[data-cash-id="' + id + '"]');
        const statusGroup = review.getByRole('group', { name: '검토 상태' });
        const currencyGroup = review.getByRole('group', { name: '통화 구분' });
        assert.equal(await review.locator('tbody [data-cash-id]').count(), 3);
        const initialReads = reads.length;
        const initialMetrics = await panel
            .locator('.capital-metrics')
            .innerText();
        await currencyGroup
            .getByRole('button', { name: 'USD', exact: true })
            .click();
        assert.equal(await review.locator('[data-cash-id]').count(), 1);
        await currencyGroup
            .getByRole('button', { name: '전체', exact: true })
            .click();
        // Actual DatePicker calendar interaction; inclusive boundaries and no GET.
        await review.getByLabel('시작일', { exact: true }).click();
        await page
            .locator('.p-datepicker-panel:visible [data-pc-section="day"]')
            .filter({ hasText: /^5$/ })
            .click();
        await page.keyboard.press('Escape');
        await page.clock.runFor(400);
        await review.getByLabel('종료일', { exact: true }).click();
        await page
            .locator('.p-datepicker-panel:visible [data-pc-section="day"]')
            .filter({ hasText: /^7$/ })
            .click();
        await page.keyboard.press('Escape');
        await page.clock.runFor(400);
        assert.equal(await review.locator('[data-cash-id]').count(), 2);
        assert.equal(reads.length, initialReads);
        assert.equal(writes.length, 0);
        assert.equal(
            await panel.locator('.capital-metrics').innerText(),
            initialMetrics
        );
        await review.getByRole('button', { name: '전체 기간 초기화' }).click();
        await row('deposit')
            .getByRole('button', { name: '외부 입금 (원금)', exact: true })
            .click();
        await review
            .getByRole('status')
            .filter({ hasText: '계좌 내역을 저장했습니다' })
            .waitFor();
        await row('deposit').waitFor({ state: 'hidden' });
        assert.equal(writes.length, 1);
        assert.equal(writes[0].note, '');
        assert.equal(annotations.A[0].revision, 1);
        await statusGroup
            .getByRole('button', { name: '확정', exact: true })
            .click();
        await row('deposit').locator('.entry-evidence > summary').click();
        await row('deposit').locator('textarea').fill('합성 근거 메모');
        await row('deposit')
            .getByRole('button', { name: '메모 저장', exact: true })
            .click();
        await row('deposit')
            .getByRole('button', { name: '확인 필요로 되돌리기' })
            .click();
        await row('deposit').waitFor({ state: 'hidden' });
        assert.equal(
            annotations.A.find((x) => x.id === 'deposit').classification,
            'unknown'
        );
        assert.equal(
            annotations.A.find((x) => x.id === 'deposit').note,
            '합성 근거 메모'
        );
        assert.equal(annotations.A.find((x) => x.id === 'deposit').revision, 3);
        await statusGroup
            .getByRole('button', { name: '확인 필요', exact: true })
            .click();
        failure = 500;
        await row('usd')
            .getByRole('button', { name: '외부 입금 (원금)', exact: true })
            .click();
        await row('usd').getByRole('alert').waitFor();
        await page.screenshot({
            path: '/tmp/stitch-capital-' + width + '-error.png',
            fullPage: true,
        });
        assert.equal(
            await row('usd')
                .getByRole('button', { name: '외부 입금 (원금)', exact: true })
                .getAttribute('aria-pressed'),
            'false'
        );
        assert(!annotations.A.some((x) => x.id === 'usd'));
        await row('usd')
            .getByRole('button', { name: '해당 건 저장 재시도' })
            .click();
        await row('usd').waitFor({ state: 'hidden' });
        assert.equal(annotations.A.find((x) => x.id === 'usd').revision, 1);
        await row('withdrawal')
            .getByRole('button', { name: '다른 분류' })
            .click();
        await row('withdrawal')
            .getByRole('button', { name: '출금 · 금액 나눔', exact: true })
            .click();
        const split = row('withdrawal');
        await split.getByLabel('출금 미확인', { exact: true }).fill('0');
        await split.getByLabel('출금 원금 회수', { exact: true }).fill('10000');
        await split.getByLabel('출금 배당 사용', { exact: true }).fill('20001');
        assert(
            await split.getByRole('button', { name: '배분 확정' }).isDisabled()
        );
        await split.getByLabel('출금 배당 사용', { exact: true }).fill('20000');
        await split.getByRole('button', { name: '배분 확정' }).click();
        await row('withdrawal').waitFor({ state: 'hidden' });
        assert.deepEqual(
            annotations.A.find((x) => x.id === 'withdrawal').withdrawalParts,
            { principal: 10000, dividend: 20000, profit: 0, unknown: 0 }
        );
        await statusGroup
            .getByRole('button', { name: '전체', exact: true })
            .click();
        assert.equal(await row('locked').getByRole('button').count(), 0);
        await page.getByRole('button', { name: '조회 권한 전환' }).click();
        assert(
            await row('deposit')
                .getByRole('button', { name: '외부 입금 (원금)', exact: true })
                .isDisabled()
        );
        await page.getByRole('button', { name: '조회 권한 전환' }).click();
        // A revision conflict requires a read and a fresh deliberate selection.
        failure = 409;
        await row('deposit')
            .getByRole('button', { name: '외부 입금 (원금)', exact: true })
            .click();
        const beforeConflictRetry = writes.length;
        await row('deposit')
            .getByRole('button', { name: '최신 내역 다시 조회' })
            .click();
        assert.equal(writes.length, beforeConflictRetry);
        // Keyboard selection and in-flight duplicate protection; switching accounts
        // must not apply A's late response or emit a refresh for B.
        holdWrite = true;
        const target = row('deposit').getByRole('button', {
            name: '외부 입금 (원금)',
            exact: true,
        });
        await page.clock.runFor(100);
        await target.focus();
        assert(await target.evaluate((el) => el === document.activeElement));
        await page.keyboard.press('Space');
        await row('deposit').getByText('저장 중…', { exact: true }).waitFor();
        assert(await target.isDisabled());
        await page.screenshot({
            path: '/tmp/stitch-capital-' + width + '-saving.png',
            fullPage: true,
        });
        const beforeSwitch = reads.length;
        await page
            .getByRole('button', { name: '계좌 전환', exact: true })
            .click();
        await row('other').waitFor();
        releaseWrite();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await row('other').waitFor();
        assert.equal(reads.filter((x) => x === 'B').length, 1);
        assert(reads.length <= beforeSwitch + 1);
        assert(writes.every((x) => x.account === 'A'));
        assert.deepEqual(annotations.B, []);
        assert.deepEqual(entries, ledger);
        assert.deepEqual(errors, []);
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        await page
            .getByRole('button', { name: '계좌 전환', exact: true })
            .click();
        await statusGroup
            .getByRole('button', { name: '전체', exact: true })
            .click();
        await row('deposit').waitFor();
        await row('deposit')
            .getByRole('button', { name: '확인 필요로 되돌리기' })
            .click();
        await row('deposit')
            .getByRole('button', { name: '외부 입금 (원금)', exact: true })
            .waitFor();
        await row('deposit')
            .getByRole('button', { name: '외부 입금 (원금)', exact: true })
            .click({ trial: true });
        await review
            .getByLabel('시작일', { exact: true })
            .click({ trial: true });
        await page.screenshot({
            path: '/tmp/stitch-capital-' + width + '-light.png',
            fullPage: true,
        });
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        await page.screenshot({
            path: '/tmp/stitch-capital-' + width + '-dark.png',
            fullPage: true,
        });
        console.log(
            'PASS ' +
                width +
                ': calendar boundaries, local filters/no reads, immediate save, rollback/retry, mixed sums, undo, revision conflict, keyboard, duplicate guard, late account isolation, light/dark and immutable fixture.'
        );
        await page.close();
    }
} finally {
    await browser.close();
    await rm(harness, { force: true });
}
