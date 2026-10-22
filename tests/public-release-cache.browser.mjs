// Use a real HTTP server: Playwright route interception disables the HTTP cache.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

let currentRelease = 'one';
let invalidEntity = false;
const originReads = [];
const entityId = 'instrument:isin:US4642872000';
const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/harness') {
        response.writeHead(200, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store',
        });
        response.end(`<script type="module">
            import { createPublicJsonClient } from '/src/services/publicJson.js';
            import { createOfficialFundClient } from '/src/services/officialFundData.js';
            window.clock = 0;
            window.read = createPublicJsonClient({ now: () => window.clock });
            window.load = createOfficialFundClient({ baseUrl: location.origin, read: window.read });
        </script>`);
        return;
    }
    if (
        /^\/src\/services\/(publicJson|sharedRequest|officialFundData|releaseCache)\.js$/.test(
            path
        )
    ) {
        response.writeHead(200, {
            'Content-Type': 'text/javascript',
            'Cache-Control': 'no-store',
        });
        response.end(await readFile(new URL('..' + path, import.meta.url)));
        return;
    }
    if (!path.startsWith('/datasets/')) {
        response.writeHead(404).end();
        return;
    }
    originReads.push(path);
    const releaseId =
        path.match(/\/releases\/([^/]+)\//)?.[1] || currentRelease;
    const common = {
        schemaVersion: 1,
        dataset: 'fund-observations',
        releaseId,
    };
    const payload = path.endsWith('/current.json')
        ? {
              ...common,
              manifestKey: `datasets/fund-observations/releases/${releaseId}/manifest.json`,
          }
        : path.endsWith('/manifest.json')
          ? {
                ...common,
                symbols: { IVV: entityId },
                policies: {},
                entities: {
                    [entityId]: { path: `entities/${'a'.repeat(64)}.json` },
                },
            }
          : invalidEntity
            ? { invalid: true }
            : {
                  ...common,
                  entityId,
                  observations: [],
              };
    response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': path.endsWith('/current.json')
            ? 'public, max-age=60'
            : 'public, max-age=31536000, immutable',
    });
    response.end(JSON.stringify(payload));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({
        executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
        args: ['--no-sandbox'],
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(base + '/harness');
    await page.waitForFunction(() => window.load);
    await page.evaluate(() =>
        Promise.all([window.load('IVV'), window.load('IVV')])
    );
    assert.equal(
        originReads.length,
        3,
        'concurrent first reads share three files'
    );
    await page.evaluate(() => window.load('IVV'));
    assert.equal(originReads.length, 3, 'tab reentry uses memory');
    await page.evaluate(() => {
        window.clock = 180_001;
    });
    await page.evaluate(() => window.load('IVV'));
    assert.equal(
        originReads.length,
        4,
        'three minute reentry requests only the pointer'
    );
    await page.evaluate(() => {
        window.clock += 86_400_001;
    });
    const before = await page.evaluate(
        () => window.read.metrics().fetchRequests
    );
    await page.evaluate(() => window.load('IVV'));
    assert.equal(
        await page.evaluate(() => window.read.metrics().fetchRequests),
        before + 3
    );
    assert.equal(
        originReads.length,
        5,
        'expired memory falls back to browser HTTP cache for immutable files'
    );
    await page.reload();
    await page.waitForFunction(() => window.load);
    await page.evaluate(() => window.load('IVV'));
    assert.equal(
        originReads.length,
        6,
        'new JS memory after reload still reuses HTTP cached immutable files'
    );
    currentRelease = 'two';
    const changed = await page.evaluate(() =>
        window.load('IVV', 'fund-observations', { force: true })
    );
    assert.equal(changed.releaseId, 'two');
    assert.equal(
        originReads.length,
        9,
        'new release loads the pointer and two new files'
    );
    currentRelease = 'one';
    await page.evaluate(() =>
        window.load('IVV', 'fund-observations', { force: true })
    );
    assert.equal(
        originReads.length,
        10,
        'rollback reuses cached immutable files'
    );
    currentRelease = 'bad';
    invalidEntity = true;
    assert.equal(
        await page.evaluate(() =>
            window.load('IVV', 'fund-observations', { force: true }).then(
                () => false,
                () => true
            )
        ),
        true
    );
    assert.equal(originReads.length, 13);
    invalidEntity = false;
    assert.equal(
        (await page.evaluate(() => window.load('IVV'))).releaseId,
        'bad'
    );
    assert.equal(
        originReads.length,
        14,
        'retry bypasses malformed immutable HTTP cached response'
    );
    console.log(
        JSON.stringify({
            result: 'passed',
            transport: 'local HTTP server, no routing interception',
            firstReadOriginRequests: 3,
            reentryAfter3Minutes: 1,
            reentryAfterMemoryExpiry: { fetchCalls: 3, originRequests: 1 },
            pageReloadOriginRequests: 1,
            releaseChangeOriginRequests: 3,
            rollbackOriginRequests: 1,
            invalidCachedEntityRetryOriginRequests: 1,
            cloudflareOriginReads: 'not measured',
        })
    );
    await context.close();
} finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
}
