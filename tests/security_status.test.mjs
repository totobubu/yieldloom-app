import { loadStockCandles } from '../api/stock-prices.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applySecurityStatuses,
    archiveTicker,
    isDelisted,
    isSearchableSecurity,
} from '../lib/security-status.js';
import { createTickerIndex } from '../scripts/publicAssets.mjs';
import {
    buildThumbnailPayload,
    catalogEntry,
    loadTickerWithSnapshot,
    loadTicker,
    rivalOptions,
} from '../api/thumbnail-data.js';
import ogHandler from '../api/thumbnail-og.js';
import { refresh } from '../scripts/thumbnail_pipeline/refresh.mjs';

const oldRows = [
    { symbol: 'COII', active: true },
    { symbol: 'AAPL', active: true },
    { symbol: 'IPO', active: false },
];
test('reviewed status overrides remote active flags without treating every inactive security as delisted', () => {
    const rows = applySecurityStatuses(oldRows);
    assert.deepEqual(
        rows
            .filter((row) => isSearchableSecurity(row))
            .map((row) => row.symbol),
        ['AAPL']
    );
    assert.deepEqual(
        rows
            .filter((row) => isSearchableSecurity(row, true))
            .map((row) => row.symbol),
        ['COII', 'AAPL']
    );
    assert.equal(rows[0].listingStatus.officialVerified, false);
    assert.equal(rows[0].listingStatus.delistedOn, null);
    assert.equal(oldRows[0].active, true);
    assert.equal(isDelisted(rows[2]), false);
});
test('a remote directory omitting archived securities still provides a local archive entry', () => {
    const index = createTickerIndex({ instruments: [oldRows[1]] });
    const coii = index.nav.find((row) => row.symbol === 'COII');
    assert.ok(coii);
    assert.equal(coii.active, false);
    assert.equal(coii.listingStatus.status, 'delisted');
});
test('COII has no rivals and is excluded from normal competitors', () => {
    assert.deepEqual(rivalOptions(catalogEntry('COII')), []);
    assert.ok(!rivalOptions(catalogEntry('CONY')).includes('COII'));
});
test('an empty delisted ticker returns metadata instead of a price error and loads only itself', async () => {
    const calls = [];
    const payload = await buildThumbnailPayload(
        'COII',
        ['CONY'],
        async (symbol) => {
            calls.push(symbol);
            return {
                symbol,
                tickerInfo: {},
                backtestData: [],
                sourceStatus: { price: 'unavailable' },
            };
        }
    );
    assert.deepEqual(calls, ['COII']);
    assert.equal(payload.dataStatus, 'archived');
    assert.equal(payload.catalog.active, false);
    assert.equal(payload.ticker.tickerInfo.price, null);
    assert.deepEqual(payload.rivals, []);
});
test('undated quotes and future/forecast rows cannot become archival prices', () => {
    const source = {
        symbol: 'COII',
        tickerInfo: { price: 55 },
        backtestData: [
            { date: '2099-01-01', close: 8 },
            { date: '2026-01-01', forecasted: true, close: 5 },
        ],
        sourceStatus: {},
    };
    const result = archiveTicker(source);
    assert.equal(result.tickerInfo.price, null);
    assert.equal(result.sourceStatus.priceDate, null);
    assert.deepEqual(result.backtestData, []);
    assert.equal(source.backtestData.length, 2);
});
test('old active snapshots keep price/dividend history but cannot restore live status or forecasts', async () => {
    const urls = [];
    let writes = 0;
    const snapshot = {
        symbol: 'COII',
        tickerInfo: { price: 42 },
        sourceStatus: { price: 'r2_projection', priceDate: '2026-01-02' },
        backtestData: [
            { date: '2026-01-02', close: 42, amount: 0.2 },
            { date: '2026-01-09', forecasted: true, amount: 0.2 },
        ],
    };
    const value = await loadTickerWithSnapshot('COII', 'https://app.example', {
        priceDataBaseUrl: '',
        projectionBaseUrl: '',
        fetcher: async (url) => {
            urls.push(String(url));
            return { ok: false, status: 404 };
        },
        readSnapshot: async () => ({ value: snapshot, savedAt: '2026-01-03' }),
        writeSnapshot: async () => {
            writes++;
        },
    });
    assert.equal(value.listingStatus.status, 'delisted');
    assert.equal(value.sourceStatus.freshness, 'archived');
    assert.equal(value.tickerInfo.regularMarketPrice, null);
    assert.equal(value.tickerInfo.price, 42);
    assert.deepEqual(value.backtestData, [snapshot.backtestData[0]]);
    assert.equal(writes, 0);
    assert.ok(urls.every((url) => !url.includes('finance.yahoo.com')));
});
test('OG output rejects delisted tickers before generating an image', () => {
    const res = {
        status(code) {
            this.code = code;
            return this;
        },
        send(body) {
            this.body = body;
        },
    };
    ogHandler({ query: { ticker: 'COII' } }, res);
    assert.equal(res.code, 410);
});
test('scheduled projections skip delisted symbols without reading or overwriting history', async () => {
    let calls = 0;
    const options = {
        nav: {
            nav: [{ symbol: 'COII', dataPaths: ['data/nasdaq/coii.json'] }],
        },
        sourceBase: 'https://prices.example',
        dryRun: true,
        asOf: '2026-10-21',
        fetcher: async () => {
            calls++;
            return { ok: false, status: 404 };
        },
    };
    const report = await refresh(options);
    assert.equal(calls, 0);
    assert.deepEqual(report.skipped, [{ symbol: 'COII', reason: 'delisted' }]);
    const explicit = await refresh({ ...options, includeDelisted: true });
    assert.equal(calls, 1);
    assert.equal(explicit.rejected.length, 1);
});

test('archival source keeps old prices outside the normal window and never retries a failed source twice', async () => {
    const urls = [];
    const archive = await loadTicker('COII', 'https://app.example', {
        priceDataBaseUrl: 'https://prices.example',
        projectionBaseUrl: '',
        fetcher: async (url) => {
            urls.push(String(url));
            assert.match(String(url), /data\/nasdaq\/coii.json$/);
            return {
                ok: true,
                json: async () => ({
                    backtestData: [
                        { date: '2020-01-02', close: 3 },
                        { date: '2026-01-02', close: 4 },
                    ],
                }),
            };
        },
    });
    assert.equal(urls.length, 1);
    assert.equal(archive.backtestData[0].date, '2020-01-02');
    assert.equal(archive.tickerInfo.regularMarketPrice, null);
    const failed = [];
    await loadTicker('COII', 'https://app.example', {
        priceDataBaseUrl: 'https://prices.example',
        projectionBaseUrl: '',
        fetcher: async (url) => {
            failed.push(String(url));
            return { ok: false, status: 404 };
        },
    });
    assert.equal(failed.filter((url) => url.endsWith('/coii.json')).length, 1);
    assert.ok(failed.every((url) => !url.includes('finance.yahoo.com')));
});

test('public candle endpoint preserves missing archival prices without a live Yahoo request', async () => {
    const urls = [];
    const value = await loadStockCandles('COII', async (url) => {
        urls.push(String(url));
        return { ok: false, status: 404 };
    });
    assert.equal(value.listingStatus.status, 'delisted');
    assert.deepEqual(value.candles, []);
    assert.ok(urls.every((url) => !url.includes('finance.yahoo.com')));
});
