import { selectAssetOwner } from './portfolio-navigation.mjs';
// Uses current all-account scope; does not write to any real API or account.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const publicContext = await browser.newContext({
        viewport: { width: 1280, height: 1024 },
    });
    const publicPage = await publicContext.newPage();
    await installStitchFixtures(publicPage);
    const publicRequests = [],
        errors = [];
    publicPage.on('pageerror', (e) => errors.push(e.message));
    publicPage.on('request', (r) => {
        if (new URL(r.url()).pathname.startsWith('/api/'))
            publicRequests.push({
                path: new URL(r.url()).pathname,
                method: r.method(),
            });
    });
    await publicPage.goto(base + '/stock/DEMO-A?tab=details');
    await publicPage.locator('.stock-facts').waitFor();
    await publicPage
        .locator('.fullscreen-data-loading-mask')
        .waitFor({ state: 'hidden' });
    // The source image says 2.00. Actual complete trailing 12 months of the frozen history sum to 1.04.
    assert.equal(
        (
            await publicPage
                .locator('.stock-overview article')
                .nth(2)
                .locator('strong')
                .innerText()
        ).trim(),
        '1.04'
    );
    assert.equal(
        (
            await publicPage
                .locator('.stock-overview article')
                .nth(3)
                .locator('strong')
                .innerText()
        ).trim(),
        '2.08%'
    );
    const feedback = publicPage.locator('#stock-feedback');
    await feedback.locator('#feedback-message').fill('짧음');
    assert.ok(
        await feedback
            .getByRole('button', { name: '요청 전송하기' })
            .isDisabled()
    );
    await feedback
        .locator('#feedback-message')
        .fill('공식 공시 원문을 확인해 주세요.');
    assert.equal(
        await feedback
            .getByRole('button', { name: '요청 전송하기' })
            .isDisabled(),
        false
    );
    assert.equal(
        publicRequests.filter((r) => r.path.includes('family-portfolio'))
            .length,
        0
    );
    assert.equal(
        publicRequests.filter(
            (r) => r.method !== 'GET' && r.path !== '/api/analytics'
        ).length,
        0,
        JSON.stringify(publicRequests)
    );
    await publicContext.close();
    const context = await browser.newContext({
        viewport: { width: 1280, height: 1024 },
    });
    const page = await context.newPage();
    await installStitchFixtures(page, { admin: true });
    const requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith('/api/'))
            requests.push({ url: u.pathname + u.search, method: r.method() });
    });
    await page.goto(base + '/mypage?tab=overview&view=summary');
    await page.locator('.valuation-comparison').waitFor();
    await page
        .locator('.fullscreen-data-loading-mask')
        .waitFor({ state: 'hidden' });
    const stored = page.locator('.stored-valuation-panel'),
        reference = page.locator('.reference-valuation-panel');
    await stored.getByText('$1,430.00', { exact: true }).waitFor();
    await stored.getByText('₩190,000', { exact: true }).waitFor();
    await reference.getByText('$1,000.00', { exact: true }).waitFor();
    await reference.getByText('₩200,000', { exact: true }).waitFor();
    await reference
        .getByText('1 / 2개 보유 항목 평가 · 일부 합계', { exact: true })
        .waitFor();
    // Missing DEMO-M quotes stay excluded; no fabricated total or currency conversion.
    assert.ok(
        (await page.locator('.valuation').innerText()).includes(
            '시세 조회 실패'
        )
    );
    await page
        .locator('.shell-submenu')
        .getByRole('link', { name: '캘린더', exact: true })
        .click();
    await page.locator('.calendar-navigation').waitFor();
    await page
        .locator('.fullscreen-data-loading-mask')
        .waitFor({ state: 'hidden' });
    await page.locator('.calendar-totals').waitFor();
    const dataRequests = () =>
        requests.filter((r) => r.method === 'GET').length;
    const beforeBasis = dataRequests();
    await page
        .getByRole('group', { name: '배당 일정 날짜 기준', exact: true })
        .getByRole('button', { name: '배당락일', exact: true })
        .click();
    assert.equal(
        dataRequests(),
        beforeBasis,
        'date-basis presentation must reuse existing schedule data'
    );
    await page
        .locator('.shell-submenu')
        .getByRole('link', { name: '자산 관리', exact: true })
        .click();
    await page.locator('.accounts').waitFor();
    assert.equal(await page.locator('.accounts li').count(), 3);
    await selectAssetOwner(page, '김모음');
    assert.equal(await page.locator('.accounts li').count(), 2);
    await selectAssetOwner(page, '이모음');
    assert.equal(await page.locator('.accounts li').count(), 1);
    assert.equal(
        await page
            .locator('.accounts')
            .getByRole('button', { name: '자료 업로드', exact: true })
            .count(),
        0,
        'viewer remains read-only'
    );
    assert.equal(
        requests.filter(
            (r) => r.method !== 'GET' && !r.url.startsWith('/api/analytics')
        ).length,
        0
    );
    assert.deepEqual(errors, []);
    console.log(
        'PASS: computed TTM preserved, no public personal API, feedback validation, independent KRW/USD totals, missing quote exclusion, date-basis cache reuse, account permission preserved, no mutations'
    );
    await context.close();
} finally {
    await browser.close();
}
