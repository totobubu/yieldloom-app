import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createTickerIndex, excludedPublicDirectories, publicAssetsPlugin } from '../scripts/publicAssets.mjs';

test('compact index preserves selectable tickers, aliases, rivals and comparison metadata', async () => {
    const source = JSON.parse(await fs.readFile('public/nav.json', 'utf8'));
    const expected = source.nav.filter(row => row.symbol && row.dataPaths?.[0]);
    const compact = createTickerIndex(source).nav;
    assert.equal(compact.length, expected.length);
    compact.forEach((row, index) => {
        for (const field of ['symbol', 'koName', 'company', 'underlying', 'yfSymbol', 'frequency', 'ipoDate']) {
            assert.equal(row[field], expected[index][field] ?? undefined);
        }
        assert.deepEqual(row.dataPaths, [expected[index].dataPaths[0]]);
        assert.equal('logo' in row, false);
        assert.equal('isin' in row, false);
    });
});

test('build excludes legacy assets and keeps thumbnail and dividend schedule assets', async () => {
    for (const directory of excludedPublicDirectories) {
        await assert.rejects(fs.access(`dist/${directory}`), { code: 'ENOENT' });
    }
    await assert.rejects(fs.access('dist/nav.json'), { code: 'ENOENT' });
    const index = JSON.parse(await fs.readFile('dist/ticker-index.json', 'utf8'));
    assert.ok(index.nav.length > 0);
    for (const color of ['red', 'blue', 'gray']) await fs.access(`dist/thumbnail/${color}.png`);
    const schedule = JSON.parse(await fs.readFile('dist/content-studio/distribution-index.json', 'utf8'));
    for (const ticker of schedule.tickers) {
        if (ticker.historyUrl) await fs.access(`dist/${ticker.historyUrl.replace(/^\//, '')}`);
    }
});

test('development index works below the deployment base path', async () => {
    const plugin = publicAssetsPlugin();
    plugin.configResolved({ root: process.cwd(), base: '/yieldloom-app/' });
    let middleware;
    plugin.configureServer({ middlewares: { use(fn) { middleware = fn; } } });
    let body;
    await middleware({ url: '/yieldloom-app/ticker-index.json?refresh=1' }, {
        setHeader() {}, end(value) { body = JSON.parse(value); },
    }, error => { throw error || new Error('Index request was not handled'); });
    assert.ok(body.nav.length > 0);
});
