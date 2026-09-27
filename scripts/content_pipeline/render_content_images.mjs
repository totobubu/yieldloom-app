import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const input = process.argv[2];
if (!input) throw new Error('Usage: node render_content_images.mjs <bundle-directory> | --all <bundle-root>');
const force = process.argv.includes('--force');
const bundleRoots = input === '--all'
    ? (await fs.readdir(path.resolve(process.argv[3] || ''), { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.resolve(process.argv[3], entry.name))
    : [path.resolve(input)];

const targets = [
    {
        html: 'social-square.html',
        png: 'social-square.png',
        width: 1080,
        height: 1080,
    },
    {
        html: 'blog-cover.html',
        png: 'blog-cover.png',
        width: 1200,
        height: 630,
    },
];

let browser;
try {
    browser = await chromium.launch({ headless: true });
} catch (error) {
    if (process.platform !== 'win32') throw error;
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
}

try {
    for (const bundle of bundleRoots) {
        for (const target of targets) {
            await fs.access(path.join(bundle, target.html));
            try {
                await fs.access(path.join(bundle, target.png));
                if (!force) continue;
            } catch {
                // Render only missing PNGs; repeated scheduled runs remain idempotent.
            }
            const page = await browser.newPage({
                viewport: { width: target.width, height: target.height },
                deviceScaleFactor: 1,
            });
            await page.goto(pathToFileURL(path.join(bundle, target.html)).href, {
                waitUntil: 'load',
            });
            await page.screenshot({
                path: path.join(bundle, target.png),
                clip: { x: 0, y: 0, width: target.width, height: target.height },
            });
            await page.close();
            console.log(path.join(bundle, target.png));
        }
    }
} finally {
    await browser.close();
}
