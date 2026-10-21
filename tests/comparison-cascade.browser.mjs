import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const nav = [
    ...[
        'AAPL',
        'MSFT',
        'AMZN',
        'GOOG',
        'GOOGL',
        'NVDA',
        'META',
        'TSLA',
        'NFLX',
    ].map((symbol) => ({
        symbol,
        securityType: 'stock',
        longName: symbol + ' Inc.',
        noDividends: true,
    })),
    ...['AAPB', 'AAPU', 'AAPD', 'APLY', 'NVDY', 'AMZY'].map((symbol) => ({
        symbol,
        company: 'ETF issuer',
        securityType: 'etf',
    })),
    {
        symbol: 'XLF',
        company: 'Financial Select',
        securityType: 'etf',
        longName: 'Financial Sector ETF',
        noDividends: true,
    },
    {
        symbol: 'JETS',
        company: 'Travel funds',
        securityType: 'etf',
        longName: 'U.S. Travel Airlines ETF',
        noDividends: true,
    },
    {
        symbol: 'NEWF',
        company: 'Vanguard',
        securityType: 'etf',
        ipoDate: '2025-02-12',
        frequency: 'monthly',
        currency: 'USD',
    },
    ...Array.from({ length: 15 }, (_, i) => ({
        symbol: `OTHER${i}`,
        company: 'Issuer',
        securityType: 'etf',
        noDividends: true,
        currency: 'USD',
    })),
];
const tickers = [
    ['APLY', 'monthly'],
    ['NVDY', 'weekly'],
    ['AMZY', 'monthly'],
].map(([ticker, frequency]) => ({
    ticker,
    latest: {
        distribution_per_share: 0.5,
        ex_date: '2026-10-15',
        frequency,
        currency: 'USD',
    },
}));
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1440, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
        });
        const errors = [];
        const requests = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('request', (r) => {
            if (['fetch', 'xhr'].includes(r.resourceType()))
                requests.push(r.url());
        });
        await page.route('**/ticker-index.json', (r) =>
            r.fulfill({ json: { nav } })
        );
        await page.route('**/us-dividend-stocks.json', (r) =>
            r.fulfill({ json: {} })
        );
        await page.route('**/distribution-index.json', (r) =>
            r.fulfill({ json: { tickers } })
        );
        await page.goto(base + '/compare?view=similar&symbol=AMD&ticker=APLY');
        await page.locator('.product-grid article').first().waitFor();
        assert.equal(await page.locator('#explorer-reference').count(), 0);
        assert.equal(await page.locator('.product-grid article').count(), 12);
        const before = requests.length;
        async function select(id, name) {
            await page.locator('#explorer-' + id).click();
            const list = page.getByRole('listbox').last();
            await list
                .getByRole('option', { name, exact: typeof name === 'string' })
                .click();
            await list.waitFor({ state: 'hidden' });
        }
        async function options(id) {
            await page.locator('#explorer-' + id).click();
            const list = page.getByRole('listbox').last();
            const names = await list.getByRole('option').allTextContents();
            await page.keyboard.press('Escape');
            await list.waitFor({ state: 'hidden' });
            return names;
        }
        await select('strategy', '인컴·옵션');
        assert.deepEqual(await options('direction'), ['모든 방향', '롱']);
        await select('direction', '롱');
        assert.deepEqual(await options('dividend'), [
            '모든 배당 여부',
            '배당 이력 있음',
        ]);
        await select('dividend', '배당 이력 있음');
        await select('frequency', '매주');
        assert.equal(await page.locator('.product-grid article').count(), 1);
        assert.match(await page.locator('.product-grid').innerText(), /NVDY/);
        await select('strategy', '레버리지');
        assert.match(
            await page.locator('#explorer-direction').innerText(),
            /모든 방향/
        );
        assert.match(
            await page.locator('#explorer-dividend').innerText(),
            /모든 배당 여부/
        );
        assert.match(
            await page.locator('#explorer-frequency').innerText(),
            /모든 지급 주기/
        );
        await select('direction', '인버스');
        assert.equal(await page.locator('.product-grid article').count(), 1);
        assert.match(await page.locator('.product-grid').innerText(), /AAPD/);
        await page
            .getByRole('button', { name: '필터 초기화', exact: true })
            .click();
        assert.equal(await page.locator('.product-grid article').count(), 12);
        await page
            .getByRole('navigation', { name: '종목 비교 하위 메뉴' })
            .getByRole('link', { name: '테마 비교', exact: true })
            .click();
        await select('theme', /^M7 /);
        assert.equal(
            await page.locator('.product-grid article h3').first().innerText(),
            'AAPL'
        );
        await select('strategy', '본주(기초자산)');
        assert.equal(await page.locator('.product-grid article').count(), 8);
        assert.doesNotMatch(
            await page.locator('.product-grid').innerText(),
            /배수 미확인|재검증 대기|운용사 미확인/
        );
        assert.deepEqual(await options('direction'), ['모든 방향', '롱']);
        await select('theme', /^FAANG /);
        await select('strategy', '본주(기초자산)');
        assert.equal(await page.locator('.product-grid article').count(), 6);
        assert.match(await page.locator('.product-grid').innerText(), /AAPL/);
        await select('theme', /^금융 \(/);
        assert.match(await page.locator('.product-grid').innerText(), /XLF/);
        assert.match(
            await page.locator('.product-grid').innerText(),
            /분류 근거: 상품명 키워드/
        );
        await select('theme', /^여행·항공·레저 \(/);
        assert.match(await page.locator('.product-grid').innerText(), /JETS/);
        assert.equal(requests.length, before);
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page.screenshot({ path: `/tmp/comparison-cascade-${width}.png` });
        await page.goto(base + '/?sort=ipoDate&company=Vanguard');
        await page.locator('.stock-result-item').first().waitFor();
        const card = page.locator('.stock-result-item').first();
        assert.match(await card.innerText(), /상장일/);
        assert.match(await card.innerText(), /2025-02-12/);
        assert.match(await card.innerText(), /매월/);
        assert.match(await card.innerText(), /배당 자료 미확인/);
        assert.doesNotMatch(await card.innerText(), /무배당/);
        assert.doesNotMatch(await card.innerText(), /배당락일\s*미확인/);
        await page.screenshot({ path: `/tmp/stock-summary-${width}.png` });
        assert.deepEqual(errors, []);
        console.log(
            `PASS ${width}: category cascade/reset, dividend semantics, themes/evidence, no filter requests, fallback listing date/cadence`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
