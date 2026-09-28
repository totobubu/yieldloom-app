import process from 'node:process';
import { chromium } from 'playwright';

const input = await new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (value += chunk));
    process.stdin.on('end', () => {
        try {
            resolve(JSON.parse(value || '{}'));
        } catch (error) {
            reject(error);
        }
    });
    process.stdin.on('error', reject);
});

const sources = Array.isArray(input.sources) ? input.sources : [];
const timeoutMs = Math.max(5_000, Number(input.timeoutMs) || 60_000);
const minDelayMs = Math.max(0, Number(input.minDelayMs) || 5_000);
const maxDelayMs = Math.max(minDelayMs, Number(input.maxDelayMs) || 15_000);
const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const randomDelay = () => minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1));

let browser;
try {
    browser = await chromium.launch({ headless: true });
} catch (error) {
    if (process.platform !== 'win32') throw error;
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
}

const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const results = [];

try {
    for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        try {
            const response = await page.goto(source.url, {
                waitUntil: 'domcontentloaded',
                timeout: timeoutMs,
            });
            const status = response?.status() ?? null;
            if (status === 403 || status === 429) {
                results.push({
                    ok: false,
                    code: status === 429 ? 'rate_limited' : 'blocked',
                    retryable: status === 429,
                    message: `official source returned HTTP ${status}`,
                });
                continue;
            }
            if (status !== null && status >= 400) {
                results.push({
                    ok: false,
                    code: 'http_error',
                    retryable: status >= 500,
                    message: `official source returned HTTP ${status}`,
                });
                continue;
            }
            if (source.readyText) {
                await page.getByText(source.readyText, { exact: true }).waitFor({ timeout: timeoutMs });
            } else {
                await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {});
            }
            const bodyText = await page.locator('body').innerText();
            const pageTitle = await page.title();
            const challengeText = `${pageTitle}\n${bodyText.slice(0, 4_000)}`;
            if (/captcha|verify you are human|access denied|unusual traffic|cloudflare ray id/i.test(challengeText)) {
                results.push({
                    ok: false,
                    code: 'challenge_detected',
                    retryable: false,
                    message: 'anti-automation challenge detected; collection stopped',
                });
                continue;
            }
            const content = source.content === 'text' ? bodyText : await page.content();
            if (!content.trim()) {
                results.push({ ok: false, code: 'empty_document', retryable: true, message: 'rendered document was empty' });
                continue;
            }
            results.push({
                ok: true,
                httpStatus: status,
                finalUrl: page.url(),
                pageTitle,
                contentBase64: Buffer.from(content, 'utf8').toString('base64'),
            });
        } catch (error) {
            results.push({
                ok: false,
                code: error?.name === 'TimeoutError' ? 'browser_timeout' : 'browser_failed',
                retryable: true,
                message: String(error?.message || error),
            });
        }
        if (index < sources.length - 1) await sleep(randomDelay());
    }
} finally {
    await context.close();
    await browser.close();
}

process.stdout.write(JSON.stringify(results));
