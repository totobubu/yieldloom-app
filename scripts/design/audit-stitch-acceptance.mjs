/* global document, getComputedStyle */
// Read-only source/application geometry audit. No financial values are replayed.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const evidence =
    process.env.STITCH_EVIDENCE_DIR || '/workspace/stitch-v2-evidence';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const cases = JSON.parse(
    await fs.readFile(`${evidence}/content-implementation/results.json`, 'utf8')
).results;
const output = process.env.STITCH_AUDIT_OUTPUT || `${evidence}/checks/phase18`;
const selectedNames = new Set(
    (process.env.STITCH_AUDIT_NAMES || '').split(',').filter(Boolean)
);
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
const measure = () => {
    const root =
        document.querySelector('.account-registration') ||
        document.querySelector('.studio-main') ||
        document.body;
    const shown = (el) =>
        el.getBoundingClientRect().width &&
        el.getBoundingClientRect().height &&
        getComputedStyle(el).visibility !== 'hidden';
    const info = (el) => {
        if (!el) return null;
        const s = getComputedStyle(el),
            r = el.getBoundingClientRect();
        return {
            tag: el.tagName,
            class: el.className,
            width: r.width,
            height: r.height,
            x: r.x,
            y: r.y,
            font: s.fontFamily,
            size: s.fontSize,
            weight: s.fontWeight,
            lineHeight: s.lineHeight,
            tracking: s.letterSpacing,
            padding: s.padding,
            gap: s.gap,
        };
    };
    const headings = [...root.querySelectorAll('h1,h2,h3')].filter(shown);
    return {
        root: info(root),
        headings: headings.slice(0, 6).map(info),
        documentHeight: document.documentElement.scrollHeight,
        sections: Object.fromEntries(
            [
                '.additional-insights',
                '.insights-filters',
                '.insights-summary',
                '.share-selector',
                '.share-editor-settings',
                '.share-preview-column',
                '.stock-price-history',
                '.stock-overview-share-card',
                '.calendar-totals',
            ].map((sel) => [sel, info(root.querySelector(sel))])
        ),
        headingText: headings
            .slice(0, 6)
            .map((el) => el.textContent.trim().slice(0, 60)),
    };
};
try {
    for (const c of cases.filter(
        (c) => !selectedNames.size || selectedNames.has(c.name)
    )) {
        const source = await browser.newPage({
            viewport: { width: c.width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const sourceFailures = await installStaticAssets(source);
        await source.setContent(
            await fs.readFile(
                `docs/design/stitch-v2/originals/7356929996797649648/${c.screenId}.html`,
                'utf8'
            ),
            { waitUntil: 'networkidle' }
        );
        await source.evaluate(() => document.fonts.ready);
        const original = await source.evaluate(measure);
        const page = await browser.newPage({
            viewport: { width: c.width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await installStitchFixtures(page, {
            admin: c.path.startsWith('/mypage'),
        });
        const failures = await installStaticAssets(page);
        await page.goto(base + c.path);
        await page.locator('.studio-main').waitFor();
        const marker =
            {
                search: '.stock-result-item',
                'stock-details': '.stock-facts',
                'stock-prices': '.candle-plot',
                'stock-dividends': '.dividend-next',
                'stock-share': '.share-workspace',
                'portfolio-summary': '.valuation-card',
                'portfolio-holdings': '.holdings-filter-card',
                'portfolio-calendar': '.calendar-totals',
                'portfolio-analysis': '.insights-summary',
                'asset-management': '.accounts',
                'account-registration': '.accounts',
            }[c.name] || '.explorer-filters';
        await page.locator(marker).first().waitFor();
        await page
            .locator('.fullscreen-data-loading-mask')
            .waitFor({ state: 'hidden' });
        await page
            .locator('.portfolio-loading-overlay')
            .waitFor({ state: 'hidden' });
        if (c.name === 'account-registration') {
            await page
                .getByRole('button', { name: '계좌 추가', exact: true })
                .click();
            await page.locator('.account-registration').waitFor();
        }
        await page.evaluate(() => document.fonts.ready);
        const implementation = await page.evaluate(measure);
        rows.push({
            name: c.name,
            width: c.width,
            screenId: c.screenId,
            original,
            implementation,
            sourceFailures,
            failures,
            errors,
        });
        await fs.writeFile(
            `${output}/geometry-audit-partial.json`,
            JSON.stringify({ rows }, null, 2)
        );
        console.log(`${c.name}/${c.width}`);
        await source.close();
        await page.close();
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/geometry-audit.json`,
    JSON.stringify(
        {
            scope: 'DOM geometry/typography diagnostic; headings matched semantically in audit report, not by automatic index; source examples and app fixture remain different; not visual acceptance',
            rows,
        },
        null,
        2
    ) + '\n'
);
console.log(
    JSON.stringify({
        rows: rows.length,
        errors: rows.flatMap((r) => r.errors),
        assetFailures: rows.flatMap((r) => [
            ...r.failures,
            ...r.sourceFailures,
        ]),
    })
);
