// Actual 720px exports with explicit complete/partial/conflict evidence. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const output = process.env.STITCH_TTM_DIR || '/tmp/yieldloom-ttm-card';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const status of ['complete', 'partial', 'conflict', 'zero'])
        for (const width of [1280, 768, 390]) {
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
                acceptDownloads: true,
            });
            await installStitchFixtures(page);
            if (status !== 'complete')
                await page.route('**/api/thumbnail-data?*', (route) => {
                    const history = Array.from({ length: 24 }, (_, i) => ({
                        date: new Date(Date.UTC(2024, i + 11, 1))
                            .toISOString()
                            .slice(0, 10),
                        amount: i === 23 ? 0.16 : 0.08,
                        close: 50,
                    }));
                    if (status === 'zero') history.splice(12); // Old latest event stays available, verified current year has no events.
                    const sourceStatus = {
                        priceDate: '2026-11-03',
                        ...(status === 'partial'
                            ? {}
                            : {
                                  collectionCoverage: {
                                      dividends: {
                                          complete: true,
                                          start: '2024-12-01',
                                          end: '2026-11-03',
                                      },
                                  },
                              }),
                        ...(status === 'conflict'
                            ? { corporateActionReview: true }
                            : {}),
                    };
                    return route.fulfill({
                        json: {
                            ticker: {
                                symbol: 'DEMO-A',
                                tickerInfo: {
                                    symbol: 'DEMO-A',
                                    price: 50,
                                    currency: 'USD',
                                    securityType: 'etf',
                                },
                                sourceStatus,
                                backtestData: history,
                            },
                            catalog: { securityType: 'etf' },
                            series: {},
                            rivals: [],
                            rivalOptions: [],
                            dataStatus: 'fresh',
                        },
                    });
                });
            await page.goto(
                (process.env.UI_BASE_URL || 'http://127.0.0.1:5175') +
                    '/stock/DEMO-A?tab=share'
            );
            await page
                .getByRole('button', {
                    name: '12개월 배당 요약 미리보기',
                    exact: true,
                })
                .click();
            const card = page.locator('.ttm-summary-card');
            await card.waitFor();
            assert.match(
                await page.locator('.ttm-share-copy').innerText(),
                /최근 12개월/
            );
            assert.match(
                await page.locator('.ttm-share-copy').innerText(),
                /최신 배당 1건의 연율화나 실제 수령액이 아닙니다/
            );

            assert.equal(
                await page.locator('.artwork-panel:visible').count(),
                1
            );
            if (status === 'complete') {
                await page
                    .context()
                    .grantPermissions(['clipboard-read', 'clipboard-write']);
                await page
                    .getByRole('button', {
                        name: '12개월 요약 문구 복사',
                        exact: true,
                    })
                    .click();
                assert.match(
                    await page.evaluate(() => navigator.clipboard.readText()),
                    /최근 12개월/
                );
                const latestPending = page.waitForEvent('download');
                await page
                    .getByRole('button', {
                        name: '배당 요약 PNG 다운로드',
                        exact: true,
                    })
                    .click();
                await latestPending;
                await page.waitForFunction(async () =>
                    (await navigator.clipboard.readText()).includes(
                        '배당 이력 1건'
                    )
                );
                await page
                    .getByRole('button', {
                        name: '이미지 공유용 문구 복사',
                        exact: true,
                    })
                    .click();
                const latestCopy = await page.evaluate(() =>
                    navigator.clipboard.readText()
                );
                assert.match(latestCopy, /배당 이력 1건.*0.16/);
                assert.doesNotMatch(latestCopy, /최근 12개월/);
                assert.equal(
                    await page
                        .getByRole('button', {
                            name: '12개월 배당 요약 미리보기',
                            exact: true,
                        })
                        .getAttribute('aria-pressed'),
                    'true'
                );
                assert.equal(
                    (await card.locator('.ttm-amount').innerText()).trim(),
                    '$1.04'
                );
                assert.equal(
                    (await card.locator('.ttm-yield').innerText()).trim(),
                    '2.08%'
                );
                assert.equal(
                    (
                        await page
                            .locator('.summary-card .hero strong')
                            .textContent()
                    ).trim(),
                    '$0.16'
                );
            } else if (status === 'zero') {
                assert.equal(
                    (await card.locator('.ttm-amount').innerText()).trim(),
                    '$0'
                );
                assert.equal(
                    (await card.locator('.ttm-yield').innerText()).trim(),
                    '0.00%'
                );
            } else {
                assert.match(
                    await card.locator('.ttm-amount').innerText(),
                    /미확인/
                );
                assert.match(
                    await card.locator('.ttm-yield').innerText(),
                    /미확인/
                );
                assert.equal(await card.locator('.ttm-bars i').count(), 0);
                assert.doesNotMatch(await card.innerText(), /\$0|0\.00%/);
            }
            assert.match(await card.innerText(), /달력 분기가 아닌/);
            const geometry = await card.evaluate((element) => {
                const body = element.querySelector('.thumbnail-card-content');
                return {
                    w: element.clientWidth,
                    h: element.clientHeight,
                    overflow:
                        element.scrollHeight > element.clientHeight + 1 ||
                        body.scrollHeight > body.clientHeight + 1,
                };
            });
            assert.deepEqual(geometry, { w: 720, h: 720, overflow: false });
            await page
                .getByRole('checkbox', { name: '배당 요약', exact: true })
                .uncheck();
            await page
                .getByRole('checkbox', {
                    name: '12개월 배당 요약',
                    exact: true,
                })
                .check();
            const pending = page.waitForEvent('download');
            await page
                .getByRole('button', { name: '선택 카드 ZIP (1)', exact: true })
                .click();
            const download = await pending;
            const chunks = [];
            for await (const chunk of await download.createReadStream())
                chunks.push(chunk);
            const files = unzipSync(Buffer.concat(chunks));
            const manifest = JSON.parse(strFromU8(files['manifest.json']));
            assert.equal(manifest.cards.length, 1);
            assert.equal(manifest.cards[0].kind, 'ttm-summary');
            assert.equal(
                manifest.cards[0].measurement.coverage,
                status === 'zero' ? 'complete' : status
            );
            assert.match(manifest.cards[0].text, /최근 12개월/);
            if (['partial', 'conflict'].includes(status)) {
                assert.equal(manifest.cards[0].measurement.amount, null);
                assert.doesNotMatch(manifest.cards[0].text, /합계 0|0\.00%/);
            }
            const png = Buffer.from(files[manifest.cards[0].filename]);
            assert.equal(png.readUInt32BE(16), 720);
            assert.equal(png.readUInt32BE(20), 720);
            assert.ok(png.length > 15000);
            await fs.writeFile(`${output}/${status}.png`, png);
            await fs.writeFile(`${output}/${status}-${width}.png`, png);
            if (status === 'complete') {
                await page
                    .getByRole('checkbox', { name: '배당 요약', exact: true })
                    .check();
                const bothPending = page.waitForEvent('download');
                await page
                    .getByRole('button', {
                        name: '선택 카드 ZIP (2)',
                        exact: true,
                    })
                    .click();
                const bothDownload = await bothPending,
                    bothChunks = [];
                for await (const chunk of await bothDownload.createReadStream())
                    bothChunks.push(chunk);
                const bothFiles = unzipSync(Buffer.concat(bothChunks));
                const bothManifest = JSON.parse(
                    strFromU8(bothFiles['manifest.json'])
                );
                assert.deepEqual(
                    bothManifest.cards.map((card) => card.kind),
                    ['summary', 'ttm-summary']
                );
                const latest = bothManifest.cards.find(
                    (card) => card.kind === 'summary'
                );
                assert.equal(latest.filename, 'demo-a_summary.png');
                assert.match(latest.text, /이력 1건.*0.16/);
                assert.equal(Object.hasOwn(latest, 'measurement'), false);
                await fs.writeFile(
                    `${output}/latest-event.png`,
                    Buffer.from(bothFiles[latest.filename])
                );
                await fs.writeFile(
                    `${output}/both-manifest.json`,
                    JSON.stringify(bothManifest, null, 2)
                );
            }
            assert.ok(
                await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth + 1
                )
            );
            console.log(
                `PASS ${status}/${width}: distinct period, coverage, 720 PNG+ZIP/copy metadata, no crop/overflow`
            );
            await page.close();
        }
} finally {
    await browser.close();
}
