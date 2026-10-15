import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Prove the independent public snapshot still renders if live quotes fail.
    await page.route('**/api/thumbnail-data?**', route => route.fulfill({ status: 503, json: { error: 'quote unavailable' } }));
    await page.goto('http://127.0.0.1:5173/thumbnail/SPYI');
    const panel = page.locator('.security-insights');
    await panel.getByRole('heading', { name: 'ROC 이력', exact: false }).waitFor();
    await panel.scrollIntoViewIfNeeded();
    assert.ok(await panel.getByText('0.48085208', { exact: true }).count());
    assert.ok(await panel.getByText('95.274833%', { exact: true }).count());
    assert.ok(await panel.getByText('확정', { exact: true }).count());
    assert.ok(await panel.getByText('추정', { exact: true }).count());
    assert.ok(await panel.getByText('회계연도 누적', { exact: true }).count());
    assert.ok(await panel.getByText('기준일 미제공', { exact: false }).count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await panel.screenshot({ path: '/tmp/yieldloom-security-insights-mobile.png' });
    await page.goto('http://127.0.0.1:5173/thumbnail/TXN');
    await panel.getByText('공개된 ROC 근거를 수집하지 못했습니다.', { exact: false }).waitFor();
    await panel.getByText('배당 지급 여력의 분기별 근거', { exact: true }).click();
    await panel.getByText('2026-06-30', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: real public snapshots render ROC precision, classifications, missing values, financial evidence and mobile layout without live API');
} finally { await browser.close(); }
