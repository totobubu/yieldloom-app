import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const harness = new URL('../.tmp-entry-income.html', import.meta.url);
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const ticker = {
    symbol: 'NEW',
    sourceStatus: { dividends: 'official_projection' },
    collectionCoverage: Object.fromEntries(
        ['market-prices', 'dividends'].map((k) => [
            k,
            { complete: true, start: '2026-08-03', end: '2026-11-03' },
        ])
    ),
    backtestData: [
        ...['2026-08-03', '2026-09-01', '2026-10-01', '2026-11-02'].map(
            (date) => ({ date, close: 100 })
        ),
        ...['2026-08-15', '2026-09-15', '2026-10-15'].map((date) => ({
            date,
            amount: 1,
            declaredDate: date,
            dividendVerified: true,
        })),
    ],
};
const options = {
    asOfDate: '2026-11-03',
    lifecycleEvidence: {
        symbol: 'NEW',
        firstTradeDate: '2026-08-03',
        dateMeaning: 'first_trade',
        verificationStatus: 'official_reviewed',
        sourceUrl: 'https://issuer.example/fund/new',
        reviewedAt: '2026-11-03',
    },
};
try {
    await writeFile(
        harness,
        `<!doctype html><html lang="ko"><meta charset="utf-8"><style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:sans-serif}</style><div id="app"></div><script type="module">
    import {createApp,h,ref,computed} from 'vue';
    import '/src/styles/style.scss';
    import '/src/styles/studio.scss';
    import Card from '/src/components/thumbnail/DividendEntryEfficiencyThumbnail.vue';
    import {calculateEntryIncomeEfficiency} from '/src/services/thumbnail/entryIncomeEfficiency.js';
    import {cardPresentationKey,normalizeCardPresentation} from '/src/services/thumbnail/cardPresentation.js';
    const state=ref({ticker:{},options:{}}),presentation=ref(normalizeCardPresentation());
    window.setEntryCase=(value)=>{state.value=value;presentation.value=normalizeCardPresentation(value.presentation)};
    createApp({render:()=>h(Card,{data:calculateEntryIncomeEfficiency(state.value.ticker,state.value.options)})}).provide(cardPresentationKey,computed(()=>presentation.value)).mount('#app');
    </script></html>`
    );
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1400 },
    });
    const errors = [],
        api = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/**', (route) => {
        api.push(route.request().url());
        return route.abort();
    });
    await page.goto(base + '/.tmp-entry-income.html');
    await page.waitForFunction(() => window.setEntryCase);
    for (const aspectRatio of ['square', 'wide', 'story']) {
        await page.evaluate(
            ({ ticker, options, aspectRatio }) =>
                window.setEntryCase({
                    ticker,
                    options,
                    presentation: { aspectRatio },
                }),
            { ticker, options, aspectRatio }
        );
        const card = page.locator('[data-thumbnail-kind="entry-efficiency"]');
        await card.getByText('2.55%', { exact: true }).first().waitFor();
        assert.match(await card.innerText(), /출시 이후 누적/);
        assert.match(await card.innerText(), /연환산하지 않/);
        assert.match(await card.innerText(), /2026.08.03~2026.11.01/);
        await card.screenshot({
            path: `/tmp/entry-income-new-${aspectRatio}.png`,
        });
        assert.equal(
            await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
            true,
            aspectRatio + ' content must fit export bounds'
        );
    }
    const incomplete = structuredClone(ticker);
    incomplete.collectionCoverage = null;
    await page.evaluate(
        ({ ticker, options }) => window.setEntryCase({ ticker, options }),
        { ticker: incomplete, options }
    );
    await page
        .getByText(/누락 이력을 짧은 신규 펀드 이력이나 0으로 대신하지/)
        .waitFor();
    const topw = { ...incomplete, symbol: 'TOPW' };
    await page.evaluate(
        (ticker) =>
            window.setEntryCase({
                ticker,
                options: { asOfDate: '2026-11-03' },
            }),
        topw
    );
    await page.getByText(/WPAY→TOPW 변경/).waitFor();
    assert.match(
        await page.locator('.unavailable').innerText(),
        /출시 후 12개월이 지났/
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
        path: '/tmp/entry-income-incomplete-mobile.png',
        fullPage: true,
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(api, []);
    console.log(
        'PASS entry card: verified cumulative labels/periods and three export ratios; incomplete history and ticker continuity; no API requests or page errors.'
    );
} finally {
    await browser.close();
    await rm(harness, { force: true });
}
