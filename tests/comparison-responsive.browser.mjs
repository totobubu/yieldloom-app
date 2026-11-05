// Local synthetic comparison review: no production account or provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures, stitchRows } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5183';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output =
    process.env.COMPARISON_EVIDENCE_DIR ||
    '/workspace/scratch/compare-stitch/verification';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const results = [];
const directory = {
    rows: [
        ...stitchRows,
        ...['NVDA', 'AMD'].map((symbol) => ({
            symbol,
            koName: `예시 ${symbol} 반도체 주식`,
            securityType: 'stock',
            noDividends: symbol === 'AMD',
            currency: symbol === 'AMD' ? 'KRW' : 'USD',
        })),
    ],
    distributions: {
        tickers: stitchRows
            .filter((r) => r.dividendEvidence.latestAmount)
            .map((r) => ({
                ticker: r.symbol,
                latest: {
                    distribution_per_share: r.dividendEvidence.latestAmount,
                    ex_date: r.dividendEvidence.latestExDate,
                    frequency: r.frequency,
                    currency: r.currency,
                },
            })),
    },
};
const metric = {
    performance: {
        totalReturn1Y: {
            status: 'available',
            value: 0,
            actualStartDate: '2025-11-03',
            asOfDate: '2026-11-03',
        },
    },
    fund: {
        expenseRatio: { status: 'available', value: 0, asOfDate: '2026-11-03' },
    },
};
try {
    for (const width of [1280, 1024, 834, 768, 640, 390, 320]) {
        for (const view of ['similar', 'theme']) {
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 1,
            });
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await installStitchFixtures(page);
            await installStaticAssets(page);
            await page.route('**/src/services/securityDirectory.js*', (route) =>
                route.fulfill({
                    contentType: 'application/javascript',
                    body: `export async function loadSecurityDirectory(){window.comparisonDirectoryReads=(window.comparisonDirectoryReads||0)+1;return ${JSON.stringify(directory)}};export async function loadSecurityInsights(symbol){(window.comparisonDetailReads||=[]).push(symbol);return symbol==='DEMO-B'?{fund:{expenseRatio:{status:'unavailable',value:99}},performance:{totalReturn1Y:{status:'unavailable',value:99}}}:${JSON.stringify(metric)}}`,
                })
            );
            await page.goto(
                base +
                    '/compare?view=' +
                    view +
                    (view === 'theme' ? '&theme=semiconductors' : '')
            );
            if (width > 1024) {
                await page
                    .locator('.comparison-summary tbody tr')
                    .first()
                    .waitFor();
                assert.equal(
                    await page.locator('[data-responsive-view]').count(),
                    0
                );
                assert.equal(
                    await page.locator('.comparison-summary thead th').count(),
                    9
                );
                results.push({ width, view, classic: true, errors });
                await page.close();
                continue;
            }
            const component = page.locator('[data-responsive-view]');
            await component.waitFor();
            await component
                .locator('.matrix-product')
                .first()
                .waitFor({ state: 'attached' });
            const mobile = width <= 640;
            assert.equal(
                await component.locator('.responsive-matrix').isVisible(),
                !mobile
            );
            assert.equal(
                await component.locator('.responsive-product-grid').isVisible(),
                mobile
            );
            assert.equal(await page.locator('#comparison-title').count(), 1);
            assert.equal(
                await component.locator('.explorer-filters .p-select').count(),
                4
            );
            const geometry = await component.evaluate((el) => {
                const rect = el.getBoundingClientRect();
                return {
                    width: rect.width,
                    pageOverflow:
                        document.documentElement.scrollWidth > innerWidth + 1,
                    filters: [
                        ...el.querySelectorAll('.explorer-filters .p-select'),
                    ].map((select) => ({
                        width: select.getBoundingClientRect().width,
                        height: select.getBoundingClientRect().height,
                    })),
                    titleFont: getComputedStyle(el.querySelector('h1'))
                        .fontSize,
                    matrixScrollable:
                        el.querySelector('.matrix-scroll').scrollWidth >
                        el.querySelector('.matrix-scroll').clientWidth,
                    gridColumns: getComputedStyle(
                        el.querySelector('.explorer-filters')
                    ).gridTemplateColumns,
                };
            });
            assert.equal(
                geometry.pageOverflow,
                false,
                `${view} ${width} page overflow`
            );
            assert.equal(
                geometry.filters.every((select) => select.height === 44),
                true
            );
            assert.equal(
                await page.evaluate(
                    () => window.comparisonDetailReads?.length || 0
                ),
                0
            );
            assert.equal(
                await page.evaluate(() => window.comparisonDirectoryReads),
                1
            );
            const visibleProducts = component.locator(
                mobile ? '.responsive-product-card' : '.matrix-product'
            );
            if (view === 'theme') {
                assert.equal(await visibleProducts.count(), 3);
                assert.match(await component.innerText(), /KRW/);
                assert.match(await component.innerText(), /미검증/);
                assert.doesNotMatch(
                    await component.innerText(),
                    /USD \(\$\) 단일/
                );
                assert.match(await component.innerText(), /개별주식 비적용/);
            }
            await page.evaluate(async () => {
                await document.fonts.ready;
            });
            await page.addStyleTag({
                content: '.studio-header, .mobile-nav { visibility: hidden; }',
            });
            await component.screenshot({
                path: `${output}/${view}-${width}.png`,
                animations: 'disabled',
            });
            if ([834, 390].includes(width)) {
                // Cascading filters must retain their original resets and avoid queries.
                await component.locator('#explorer-strategy').click();
                await page
                    .getByRole('listbox')
                    .getByRole('option')
                    .nth(1)
                    .click();
                await component.locator('#explorer-direction').click();
                const directions = page
                    .getByRole('listbox')
                    .getByRole('option');
                if ((await directions.count()) > 1)
                    await directions.nth(1).click();
                else await page.keyboard.press('Escape');
                await component.locator('#explorer-strategy').click();
                await page
                    .getByRole('listbox')
                    .getByRole('option')
                    .nth(0)
                    .click();
                assert.equal(
                    (
                        await component
                            .locator('#explorer-direction')
                            .innerText()
                    ).trim(),
                    '모든 방향'
                );
                assert.equal(
                    (
                        await component
                            .locator('#explorer-dividend')
                            .innerText()
                    ).trim(),
                    '모든 배당 여부'
                );
                assert.equal(
                    (
                        await component
                            .locator('#explorer-frequency')
                            .innerText()
                    ).trim(),
                    '모든 지급 주기'
                );
                assert.equal(
                    await page.evaluate(() => window.comparisonDirectoryReads),
                    1
                );
                assert.equal(
                    await page.evaluate(
                        () => window.comparisonDetailReads?.length || 0
                    ),
                    0
                );
                if (view === 'similar') {
                    await component
                        .locator('#comparison-product-search')
                        .fill('DEMO-B');
                    assert.equal(await visibleProducts.count(), 1);
                    await component
                        .locator('#comparison-product-search')
                        .fill('unmatchable-query');
                    await component
                        .getByRole('heading', {
                            name: '조건에 맞는 종목이 없습니다',
                        })
                        .waitFor();
                    assert.equal(
                        await page.evaluate(
                            () => window.comparisonDetailReads?.length || 0
                        ),
                        0
                    );
                    await component
                        .getByRole('button', {
                            name: '필터 초기화',
                            exact: true,
                        })
                        .click();
                }
                // Source tab labels retain their meaning without invented allocation data.
                const detailReadsBeforeTabs = await page.evaluate(
                    () => window.comparisonDetailReads?.length || 0
                );
                await component
                    .getByRole('button', {
                        name:
                            view === 'theme'
                                ? '기초자산 비중 및 섹터 분배'
                                : '테마 및 섹터 분배',
                        exact: true,
                    })
                    .click();
                assert.match(
                    await component.locator('.analysis-panel').innerText(),
                    /제공되지 않습니다/
                );
                if (view === 'theme') {
                    await component
                        .getByRole('button', {
                            name: '배당 지급 주기 및 현금흐름 대조',
                            exact: true,
                        })
                        .click();
                    assert.match(
                        await component.locator('.analysis-panel').innerText(),
                        /예측 자료는 제공되지 않습니다/
                    );
                }
                await component
                    .getByRole('button', {
                        name:
                            view === 'theme'
                                ? '테마 대표 종목 및 연관 ETF 매트릭스'
                                : '유사 상품군 매트릭스',
                        exact: true,
                    })
                    .click();
                assert.equal(
                    await page.evaluate(
                        () => window.comparisonDetailReads?.length || 0
                    ),
                    detailReadsBeforeTabs
                );
                if (mobile) {
                    const trigger = component
                        .locator('.product-detail-trigger')
                        .first();
                    await trigger.click();
                    const dialog = page.getByRole('dialog');
                    await dialog.waitFor();
                    assert.match(await dialog.innerText(), /배당락일/);
                    assert.equal(
                        await page.evaluate(
                            () => window.comparisonDetailReads?.length || 0
                        ),
                        detailReadsBeforeTabs
                    );
                    await page.keyboard.press('Escape');
                    await dialog.waitFor({ state: 'hidden' });
                    assert.equal(
                        await trigger.evaluate(
                            (el) => el === document.activeElement
                        ),
                        true
                    );
                }
                // Only explicitly selected symbols are queried; max three remain selectable.
                await component
                    .getByRole('button', { name: '선택 초기화', exact: true })
                    .click();
                assert.equal(
                    await component.locator('.tray-items > span').count(),
                    0
                );
                const boxes = component.locator(
                    mobile
                        ? '.responsive-product-card input[type=checkbox]'
                        : '.matrix-product input[type=checkbox]'
                );
                await boxes.first().check();
                const selectedSymbol = await boxes
                    .first()
                    .getAttribute('aria-label');
                await component
                    .getByRole('button', {
                        name: '선택 항목 정밀 비교 실행 (1/3)',
                        exact: true,
                    })
                    .click();
                await page.waitForFunction(
                    () => window.comparisonDetailReads?.length === 1
                );
                await page
                    .locator('.fullscreen-loading')
                    .waitFor({ state: 'hidden' });
                assert.equal(
                    (
                        await page.evaluate(() => window.comparisonDetailReads)
                    )[0],
                    selectedSymbol.replace(' 비교 트레이 선택', '')
                );
                if (view === 'similar') {
                    const before = mobile
                        ? component.locator('.primary-product-metrics').first()
                        : component.locator('.matrix-fee').first();
                    assert.match(await before.innerText(), /0%/);
                    // Unrequested rows do not turn into a false missing-data result.
                    const unrequested = mobile
                        ? component.locator('.primary-product-metrics').nth(1)
                        : component.locator('.matrix-fee').nth(1);
                    assert.match(await unrequested.innerText(), /조회 전/);
                }
                await component.locator('.filter-details > summary').click();
                await component
                    .getByRole('button', {
                        name: '수익률·수수료·가격 하락 조회',
                        exact: true,
                    })
                    .click();
                await page.waitForFunction(
                    () => window.comparisonDetailReads?.length > 1
                );
                await page
                    .getByRole('button', {
                        name: '수익률·수수료·가격 하락 조회',
                        exact: true,
                    })
                    .waitFor();
                if (view === 'similar') {
                    const unavailable = mobile
                        ? component.locator('.primary-product-metrics').nth(1)
                        : component.locator('.matrix-fee').nth(1);
                    await page.waitForFunction(
                        () =>
                            !document.querySelector(
                                '.p-button[data-p~="loading"]'
                            )
                    );
                    assert.match(await unavailable.innerText(), /미확인/);
                    assert.doesNotMatch(await unavailable.innerText(), /99%/);
                }
                const downloadEvent = page.waitForEvent('download');
                await component
                    .getByRole('button', { name: '저장', exact: true })
                    .click();
                const download = await downloadEvent;
                const saved = JSON.parse(
                    await fs.readFile(await download.path(), 'utf8')
                );
                assert.equal(saved.view, view);
                assert.ok(saved.symbols.length <= 3);
                assert.equal('amount' in saved, false);
                await page
                    .context()
                    .grantPermissions(['clipboard-read', 'clipboard-write']);
                await component
                    .getByRole('button', { name: '공유', exact: true })
                    .click();
                const clipboard = await page.evaluate(() =>
                    navigator.clipboard.readText()
                );
                assert.match(clipboard, /compare\?view=/);
                assert.match(clipboard, /conditions/);
                await component
                    .getByRole('status')
                    .filter({ hasText: '비교 조건을 복사' })
                    .waitFor();
                // Dropdown keyboard focus, Escape and theme persistence remain usable.
                await component.locator('#explorer-strategy').focus();
                await page.keyboard.press('ArrowDown');
                await page.keyboard.press('Escape');
                await page.evaluate(() =>
                    document.documentElement.classList.add('p-dark')
                );
                assert.equal(
                    await page.evaluate(
                        () =>
                            document.documentElement.scrollWidth >
                            innerWidth + 1
                    ),
                    false
                );
                await component.screenshot({
                    path: `${output}/${view}-${width}-dark.png`,
                    animations: 'disabled',
                });
                await page.evaluate(() =>
                    document.documentElement.classList.remove('p-dark')
                );
                // Resizing must not discard current filters or create duplicate IDs.
                await page.setViewportSize({ width: 1280, height: 1024 });
                await page.locator('.comparison-summary').waitFor();
                assert.equal(
                    await page.locator('#comparison-title').count(),
                    1
                );
                await page.setViewportSize({ width, height: 1024 });
                await component.waitFor();
                assert.equal(
                    await page.locator('#comparison-title').count(),
                    1
                );
            }
            assert.deepEqual(errors, []);
            results.push({ width, view, geometry, errors });
            await page.close();
        }
    }
} finally {
    await fs.writeFile(
        `${output}/results.json`,
        JSON.stringify(results, null, 2)
    );
    await browser.close();
}
console.log(
    `Responsive comparison: ${results.length} viewport/view states passed; ${output}`
);
