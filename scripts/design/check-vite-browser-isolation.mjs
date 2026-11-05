/* global window -- isolated browser callback. */
// Bounded concurrency experiment. Both pages use synthetic data; no production API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { installStitchFixtures } from '../../tests/stitch-fixtures.mjs';
import { checkReviewCalendar } from '../../tests/support/fifo-calendar-browser.mjs';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5175';
const output =
    process.env.STITCH_ISOLATION_REPORT || '/tmp/stitch-browser-isolation.json';
const expectedReload = process.argv.includes('--expect-reload');
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
const messages = [],
    navigations = [];
try {
    const page = await browser.newPage({
        viewport: { width: 768, height: 1024 },
    });
    await installStitchFixtures(page);
    page.on('websocket', (ws) =>
        ws.on('framereceived', (frame) => {
            try {
                const payload = JSON.parse(String(frame.payload));
                if (payload.type === 'full-reload')
                    messages.push({
                        type: payload.type,
                        path: payload.path || null,
                    });
            } catch {
                /* Vite non-JSON frames are irrelevant. */
            }
        })
    );
    await page.goto(base + '/stock/DEMO-A?tab=dividends');
    const ledger = page.locator('.dividend-roc-history');
    await ledger
        .getByRole('button', { name: '회차별 이력', exact: true })
        .click();
    await ledger.locator('.history-table tbody tr').first().waitFor();
    await page
        .locator('.fullscreen-data-loading-mask')
        .waitFor({ state: 'hidden' });
    const before = await ledger.locator('.history-table tbody tr').count();
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame())
            navigations.push(new URL(frame.url()).pathname);
    });
    await checkReviewCalendar(browser, base);
    if (expectedReload) {
        // Explicit negative control: replay only the old filesystem side effect.
        const probe = new URL(
            `../../.tmp-browser-isolation-${process.pid}.html`,
            import.meta.url
        );
        try {
            await fs.writeFile(
                probe,
                `<!doctype html><title>Synthetic watcher probe</title><script type="module">import {ref} from 'vue'; window.syntheticWatcherProbe=ref(1).value;</script>`
            );
            const sibling = await browser.newPage();
            try {
                await sibling.goto(
                    base + '/' + probe.pathname.split('/').at(-1)
                );
                await sibling.waitForFunction(
                    () => window.syntheticWatcherProbe === 1
                );
            } finally {
                await sibling.close();
            }
        } finally {
            await fs.rm(probe, { force: true });
        }
    }

    // Observe the asynchronous Vite watcher after the sibling fixture closes.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const after = await ledger.locator('.history-table tbody tr').count();
    const monthly = await ledger.locator('.monthly-cell').count();
    const result = {
        fixture: 'fixed synthetic DEMO-A and FIFO review events',
        before,
        after,
        monthly,
        navigations,
        hmr: messages,
        expectedReload,
        trigger: expectedReload
            ? 'explicit synthetic HTML filesystem negative control'
            : 'FIFO virtual route only',
        interpretation:
            'Reload reproduction establishes a shared-dev-server interference mechanism, not historical telemetry for the earlier failure.',
    };
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
    if (expectedReload) {
        assert.ok(messages.length > 0 || navigations.length > 0);
        assert.equal(after, 0);
        assert.ok(monthly > 0);
    } else {
        assert.equal(messages.length, 0);
        assert.equal(navigations.length, 0);
        assert.equal(after, before);
    }
    console.log(JSON.stringify(result));
} finally {
    await browser.close();
}
