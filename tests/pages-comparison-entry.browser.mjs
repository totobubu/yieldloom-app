// Real Pages build, a local extensionless static host, anonymous public fixtures.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import { installStitchFixtures } from './stitch-fixtures.mjs';
import { installStaticAssets } from '../scripts/design/browser-static-assets.mjs';

const root = resolve('dist');
const mime = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.png': 'image/png',
};
const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/yieldloom-app/')) {
        res.writeHead(404).end();
        return;
    }
    let file = resolve(
        root,
        path.slice('/yieldloom-app/'.length) || 'index.html'
    );
    if (!file.startsWith(root + '/')) {
        res.writeHead(400).end();
        return;
    }
    try {
        let bytes;
        try {
            bytes = await readFile(file);
        } catch {
            if (extname(file)) throw Error('Missing static asset');
            file += '.html';
            bytes = await readFile(file);
        }
        res.writeHead(200, {
            'content-type': mime[extname(file)] || 'application/octet-stream',
        }).end(bytes);
    } catch {
        res.writeHead(404, { 'content-type': 'text/html' }).end(
            await readFile(resolve(root, '404.html'))
        );
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/yieldloom-app`;
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox'],
});
try {
    assert.equal((await fetch(`${base}/unknown-route`)).status, 404);
    for (const view of ['similar', 'theme']) {
        const page = await browser.newPage({
            viewport: { width: 834, height: 1000 },
        });
        await installStitchFixtures(page);
        await installStaticAssets(page);
        let writes = 0;
        await page.route('**/*', (route) => {
            if (
                !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
            ) {
                writes++;
                return route.abort();
            }
            return route.fallback();
        });
        const url = `${base}/compare?view=${view}&marker=a%2Bb%26c`;
        const response = await page.goto(url);
        assert.equal(response.status(), 200);
        await page.locator('[data-responsive-view]').waitFor();
        assert.equal(
            await page
                .locator('[data-responsive-view]')
                .getAttribute('data-responsive-view'),
            view
        );
        assert.equal(new URL(page.url()).searchParams.get('marker'), 'a+b&c');
        assert.equal((await page.reload()).status(), 200);
        await page.locator('[data-responsive-view]').waitFor();
        assert.equal(new URL(page.url()).searchParams.get('view'), view);
        assert.equal(new URL(page.url()).searchParams.get('marker'), 'a+b&c');
        assert.equal(writes, 0);
        await page.close();
    }
    console.log(
        'PASS Pages comparison: native HTML200, view/query preservation, refresh200, unknown route404, no writes.'
    );
} finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
}
