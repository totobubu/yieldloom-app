// Selected copy/clipboard/manifest uses the same existing financial text path.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const output = process.env.STITCH_METRIC_STATE_DIR;
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await page
            .context()
            .grantPermissions(['clipboard-read', 'clipboard-write']);
        await installStaticAssets(page);
        await installStitchFixtures(page);
        const requests = [];
        const errors = [];
        page.on('request', (r) => {
            if (r.url().includes('/api/') && r.method() === 'GET')
                requests.push(r.url());
        });
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/stock/DEMO-A?tab=share'
        );
        await page.locator('.summary-card .hero strong').waitFor();
        const baseline = requests.length;
        const select = async (label) =>
            page
                .getByRole('button', { name: `${label} 미리보기`, exact: true })
                .click();
        const capture = async (name) => {
            if (!output) return;
            await fs.mkdir(output, { recursive: true });
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({
                path: `${output}/${name}-${width}.png`,
                fullPage: true,
                animations: 'disabled',
            });
            const box = await page.locator('.studio-main').boundingBox();
            await page.screenshot({
                path: `${output}/${name}-${width}-content.png`,
                fullPage: true,
                animations: 'disabled',
                clip: { x: 0, y: box.y, width, height: box.height },
                style: '.studio-header,.studio-footer,.mobile-nav,.shell-submenu{visibility:hidden!important;}',
            });
        };
        await select('배당 비교');
        const selectedPreview = page.getByRole('button', {
            name: '배당 비교 미리보기',
            exact: true,
        });
        const readableSelection = async () => {
            const contrast = await selectedPreview.evaluate((button) => {
                const channels = (value) => value.match(/[\d.]+/g).map(Number);
                const parent = channels(
                    getComputedStyle(button.closest('.card-choice'))
                        .backgroundColor
                );
                const layer = channels(
                    getComputedStyle(button).backgroundColor
                );
                const alpha = layer[3] ?? 1;
                const background = layer
                    .slice(0, 3)
                    .map(
                        (channel, index) =>
                            channel * alpha + parent[index] * (1 - alpha)
                    );
                const foreground = channels(
                    getComputedStyle(button).color
                ).slice(0, 3);
                const luminance = (rgb) =>
                    rgb
                        .map((channel) => {
                            const x = channel / 255;
                            return x <= 0.04045
                                ? x / 12.92
                                : ((x + 0.055) / 1.055) ** 2.4;
                        })
                        .reduce(
                            (sum, channel, index) =>
                                sum + channel * [0.2126, 0.7152, 0.0722][index],
                            0
                        );
                const a = luminance(foreground),
                    b = luminance(background);
                return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            });
            assert.ok(
                contrast >= 4.5,
                `Selected text remains readable over its actual button/parent surfaces: ${contrast}`
            );
        };
        await selectedPreview.hover();
        await readableSelection();
        await selectedPreview.focus();
        await readableSelection();

        const copy = page.locator('.card-share-copy pre');
        let text = await copy.innerText();
        assert.match(text, /직전 대비 배당 \+\$0\.08/);
        assert.match(text, /같은 종목의 직전·최신/);
        assert.match(text, /가격 자료 기준일: 2026-11-03/);
        assert.match(text, /배당락일: 2026-10-01 → 2026-11-01/);
        assert.doesNotMatch(text, /피어 그룹|세전 연 배당률/);
        assert.match(
            await page.locator('.comparison-card').innerText(),
            /직전·최신 배당 비교/
        );
        await capture('comparison-copy');
        const copyExact = async () => {
            const value = await copy.innerText();
            await page
                .locator('.card-share-copy')
                .getByRole('button', { name: '문구 복사', exact: true })
                .click();
            await page.waitForFunction(
                (expected) =>
                    navigator.clipboard
                        .readText()
                        .then((value) => value === expected),
                value
            );
            return value;
        };
        assert.equal(await copyExact(), text);
        await page.getByRole('button', { name: '간결형', exact: true }).click();
        await page.waitForFunction(
            (before) =>
                document.querySelector('.card-share-copy pre').innerText !==
                before,
            text
        );
        text = await copyExact();
        assert.match(text, /지표 기준:/);
        await page
            .getByRole('checkbox', { name: '배당 비교', exact: true })
            .check();
        const pending = page.waitForEvent('download');
        await page
            .getByRole('button', { name: '선택 카드 ZIP (2)', exact: true })
            .click();
        const download = await pending;
        const chunks = [];
        for await (const chunk of await download.createReadStream())
            chunks.push(chunk);
        const files = unzipSync(Buffer.concat(chunks));
        const manifest = JSON.parse(strFromU8(files['manifest.json']));
        const comparison = manifest.cards.find(
            (card) => card.kind === 'comparison'
        );
        assert.ok(comparison);
        assert.equal(
            strFromU8(files[comparison.filename.replace('.png', '.txt')]),
            text,
            'ZIP text equals the displayed and copied selected text'
        );
        if (output)
            await fs.writeFile(
                `${output}/comparison-texts-${width}.json`,
                JSON.stringify(
                    {
                        scope: 'Synthetic fixture only',
                        displayed: text,
                        clipboard: await page.evaluate(() =>
                            navigator.clipboard.readText()
                        ),
                        zipText: strFromU8(
                            files[comparison.filename.replace('.png', '.txt')]
                        ),
                    },
                    null,
                    2
                ) + '\n'
            );
        await select('배당 일정');
        text = await copyExact();
        assert.match(text, /다음 배당 일정/);
        assert.match(text, /확정\/추정\/미확인/);
        assert.doesNotMatch(text, /직전 대비 배당/);
        assert.match(text, /일정 화면 기준일: 2026-11-04/);
        assert.match(
            await page.locator('.schedule-artboard .steps .ex p').innerText(),
            /공시 배당락 예정/
        );
        await capture('calendar-copy');
        await select('과거 매수 시점별 배당률');
        text = await copyExact();
        assert.match(text, /세후/);
        assert.match(text, /각 가상 매수일 직전12개월 세후/);
        assert.doesNotMatch(text, /세전 연 배당률|4\.44%/);
        await capture('entry-trailing-copy');
        await select('12개월 배당 요약');
        assert.match(
            await page.locator('.ttm-share-copy').innerText(),
            /최근 12개월.*1\.04/
        );
        await capture('ttm-copy-preserved');
        await select('배당 요약');
        assert.match(
            await page.locator('.toss-copy pre').innerText(),
            /세전 배당금.*0\.16/
        );
        await capture('latest-copy-preserved');
        assert.equal(
            requests.length,
            baseline,
            'Switching/copying/ZIP reuses loaded data'
        );
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        assert.deepEqual(errors, []);
        await page.route('**/api/thumbnail-data?*', (route) => {
            if (
                new URL(route.request().url()).searchParams.get('ticker') !==
                'DEMO-M'
            )
                return route.fallback();
            return route.fulfill({
                json: {
                    ticker: {
                        symbol: 'DEMO-M',
                        tickerInfo: {
                            symbol: 'DEMO-M',
                            currency: 'USD',
                            price: 50,
                        },
                        backtestData: [
                            { date: '2026-11-01', amount: 0.1, close: 50 },
                        ],
                        sourceStatus: { priceDate: '2026-11-03' },
                    },
                    catalog: { securityType: 'etf' },
                    rivals: [],
                    rivalOptions: [],
                    series: {},
                    dataStatus: 'partial',
                },
            });
        });
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/stock/DEMO-M?tab=share'
        );
        await select('과거 매수 시점별 배당률');
        text = await copyExact();
        assert.match(text, /기간\/자료 완전성 미확인/);
        assert.doesNotMatch(text, /4\.44%|0\.00%/);
        await capture('entry-unavailable-copy');
        for (const [day, caption] of [
            ['2026-11-20', '배당락일 당일'],
            ['2026-11-26', '배당락일 경과'],
        ]) {
            await page.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
            await page.goto(
                (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                    '/stock/DEMO-A?tab=share'
            );
            await select('배당 일정');
            await page
                .locator('.schedule-artboard .steps .ex p')
                .getByText(caption, { exact: true })
                .waitFor();
        }
        console.log(
            `PASS share metrics/${width}: comparison/calendar/unavailable entry copy and clipboard follow selection; ZIP equality; latest+TTM retained; no data reads/errors/overflow`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
