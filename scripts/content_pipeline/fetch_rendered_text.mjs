import process from 'node:process';
import { chromium } from 'playwright';

const [url, readyText = ''] = process.argv.slice(2);
if (!url)
    throw new Error('Usage: node fetch_rendered_text.mjs <url> [ready-text]');

let browser;
try {
    browser = await chromium.launch({ headless: true });
} catch (error) {
    if (process.platform !== 'win32') throw error;
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
}

try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (readyText) {
        await page
            .getByText(readyText, { exact: true })
            .waitFor({ timeout: 30_000 });
        await page.waitForTimeout(8_000);
    }
    process.stdout.write(await page.locator('body').innerText());
} finally {
    await browser.close();
}
