/* global document, innerWidth, getComputedStyle -- Playwright page callbacks. */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const out = process.env.STITCH_EVIDENCE_DIR || '/tmp/yieldloom-stitch-review';
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 },
    deviceScaleFactor: 2,
});
const assetCache = new Map();
await context.route('https://**/*', async (r) => {
    const u = r.request().url();
    const host = new URL(u).hostname;
    if (
        ![
            'cdn.tailwindcss.com',
            'fonts.googleapis.com',
            'fonts.gstatic.com',
            'cdnjs.cloudflare.com',
            'lh3.googleusercontent.com',
        ].includes(host)
    )
        return r.abort();
    try {
        let body = assetCache.get(u);
        if (!body) {
            const result = await execFileAsync(
                'curl',
                ['--fail', '--silent', '--show-error', '--max-time', '20', u],
                { encoding: 'buffer', maxBuffer: 12000000 }
            );
            body = result.stdout;
            assetCache.set(u, body);
        }
        const contentType =
            host === 'cdn.tailwindcss.com'
                ? 'application/javascript'
                : host === 'fonts.googleapis.com' || u.includes('.css')
                  ? 'text/css'
                  : host === 'fonts.gstatic.com'
                    ? 'font/woff2'
                    : 'image/png';
        await r.fulfill({ body, contentType });
    } catch {
        await r.abort();
    }
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await fs.mkdir(`${out}/implementation`, { recursive: true });
await page.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));
await page.route('**/src/services/firebaseClient*', (r) =>
    r.fulfill({
        contentType: 'application/javascript',
        body: `import {ref,computed} from '/node_modules/.vite/deps/vue.js';export const firebaseUser=ref(null),authLoading=ref(false),signedIn=computed(()=>false),auth={},googleProvider={},firebaseReady=true,db=null;`,
    })
);
await page.route('**/api/**', (r) =>
    r.fulfill({
        status: 403,
        json: { error: 'Visual fixture: no personal data access' },
    })
);
const fixtureRows = [
    ['DEMO-A', '가상 고배당 인덱스 ETF', '예시 운용사', 0.18, '2026-10-20'],
    [
        'DEMO-B',
        '가상 월배당 커버드콜 ETF',
        '알파 인컴 운용',
        0.21,
        '2026-10-15',
    ],
    [
        'DEMO-C',
        '가상 테크 2X 레버리지 인덱스',
        '베타 글로벌',
        0.05,
        '2026-09-28',
    ],
    ['DEMO-D', '가상 테크놀로지스 보통주', '일반 주식', null, null],
    [
        'DEMO-E',
        '가상 신흥국 배당성장 포트폴리오',
        '신흥마켓 파트너스',
        null,
        null,
    ],
    ['DEMO-F', '가상 에너지 파트너스 보통주', '일반 주식', 0.75, '2026-10-12'],
].map(([symbol, koName, company, latestAmount, latestExDate]) => ({
    symbol,
    koName,
    company,
    currency: 'USD',
    securityType: symbol === 'DEMO-D' || symbol === 'DEMO-F' ? 'stock' : 'etf',
    noDividends: symbol === 'DEMO-D',
    dividendEvidence: { latestAmount, latestExDate },
}));
await page.route('**/src/services/securityDirectory.js*', (r) =>
    r.fulfill({
        contentType: 'application/javascript',
        body: `export async function loadSecurityDirectory(){return ${JSON.stringify({ rows: fixtureRows, distributions: { tickers: [] } })}}`,
    })
);
const measurements = [];
for (const width of [1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto('http://127.0.0.1:5173/?q=DEMO&sort=symbol');
    await page
        .locator('.stock-card-grid li')
        .first()
        .waitFor()
        .catch(async (e) => {
            console.log('ERRORS', errors);
            console.log(
                (await page.locator('body').innerText()).slice(0, 1500)
            );
            throw e;
        });
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => ({
        width: innerWidth,
        header: document.querySelector('.studio-header').getBoundingClientRect()
            .height,
        headerInner: document
            .querySelector('.header-inner')
            .getBoundingClientRect().width,
        overflow: document.documentElement.scrollWidth > innerWidth,
        bottomLinks: [...document.querySelectorAll('.mobile-nav a')].map((a) =>
            a.textContent.trim()
        ),
        primary: getComputedStyle(document.documentElement)
            .getPropertyValue('--app-accent')
            .trim(),
        cards: document.querySelectorAll('.stock-card-grid li').length,
    }));
    measurements.push(result);
    await page.screenshot({
        path: `${out}/implementation/search-${width}.png`,
        fullPage: true,
    });
    const region = await page.locator('.studio-main').boundingBox();
    await page.screenshot({
        path: `${out}/implementation/search-content-${width}.png`,
        fullPage: true,
        style: '.studio-header, .studio-footer, .mobile-nav { visibility: hidden !important; }',
        clip: { x: 0, y: region.y, width, height: region.height },
    });
    if (result.overflow) throw Error(`overflow ${width}`);
}
await page.setViewportSize({ width: 1280, height: 1024 });
await page.goto('http://127.0.0.1:5173/?q=DEMO&sort=symbol');
await page
    .locator('.stock-card-grid li')
    .first()
    .waitFor()
    .catch(async (e) => {
        console.log('ERRORS', errors);
        console.log((await page.locator('body').innerText()).slice(0, 1500));
        throw e;
    });
await page.getByRole('button', { name: '다크 모드', exact: true }).click();
await page.screenshot({
    path: `${out}/implementation/search-dark.png`,
    fullPage: true,
});
await page.reload();
if (
    !(await page
        .locator('html')
        .evaluate((e) => e.classList.contains('p-dark')))
)
    throw Error('theme persistence');
await page.getByRole('button', { name: '라이트 모드', exact: true }).click();
// Keep legacy entrypoints on the same validated, isolated reference renderer.
if (process.env.STITCH_SKIP_REFERENCE !== '1') {
    const result = await execFileAsync(
        process.execPath,
        [`${repo}/scripts/design/capture-stitch-originals.mjs`],
        {
            cwd: repo,
            env: { ...process.env, STITCH_EVIDENCE_DIR: out },
            maxBuffer: 12000000,
        }
    );
    console.log(result.stdout);
}
await fs.writeFile(
    `${out}/measurements.json`,
    JSON.stringify(
        {
            data: 'synthetic DEMO fixture only; no live account data',
            clock: '2026-11-03T12:00:00Z',
            deviceScaleFactor: 2,
            measurements,
            errors,
        },
        null,
        2
    )
);
console.log(JSON.stringify({ measurements, errors }));
await browser.close();
