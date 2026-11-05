// Synthetic identities/data only. Filtering and pagination must not fetch or write.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const captured = [];
async function capture(page, name, width) {
    if (!process.env.STITCH_HOLDINGS_STATE_DIR) return;
    await fs.mkdir(process.env.STITCH_HOLDINGS_STATE_DIR, { recursive: true });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
        path: `${process.env.STITCH_HOLDINGS_STATE_DIR}/${name}-${width}.png`,
        fullPage: true,
        animations: 'disabled',
    });
    captured.push({ name, width, dpr: 2 });
}
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            ...(process.env.STITCH_HOLDINGS_STATE_DIR
                ? { deviceScaleFactor: 2 }
                : {}),
        });
        if (process.env.STITCH_HOLDINGS_STATE_DIR)
            await installStaticAssets(page);
        await installStitchFixtures(page, { admin: true });
        const api = [],
            errors = [];
        page.on('request', (r) => {
            if (r.url().includes('/api/')) api.push(r.method() + ' ' + r.url());
        });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(base + '/mypage?tab=overview&view=holdings');
        await page
            .locator('.holding-card')
            .first()
            .waitFor({ state: 'attached' });
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        const mobile = page.locator('.holding-cards');
        assert.equal(await mobile.isVisible(), width < 1024);
        assert.equal(
            await page.locator('.holdings-desktop-table').isVisible(),
            width >= 1024
        );
        const totals = page.locator('.currency-summary-compact');
        assert.match(await totals.innerText(), /₩190,000/);
        assert.match(await totals.innerText(), /\$1,430.00/);
        await capture(page, 'holder', width);
        const beforeView = api.length;
        const view = page.getByRole('group', {
            name: '조회 방식',
            exact: true,
        });
        await view
            .getByRole('button', { name: '종목 합산', exact: true })
            .click();
        await page.locator('.holdings-symbol-view').waitFor();
        assert.equal(
            await page.locator('.holdings-symbol-view tbody tr').count(),
            3
        );
        assert.equal(
            await page.locator('.holdings-holder-view').isVisible(),
            false
        );
        await capture(page, 'symbol', width);
        await page
            .getByRole('textbox', { name: '종목 검색', exact: true })
            .fill('DEMO-A');
        assert.equal(
            await page.locator('.holdings-symbol-view tbody tr').count(),
            1
        );
        assert.match(
            await page.locator('.holdings-symbol-view').innerText(),
            /980/
        );
        assert.match(
            await totals.innerText(),
            /\$1,430.00/,
            'whole-account summary must retain its explicitly labeled scope'
        );
        await page
            .getByRole('button', { name: '선택 초기화', exact: true })
            .click();
        assert.equal(
            await page.locator('.holdings-symbol-view tbody tr').count(),
            3
        );
        await view
            .getByRole('button', { name: '명의자·계좌별 잔고', exact: true })
            .click();
        assert.equal(
            api.length,
            beforeView,
            'view/filter/reset must reuse the loaded projection'
        );
        if (width < 1024) {
            assert.equal(await page.locator('.holding-card').count(), 3);
            assert.equal(
                await page
                    .locator('.holding-card')
                    .filter({ hasText: 'DEMO-M' })
                    .locator('.holding-access')
                    .innerText(),
                '조회 전용'
            );
            assert.equal(
                await page
                    .locator('.holding-card')
                    .filter({ hasText: 'DEMO-K' })
                    .locator('.holding-access')
                    .innerText(),
                '편집 가능'
            );
            assert.match(
                await page.locator('.holding-card').first().innerText(),
                /종목명 미제공/
            );

            assert.match(await mobile.innerText(), /₩190,000/);
            assert.match(await mobile.innerText(), /\$980\.00/);
            assert.match(await mobile.innerText(), /\$450\.00/);
            const baseline = api.length;
            await page
                .getByRole('textbox', { name: '종목 검색', exact: true })
                .fill('DEMO-M');
            await page
                .locator('.holding-card')
                .filter({ hasText: 'DEMO-M' })
                .waitFor();
            assert.equal(await page.locator('.holding-card').count(), 1);
            assert.match(await mobile.innerText(), /2026-10-28/);
            assert.match(await mobile.innerText(), /manual-holdings-v1/);
            assert.equal(
                api.length,
                baseline,
                'Local card filter must reuse the existing summary'
            );
            await mobile
                .getByRole('button', { name: '원본 자료 확인', exact: true })
                .click();
            await page.locator('#selected-account-management').waitFor();
            assert.match(await page.locator('.accounts').innerText(), /Viewer/);
            assert.equal(
                await page
                    .locator('.accounts')
                    .getByRole('button', { name: '자료 업로드', exact: true })
                    .count(),
                0,
                'Viewer evidence navigation must preserve write permissions'
            );
        }
        assert.deepEqual(
            api.filter((r) => !r.startsWith('GET ')),
            []
        );
        if (width >= 1024) {
            assert.equal(
                await page.locator('.holdings-desktop-table th').count(),
                8
            );
            assert.equal(
                await page
                    .locator('.holdings-desktop-table')
                    .getByRole('link', { name: 'DEMO-A', exact: true })
                    .getAttribute('href'),
                '/stock/DEMO-A?tab=details'
            );
            await page
                .locator('.holdings-desktop-table')
                .getByRole('button', { name: /DEMO-M.*자료 확인/ })
                .click();
            await page
                .locator('.family-page[data-stitch-view="assets"]')
                .waitFor();
            assert.equal(
                await page
                    .getByRole('button', { name: '자료 업로드', exact: true })
                    .count(),
                0
            );
        }
        assert.deepEqual(errors, []);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        console.log(
            `PASS holdings/${width}: desktop table/mobile cards, exact currencies, local filter, no writes`
        );
        await page.close();
    }
    if (process.env.STITCH_HOLDINGS_STATE_DIR)
        await fs.writeFile(
            `${process.env.STITCH_HOLDINGS_STATE_DIR}/results.json`,
            JSON.stringify(
                {
                    dataset:
                        'fixed synthetic account snapshots; no production data',
                    captured,
                },
                null,
                2
            )
        );
    const page = await browser.newPage({
        viewport: { width: 390, height: 1024 },
    });
    const compiled = await (
        await page.request.get(
            base + '/src/components/portfolio/PortfolioHoldingCards.vue'
        )
    ).text();
    const routerModule = compiled.match(/from "([^"]*vue-router\.js[^"]*)"/)[1];
    await page.route('**/__stitch-holdings', (r) =>
        r.fulfill({
            contentType: 'text/html',
            body: `<meta charset="utf-8"><div id="app"></div><script type="module">import {createApp,ref,h} from '/node_modules/.vite/deps/vue.js';import Cards from '/src/components/portfolio/PortfolioHoldingCards.vue';import PrimeVue from '/node_modules/primevue/config/index.mjs';import {createRouter,createMemoryHistory} from '${routerModule}';const rows=ref(Array.from({length:13},(_,i)=>({symbol:'FIXTURE-'+i,accountId:'a',ownerId:'p',currency:i%2?'USD':'KRW',quantity:2,amount:i===12?null:i===10?0:i===11?0.00000012:10,asOf:'2026-11-03',source:'isolated pagination fixture'})));window.testRows=rows;createApp({setup:()=>()=>h(Cards,{rows:rows.value,ownerName:()=> '합성 명의',accountLabel:()=> '합성 계좌',number:v=>v==null?'미확인':String(v)})}).use(PrimeVue,{unstyled:true}).use(createRouter({history:createMemoryHistory(),routes:[]})).mount('#app');</script>`,
        })
    );
    await page.goto(base + '/__stitch-holdings');
    await page.locator('.holding-card').first().waitFor();
    assert.equal(await page.locator('.holding-card').count(), 10);
    await page
        .getByRole('button', { name: '다음 보유 종목', exact: true })
        .click();
    assert.equal(await page.locator('.holding-card').count(), 3);
    assert.equal(
        await page
            .locator('.holding-card')
            .nth(0)
            .locator('.holding-figures strong')
            .last()
            .innerText(),
        '₩0'
    );
    assert.equal(
        await page
            .locator('.holding-card')
            .nth(1)
            .locator('.holding-figures strong')
            .last()
            .innerText(),
        '$0.00000012'
    );
    assert.equal(
        await page
            .locator('.holding-card')
            .last()
            .locator('.holding-figures strong')
            .last()
            .innerText(),
        '미확인'
    );
    assert.equal(
        await page
            .locator('.holding-card')
            .last()
            .locator('.currency')
            .innerText(),
        'KRW'
    );
    await page.evaluate(() => {
        window.testRows.value = window.testRows.value.slice(0, 1);
    });
    await page
        .locator('.holding-card')
        .filter({ hasText: 'FIXTURE-0' })
        .waitFor();
    assert.equal(await page.locator('.holding-card').count(), 1);
    assert.equal(
        await page
            .getByRole('navigation', { name: '보유 종목 카드 페이지' })
            .count(),
        0
    );
    console.log(
        'PASS pagination: 13 rows retained across pages, null amount stays unknown, filtering resets page'
    );
} finally {
    await browser.close();
}
