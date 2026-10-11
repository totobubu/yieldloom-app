import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Run against `npm run dev -- --port 5173`. Deterministic market fixtures
// isolate preview/export behavior from remote data availability.
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const page = await browser.newPage({ acceptDownloads: true });
    await page.route(/\/data\/.*\.json/, route => route.fulfill({ json: {
        tickerInfo: {},
        backtestData: Array.from({ length: 36 }, (_, index) => ({
            date: `${2024 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-15`,
            close: 25 + index / 10, amount: 0.2 + index / 100, amountFixed: 0.2 + index / 100,
        })),
    } }));
    await page.goto('http://127.0.0.1:5173/thumbnail/TSLY?rivals=CRSH,TSII,TSLW');
    await page.locator('.thumbnail-preview').first().waitFor();
    await page.getByRole('button', { name: '라이벌 PNG 다운로드', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelectorAll('.artwork-panel button')[2].disabled);
    for (const width of [320, 375, 390, 768, 799, 800, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(100);
        const measurements = await page.locator('.artwork-panel').evaluateAll(panels => panels.map(panel => {
            const frame = panel.querySelector('.thumbnail-preview').getBoundingClientRect();
            const card = panel.querySelector('[data-thumbnail-kind]').getBoundingClientRect();
            const button = panel.querySelector('button').getBoundingClientRect();
            return { width: frame.width, height: frame.height, cardWidth: card.width, right: card.right, bottom: card.bottom, buttonTop: button.top };
        }));
        for (const item of measurements) {
            assert.ok(Math.abs(item.width - item.height) < 1, JSON.stringify(item));
            assert.ok(Math.abs(item.width - item.cardWidth) < 1, JSON.stringify(item));
            assert.ok(item.right <= width + 1, JSON.stringify(item));
            assert.ok(item.bottom <= item.buttonTop + 1, JSON.stringify(item));
            assert.ok(item.width <= 720);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}`);
    }
    for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const label of ['요약', '비교', '라이벌', '일정', '매수 효율']) {
            const downloadPromise = page.waitForEvent('download');
            await page.getByRole('button', { name: `${label} PNG 다운로드`, exact: true }).click();
            const download = await downloadPromise;
            const stream = await download.createReadStream();
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const png = Buffer.concat(chunks);
            assert.equal(png.readUInt32BE(16), 720);
            assert.equal(png.readUInt32BE(20), 720);
            assert.ok(png.length > 10000, 'Unexpectedly empty PNG');
        }
    }
    await page.goto('http://127.0.0.1:5173/thumbnail/SCHD');
    await page.locator('.slot-grid.quarterly').waitFor();
    assert.equal(await page.locator('.slot-grid.quarterly article').count(), 4);
    console.log('PASS: nine viewport widths, resize, five card exports at mobile/desktop, SCHD quarterly layout');
} finally { await browser.close(); }
