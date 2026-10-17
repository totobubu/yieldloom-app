// Requires local Vite. Uses fixture identities/data; no production reads or writes.
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
const harness = new URL('../.tmp-account-recovery-reads.html', import.meta.url);
await writeFile(
    harness,
    `<!doctype html><html><meta charset="UTF-8"><div id="app"></div><script type="module">
import {createApp,h,reactive,ref,onMounted} from 'vue';
import Overview from '/src/components/portfolio/AccountRecoveryOverview.vue';
import {portfolioCapitalRequest} from '/src/services/portfolioCapital.js';
createApp({setup(){
 const user=reactive({uid:'fixture-owner',getIdToken:async()=> 'fixture'});
 const accounts=[{id:'A',alias:'A'},{id:'B',alias:'B'}];
 const state=ref(null),saved=ref(false);
 const load=async()=>{state.value=await portfolioCapitalRequest(user,undefined,'A',{force:true});};
 onMounted(load);
 const save=async()=>{
  window.testNow+=6000; // B's five-second client cache has expired.
  await portfolioCapitalRequest(user,{action:'classifyCash',id:'cash'},'A');
  await load(); saved.value=true;
 };
 return ()=>h('main',[
  h('button',{onClick:save},'Save selected account'),h('output',{id:'saved'},saved.value?'Saved':''),
  h(Overview,{user,accounts,refreshAccountId:state.value?'A':'',refreshState:state.value})
 ]);
}}).mount('#app');
</script></html>`
);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        const errors = [],
            reads = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            window.testNow = Date.now();
            Date.now = () => window.testNow;
        });
        let revision = 0;
        await page.route('**/api/portfolio-capital*', async (route) => {
            const req = route.request(),
                params = new URL(req.url()).searchParams,
                id = params.get('accountId');
            if (req.method() === 'POST') {
                revision++;
                return route.fulfill({ json: { id: 'cash' } });
            }
            reads.push(id);
            // Real client coalesces the selected panel and overview while this is pending.
            await new Promise((resolve) => setTimeout(resolve, 20));
            return route.fulfill({
                json: {
                    version: `v1:1:${id === 'A' ? revision : 0}`,
                    ledgerVersion: 'v1:1',
                    entries: [
                        {
                            id: 'cash',
                            date: '20261015',
                            currency: 'KRW',
                            amount: id === 'A' ? 100 : 20,
                        },
                    ],
                    classifications: [
                        {
                            id: 'cash',
                            classification:
                                id === 'A'
                                    ? 'external_deposit'
                                    : 'external_withdrawal',
                            withdrawalParts: {
                                principal: 20,
                                dividend: 0,
                                profit: 0,
                                unknown: 0,
                            },
                        },
                    ],
                    allocations: [],
                    trades: [],
                    importedCash: [],
                },
            });
        });
        await page.goto(
            (process.env.FAMILY_UI_BASE_URL || 'http://127.0.0.1:5173') +
                '/.tmp-account-recovery-reads.html'
        );
        const overview = page.getByRole('region', {
            name: '전체 계좌 원금 회수 현황',
            exact: true,
        });
        await overview.getByText('20%', { exact: true }).first().waitFor();
        assert.equal(reads.filter((id) => id === 'A').length, 1);
        assert.equal(reads.filter((id) => id === 'B').length, 1);
        await page
            .getByRole('button', { name: 'Save selected account' })
            .click();
        await page
            .locator('#saved')
            .getByText('Saved', { exact: true })
            .waitFor();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        assert.equal(reads.filter((id) => id === 'A').length, 2);
        assert.equal(
            reads.filter((id) => id === 'B').length,
            1,
            'editing A must not revalidate expired B'
        );
        assert.deepEqual(errors, []);
        await page.close();
    }
    console.log(
        'PASS: selected account edits reuse loaded state without revalidating other accounts, desktop/mobile'
    );
} finally {
    await browser.close();
    await rm(harness, { force: true });
}
