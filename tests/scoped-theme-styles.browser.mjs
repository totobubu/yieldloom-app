// Compile the real component styles and verify DOM isolation; no app/API/user data.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, compileStyle } from '@vue/compiler-sfc';
import { chromium } from 'playwright';
const cases = [
    [
        'src/components/navigation/PortfolioNavigation.vue',
        '<nav class="portfolio-navigation location-navigation"><span class="location-group">포트폴리오</span><span class="location-current">원금</span><span class="location-status">메뉴 닫힘</span></nav>',
        '.location-group',
        'color',
        'rgb(148, 163, 184)',
    ],
    [
        'src/components/portfolio/PortfolioImportReview.vue',
        '<span class="issue-metric">검토</span><span class="preview-badge">미리보기</span>',
        '.issue-metric',
        'color',
        'rgb(252, 211, 77)',
    ],
    [
        'src/components/portfolio/TossPdfImportReview.vue',
        '<span class="type-pill buy">매수</span><span class="fee-value">수수료</span>',
        '.type-pill.buy',
        'color',
        'rgb(253, 164, 175)',
    ],
    [
        'src/components/portfolio/PortfolioInsights.vue',
        '<div class="insights"><input type="month" aria-label="월"></div>',
        'input',
        'colorScheme',
        'dark',
    ],
    [
        'src/components/stock/DividendRocChart.vue',
        '<svg><circle class="ratio-point" cx="10" cy="10" r="4"/><path class="ratio-line" d="M0 0 L20 20"/></svg>',
        '.ratio-point',
        'fill',
        'rgb(216, 180, 254)',
    ],
];
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    for (const [
        index,
        [file, markup, target, property, expected],
    ] of cases.entries()) {
        const descriptor = parse(await readFile(file, 'utf8'), {
            filename: file,
        }).descriptor;
        const id = 'data-v-isolation' + index;
        const css = descriptor.styles
            .map((style) => {
                const compiled = compileStyle({
                    source: style.content,
                    filename: file,
                    id,
                    scoped: style.scoped,
                });
                assert.deepEqual(compiled.errors, []);
                return compiled.code;
            })
            .join('\n');
        const page = await browser.newPage();
        await page.setContent(
            '<!doctype html><html class="p-dark"><head><style>:root{color:#112233;background:#f8f9fa;fill:#123456;stroke:#654321;border:1px solid #112233;color-scheme:light;--app-text:#e2e8f0;--app-accent:#0d7a6e;--app-muted:#94a3b8;--app-border:#64748b}</style></head><body>' +
                markup +
                '</body></html>'
        );
        await page
            .locator('body *')
            .evaluateAll(
                (els, attr) => els.forEach((el) => el.setAttribute(attr, '')),
                id
            );
        const root = () =>
            page.locator('html').evaluate((el) => {
                const s = getComputedStyle(el);
                return Object.fromEntries(
                    [
                        'color',
                        'backgroundColor',
                        'borderTopColor',
                        'fill',
                        'stroke',
                        'colorScheme',
                    ].map((key) => [key, s[key]])
                );
            });
        const baseline = await root();
        await page.addStyleTag({ content: css });
        const actual = await root();
        if (process.env.SCOPED_THEME_EXPECT_BUG) {
            assert.notDeepEqual(
                actual,
                baseline,
                'original stylesheet must reproduce root leakage'
            );
            console.log(
                JSON.stringify({
                    file,
                    result: 'original bug reproduced',
                    baseline,
                    actual,
                })
            );
        } else {
            assert.deepEqual(
                actual,
                baseline,
                file + ' must not style the document root'
            );
            assert.equal(
                await page
                    .locator(target)
                    .evaluate((el, key) => getComputedStyle(el)[key], property),
                expected,
                file + ' must apply dark styling to its target'
            );
            await page
                .locator('html')
                .evaluate((el) => el.classList.remove('p-dark'));
            assert.deepEqual(
                await root(),
                baseline,
                'theme toggle must preserve the root baseline'
            );
            console.log(
                'PASS ' + file + ': dark target and document isolation'
            );
        }
        await page.close();
    }
} finally {
    await browser.close();
}
