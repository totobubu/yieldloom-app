// Synthetic public-price responses and an isolated local component only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';

const base = new URL(process.env.UI_BASE_URL || 'http://127.0.0.1:5175');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
const evidence = process.env.PRICE_REFRESH_EVIDENCE_DIR;
if (evidence) await fs.mkdir(evidence, { recursive: true });
const harness = fileURLToPath(
    new URL('../.phase72-price-refresh.html', import.meta.url)
);
await fs.writeFile(
    harness,
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app" class="studio-shell"></div><script type="module">
import {createApp,h,ref} from 'vue';import PrimeVue from 'primevue/config';import {MyPreset} from '/src/config/theme.js';import Chart from '/src/components/stock/StockCandlestickChart.vue';import {loadStockPrices} from '/src/services/stockPrices.js';import '/src/styles/style.scss';import '/src/styles/studio.scss';
const symbol=ref('DEMO-A'),states=[],transports=[];const originalFetch=window.fetch.bind(window);window.fetch=(url,options)=>{if(String(url).includes('/api/stock-prices')){const row={symbol:new URL(url,location.origin).searchParams.get('ticker'),cache:options.cache,signalPresent:!!options.signal,aborted:false};options.signal?.addEventListener('abort',()=>row.aborted=true);transports.push(row)}return originalFetch(url,options)};window.priceRefreshFixture={symbol,states,transports,cachedRead:value=>loadStockPrices(value)};
createApp({setup(){return()=>h('main',{class:'fixture-frame'},h(Chart,{symbol:symbol.value,currency:'USD',events:[],onPricesState:value=>states.push(value)}))}}).use(PrimeVue,{theme:{preset:MyPreset,options:{darkModeSelector:'.p-dark'}}}).mount('#app');
</script><style>body{margin:0}.fixture-frame{max-width:1180px;margin:auto;padding:24px}@media(max-width:640px){.fixture-frame{padding:16px}}</style></body></html>`,
    { flag: 'wx' }
);
let browser;
const results = [];
const geometry = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
        height: rect.height,
        width: rect.width,
        font: style.fontSize,
        weight: style.fontWeight,
        radius: style.borderRadius,
        padding: style.padding,
        line: style.lineHeight,
    };
};
try {
    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox'],
    });
    for (const width of [1280, 768, 390]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
            deviceScaleFactor: 2,
        });
        await installStaticAssets(context);
        const page = await context.newPage();
        await page.clock.setFixedTime(new Date('2026-11-04T12:00:00Z'));
        const reads = [],
            errors = [],
            aborted = [];
        let holdNext = false,
            failNext = false,
            releaseHeld;
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('requestfailed', (request) => {
            if (request.url().includes('/api/stock-prices'))
                aborted.push(request.failure()?.errorText);
        });
        await page.route('**/api/**', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            assert.equal(url.pathname, '/api/stock-prices');
            assert.equal(request.method(), 'GET');
            const symbol = url.searchParams.get('ticker');
            reads.push(symbol);
            const revision = reads.length;
            if (holdNext) {
                holdNext = false;
                await new Promise((done) => (releaseHeld = done));
            }
            if (failNext) {
                failNext = false;
                return route.fulfill({
                    status: 503,
                    json: { error: '합성 시세 오류' },
                });
            }
            const close = symbol === 'DEMO-B' ? 40 + revision : 20 + revision;
            try {
                await route.fulfill({
                    json: {
                        symbol,
                        currency: 'USD',
                        candles: Array.from({ length: 30 }, (_, i) => ({
                            date: new Date(Date.UTC(2026, 9, i + 1))
                                .toISOString()
                                .slice(0, 10),
                            open: close - 1,
                            high: close + 1,
                            low: close - 2,
                            close,
                            volume: 0,
                        })),
                    },
                });
            } catch (error) {
                if (!request.failure()) throw error;
            }
        });
        await page.goto(new URL('/.phase72-price-refresh.html', base).href);
        await page.locator('.quote-summary').waitFor();
        assert.deepEqual(reads, ['DEMO-A'], 'initial auto load stays one read');
        const refresh = page.getByRole('button', {
            name: '시세 데이터 재조회',
            exact: true,
        });
        console.log(
            JSON.stringify({
                width,
                initialReads: reads.length,
                normalRefreshButtons: await refresh.count(),
            })
        );
        assert.equal(
            await refresh.count(),
            1,
            'normal chart must expose reference refresh control'
        );
        const implementation = await refresh.evaluate(geometry);
        assert.equal(
            await refresh.evaluate((button) => {
                const note = button
                    .closest('section')
                    .querySelector('.basis-note');
                return (
                    button.parentElement.getBoundingClientRect().top >=
                    note.getBoundingClientRect().bottom
                );
            }),
            true,
            'refresh remains after chart and data-basis note'
        );
        await page.evaluate(() =>
            window.priceRefreshFixture.cachedRead('DEMO-A')
        );
        assert.equal(
            reads.length,
            1,
            'ordinary public read still uses the cache'
        );
        holdNext = true;
        if (width === 768) {
            await refresh.focus();
            await page.keyboard.press('Enter');
        } else if (width === 1280)
            await refresh.evaluate((button) => {
                button.click();
                button.click();
            });
        else await refresh.click();
        await page.waitForFunction(
            () => window.priceRefreshFixture.transports.length === 2
        );
        assert.equal(await refresh.isDisabled(), true);
        await refresh.evaluate((button) => {
            button.click();
            button.click();
        });
        await page.evaluate(() => {
            window.sharedPriceRead =
                window.priceRefreshFixture.cachedRead('DEMO-A');
        });
        assert.equal(
            reads.length,
            2,
            'pending click lock and shared reads avoid duplicate transport'
        );
        releaseHeld();
        await page.locator('.quote-summary').waitFor();
        assert.equal(await refresh.isEnabled(), true);
        await page.evaluate(() => window.sharedPriceRead);
        const cached = await page.evaluate(() =>
            window.priceRefreshFixture.cachedRead('DEMO-A')
        );
        assert.equal(cached.candles[0].close, 22);
        assert.equal(
            reads.length,
            2,
            'new forced result is cached without automatic reload'
        );
        await page.getByRole('button', { name: '3개월', exact: true }).click();
        await page.getByRole('button', { name: '주봉', exact: true }).click();
        assert.equal(reads.length, 2, 'chart controls remain local');
        holdNext = true;
        await refresh.click();
        await page.waitForFunction(
            () => window.priceRefreshFixture.transports.length === 3
        );
        await page.evaluate(() => {
            window.priceRefreshFixture.symbol.value = 'DEMO-B';
        });
        await page.waitForFunction(
            () =>
                window.priceRefreshFixture.states.at(-1)?.symbol === 'DEMO-B' &&
                !window.priceRefreshFixture.states.at(-1)?.loading
        );
        releaseHeld();
        await page.waitForTimeout(50);
        const latest = await page.evaluate(() =>
            window.priceRefreshFixture.states.at(-1)
        );
        assert.equal(latest.symbol, 'DEMO-B');
        assert.equal(latest.payload.symbol, 'DEMO-B');
        assert.deepEqual(reads, ['DEMO-A', 'DEMO-A', 'DEMO-A', 'DEMO-B']);
        failNext = true;
        await refresh.click();
        const retry = page.getByRole('button', {
            name: '다시 시도',
            exact: true,
        });
        await retry.waitFor();
        assert.equal(
            await refresh.count(),
            0,
            'error keeps the original retry path'
        );
        await retry.click();
        await refresh.waitFor();
        await page.locator('.quote-summary').waitFor();
        assert.equal(
            reads.length,
            6,
            'each explicit refresh/retry adds one request'
        );
        const transports = await page.evaluate(
            () => window.priceRefreshFixture.transports
        );
        assert.deepEqual(
            transports.map((row) => row.cache),
            ['no-store', 'reload', 'reload', 'no-store', 'reload', 'reload']
        );
        assert.ok(transports.every((row) => row.signalPresent));
        assert.equal(
            transports[2].aborted,
            true,
            'ticker switch aborts stale refresh'
        );
        assert.deepEqual(errors, []);
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth > innerWidth
            ),
            false
        );
        if (evidence)
            await page.screenshot({
                path: resolve(evidence, `implementation-${width}.png`),
                fullPage: true,
            });
        let dark = null;
        if (width === 390) {
            await page.evaluate(() =>
                document.documentElement.classList.add('p-dark')
            );
            await refresh.evaluate(async (button) => {
                getComputedStyle(button).backgroundColor;
                await Promise.all(
                    button
                        .getAnimations()
                        .map((animation) => animation.finished)
                );
            });
            dark = await refresh.evaluate((button) => {
                const style = getComputedStyle(button);
                return {
                    height: button.getBoundingClientRect().height,
                    color: style.color,
                    background: style.backgroundColor,
                };
            });
            assert.equal(dark.height, 30);
            assert.notEqual(dark.color, dark.background);
            assert.notEqual(dark.background, 'rgb(255, 255, 255)');
            assert.equal(reads.length, 6, 'theme change adds no fetch');
            if (evidence)
                await page.screenshot({
                    path: resolve(evidence, 'implementation-dark-390.png'),
                    fullPage: true,
                });
        }
        const original = await fs.readFile(
            new URL(
                '../docs/design/stitch-v2/originals/7356929996797649648/87cd200796914464b7613003247de771.html',
                import.meta.url
            ),
            'utf8'
        );
        await page.route('**/source-price-refresh', (route) =>
            route.fulfill({ contentType: 'text/html', body: original })
        );
        await page.goto(new URL('/source-price-refresh', base).href);
        await page.evaluate(() => document.fonts.ready);
        const source = await page
            .getByRole('button', { name: '시세 데이터 재조회', exact: true })
            .evaluate(geometry);
        for (const key of ['height', 'font', 'weight', 'radius', 'padding'])
            assert.equal(implementation[key], source[key], key);
        if (evidence)
            await page.screenshot({
                path: resolve(evidence, `source-${width}.png`),
                fullPage: true,
            });
        results.push({
            width,
            reads,
            transports,
            aborted,
            implementation,
            source,
            keyboardRefresh: width === 768,
            dark,
            errors,
            scope: 'synthetic HTTP responses; source HTML rendered at same viewport; native PNG and live provider/account not accepted',
        });
        await context.close();
    }
    if (evidence)
        await fs.writeFile(
            resolve(evidence, 'results.json'),
            JSON.stringify(results, null, 2) + '\n'
        );
    console.log(
        'PASS: 3 widths, normal explicit refresh uses existing forced public fetch; one initial read, pending lock/shared cache, no control auto reads, stale ticker abort, error/retry and source button geometry preserved. Synthetic public data only.'
    );
} finally {
    await browser?.close();
    await fs.unlink(harness);
}
