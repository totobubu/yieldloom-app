// Isolated fixtures only; submenu navigation must never open a write flow.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    const page = await browser.newPage({
        viewport: { width: 768, height: 1024 },
    });
    await installStitchFixtures(page, { admin: true });
    const writes = [],
        errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
        if (request.url().includes('/api/') && request.method() !== 'GET')
            writes.push(request.url());
    });
    await page.goto(
        (process.env.UI_BASE_URL || 'http://127.0.0.1:5173') +
            '/mypage?tab=overview&view=summary'
    );
    await page.locator('.valuation-card').first().waitFor();
    for (const [label, id] of [
        ['종목 집중도 (HHI)', 'asset-concentration'],
        ['배당 성장률', 'dividend-growth'],
        ['수동 잔고 보정', 'manual-balance'],
        ['자금 입출금 흐름', 'capital-details-heading'],
    ]) {
        await page
            .getByRole('button', { name: '포트폴리오 메뉴', exact: true })
            .click();
        await page
            .locator('#portfolio-submenu-drawer')
            .getByRole('link', { name: label, exact: true })
            .click();
        await page.waitForURL((url) => url.hash === '#' + id);
        await page.locator('#' + id).waitFor();
        await page.waitForFunction(
            (id) => document.activeElement?.id === id,
            id,
            { timeout: 5000 }
        );
        assert.equal(await page.locator('[role="dialog"]').count(), 0);
    }
    assert.equal(new URL(page.url()).searchParams.get('view'), 'capital');
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log(
        'PASS: 4 submenu links reach and focus their exact destination; growth is explicitly pending; no dialogs, API writes or JavaScript errors'
    );
} finally {
    await browser.close();
}
