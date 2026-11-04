// Fixed synthetic balances only. Exercise responsive detail values and shared pagination.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output = process.env.STITCH_SUMMARY_DETAIL_DIR;
if (output) await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
async function ready(page) {
    await page.locator('.valuation-grid').waitFor();
    await page
        .locator('.fullscreen-data-loading-mask')
        .waitFor({ state: 'hidden' });
}
async function capture(page, name) {
    if (!output) return;
    await page.evaluate(async () => {
        await document.fonts.ready;
        scrollTo(0, 0);
        await new Promise(requestAnimationFrame);
    });
    await page.screenshot({
        path: `${output}/${name}.png`,
        fullPage: true,
        animations: 'disabled',
    });
}
try {
    for (const width of [1280, 768, 390]) {
        const page = await browser.newPage({
            viewport: { width, height: 1024 },
            deviceScaleFactor: 2,
        });
        await installStaticAssets(page);
        await installStitchFixtures(page, { admin: true });
        const requests = [],
            errors = [];
        page.on('request', (r) =>
            requests.push({ url: r.url(), method: r.method() })
        );
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(base + '/mypage?tab=overview&view=summary');
        await ready(page);
        assert.match(
            await page.locator('.stored-valuation-panel').innerText(),
            /₩190,000/
        );
        assert.match(
            await page.locator('.stored-valuation-panel').innerText(),
            /\$1,430\.00/
        );
        assert.match(
            await page.locator('.reference-valuation-panel').innerText(),
            /₩200,000/
        );
        assert.match(
            await page.locator('.reference-valuation-panel').innerText(),
            /\$1,000\.00/
        );
        assert.doesNotMatch(
            await page
                .locator('.reference-valuation-panel .valuation-card > strong')
                .allTextContents()
                .then((a) => a.join(' ')),
            /450/
        );
        if (width >= 1024) {
            assert.equal(
                await page.locator('.valuation-desktop thead th').count(),
                10
            );
            assert.equal(
                await page.locator('.valuation-desktop tbody tr').count(),
                3
            );
            assert.equal(
                await page.locator('.valuation-mobile').isVisible(),
                false
            );
        } else {
            assert.equal(
                await page.locator('.valuation-desktop').isVisible(),
                false
            );
            assert.equal(
                await page.locator('.valuation-detail-card').count(),
                3
            );
            const missing = page.locator(
                '.valuation-detail-card[data-symbol="DEMO-M"]'
            );
            assert.match(await missing.innerText(), /450\.00/);
            assert.equal(
                await missing.locator('.reference-amount').innerText(),
                '—'
            );
            assert.match(
                await missing.locator('.valuation-row-state').innerText(),
                /시세 조회 실패/
            );
            assert.match(
                await missing.locator('.valuation-row-source').innerText(),
                /미확인/
            );
            assert.match(await missing.innerText(), /이모음.*0884/);
        }
        const fit = await page
            .locator('.valuation-card > strong')
            .evaluateAll((elements) =>
                elements.every((el) => {
                    const style = getComputedStyle(el),
                        canvas = document.createElement('canvas'),
                        ctx = canvas.getContext('2d');
                    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                    const text = el.textContent.trim();
                    return (
                        ctx.measureText(text).width +
                            (text.length - 1) *
                                (parseFloat(style.letterSpacing) || 0) <=
                        el.closest('.valuation-card').getBoundingClientRect()
                            .right -
                            el.getBoundingClientRect().left +
                            1
                    );
                })
            );
        assert.equal(
            fit,
            true,
            'Reference amounts fit without splitting digits'
        );
        assert.equal(
            await page
                .locator('.valuation-card > strong.partial-total')
                .count(),
            1,
            'Incomplete USD summary remains visually partial'
        );
        assert.equal(
            await page
                .locator('.valuation-review')
                .getByRole('button', {
                    name: '자료 검토 상세 진입',
                    exact: true,
                })
                .isDisabled(),
            true
        );
        assert.match(
            await page.locator('.valuation-review').innerText(),
            /별도 검토 화면 미구현/
        );
        assert.equal(
            await page.locator('.reference-valuation-panel .p-message').count(),
            0,
            'Warnings preserved outside totals in source review region'
        );
        assert.equal(
            await page
                .locator('.valuation-card > strong')
                .evaluateAll((elements) =>
                    elements.every(
                        (el) =>
                            Math.abs(el.getBoundingClientRect().height - 32) < 1
                    )
                ),
            true,
            'Reference amounts stay on a single line'
        );
        await capture(page, `default-${width}`);
        const count = requests.filter((r) => r.url.includes('/api/')).length;
        await page
            .getByRole('combobox', { name: '평가 계좌 범위', exact: true })
            .selectOption('b');
        await ready(page);
        assert.match(
            await page.locator('.stored-valuation-panel').innerText(),
            /980\.00/
        );
        assert.doesNotMatch(
            await page.locator('.stored-valuation-panel').innerText(),
            /KRW/
        );
        const visible =
            width >= 1024
                ? page.locator('.valuation-desktop tbody tr')
                : page.locator('.valuation-detail-card');
        assert.equal(await visible.count(), 1);
        await capture(page, `usd-${width}`);
        await page
            .getByRole('combobox', { name: '평가 계좌 범위', exact: true })
            .selectOption('c');
        await ready(page);
        assert.equal(
            await page
                .locator('.reference-valuation-panel .valuation-card > strong')
                .innerText(),
            '—',
            'No priced holdings is unavailable, not a zero valuation'
        );
        assert.match(
            await page.locator('.stored-valuation-panel').innerText(),
            /450\.00/
        );
        await capture(page, `missing-${width}`);

        assert.equal(
            requests.filter((r) => r.url.includes('/api/')).length,
            count,
            'Scope changes reuse quotes and balances'
        );
        assert.equal(
            requests.some(
                (r) =>
                    r.method !== 'GET' &&
                    r.url.includes('/api/') &&
                    !r.url.includes('/analytics')
            ),
            false
        );
        assert.deepEqual(errors, []);
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            ),
            true
        );
        console.log(
            `PASS summary/${width}:10-column table or labeled cards, independent currencies, missing exclusion, scope no fetch/write/overflow/errors`
        );
        await page.close();
    }
    const page = await browser.newPage({
        viewport: { width: 390, height: 1024 },
        deviceScaleFactor: 2,
    });
    await installStaticAssets(page);
    await installStitchFixtures(page, { admin: true });
    const rows = Array.from({ length: 12 }, (_, i) => ({
        symbol: i === 11 ? 'DEMO-M' : `SYN${String(i + 1).padStart(2, '0')}`,
        currency: 'USD',
        quantity: i === 10 ? 0 : 2,
        amount: i === 0 ? 0 : 100,
    }));
    const account = {
        id: 'many',
        familyId: 'stitch-family',
        ownerId: 'p',
        alias: '합성12종목 계좌',
        institution: '합성기관',
        maskedNumber: '****0000',
        authorityUid: 'stitch-review-user',
        permissions: {},
        entriesRevision: 1,
        snapshot: { asOf: '2026-11-03', source: 'fixture-only', rows },
    };
    await page.route('**/api/family-portfolio?*', (r) =>
        r.fulfill({
            json: {
                families: [
                    {
                        id: 'stitch-family',
                        kind: 'personal',
                        adminUid: 'stitch-review-user',
                        profiles: {
                            p: {
                                uid: 'stitch-review-user',
                                name: '합성명의자',
                            },
                        },
                    },
                ],
                accounts: [account],
                summary: {
                    positions: rows.map((row) => ({
                        ...row,
                        accountId: 'many',
                        ownerId: 'p',
                        asOf: '2026-11-03',
                        source: 'fixture-only',
                    })),
                    knownValueByCurrency: { USD: 1100 },
                    missingSnapshotAccounts: [],
                    valueComplete: true,
                },
            },
        })
    );
    const reads = [];
    page.on('request', (r) => {
        if (r.url().includes('/api/')) reads.push(r.url());
    });
    await page.goto(base + '/mypage?tab=overview&view=summary');
    await ready(page);
    const cards = page.locator('.valuation-detail-card');
    assert.equal(await cards.count(), 10);
    assert.match(
        await cards.first().innerText(),
        /\$0\.00/,
        'Zero baseline remains zero'
    );
    const before = reads.length;
    await page
        .getByRole('navigation', { name: '보유 평가 카드 페이지', exact: true })
        .getByRole('button', { name: '페이지 2', exact: true })
        .click();
    assert.equal(await cards.count(), 2);
    assert.equal(
        await cards.first().locator('.reference-amount').innerText(),
        '$0.00',
        'Zero quantity has valid zero valuation'
    );
    assert.equal(
        await cards.last().locator('.reference-amount').innerText(),
        '—',
        'Missing quote is never zero'
    );
    await capture(page, 'page2-mobile');
    await page.setViewportSize({ width: 1280, height: 1024 });
    assert.equal(await page.locator('.valuation-desktop tbody tr').count(), 2);
    assert.match(
        await page.locator('.valuation-desktop tbody').innerText(),
        /SYN11/
    );
    await capture(page, 'page2-desktop');
    assert.equal(
        await page
            .locator('.valuation-desktop tbody tr')
            .first()
            .locator('td')
            .nth(8)
            .innerText(),
        '$0.00'
    );
    for (const width of [1024, 1023]) {
        await page.setViewportSize({ width, height: 1024 });
        assert.equal(
            await page.locator('.valuation-desktop').isVisible(),
            width >= 1024
        );
        assert.equal(await cards.count(), 2);
    }
    await page.setViewportSize({ width: 1280, height: 1024 });
    await page
        .locator('.valuation-desktop .p-paginator')
        .getByRole('button', { name: '페이지 1', exact: true })
        .click();
    await page.setViewportSize({ width: 390, height: 1024 });
    assert.equal(await cards.count(), 10);
    assert.equal(
        reads.length,
        before,
        'Paging and responsive switch add no reads'
    );
    console.log(
        'PASS summary/paging:12 rows, synchronized desktop/mobile pages, zero baseline/value vs missing quote, no extra reads'
    );
    await page.close();
} finally {
    await browser.close();
}
