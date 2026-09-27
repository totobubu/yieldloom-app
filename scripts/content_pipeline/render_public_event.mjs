import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const eventId = Number(process.argv[2]);
const publicRoot = path.resolve(process.argv[3] || 'public/content-studio');
if (!Number.isInteger(eventId) || eventId <= 0) {
    throw new Error('Usage: node render_public_event.mjs <event-id> [public-root]');
}

const indexPath = path.join(publicRoot, 'renders.json');
const payload = JSON.parse(await fs.readFile(indexPath, 'utf8'));
const rows = Array.isArray(payload.renders) ? payload.renders : [];
const eventRows = rows.filter((row) => row.eventId === eventId);
const htmlRow = eventRows.find((row) => row.name === 'social-square.html');
if (!htmlRow) throw new Error(`Unknown or non-renderable eventId: ${eventId}`);

const eventDirectory = path.join(publicRoot, 'renders', String(eventId));
const htmlPath = path.join(eventDirectory, 'social-square.html');
const pngPath = path.join(eventDirectory, 'social-square.png');
await fs.access(htmlPath);

let alreadyExists = false;
try {
    await fs.access(pngPath);
    alreadyExists = true;
} catch {
    // Render only when the PNG is absent.
}

if (!alreadyExists) {
    let browser;
    try {
        browser = await chromium.launch({ headless: true });
    } catch (error) {
        if (process.platform !== 'win32') throw error;
        browser = await chromium.launch({ headless: true, channel: 'msedge' });
    }
    try {
        const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
        await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
        await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1080, height: 1080 } });
    } finally {
        await browser.close();
    }
}

if (!eventRows.some((row) => row.name === 'social-square.png')) {
    rows.push({
        ...htmlRow,
        name: 'social-square.png',
        url: `/content-studio/renders/${eventId}/social-square.png`,
    });
    await fs.writeFile(indexPath, `${JSON.stringify({ renders: rows })}\n`, 'utf8');
}

process.stdout.write(`${JSON.stringify({ eventId, status: alreadyExists ? 'no_change' : 'success' })}\n`);
