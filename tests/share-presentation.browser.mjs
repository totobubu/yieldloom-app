// Financial values and provider data are synthetic. No personal data is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';

const base = process.env.SHARE_UI_BASE_URL || 'http://127.0.0.1:5173';
const output = 'design-review/share-presentation';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (error) => {
        errors.push(error.message);
        console.log('pageerror:', error.message);
    });
    await page.addInitScript(
        () =>
            localStorage.getItem('yieldloom.thumbnail-presets.v1') ||
            localStorage.setItem(
                'yieldloom.thumbnail-presets.v1',
                JSON.stringify([
                    {
                        id: 'legacy',
                        name: '기존 정사각형',
                        ticker: 'TSLY',
                        rivals: ['CRSH'],
                        tone: 'friendly',
                    },
                ])
            )
    );
    await page.route('**/api/thumbnail-data?*', (route) => {
        const ticker = (symbol) => ({
            symbol,
            tickerInfo: {
                symbol,
                price: 101,
                currency: 'USD',
                longName: '긴 이름을 가진 검증용 인컴 ETF',
            },
            sourceStatus: {
                freshness: 'fresh',
                priceDate: '2026-10-13',
                dividendSourceUrl: '/fixture-official.json',
            },
            backtestData: Array.from({ length: 46 }, (_, index) => ({
                date: new Date(Date.UTC(2023, index, 5))
                    .toISOString()
                    .slice(0, 10),
                close: 80 + index,
                amount: 0.2 + (index % 4) / 100,
            })),
        });
        return route.fulfill({
            json: {
                ticker: ticker('TSLY'),
                catalog: { underlying: 'TSLA' },
                rivals: ['CRSH'],
                rivalOptions: ['CRSH'],
                series: { CRSH: ticker('CRSH'), TSLA: ticker('TSLA') },
                dataStatus: 'fresh',
            },
        });
    });
    await page.route('**/content-studio/distribution-index.json', (route) =>
        route.fulfill({
            json: {
                tickers: [
                    {
                        ticker: 'TSLY',
                        historyUrl:
                            '/content-studio/distribution-ticker-tsly.json',
                    },
                ],
            },
        })
    );
    await page.route('**/distribution-ticker-tsly.json', (route) =>
        route.fulfill({
            json: {
                history: [6, 13, 20].map((day) => ({
                    id: day,
                    ticker: 'TSLY',
                    ex_date: `2026-10-${String(day).padStart(2, '0')}`,
                    payable_date: `2026-10-${String(day + 1).padStart(2, '0')}`,
                    verification_status: 'official',
                    distribution_per_share: 0.22,
                    frequency: 'weekly',
                })),
            },
        })
    );
    await page.route('https://fonts.googleapis.com/**', (route) =>
        route.abort()
    );
    await page.goto(base + '/stock/TSLY?tab=share&rivals=CRSH');
    try {
        await page
            .getByRole('button', { name: '요약 PNG 다운로드', exact: true })
            .waitFor();
    } catch (error) {
        console.log((await page.locator('body').innerText()).slice(-2500));
        throw error;
    }
    const select = async (label, option) => {
        await page.getByRole('combobox', { name: label, exact: true }).click();
        await page.getByRole('option', { name: option, exact: true }).click();
    };
    const labels = [
        '배당 비교',
        '기초자산·종목 비교',
        '배당 일정',
        '과거 매수 시점별 배당률',
    ];
    for (const label of labels)
        await page.getByRole('checkbox', { name: label, exact: true }).check();
    const kinds = [
        'summary',
        'comparison',
        'rival',
        'calendar',
        'entry-efficiency',
    ];
    const ratios = [
        ['square', '정사각형 · 1:1', 720, 720],
        ['wide', '와이드 · 16:9', 1280, 720],
        ['story', '스토리 · 9:16', 720, 1280],
    ];
    const templates = [
        ['classic', '기본'],
        ['paper', '페이퍼'],
        ['navy', '네이비'],
    ];
    const summaryAmount = await page
        .locator('.summary-card .hero strong')
        .innerText();
    const geometry = [],
        violations = [];
    for (const [ratio, label, width, height] of ratios) {
        await select('출력 비율', label);
        for (const [template, name] of templates) {
            await select('카드 디자인', name);
            for (const kind of kinds) {
                const card = page.locator(`[data-thumbnail-kind="${kind}"]`);
                const measured = await card.evaluate((element) => {
                    const body = element.querySelector(
                        '.thumbnail-card-content'
                    );
                    return {
                        width: element.clientWidth,
                        height: element.clientHeight,
                        scrollWidth: element.scrollWidth,
                        scrollHeight: element.scrollHeight,
                        bodyHeight: body.clientHeight,
                        bodyScroll: body.scrollHeight,
                    };
                });
                assert.equal(
                    measured.width,
                    width,
                    `${ratio}/${template}/${kind}`
                );
                assert.equal(measured.height, height);
                assert.ok(
                    measured.scrollWidth <= width + 1,
                    `horizontal clipping ${ratio}/${template}/${kind}: ${JSON.stringify(measured)}`
                );
                if (
                    measured.scrollHeight > height + 1 ||
                    measured.bodyScroll > measured.bodyHeight + 1
                )
                    violations.push({ ratio, template, kind, ...measured });
                geometry.push({ ratio, template, kind, ...measured });
            }
            assert.equal(
                await page.locator('.summary-card .hero strong').innerText(),
                summaryAmount
            );
        }
    }
    await fs.writeFile(
        `${output}/geometry.json`,
        JSON.stringify(geometry, null, 2)
    );
    assert.deepEqual(
        violations,
        [],
        'Card content must fit the chosen dimensions'
    );
    async function download(button) {
        const pending = page.waitForEvent('download');
        await button.click();
        const download = await pending,
            chunks = [];
        for await (const chunk of await download.createReadStream())
            chunks.push(chunk);
        return {
            name: download.suggestedFilename(),
            bytes: Buffer.concat(chunks),
        };
    }
    const exports = [];
    for (const [index, [ratio, label, width, height]] of ratios.entries()) {
        const [template, templateLabel] = templates[index];
        await select('출력 비율', label);
        await select('카드 디자인', templateLabel);
        const zip = await download(
            page.getByRole('button', { name: '선택 카드 ZIP (5)', exact: true })
        );
        const files = unzipSync(zip.bytes);
        const manifest = JSON.parse(strFromU8(files['manifest.json']));
        assert.deepEqual(manifest.presentation, {
            aspectRatio: ratio,
            template,
            width,
            height,
        });
        assert.equal(manifest.schemaVersion, 2);
        assert.equal(manifest.cards.length, 5);
        for (const card of manifest.cards) {
            const png = Buffer.from(files[card.filename]);
            assert.equal(png.readUInt32BE(16), width);
            assert.equal(png.readUInt32BE(20), height);
            assert.ok(files[card.filename.replace('.png', '.txt')]);
            await fs.writeFile(`${output}/${card.filename}`, png);
        }
        const single = await download(
            page.getByRole('button', { name: '요약 PNG 다운로드', exact: true })
        );
        assert.equal(single.bytes.readUInt32BE(16), width);
        assert.equal(single.bytes.readUInt32BE(20), height);
        assert.ok(files[single.name]);
        exports.push({
            ratio,
            template,
            width,
            height,
            zip: zip.name,
            png: single.name,
        });
    }
    await select('출력 비율', '스토리 · 9:16');
    await select('카드 디자인', '네이비');
    await page
        .getByRole('button', { name: '프리셋 저장', exact: true })
        .click();
    const dialog = page.getByRole('dialog', {
        name: '프리셋 저장',
        exact: true,
    });
    await dialog
        .getByLabel('프리셋 이름', { exact: true })
        .fill('스토리 네이비');
    await dialog
        .getByRole('button', { name: '프리셋 저장', exact: true })
        .click();
    await dialog.waitFor({ state: 'hidden' });
    await select('출력 비율', '정사각형 · 1:1');
    await page
        .getByRole('checkbox', { name: '배당 일정', exact: true })
        .uncheck();
    await page
        .getByRole('button', { name: '스토리 네이비', exact: true })
        .click();
    assert.equal(
        await page.locator('.summary-card').getAttribute('data-aspect-ratio'),
        'story'
    );
    assert.equal(
        await page.locator('.summary-card').getAttribute('data-card-template'),
        'navy'
    );
    assert.ok(
        await page
            .getByRole('checkbox', { name: '배당 일정', exact: true })
            .isChecked()
    );
    await page.reload();
    await page
        .getByRole('button', { name: '스토리 네이비', exact: true })
        .click();
    assert.equal(
        await page.locator('.summary-card').getAttribute('data-card-template'),
        'navy'
    );
    for (const width of [1440, 768, 390, 360]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const [ratio, label] of ratios) {
            await select('출력 비율', label);
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                ),
                `${width}/${ratio} viewport overflow`
            );
            await page.locator('.share-workspace').scrollIntoViewIfNeeded();
            await page.screenshot({ path: `${output}/${width}-${ratio}.png` });
        }
    }
    await page
        .getByRole('button', { name: '기존 정사각형', exact: true })
        .click();
    assert.equal(
        await page.locator('.summary-card').getAttribute('data-aspect-ratio'),
        'square'
    );
    assert.equal(
        await page.locator('.summary-card').getAttribute('data-card-template'),
        'classic'
    );
    await page.evaluate(() => document.documentElement.classList.add('p-dark'));
    const darkApp = await download(
        page.getByRole('button', { name: '요약 PNG 다운로드', exact: true })
    );
    assert.equal(darkApp.name, 'tsly_summary.png');
    const corner = await page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        return [...ctx.getImageData(1, 1, 1, 1).data];
    }, darkApp.bytes.toString('base64'));
    assert.deepEqual(corner, [255, 255, 255, 255]);
    assert.deepEqual(errors, []);
    await fs.writeFile(
        `${output}/verification.json`,
        JSON.stringify({ geometry, exports, errors }, null, 2)
    );
    console.log(
        'PASS: 45 card variants, 15 ZIP images + 3 PNGs, dimensions/manifest/copy, preset migration/restore, 12 viewport layouts and app-dark independence'
    );
} finally {
    await browser.close();
}
