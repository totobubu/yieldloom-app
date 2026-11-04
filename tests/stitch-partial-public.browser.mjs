// Synthetic public catalog only. No authenticated identities or production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5185';
const output =
    process.env.PARTIAL_EVIDENCE_DIR || '/tmp/yieldloom-partial-public';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const name =
    '가상 테스트용 장기 이름 배당 인덱스 포트폴리오 ETF 전체 종목명 확인';
const nav = Array.from({ length: 125 }, (_, i) => ({
    symbol: `DEMO-${String(i).padStart(3, '0')}`,
    koName: name,
    company: '테스트 운용사',
    underlying: 'DEMO-BASE',
    active: true,
    currency: 'USD',
}));
const results = [];
try {
    for (const width of [1280, 768, 390, 320]) {
        const context = await browser.newContext({
            viewport: { width, height: 1000 },
        });
        await context.route('**/ticker-index.json*', (route) =>
            route.fulfill({ json: { nav } })
        );
        await context.route('**/us-dividend-stocks.json*', (route) =>
            route.fulfill({ json: {} })
        );
        await context.route(
            '**/content-studio/distribution-index.json*',
            (route) => route.fulfill({ json: { tickers: [] } })
        );
        const page = await context.newPage();
        const errors = [],
            writes = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
            if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()))
                writes.push(r.url());
        });
        await page.goto(`${base}/?q=DEMO&sort=symbol`);
        const card = page.locator('.stock-result-card').first();
        await card.waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        const metrics = await card.locator('.stock-card-metrics').innerText();
        for (const mode of ['light', 'dark']) {
            if (mode === 'dark')
                await page
                    .getByRole('button', { name: '다크 모드', exact: true })
                    .click();
            await page
                .locator('.studio-brand img')
                .evaluate((img) => img.decode());
            assert.ok(
                (
                    await page.evaluate(() =>
                        document.fonts.load('16px primeicons')
                    )
                ).length > 0,
                'PrimeIcons font must load'
            );
            const sizes = await card.evaluate((el) => {
                const heading = el.querySelector('.stock-card-heading');
                const title = heading.querySelector(':scope > div > span');
                const style = getComputedStyle(title),
                    box = title.getBoundingClientRect(),
                    parent = heading.getBoundingClientRect();
                return {
                    width: box.width,
                    headingWidth: parent.width,
                    fontSize: style.fontSize,
                    lineHeight: style.lineHeight,
                    clamp: style.webkitLineClamp,
                    text: title.textContent,
                };
            });
            assert.equal(sizes.text.trim(), name);
            assert.ok(
                Math.abs(sizes.width - sizes.headingWidth) < 1,
                JSON.stringify(sizes)
            );
            assert.equal(sizes.fontSize, '15px');
            assert.equal(sizes.lineHeight, '20.25px');
            assert.equal(sizes.clamp, 'none');
            const buttons = await page
                .locator('.search-pagination button')
                .evaluateAll((els) =>
                    els.map((el) => ({
                        w: el.getBoundingClientRect().width,
                        h: el.getBoundingClientRect().height,
                    }))
                );
            assert.ok(buttons.length >= 3);
            for (const b of buttons) assert.deepEqual(b, { w: 44, h: 44 });
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                )
            );
            assert.equal(
                await card.locator('.stock-card-metrics').innerText(),
                metrics
            );
            assert.equal(
                await card.locator('.stock-symbol-link').getAttribute('href'),
                '/stock/DEMO-000'
            );
            assert.equal(
                await card.locator('.stock-detail-action').getAttribute('href'),
                '/stock/DEMO-000'
            );
            assert.equal(
                await card
                    .locator('.stock-compare-action')
                    .getAttribute('href'),
                '/underlying/DEMO-BASE'
            );
            await page.screenshot({
                path: `${output}/${width}-${mode}.png`,
                fullPage: true,
            });
            results.push({
                viewportWidth: width,
                mode,
                ...sizes,
                buttons: buttons.length,
                overflow: false,
            });
        }
        await page.locator('.p-paginator-next').click();
        await page.waitForURL((url) => url.searchParams.get('page') === '2');
        await page
            .locator('.stock-symbol-link')
            .first()
            .getByText('DEMO-060', { exact: true })
            .waitFor();
        await page.reload();
        await page
            .locator('.stock-symbol-link')
            .first()
            .getByText('DEMO-060', { exact: true })
            .waitFor();
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        await context.close();
    }
    await fs.writeFile(
        `${output}/measurements.json`,
        JSON.stringify(results, null, 2)
    );
    console.log(
        'PASS public partial: 4 widths × light/dark; full names, 44px buttons, links, paging/reload, unchanged metrics, no writes/errors/overflow'
    );
} finally {
    await browser.close();
}
