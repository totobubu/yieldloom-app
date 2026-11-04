/* global document, getComputedStyle -- isolated browser measurement. */
// Read immutable Stitch HTML and the current app; never create an approved design.
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStaticAssets } from './browser-static-assets.mjs';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
const output =
    process.env.STITCH_ASSEMBLY_DIR || '/tmp/yieldloom-stitch-assembly';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const roots = 'docs/design/stitch-v2/originals';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const rows = [];
await fs.mkdir(output, { recursive: true });
try {
    for (const width of [1280, 1440, 1600, 768, 390]) {
        const sources = [
            [
                'shell-original',
                `${roots}/2458864221184522893/${width > 1024 ? '1170392357232825899' : width > 767 ? '8db2e91cf0394d78bcdd6f777b49af04' : '01993440e0064d12b0d50c2f1b633c57'}.html`,
            ],
            [
                'asset-original',
                `${roots}/7356929996797649648/b611bd07ed0c464581479140b9207afb.html`,
            ],
            ['implementation', null],
            ...(width > 1024
                ? [
                      [
                          'shell-closed-original',
                          `${roots}/2458864221184522893/6fa38540cd064d57a93be9dab4eba5fb.html`,
                      ],
                      ['closed-implementation', null],
                  ]
                : []),
        ];
        for (const [kind, file] of sources) {
            const context = await browser.newContext({
                viewport: { width, height: 1024 },
            });
            const page = await context.newPage();
            const failures = await installStaticAssets(page),
                errors = [];
            page.on('pageerror', (e) => errors.push(e.message));
            if (file)
                await page.setContent(await fs.readFile(file, 'utf8'), {
                    waitUntil: 'networkidle',
                });
            else {
                await installStitchFixtures(page, { admin: true });
                await page.goto(base + '/mypage?tab=assets');
                await page.locator('.accounts li').first().waitFor();
                if (kind === 'closed-implementation')
                    await page
                        .getByRole('button', { name: '메뉴 접기', exact: true })
                        .click();
            }
            await page.evaluate(() => document.fonts.ready);
            const geometry = await page.evaluate((kind) => {
                const box = (el) => {
                    if (!el) return null;
                    const r = el.getBoundingClientRect(),
                        css = getComputedStyle(el);
                    return {
                        x: r.x,
                        y: r.y,
                        width: r.width,
                        height: r.height,
                        paddingLeft: css.paddingLeft,
                        paddingRight: css.paddingRight,
                        maxWidth: css.maxWidth,
                        display: css.display,
                        gap: css.gap,
                    };
                };
                const main = document.querySelector('main');
                return {
                    headerInner: box(document.querySelector('header > div')),
                    bodyFrame: box(
                        kind.endsWith('implementation')
                            ? document.querySelector('.shell-body')
                            : kind.includes('shell')
                              ? main.parentElement
                              : main
                    ),
                    submenu: box(
                        document.querySelector(
                            kind.endsWith('implementation')
                                ? '.shell-submenu'
                                : 'aside'
                        )
                    ),
                    main: box(main),
                    content: box(
                        kind.endsWith('implementation')
                            ? document.querySelector(
                                  '.asset-management-overview'
                              )
                            : kind === 'asset-original'
                              ? main.firstElementChild
                              : main
                    ),
                    footerInner: box(document.querySelector('footer > div')),
                    scrollWidth: document.documentElement.scrollWidth,
                    fonts: document.fonts.status,
                };
            }, kind);
            if (errors.length || failures.length)
                throw new Error(
                    `${kind}/${width}: invalid render ${JSON.stringify({ errors, failures })}`
                );
            rows.push({ kind, viewport: width, file, ...geometry });
            await context.close();
        }
    }
} finally {
    await browser.close();
}
await fs.writeFile(
    `${output}/results.json`,
    JSON.stringify(
        {
            purpose:
                'DOM geometry only; immutable source HTML; no visual acceptance or synthesized design',
            rows,
        },
        null,
        2
    ) + '\n'
);
console.log(
    JSON.stringify(
        rows.map(({ kind, viewport, headerInner, main, content }) => ({
            kind,
            viewport,
            headerWidth: headerInner?.width,
            mainX: main.x,
            mainWidth: main.width,
            contentWidth: content?.width,
        }))
    )
);
