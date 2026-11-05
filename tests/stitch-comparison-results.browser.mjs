// Isolated synthetic metrics only: zero is valid; unavailable supplied values are rejected.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const output = process.env.STITCH_COMPARISON_RESULT_DIR;
const states = [];
if (output) await fs.mkdir(output, { recursive: true });
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
try {
    for (const width of [1280, 768, 390]) {
        for (const [view, query] of [
            ['underlying', '&symbol=DEMO-BASE'],
            ['similar', ''],
            ['theme', '&theme=semiconductors'],
        ]) {
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            await installStaticAssets(page);
            const availableZero = {
                performance: {
                    totalReturn1Y: {
                        status: 'available',
                        value: 0,
                        actualStartDate: '2025-11-03',
                        asOfDate: '2026-11-03',
                    },
                },
                fund: {
                    expenseRatio: {
                        status: 'available',
                        value: 0,
                        asOfDate: '2026-11-03',
                    },
                },
            };
            await installStitchFixtures(page, {
                insightsBySymbol: {
                    'DEMO-A': availableZero,
                    'DEMO-E': availableZero,
                    'DEMO-B': {
                        performance: {
                            totalReturn1Y: { status: 'unavailable', value: 99 },
                        },
                        fund: {
                            expenseRatio: { status: 'unavailable', value: 99 },
                        },
                    },
                },
            });
            const requests = [],
                errors = [];
            page.on('request', (r) =>
                requests.push({ url: r.url(), method: r.method() })
            );
            page.on('pageerror', (e) => errors.push(e.message));
            await page.goto(base + '/compare?view=' + view + query);
            const compact = width <= 1024 && view !== 'underlying';
            const tablet = compact && width > 640;
            const products = page.locator(
                tablet
                    ? '.matrix-product'
                    : width > 1024
                      ? '.comparison-summary tbody tr'
                      : '.product-grid article'
            );
            await products.first().waitFor();
            if (compact) {
                await page.locator('.filter-details > summary').click();
                if (!tablet)
                    await page.locator('.product-extra').evaluateAll((nodes) =>
                        nodes.forEach((node) => {
                            node.open = true;
                        })
                    );
                else await page.locator('.tablet-extra > summary').click();
            }
            const a = products.filter({
                has: page.getByRole('link', {
                    name: view === 'theme' ? 'DEMO-E' : 'DEMO-A',
                    exact: true,
                }),
            });
            const b = products.filter({
                has: page.getByRole('link', { name: 'DEMO-B', exact: true }),
            });
            assert.equal(await a.count(), 1);
            assert.equal(await b.count(), view === 'theme' ? 0 : 1);
            assert.match(
                await (
                    tablet ? page.locator('.responsive-matrix') : a
                ).innerText(),
                /조회 전/
            );
            assert.equal(
                requests.filter(
                    (r) =>
                        r.url.includes('/stock-prices') ||
                        r.url.includes('/security-insights/')
                ).length,
                0,
                'Rendering results must not load metrics'
            );
            if (width > 1024) {
                assert.equal(
                    await page.locator('.comparison-summary thead th').count(),
                    9
                );
                assert.equal(
                    await page
                        .getByRole('region', {
                            name: '종목 비교 결과표',
                            exact: true,
                        })
                        .getAttribute('tabindex'),
                    '0'
                );
            } else if (!tablet && !compact) {
                assert.equal(
                    await a.locator('.product-fields dt').count(),
                    compact ? 3 : 4
                );
                assert.equal(
                    await a.locator('.product-metrics > div').count(),
                    3
                );
                assert.match(
                    await a.locator('.product-dividend').innerText(),
                    view === 'theme' ? /미확인/ : /0.18\s*USD/
                );
                assert.match(
                    await a.locator('.product-meta').innerText(),
                    /재검증 대기/
                );
                assert.equal(
                    await a
                        .getByRole('link', { name: '종목 상세', exact: true })
                        .getAttribute('href'),
                    view === 'theme' ? '/stock/DEMO-E' : '/stock/DEMO-A'
                );
            }
            if (output) {
                await page.evaluate(async () => {
                    await document.fonts.ready;
                    scrollTo(0, 0);
                    await new Promise(requestAnimationFrame);
                });
                await page.screenshot({
                    path: `${output}/${view}-${width}-before.png`,
                    fullPage: true,
                    animations: 'disabled',
                });
            }
            await page
                .getByRole('button', {
                    name: '수익률·수수료·가격 하락 조회',
                    exact: true,
                })
                .click();
            await page
                .locator('.comparison-load-button[data-p~="loading"]')
                .waitFor({ state: 'hidden' });
            if (width > 1024) {
                assert.match(await a.locator('td').nth(3).innerText(), /^0%/);
                assert.match(await a.locator('td').nth(4).innerText(), /^0%/);
                if (view !== 'theme')
                    assert.equal(
                        await page
                            .locator('.comparison-summary td.is-best')
                            .first()
                            .evaluate(
                                (el) =>
                                    Number(getComputedStyle(el).fontWeight) >=
                                    700
                            ),
                        true,
                        'Existing comparable-value highlight remains bold'
                    );
            } else if (tablet) {
                const symbol = view === 'theme' ? 'DEMO-E' : 'DEMO-A';
                const index = await products.evaluateAll(
                    (nodes, symbol) =>
                        nodes.findIndex((node) =>
                            node.textContent.includes(symbol)
                        ),
                    symbol
                );
                assert.match(
                    await page.locator('.matrix-fee').nth(index).innerText(),
                    /0%/
                );
                const extra = page
                    .locator('.tablet-extra tbody tr')
                    .filter({ hasText: symbol });
                assert.match(await extra.innerText(), /0%/);
            } else if (compact) {
                await a.locator('.product-detail-trigger').click();
                const dialog = page.getByRole('dialog');
                await dialog.waitFor();
                assert.match(
                    await dialog
                        .locator('.product-metrics > div')
                        .nth(0)
                        .innerText(),
                    /0%/
                );
                assert.match(
                    await dialog
                        .locator('.product-metrics > div')
                        .nth(1)
                        .innerText(),
                    /0%/
                );
                assert.match(await dialog.innerText(), /2026-11-03/);
                assert.match(
                    await dialog.locator('.product-meta').innerText(),
                    /재검증 대기/
                );
                assert.equal(
                    await dialog
                        .getByRole('link', { name: '종목 상세', exact: true })
                        .getAttribute('href'),
                    view === 'theme' ? '/stock/DEMO-E' : '/stock/DEMO-A'
                );
                await page.keyboard.press('Escape');
                await dialog.waitFor({ state: 'hidden' });
            } else {
                assert.match(
                    await a
                        .locator('.product-metrics > div')
                        .nth(0)
                        .innerText(),
                    /0%/
                );
                assert.match(
                    await a
                        .locator('.product-metrics > div')
                        .nth(1)
                        .innerText(),
                    /0%/
                );
            }
            if (view !== 'theme') {
                const unavailable = tablet
                    ? page.locator('.matrix-fee').nth(1)
                    : b;
                assert.doesNotMatch(
                    await unavailable.innerText(),
                    /99%|조회 전/
                );
                assert.match(await unavailable.innerText(), /미확인/);
            }
            assert.equal(
                requests.filter((r) => r.url.includes('/stock-prices')).length,
                await products.count(),
                'One explicit price query per displayed security'
            );
            assert.equal(
                requests.filter(
                    (r) =>
                        r.method !== 'GET' &&
                        r.url.includes('/api/') &&
                        !r.url.includes('/analytics')
                ).length,
                0
            );
            assert.equal(
                requests.some((r) => /\/api\/(family|portfolio)/.test(r.url)),
                false
            );
            assert.deepEqual(errors, []);
            assert.equal(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                ),
                true
            );
            if (output) {
                await page.evaluate(async () => {
                    await document.fonts.ready;
                    scrollTo(0, 0);
                    await new Promise(requestAnimationFrame);
                });
                await page.screenshot({
                    path: `${output}/${view}-${width}-loaded.png`,
                    fullPage: true,
                    animations: 'disabled',
                });
                states.push({
                    view,
                    width,
                    deviceScaleFactor: 2,
                    zeroSymbol: view === 'theme' ? 'DEMO-E' : 'DEMO-A',
                    zeroRowText: await a.innerText(),
                    sourceState:
                        'No source queried-result frame; implementation synthetic state only',
                });
            }
            console.log(
                `PASS comparison/${view}/${width}: explicit query, zero vs unavailable, real links/provenance, structured results, no personal writes/overflow/errors`
            );
            await page.close();
        }
    }
    if (output)
        await fs.writeFile(
            `${output}/results.json`,
            JSON.stringify(states, null, 2) + '\n'
        );
} finally {
    await browser.close();
}
