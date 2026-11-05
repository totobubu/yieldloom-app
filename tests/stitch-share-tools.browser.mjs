// Source-backed auxiliary controls; synthetic metadata and isolated browser storage.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
        });
        await installStaticAssets(page);
        await installStitchFixtures(page);
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        let reads = 0;
        const options = ['DEMO-B', 'DEMO-C', 'DEMO-D'];
        await page.route('**/api/thumbnail-data?*', (route) => {
            reads++;
            const query = new URL(route.request().url()).searchParams;
            const rivals = (query.get('rivals') || '')
                .split(',')
                .filter((symbol) => options.includes(symbol))
                .slice(0, 3);
            return route.fulfill({
                json: {
                    catalog: {
                        company: '합성 운용사',
                        securityType: 'etf',
                        underlying: 'DEMO-BASE',
                    },
                    ticker: {
                        symbol: 'DEMO-A',
                        tickerInfo: {
                            symbol: 'DEMO-A',
                            currency: 'USD',
                            price: 50,
                            underlying: 'DEMO-BASE',
                        },
                        backtestData: [
                            { date: '2026-11-01', amount: 0.16, close: 50 },
                        ],
                        sourceStatus: {
                            priceDate: '2026-11-03',
                            freshness: 'fresh',
                        },
                    },
                    rivals,
                    rivalOptions: options,
                    series: {},
                    dataStatus: 'fresh',
                },
            });
        });
        await page.goto(
            (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                '/stock/DEMO-A?tab=share'
        );
        await page.locator('.share-rival-settings').waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        const rivalPanel = page.locator('.share-rival-settings');
        for (const [i, symbol] of options.entries()) {
            const before = reads;
            await rivalPanel
                .getByRole('combobox', { name: '비교 종목 후보', exact: true })
                .click();
            await page
                .getByRole('option', { name: symbol, exact: true })
                .click();
            assert.equal(reads, before, 'Candidate selection is local');
            await rivalPanel
                .getByRole('button', { name: '추가', exact: true })
                .click();
            await page.waitForFunction(
                (count) =>
                    document.querySelectorAll('.share-rival-chip').length ===
                    count,
                i + 1
            );
            assert.equal(
                reads,
                before + 1,
                'One metadata request per changed comparison scope'
            );
        }
        assert.equal(
            await rivalPanel
                .getByRole('combobox', { name: '비교 종목 후보', exact: true })
                .isDisabled(),
            true
        );
        await rivalPanel
            .getByRole('button', { name: 'DEMO-B 비교 제외', exact: true })
            .click();
        await page.waitForFunction(
            () => document.querySelectorAll('.share-rival-chip').length === 2
        );
        assert.equal(
            new URL(page.url()).searchParams.get('rivals'),
            'DEMO-C,DEMO-D'
        );
        const presets = page.locator('.share-export-settings');
        assert.equal(
            await presets
                .getByRole('button', { name: '적용', exact: true })
                .isDisabled(),
            true
        );
        await presets
            .getByRole('button', { name: '프리셋 저장', exact: true })
            .click();
        await presets
            .getByText('프리셋 이름을 입력해 주세요.', { exact: true })
            .waitFor();
        await presets
            .getByLabel('프리셋 이름', { exact: true })
            .fill('합성 저장');
        const beforeSave = reads;
        await presets
            .getByRole('button', { name: '프리셋 저장', exact: true })
            .click();
        assert.equal(
            await presets
                .getByText('프리셋 이름을 입력해 주세요.', { exact: true })
                .count(),
            0,
            'Successful save clears the validation error'
        );
        assert.equal(
            reads,
            beforeSave,
            'Local preset save does not read metadata'
        );
        const stored = await page.evaluate(() =>
            JSON.parse(localStorage.getItem('yieldloom.thumbnail-presets.v1'))
        );
        assert.equal(stored.length, 1);
        assert.equal(stored[0].name, '합성 저장');
        assert.deepEqual(stored[0].rivals, ['DEMO-C', 'DEMO-D']);
        await page
            .getByRole('checkbox', { name: '배당 일정', exact: true })
            .check();
        await presets
            .getByRole('button', { name: '적용', exact: true })
            .click();
        assert.equal(
            await page
                .getByRole('checkbox', { name: '배당 일정', exact: true })
                .isChecked(),
            false,
            'Preset restores the saved ZIP inclusion'
        );
        await presets
            .getByRole('button', { name: '선택한 프리셋 삭제', exact: true })
            .click();
        assert.equal(
            await page.evaluate(
                () =>
                    JSON.parse(
                        localStorage.getItem('yieldloom.thumbnail-presets.v1')
                    ).length
            ),
            0
        );
        assert.equal(
            await presets
                .getByRole('button', { name: '적용', exact: true })
                .isDisabled(),
            true
        );
        assert.ok(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        assert.deepEqual(errors, []);
        console.log(
            `PASS share tools/${width}: candidate allowlist/max3/add/remove and scoped reads; local preset validation/save/apply/delete; no overflow/errors`
        );
        await page.close();
    }
} finally {
    await browser.close();
}
