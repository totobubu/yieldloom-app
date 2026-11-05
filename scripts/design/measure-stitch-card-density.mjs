/* global getComputedStyle, document -- isolated page callback. */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const root = process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output = `${root}/checks/${process.env.STITCH_REVIEW_PHASE || 'phase15'}/density`;
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const read = async (locator) =>
    locator.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
            padding: s.padding,
            borderRadius: s.borderRadius,
            background: s.backgroundColor,
            height: el.getBoundingClientRect().height,
            width: el.getBoundingClientRect().width,
            parts: [...el.children].map((child) => ({
                tag: child.tagName,
                height: child.getBoundingClientRect().height,
                lineHeight: getComputedStyle(child).lineHeight,
                children: [...child.children].map((item) => ({
                    tag: item.tagName,
                    height: item.getBoundingClientRect().height,
                    lineHeight: getComputedStyle(item).lineHeight,
                })),
            })),
        };
    });
try {
    for (const width of [1280, 768, 390]) {
        for (const kind of ['holdings', 'dividends']) {
            const id =
                kind === 'holdings'
                    ? 'd90f121fb719421e880cc02309349add'
                    : 'bd619d24ceb74c92afad1787a364ab4b';
            const source = await browser.newPage({
                viewport: { width, height: 1024 },
            });
            const failures = await installStaticAssets(source);
            await source.setContent(
                await fs.readFile(
                    `docs/design/stitch-v2/originals/7356929996797649648/${id}.html`,
                    'utf8'
                ),
                { waitUntil: 'networkidle' }
            );
            await source.evaluate(() => document.fonts.ready);
            const page = await browser.newPage({
                viewport: { width, height: 1024 },
            });
            await installStitchFixtures(page, { admin: kind === 'holdings' });
            await installStaticAssets(page);
            await page.goto(
                base +
                    (kind === 'holdings'
                        ? '/mypage?tab=overview&view=holdings'
                        : '/stock/DEMO-A?tab=dividends')
            );
            await page
                .locator(
                    kind === 'holdings'
                        ? '.holding-card'
                        : '.dividend-core-metrics'
                )
                .first()
                .waitFor({ state: 'attached' });
            await page
                .locator('.fullscreen-data-loading-mask')
                .waitFor({ state: 'hidden' });
            let original, implementation, criteria;
            if (kind === 'holdings' && width < 1024) {
                original = {
                    container: await read(
                        source.locator('#holder-cards-container')
                    ),
                    card: await read(
                        source.locator('.holder-card-item').first()
                    ),
                };
                implementation = {
                    container: await read(page.locator('.holding-cards')),
                    card: await read(page.locator('.holding-card').first()),
                };
                criteria = {
                    containerPadding:
                        original.container.padding ===
                        implementation.container.padding,
                    cardPadding:
                        original.card.padding === implementation.card.padding,
                    cardSurface:
                        original.card.background ===
                        implementation.card.background,
                    cardHeightExact:
                        original.card.height === implementation.card.height,
                };
            } else if (kind === 'dividends') {
                const core = source.locator('section').filter({
                    has: source.getByRole('heading', {
                        name: '3. 핵심 재무 & 배당 지표',
                        exact: true,
                    }),
                });
                const roc = source.locator('section').filter({
                    has: source.getByRole('heading', {
                        name: '4. 배당·ROC 이력',
                        exact: true,
                    }),
                });
                original = { core: await read(core), roc: await read(roc) };
                implementation = {
                    core: await read(page.locator('.dividend-core-metrics')),
                    roc: await read(page.locator('.dividend-roc-history')),
                    wrapper: await read(page.locator('.stock-insights')),
                };
                criteria = {
                    corePadding:
                        original.core.padding === implementation.core.padding,
                    rocPadding:
                        original.roc.padding === implementation.roc.padding,
                    rocRadius:
                        original.roc.borderRadius ===
                        implementation.roc.borderRadius,
                    extraWrapperPaddingRemoved:
                        implementation.wrapper.padding === '0px',
                };
            } else {
                original = { mobileCards: 'hidden' };
                implementation = { mobileCards: 'hidden' };
                criteria = {
                    mobileCardsHidden: !(await page
                        .locator('.holding-cards')
                        .isVisible()),
                };
            }
            rows.push({
                kind,
                width,
                sourceId: id,
                original,
                implementation,
                criteria,
                assetFailures: failures,
                wholeScreenAcceptance:
                    'fail: remaining typography, metadata and state differences',
            });
            await page.close();
            await source.close();
        }
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        {
            scope: 'component geometry and surface only; no visual acceptance',
            rows,
        },
        null,
        2
    ) + '\n'
);
console.log(JSON.stringify(rows));
