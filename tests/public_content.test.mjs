import test from 'node:test';
import assert from 'node:assert/strict';
import { storage } from './fixtures/public-content-fixture.mjs';

let clock = Date.now();
const realNow = Date.now;
Date.now = () => clock;
const { loadOfficialHistory, loadOfficialIndex } = await import(
    '../lib/official-dividends.js'
);
const { loadStockEvidence } = await import('../lib/load-stock-evidence.js');
const { loadTicker } = await import('../api/thumbnail-data.js');

test('warm server observes appended dividends, stock evidence and rollback without rebuilding', async () => {
    process.env.PUBLIC_CONTENT_BASE_URL = 'https://snapshot.invalid';
    process.env.PUBLIC_CONTENT_CHANNEL = 'production';
    const store = storage();
    const fetcher = async (url) => {
        const body = store.read(String(url));
        return new Response(body || '{}', { status: body ? 200 : 503 });
    };
    try {
        const history = () =>
            loadOfficialHistory('BAC', 'https://app.invalid', fetcher);
        assert.equal((await history()).length, 1);
        assert.equal(
            (await loadOfficialIndex({ fetcher })).tickers[0].latest
                .distribution_per_share,
            '0.32'
        );
        assert.equal(
            (await loadStockEvidence('BAC', 'https://app.invalid', fetcher))
                .symbol,
            'BAC'
        );
        store.advance();
        clock += 61_000;
        assert.equal((await history()).length, 2);
        assert.equal(
            (await loadStockEvidence('BAC', 'https://app.invalid', fetcher))
                .history.length,
            1
        );
        const ticker = await loadTicker('BAC', 'https://app.invalid', {
            fetcher,
            priceDataBaseUrl: '',
        });
        assert.equal(ticker.backtestData.at(-1).amount, 0.33);
        const count = store.requests.length;
        await Promise.all([history(), history()]);
        assert.equal(store.requests.length, count);
        store.rollback();
        clock += 61_000;
        assert.equal((await history()).length, 1);
        assert.equal(store.requests.at(-1), 'current.json');
    } finally {
        Date.now = realNow;
        delete process.env.PUBLIC_CONTENT_BASE_URL;
        delete process.env.PUBLIC_CONTENT_CHANNEL;
    }
});

test('preview rejects production channel', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.PUBLIC_CONTENT_BASE_URL = 'https://snapshot.invalid';
    process.env.PUBLIC_CONTENT_CHANNEL = 'production';
    try {
        await assert.rejects(loadOfficialIndex(), /Preview cannot/);
    } finally {
        delete process.env.VERCEL_ENV;
        delete process.env.PUBLIC_CONTENT_BASE_URL;
        delete process.env.PUBLIC_CONTENT_CHANNEL;
    }
});

test('a corrupt immutable projection is rejected and can recover on retry', async () => {
    process.env.PUBLIC_CONTENT_BASE_URL = 'https://snapshot.invalid';
    process.env.PUBLIC_CONTENT_CHANNEL = 'production';
    const store = storage();
    let corrupt = true;
    const fetcher = async (url) => {
        let body = store.read(String(url));
        if (body && JSON.parse(body).ticker === 'BAC' && corrupt) {
            corrupt = false;
            body += ' ';
        }
        return new Response(body || '{}', { status: body ? 200 : 404 });
    };
    try {
        await assert.rejects(
            loadOfficialHistory('BAC', '', fetcher),
            /hash mismatch/
        );
        assert.equal((await loadOfficialHistory('BAC', '', fetcher)).length, 1);
    } finally {
        delete process.env.PUBLIC_CONTENT_BASE_URL;
        delete process.env.PUBLIC_CONTENT_CHANNEL;
    }
});
