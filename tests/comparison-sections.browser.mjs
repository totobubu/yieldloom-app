import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = '/tmp/yieldloom-comparison-sections';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 768, 390, 360]) {
        const context = await browser.newContext({
            viewport: { width, height: 1100 },
        });
        const page = await context.newPage();
        const requests = [];
        const errors = [];
        page.on('request', (r) => {
            if (['fetch', 'xhr'].includes(r.resourceType()))
                requests.push(r.url());
        });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(base + '/underlying/AAPL');
        await page.locator('.product-grid article').first().waitFor();
        assert.equal(
            await page
                .getByRole('heading', { name: '종목 비교', exact: true })
                .count(),
            1
        );
        const nav = page.getByRole('navigation', {
            name: '종목 비교 하위 메뉴',
        });
        assert.equal(await nav.getByRole('link').count(), 3);
        const heading = page.getByRole('heading', {
            name: '기초자산별 ETF 비교',
            exact: true,
        });
        const button = page.getByRole('button', {
            name: '수익률·수수료·가격 하락 조회',
            exact: true,
        });
        assert.equal(
            await page
                .locator('.comparison-section-heading')
                .getByRole('button', {
                    name: '수익률·수수료·가격 하락 조회',
                    exact: true,
                })
                .count(),
            1
        );
        if (width >= 768) {
            const a = await heading.boundingBox(),
                b = await button.boundingBox();
            assert.ok(b.x > a.x + a.width);
            assert.ok(Math.abs(b.y - a.y) < 55);
        }
        const info = page.getByRole('button', {
            name: '비교 안내',
            exact: true,
        });
        if (width === 1440) {
            await info.hover();
            await page.getByRole('tooltip').waitFor();
            await page.mouse.move(1, 1);
        }
        await info.focus();
        await page.keyboard.press('Enter');
        await page.locator('.p-popover').waitFor();
        assert.match(await page.locator('.p-popover').innerText(), /일간 배수/);
        await page.keyboard.press('Escape');
        await page.locator('.p-popover').waitFor({ state: 'hidden' });
        assert.ok(
            !requests.some((url) => /stock-prices|security-insights/.test(url)),
            'Details must remain lazy'
        );
        const before = requests.length;
        await page.screenshot({ path: `${output}/${width}-underlying.png` });
        await nav
            .getByRole('link', { name: '유사 ETF 비교', exact: true })
            .click();
        await page.waitForURL(
            (url) => url.searchParams.get('view') === 'similar'
        );
        await page.locator('.product-grid article').first().waitFor();
        assert.match(
            await page.locator('.comparison-result-count').innerText(),
            /APLY/
        );
        assert.ok(
            (await page.locator('.product-grid article').count()) > 1,
            'Default comparison must contain peers'
        );
        assert.equal(
            await page
                .locator('.product-grid')
                .getByText('기준 ETF', { exact: true })
                .count(),
            1
        );
        await page.screenshot({ path: `${output}/${width}-similar.png` });
        await nav.getByRole('link', { name: '테마 비교', exact: true }).click();
        await page.waitForURL(
            (url) => url.searchParams.get('view') === 'theme'
        );
        await page
            .locator('.comparison-context')
            .getByText('M7 (매그니피센트 7)', { exact: true })
            .waitFor();
        for (const href of await page
            .locator('.product-context-tags a')
            .evaluateAll((nodes) =>
                nodes.map((node) => node.getAttribute('href'))
            ))
            assert.ok(
                [
                    '/underlying/AAPL',
                    '/underlying/MSFT',
                    '/underlying/GOOGL',
                    '/underlying/GOOG',
                    '/underlying/AMZN',
                    '/underlying/NVDA',
                    '/underlying/META',
                    '/underlying/TSLA',
                ].includes(href)
            );
        await page.locator('#explorer-theme').click();
        await page.getByRole('option', { name: '반도체', exact: true }).click();
        await page.waitForURL(
            (url) => url.searchParams.get('theme') === 'semiconductors'
        );
        assert.equal(
            requests.length,
            before,
            'Tabs and selection must reuse the directory without fetching'
        );
        await page.screenshot({ path: `${output}/${width}-theme.png` });
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            `Overflow ${width}`
        );
        await page
            .getByRole('button', { name: '다크 모드', exact: true })
            .click();
        await page.screenshot({ path: `${output}/${width}-dark.png` });
        await page.reload();
        await page.locator('.product-grid article').first().waitFor();
        assert.match(
            await page.locator('.comparison-context').innerText(),
            /반도체/
        );
        assert.equal(await page.locator('html.p-dark').count(), 1);
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}: legacy URL, 3 sections, header action, keyboard/help, M7/semiconductor grouping, no tab requests, reload/dark, no overflow/errors`
        );
        await context.close();
    }
    const page = await browser.newPage();
    // Deterministic public metrics exercise the explicit detail query without contacting market APIs.
    const prices = [];
    await page.route('**/api/stock-prices?*', async (route) => {
        const symbol = new URL(route.request().url()).searchParams.get(
            'ticker'
        );
        prices.push(symbol);
        await route.fulfill({
            json: {
                symbol,
                candles: [
                    { date: '2026-10-01', close: 100 },
                    { date: '2026-10-20', close: 90 },
                ],
            },
        });
    });
    await page.route('**/security-insights/*.json', (route) =>
        route.fulfill({
            json: {
                securities: {
                    AAPB: {
                        performance: {
                            totalReturn1Y: {
                                status: 'available',
                                value: 25,
                                actualStartDate: '2025-10-20',
                                asOfDate: '2026-10-20',
                            },
                        },
                    },
                    AAPD: {
                        performance: {
                            totalReturn1Y: {
                                status: 'available',
                                value: 35,
                                actualStartDate: '2025-10-19',
                                asOfDate: '2026-10-19',
                            },
                        },
                    },
                },
            },
        })
    );
    await page.goto(base + '/compare?view=underlying&symbol=AAPL');
    await page.locator('.product-grid article').first().waitFor();
    const count = await page.locator('.product-grid article').count();
    await page
        .getByRole('button', {
            name: '수익률·수수료·가격 하락 조회',
            exact: true,
        })
        .click();
    await page
        .getByRole('heading', { name: '한눈에 비교', exact: true })
        .waitFor();
    assert.equal(prices.length, Math.min(count, 12));
    assert.equal(
        await page
            .locator('.comparison-summary tbody td:nth-child(3).is-best')
            .count(),
        0,
        'Different return periods must not produce a winner'
    );
    assert.match(
        await page.locator('.comparison-summary').innerText(),
        /2025-10-20/
    );
    assert.match(
        await page.locator('.comparison-summary').innerText(),
        /미확인/
    );
    await page.goto(base + '/compare?view=similar&ticker=INVALID');
    await page
        .getByRole('heading', {
            name: '조건에 맞는 ETF가 없습니다',
            exact: true,
        })
        .waitFor();
    await page.close();
    console.log(
        'PASS: explicit detail query limits requests, missing metrics remain unknown, invalid reference empty state'
    );
} finally {
    await browser.close();
}
