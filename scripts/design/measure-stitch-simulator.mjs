/* global document, getComputedStyle, innerWidth */
// Read-only source/app capture. A geometric match does not establish pixel parity.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const root = 'docs/design/stitch-simulator';
const output =
    process.env.SIMULATOR_EVIDENCE_DIR || '/tmp/stitch-simulator/comparison';
const mapping = JSON.parse(await fs.readFile(`${root}/mapping.json`, 'utf8'));
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
await fs.mkdir(output, { recursive: true });
const measure = (source) => {
    const title = document.querySelector('h1');
    let card = source
        ? document.querySelector('h2')
        : document.querySelector('.simulation-settings');
    if (source)
        while (
            card?.parentElement &&
            !(
                parseFloat(getComputedStyle(card).borderTopWidth) > 0 &&
                parseFloat(getComputedStyle(card).paddingTop) >= 10
            )
        )
            card = card.parentElement;
    const input = document.querySelector(
        source
            ? 'input:not([type="range"]):not([type="checkbox"])'
            : '.p-inputnumber-input'
    );
    const values = (element) => {
        if (!element) return null;
        const style = getComputedStyle(element),
            rect = element.getBoundingClientRect();
        return {
            width: rect.width,
            height: rect.height,
            padding: style.padding,
            gap: style.gap,
            radius: style.borderRadius,
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            fontFamily: style.fontFamily,
        };
    };
    return {
        title: values(title),
        settings: values(card),
        input: values(input),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        fontsReady: document.fonts.status,
        cssRules: [...document.styleSheets].reduce((n, s) => {
            try {
                return n + s.cssRules.length;
            } catch {
                return n;
            }
        }, 0),
    };
};
const rows = [];
try {
    for (const screen of mapping.screens) {
        const tax = screen.title.includes('Tax Comparison'),
            mobile = screen.title.includes('Mobile'),
            tablet = screen.title.includes('Tablet');
        const width = mobile ? 390 : tablet ? 834 : 1440;
        const name = `${tax ? 'tax' : 'simulator'}-${mobile ? 'mobile' : tablet ? 'tablet' : 'desktop'}`;
        const original = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        const sourceAssets = await installStaticAssets(original),
            sourceErrors = [];
        original.on('pageerror', (e) => sourceErrors.push(e.message));
        const html = await fs.readFile(`${root}/${screen.html}`, 'utf8');
        const hash = crypto.createHash('sha256').update(html).digest('hex');
        if (hash !== screen.htmlSha256)
            throw new Error(`Immutable HTML hash differs: ${screen.screenId}`);
        await original.setContent(html, { waitUntil: 'networkidle' });
        await original.evaluate(() => document.fonts.ready);
        const sourceMetrics = await original.evaluate(measure, true);
        await original.screenshot({
            path: `${output}/${name}-original.png`,
            fullPage: true,
        });
        const app = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStitchFixtures(app, { admin: true });
        const appAssets = await installStaticAssets(app),
            appErrors = [];
        app.on('pageerror', (e) => appErrors.push(e.message));
        await app.goto(
            `${process.env.UI_BASE_URL || 'http://127.0.0.1:5173'}/simulator`
        );
        await app.locator('.scenario-result').first().waitFor();
        if (tax)
            await app
                .getByRole('button', { name: '원천징수율만 비교', exact: true })
                .click();
        await app.evaluate(() => document.fonts.ready);
        const appMetrics = await app.evaluate(measure, false);
        await app
            .locator('.simulator-page')
            .screenshot({ path: `${output}/${name}-implementation.png` });
        rows.push({
            name,
            screenId: screen.screenId,
            viewport: { width, height: 1024, dpr: 2 },
            sourceMetrics,
            appMetrics,
            sourceErrors,
            appErrors,
            sourceAssets,
            appAssets,
            pixelComparisonPerformed: false,
            visualAcceptance: 'pending-review',
            note: 'Live user-editable assumptions retain the existing engine; source models and device typography differ. See SIMULATOR_REVIEW.md.',
        });
        await original.close();
        await app.close();
        console.log(
            name,
            JSON.stringify({
                sourceErrors,
                appErrors,
                sourceAssets,
                appAssets,
                overflow: appMetrics.overflow,
            })
        );
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        { source: 'Official MCP immutable HTML, no value substitution', rows },
        null,
        2
    ) + '\n'
);
if (
    rows.some(
        (r) =>
            r.appErrors.length ||
            r.sourceErrors.length ||
            r.sourceAssets.length ||
            r.appAssets.length ||
            r.appMetrics.overflow ||
            r.sourceMetrics.cssRules < 50
    )
)
    process.exitCode = 1;
