/* global document, getComputedStyle, innerWidth -- isolated reference page. */
// Re-render immutable MCP HTML at each implementation viewport. A fresh page is
// used to isolate each runtime; the observed failure was an empty CDN response.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
const output =
    process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const mapping = JSON.parse(
    await fs.readFile('docs/design/stitch-v2/mapping.json', 'utf8')
);
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
await fs.mkdir(`${output}/rendered-originals`, { recursive: true });
try {
    for (const screen of mapping.screens.filter(
        (s) => s.classification === 'current-content'
    )) {
        const html = await fs.readFile(
            `docs/design/stitch-v2/${screen.originalHtml}`,
            'utf8'
        );
        for (const width of [1280, 768, 390]) {
            const context = await browser.newContext({
                viewport: { width, height: 1024 },
                deviceScaleFactor: 2,
            });
            const page = await context.newPage();
            const assetFailures = await installStaticAssets(page);
            const errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            try {
                await page.setContent(html, {
                    waitUntil: 'networkidle',
                    timeout: 45000,
                });
                await page.evaluate(() => document.fonts.ready);
                const health = await page.evaluate(() => ({
                    bodyBackground: getComputedStyle(document.body)
                        .backgroundColor,
                    bodyFont: getComputedStyle(document.body).fontFamily,
                    styleRules: [...document.styleSheets].reduce((n, s) => {
                        try {
                            return n + s.cssRules.length;
                        } catch {
                            return n;
                        }
                    }, 0),
                    overflow:
                        document.documentElement.scrollWidth > innerWidth + 1,
                    scrollWidth: document.documentElement.scrollWidth,
                    scrollHeight: document.documentElement.scrollHeight,
                    fontsReady: document.fonts.status,
                }));
                // A Tailwind document with only its tiny reset is an invalid baseline.
                const needsTailwind = html.includes('cdn.tailwindcss.com');
                const styled = !needsTailwind || health.styleRules > 50;
                const status =
                    styled && !errors.length && !assetFailures.length
                        ? 'captured'
                        : 'invalid-reference';
                await page.screenshot({
                    path: `${output}/rendered-originals/${screen.screenId}-${width}.png`,
                    fullPage: true,
                    animations: 'disabled',
                    clip: { x: 0, y: 0, width, height: health.scrollHeight },
                });
                rows.push({
                    screenId: screen.screenId,
                    width,
                    dpr: 2,
                    status,
                    ...health,
                    errors,
                    assetFailures,
                });
                console.log(screen.screenId, width, status, health.styleRules);
            } catch (e) {
                rows.push({
                    screenId: screen.screenId,
                    width,
                    status: 'capture-failed',
                    error: e.message,
                    errors,
                    assetFailures,
                });
            } finally {
                await context.close();
            }
        }
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/rendered-originals/results.json`,
    JSON.stringify(
        {
            source: 'immutable MCP HTML; fresh page at matching viewport; no content/data substitution',
            rows,
        },
        null,
        2
    )
);
if (rows.some((r) => r.status !== 'captured')) process.exitCode = 1;
