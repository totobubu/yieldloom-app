// Synthetic identities, immutable source rows and an in-memory serializable API only.
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fxLinkFixture } from './support/fx-link-fixture.mjs';
const base = process.env.CAPITAL_TEST_URL || 'http://127.0.0.1:5181';
const harness = new URL('../.tmp-fx-pair-review.html', import.meta.url);
await writeFile(
    harness,
    `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module">
import {createApp,h,ref,watch} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import ko from '/src/config/locale/ko.js';import Panel from '/src/components/portfolio/PortfolioCapitalPanel.vue';import {portfolioCapitalRequest} from '/src/services/portfolioCapital.js';import '/src/styles/style.scss';import '/src/styles/studio.scss';
createApp({setup(){const user={uid:'owner',getIdToken:async()=>'synthetic-only'},account=ref('AC'),state=ref({entries:[],classifications:[]}),loading=ref(false),error=ref(''),readOnly=ref(false);let generation=0;async function load(){const n=++generation,id=account.value;loading.value=true;error.value='';try{const data=await portfolioCapitalRequest(user,undefined,id,{force:true});if(n===generation)state.value=data;}catch(e){if(n===generation)error.value=e.message;}finally{if(n===generation)loading.value=false;}}watch(account,()=>{state.value={entries:[],classifications:[]};load();},{immediate:true});return()=>h('main',{class:'thumbnail-app','aria-busy':String(loading.value),style:'max-width:1280px;margin:auto;padding:16px'},[h('button',{onClick:()=>account.value=account.value==='AC'?'B':'AC'},'계좌 전환'),h('button',{onClick:()=>readOnly.value=!readOnly.value},'조회 권한 전환'),h(Panel,{key:account.value,user,accountId:account.value,state:state.value,loading:loading.value,error:error.value,readOnly:readOnly.value,onRefresh:load})]);}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}},locale:ko}).mount('#app');</script></html>`
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
            }),
            f = fxLinkFixture('owner', true),
            requests = [],
            errors = [];
        for (const [id, rawType] of [
            ['BANKA', '이체출금(합성은행A)'],
            ['BANKB', '이체출금(합성은행B)'],
        ])
            f.records.set('investmentAccounts/AC/entries/' + id, {
                source: 'toss-pdf',
                row: {
                    symbol: 'CASH',
                    date: '2026-10-02',
                    currency: 'KRW',
                    amount: 1000,
                    type: 'cash_out',
                    rawType,
                },
            });
        f.records.set('investmentAccounts/AC/cashClassifications/BANKA', {
            classification: 'transfer',
            revision: 1,
            note: 'confirmed note',
        });
        f.records.set('investmentAccounts/B', {
            familyId: 'F',
            permissions: { owner: 'owner' },
        });
        f.records.set('investmentAccounts/B/entries/OTHER', {
            source: 'toss-pdf',
            row: {
                symbol: 'CASH',
                date: '2026-10-01',
                type: 'cash_in',
                currency: 'KRW',
                amount: 10,
                rawType: '다른 계좌',
            },
        });
        const originals = structuredClone(
            [...f.records].filter(([k]) => k.includes('/entries/'))
        );
        let fail = 0,
            hold = false,
            release;
        page.on('pageerror', (e) => errors.push(e.message));
        await page.route('**/api/portfolio-capital*', async (route) => {
            const r = route.request(),
                query = Object.fromEntries(new URL(r.url()).searchParams),
                body = r.method() === 'POST' ? r.postDataJSON() : undefined;
            requests.push({
                method: r.method(),
                account: body?.accountId || query.accountId,
                action: body?.action,
            });
            if (body && hold) {
                hold = false;
                await new Promise((resolve) => (release = resolve));
            }
            if (body && fail) {
                const status = fail;
                fail = 0;
                return route.fulfill({
                    status,
                    json: { error: '합성 연결 저장 실패' },
                });
            }
            const result = await f.call(body, r.method(), query);
            return route.fulfill({ status: result.status, json: result.data });
        });
        const open = async () => {
            await page.goto(base + '/.tmp-fx-pair-review.html');
            await page.locator('main[aria-busy="false"]').waitFor();
        };
        const review = page.locator('.cash-entry-review'),
            row = (id) => review.locator(`[data-cash-id="${id}"]`),
            status = (name) =>
                review
                    .getByRole('group', { name: '검토 상태' })
                    .getByRole('button', { name, exact: true });
        await open();
        await row('K').waitFor();
        assert.equal(await row('BANKA').count(), 0);
        assert.equal(
            await review.getByText('확정 완료', { exact: true }).count(),
            0
        );
        const initialMetrics = await page
                .locator('.capital-metrics')
                .innerText(),
            beforeFilter = requests.length;
        await review
            .getByRole('combobox', { name: '거래 종류', exact: true })
            .click();
        await page
            .getByRole('option', { name: '이체출금', exact: true })
            .click();
        await row('BANKB').waitFor();
        assert.equal(await review.locator('[data-cash-id]').count(), 1);
        await status('확정').click();
        await row('BANKA').waitFor();
        assert.equal(await row('BANKB').count(), 0);
        assert.match(
            await review.locator('.review-count').innerText(),
            /상태: 확정/
        );
        await status('전체').click();
        assert.equal(await review.locator('[data-cash-id]').count(), 2);
        await review
            .getByRole('group', { name: '통화 구분' })
            .getByRole('button', { name: 'USD', exact: true })
            .click();
        assert.equal(await review.locator('[data-cash-id]').count(), 0);
        assert.equal(requests.length, beforeFilter);
        assert.equal(
            await page.locator('.capital-metrics').innerText(),
            initialMetrics
        );
        await review.getByRole('button', { name: '전체 기간 초기화' }).click();
        await row('K').waitFor();
        const choose = async (id, peer) => {
            const combo = row(id).getByRole('combobox', {
                name: '환전 짝 선택',
                exact: true,
            });
            await combo.click();
            await page
                .getByRole('option', { name: new RegExp('원장 ' + peer + '$') })
                .click();
        };
        await row('K').locator('.entry-evidence > summary').click();
        await row('K')
            .getByLabel('확인 근거·메모 (선택)')
            .fill('승인 전 입력 메모');
        await choose('K', 'U');
        const approve = row('K').getByRole('button', {
            name: '양쪽 연결 승인',
        });
        await approve.focus();
        await page.keyboard.press('Space');
        await row('K').waitFor({ state: 'hidden' });
        await row('U').waitFor({ state: 'hidden' });
        let state = await f.read();
        const first = state.fxLinkViews.find((l) => l.entryIds.includes('K'));
        assert.equal(first.mode, 'approved');
        assert.equal(first.status, 'active');
        assert.equal(
            state.classifications.find((a) => a.id === 'K').note,
            '승인 전 입력 메모'
        );
        assert.equal(
            state.classifications.filter((a) => a.internalFxLinkId === first.id)
                .length,
            2
        );
        await page.reload();
        await row('K2').waitFor();
        assert.equal(await row('K').count(), 0);
        await status('전체').click();
        await row('K').waitFor();
        for (const id of ['K', 'U']) {
            await row(id)
                .getByText('내부 연결 ID 확인', { exact: true })
                .click();
            assert.equal(await row(id).locator('code').innerText(), first.id);
            assert.match(
                await row(id).innerText(),
                /토스 발급 거래번호와 별개/
            );
        }
        await row('K').locator('.entry-evidence > summary').click();
        await row('K')
            .getByLabel('확인 근거·메모 (선택)')
            .fill('합성 연결 메모');
        await row('K')
            .getByRole('button', { name: '메모 저장', exact: true })
            .click();
        await page.locator('main[aria-busy="false"]').waitFor();
        state = await f.read();
        assert.equal(
            state.fxLinkViews.find((l) => l.id === first.id).status,
            'active'
        );
        assert.equal(
            state.classifications.find((a) => a.id === 'K').note,
            '합성 연결 메모'
        );
        await choose('K2', 'U2');
        fail = 500;
        await row('K2').getByRole('button', { name: '양쪽 연결 승인' }).click();
        await row('K2').getByRole('alert').waitFor();
        assert.equal(
            (await f.read()).fxLinks.filter((l) => l.state === 'active').length,
            1
        );
        await row('K2').getByRole('button', { name: '양쪽 연결 승인' }).click();
        await row('K2').getByText('확정 완료', { exact: true }).waitFor();
        await page.getByRole('button', { name: '조회 권한 전환' }).click();
        assert(
            await row('K')
                .getByRole('button', { name: '양쪽 연결 해제' })
                .isDisabled()
        );
        await page.getByRole('button', { name: '조회 권한 전환' }).click();
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        await page.screenshot({
            path: `/tmp/fx-links-${width}-active.png`,
            fullPage: true,
        });
        await row('K').getByRole('button', { name: '양쪽 연결 해제' }).click();
        await row('K')
            .getByText('확인 필요', { exact: true })
            .first()
            .waitFor();
        await status('확인 필요').click();
        await row('K').waitFor();
        assert.equal(await row('K2').count(), 0);
        assert.equal(
            await review.getByText('확정 완료', { exact: true }).count(),
            0
        );
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.evaluate(() =>
            document.documentElement.classList.add('p-dark')
        );
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        await page.screenshot({
            path: `/tmp/fx-links-${width}-dark.png`,
            fullPage: true,
        });
        await choose('K', 'U');
        hold = true;
        await row('K').getByRole('button', { name: '양쪽 연결 승인' }).click();
        await row('K').getByText('연결 저장 중…', { exact: true }).waitFor();
        await page
            .getByRole('button', { name: '계좌 전환', exact: true })
            .click();
        await row('OTHER').waitFor();
        release();
        await page.waitForResponse(
            (r) =>
                r.url().includes('/api/portfolio-capital') &&
                r.request().method() === 'POST'
        );
        await page.evaluate(() => new Promise(requestAnimationFrame));
        assert.equal(
            requests.filter((r) => r.method === 'GET' && r.account === 'B')
                .length,
            1
        );
        assert.equal(await row('K').count(), 0);
        assert(!requests.some((r) => r.method === 'POST' && r.account === 'B'));
        assert.deepEqual(
            [...f.records].filter(([k]) => k.includes('/entries/')),
            originals
        );
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}: pair selection/approval/shared internal ID, reload, note-only save, error retry, paired detach, read-only, filters without requests, confirmed exclusion, dark/mobile and late account isolation.`
        );
        await page.close();
    }
} finally {
    await browser.close();
    await rm(harness, { force: true });
}
