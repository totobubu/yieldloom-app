import test from 'node:test';
import assert from 'node:assert/strict';
import thumbnailHandler, { buildThumbnailPayload, catalogEntry, loadTicker, loadTickerWithSnapshot, rivalOptions, toBacktestData } from '../api/thumbnail-data.js';

test('public endpoint CORS survives a cache warmed by a same-origin request', async () => {
    const cached = {};
    const response = {
        setHeader(name, value) { cached[name] = value; },
        status(value) { cached.status = value; return this; },
        json(value) { cached.body = value; },
        end() {},
    };
    // Invalid input avoids external data calls and checks the actual endpoint,
    // including its error path, rather than only the wrapper's optional flag.
    await thumbnailHandler({ method: 'GET', headers: {}, query: { ticker: '../private' } }, response);
    assert.equal(cached.status, 400);
    assert.equal(cached['Access-Control-Allow-Origin'], '*');
    assert.equal(cached['Access-Control-Allow-Credentials'], undefined);
});

test('catalog limits rivals to the same verified underlying', () => {
    const entry = catalogEntry('tsly');
    assert.equal(entry.underlying, 'TSLA');
    assert.ok(rivalOptions(entry).includes('TSII'));
    assert.ok(!rivalOptions(entry).includes('NVDY'));
});

test('payload removes invalid rivals and reports partial loads', async () => {
    const payload = await buildThumbnailPayload('TSLY', ['TSII', 'NVDY'], async (symbol) => symbol === 'TSII' ? Promise.reject(new Error('missing')) : { symbol, tickerInfo: { price: 100 }, backtestData: [] });
    assert.deepEqual(payload.rivals, ['TSII']);
    assert.equal(payload.partial, true);
    assert.deepEqual(payload.unavailable, ['TSII']);
    assert.equal(payload.dataStatus, 'partial');
    assert.equal(payload.seriesStatus.TSII.freshness, 'unavailable');
});

test('official events retain exact ex-date and distribution amount without a price', () => {
    assert.deepEqual(toBacktestData([
        { ex_date: '2026-01-02', distribution_per_share: '0.2000' },
        { ex_date: '2026-01-03', distribution_per_share: null },
    ]), [{ date: '2026-01-02', amount: 0.2, amountFixed: 0.2 }]);
});

test('an approved catalog ticker can render when it has no published dividend history yet', async () => {
    const payload = await buildThumbnailPayload('AMDY', [], async (symbol) => ({ symbol, tickerInfo: {}, backtestData: [] }));
    assert.equal(payload.ticker.symbol, 'AMDY');
    assert.deepEqual(payload.ticker.backtestData, []);
});

test('AMDY joins its official ledger to its R2 price projection', async () => {
    const originalFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (url) => {
            if (String(url).endsWith('distribution-ticker-amdy.json')) {
                return { ok: true, json: async () => ({ history: [{ ex_date: '2026-10-08', distribution_per_share: '1.0254' }] }) };
            }
            assert.match(String(url), /data\/nyse\/amdy\.json$/);
            return { ok: true, json: async () => ({ backtestData: [{ date: '2026-10-07', close: 46.5 }, { date: '2026-10-08', close: 47.04 }, { date: '2027-04-08', forecasted: true }] }) };
        };
        const ticker = await loadTicker('AMDY', 'https://yieldloom-app.vercel.app', { priceDataBaseUrl: 'https://prices.example', asOfDate: '2026-10-09' });
        assert.equal(ticker.tickerInfo.regularMarketPrice, 47.04);
        assert.deepEqual(ticker.backtestData, [
            { date: '2026-10-07', close: 46.5 },
            { date: '2026-10-08', close: 47.04, amount: 1.0254, amountFixed: 1.0254 },
        ]);
        assert.equal(ticker.sourceStatus.dividends, 'official_projection');
        assert.equal(ticker.sourceStatus.price, 'r2_projection');
        assert.equal(ticker.sourceStatus.freshness, 'fresh');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('official ledger falls back to the public static origin when the deployment origin fails', async () => {
    const requestedUrls = [];
    const ticker = await loadTicker('TOPW', 'https://yieldloom-app.vercel.app', {
        priceDataBaseUrl: '',
        fetcher: async (url) => {
            requestedUrls.push(String(url));
            if (String(url).startsWith('https://yieldloom-app.vercel.app')) return { ok: false, status: 500 };
            if (String(url).startsWith('https://totobubu.github.io/yieldloom-app')) return { ok: true, json: async () => ({ history: [{ ex_date: '2026-10-13', distribution_per_share: '0.10', verification_status: 'official' }] }) };
            throw new Error(`Unexpected URL: ${url}`);
        },
    });
    assert.equal(ticker.backtestData.length, 1);
    assert.equal(ticker.backtestData[0].amount, 0.1);
    assert.equal(requestedUrls.filter(url => url.includes('distribution-ticker-topw.json')).length, 2);
});

test('missing price and snapshot preserve the available official dividends', async () => {
    const value = await loadTickerWithSnapshot('TOPW', 'https://app.example', {
        priceDataBaseUrl: 'https://prices.example',
        fetcher: async (url) => String(url).includes('distribution-ticker-topw.json')
            ? { ok: true, json: async () => ({ history: [{ ex_date: '2026-10-13', distribution_per_share: '0.219894', verification_status: 'official' }] }) }
            : { ok: false, status: 403 },
        readSnapshot: async () => null,
        writeSnapshot: async () => false,
    });
    assert.equal(value.sourceStatus.price, 'unavailable');
    assert.equal(value.sourceStatus.freshness, 'partial');
    assert.equal(value.backtestData[0].amount, 0.219894);
});

test('an available price snapshot is used when the live price fails', async () => {
    const snapshotValue = { symbol: 'AMD', tickerInfo: { price: 100 }, backtestData: [{ date: '2026-10-12', close: 100 }], sourceStatus: { price: 'r2_projection' } };
    const value = await loadTickerWithSnapshot('AMD', 'https://app.example', {
        priceDataBaseUrl: 'https://prices.example',
        fetcher: async () => ({ ok: false, status: 403 }),
        readSnapshot: async () => ({ value: snapshotValue, savedAt: '2026-10-12T20:00:00Z' }),
        writeSnapshot: async () => { throw new Error('Should preserve the saved price snapshot'); },
    });
    assert.equal(value.tickerInfo.price, 100);
    assert.equal(value.sourceStatus.freshness, 'stale');
    assert.equal(value.sourceStatus.reason, 'price_source_unavailable');
});

test('nav paths provide prices for underlying stocks and TOPW outside the price index', async () => {
    for (const symbol of ['AMD', 'TSLA', 'TOPW']) {
        const value = await loadTicker(symbol, 'https://app.example', {
            priceDataBaseUrl: 'https://prices.example',
            fetcher: async (url) => {
                if (String(url).includes('distribution-ticker-')) return { ok: true, json: async () => ({ history: [] }) };
                assert.equal(String(url), `https://prices.example/data/nasdaq/${symbol.toLowerCase()}.json`);
                return { ok: true, json: async () => ({ backtestData: [{ date: '2026-10-13', close: 100 }] }) };
            },
        });
        assert.equal(value.tickerInfo.price, 100);
        assert.equal(value.tickerInfo.currency, 'USD');
        assert.equal(value.sourceStatus.price, 'r2_projection');
    }
});

test('price still renders when the official ledger is temporarily unavailable', async () => {
    const ticker = await loadTicker('AMDY', 'https://app.example', {
        priceDataBaseUrl: 'https://prices.example', asOfDate: '2026-10-14',
        fetcher: async url => String(url).includes('distribution-ticker-') ? { ok:false,status:503 } : { ok:true,json:async()=>({backtestData:[{date:'2026-10-13',close:100}]}) },
    });
    assert.equal(ticker.tickerInfo.price,100);
    assert.equal(ticker.sourceStatus.dividends,'unavailable');
    assert.equal(ticker.sourceStatus.freshness,'partial');
});

test('no rivals avoids loading the underlying and duplicating the main ticker', async () => {
    const calls = [];
    const payload = await buildThumbnailPayload('AMDY', [], async symbol => {
        calls.push(symbol);return {symbol,tickerInfo:{price:100},backtestData:[],sourceStatus:{freshness:'fresh'}};
    });
    assert.deepEqual(calls,['AMDY']);
    assert.deepEqual(payload.series,{});
});

test('public dividends include review-only issuer captures and retain their review status', () => {
    const events=['official','cross_checked','needs_review'].map((verification_status,index)=>({ex_date:`2026-10-0${index+1}`,distribution_per_share:'0.1000',verification_status}));
    const rows = toBacktestData(events);
    assert.equal(rows.length,3);
    assert.equal(rows[2].verificationStatus,'needs_review');
    assert.equal(rows[0].verificationStatus,undefined);
});

test('duplicate issuer captures count once and verified payments win over review captures', () => {
    const rows = toBacktestData([
        {ex_date:'2026-10-01',declared_date:'2026-09-29',distribution_per_share:'0.10',verification_status:'needs_review'},
        {ex_date:'2026-10-01',declared_date:'2026-09-30',distribution_per_share:'0.12',verification_status:'needs_review'},
        {ex_date:'2026-10-02',distribution_per_share:'0.20',verification_status:'official'},
        {ex_date:'2026-10-02',distribution_per_share:'0.90',verification_status:'needs_review'},
        {ex_date:'2026-10-03',distribution_per_share:'0.30',verification_status:'rejected'},
        {ex_date:'2026-10-04',distribution_per_share:'0.30',forecasted:true,verification_status:'needs_review'},
    ]);
    assert.equal(rows.length,2);
    assert.equal(rows[0].amount,0.12);
    assert.equal(rows[0].verificationStatus,'needs_review');
    assert.equal(rows[1].amount,0.20);
    assert.equal(rows[1].verificationStatus,undefined);
});

test('default rivals select every candidate when there are at most three', async () => {
    for (const ticker of ['ABNY', 'APLY', 'AMDY', 'QQQM']) {
        const payload = await buildThumbnailPayload(ticker, undefined, async symbol => ({ symbol, tickerInfo: { price: 100 }, backtestData: [] }));
        assert.deepEqual(payload.rivals, rivalOptions(catalogEntry(ticker)));
    }
});

test('default rivals select the three largest market caps and load candidates once', async () => {
    const caps = { CRSH: null, TEST: 10, TSII: 500, TSLW: 100, TSYY: 300 };
    const calls = [];
    const payload = await buildThumbnailPayload('TSLY', undefined, async symbol => {
        calls.push(symbol);
        return { symbol, tickerInfo: { price: 100, marketCap: caps[symbol] }, backtestData: [] };
    });
    assert.deepEqual(payload.rivals, ['TSII', 'TSYY', 'TSLW']);
    assert.equal(calls.length, new Set(calls).size);
    assert.deepEqual(Object.keys(payload.series), ['TSII', 'TSYY', 'TSLW', 'TSLA']);
});

test('explicit selection including an empty list overrides automatic defaults', async () => {
    const loader = async symbol => ({ symbol, tickerInfo: { price: 100 }, backtestData: [] });
    assert.deepEqual((await buildThumbnailPayload('TSLY', [], loader)).rivals, []);
    assert.deepEqual((await buildThumbnailPayload('TSLY', ['TEST'], loader)).rivals, ['TEST']);
});


test('fresh review dividends survive price snapshot fallback without duplicate snapshot payments', async () => {
    const value = await loadTickerWithSnapshot('QLDY', 'https://app.example', {
        priceDataBaseUrl: 'https://prices.example',
        fetcher: async url => String(url).includes('distribution-ticker-')
            ? {ok:true,json:async()=>({history:[{ex_date:'2026-10-15',distribution_per_share:'0.1570',verification_status:'needs_review',official_url:'https://issuer.example/'}]})}
            : {ok:false,status:403},
        readSnapshot: async()=>({value:{symbol:'QLDY',tickerInfo:{price:40},backtestData:[{date:'2026-10-15',close:40,amount:9}],sourceStatus:{price:'r2_projection'}},savedAt:'2026-10-15T20:00:00Z'}),
        writeSnapshot:async()=>false,
    });
    assert.equal(value.backtestData.length,1);
    assert.equal(value.backtestData[0].amount,0.157);
    assert.equal(value.backtestData[0].verificationStatus,'needs_review');
    assert.equal(value.sourceStatus.dividendReviewCount,1);
    assert.equal(value.sourceStatus.freshness,'stale');
});

test('API preserves split dates independently of the broad history review flag', async () => {
    const ticker = await loadTicker('MSTY', 'https://issuer-data.example', {
        priceDataBaseUrl: 'https://prices.example',
        projectionBaseUrl: '',
        asOfDate: '2026-10-29',
        stockEvidenceLoader: async () => ({ splits: [{ date: '2025-12-08', ratio: 0.2 }], history: [] }),
        fetcher: async (url) => {
            if (String(url).includes('distribution-ticker-msty.json'))
                return { ok: true, json: async () => ({ history: [
                    { ex_date: '2026-10-22', distribution_per_share: '0.1671', verification_status: 'official' },
                    { ex_date: '2026-10-29', distribution_per_share: '0.1630', verification_status: 'official' },
                ] }) };
            assert.match(String(url), /data\/nyse\/msty\.json$/);
            return { ok: true, json: async () => ({
                tickerInfo: { events: { splits: [{ date: '2025-12-08', ratio: 0.2 }] } },
                backtestData: [{ date: '2025-01-02', close: 20 }, { date: '2026-10-27', close: 14.08 }],
            }) };
        },
    });
    assert.equal(ticker.sourceStatus.corporateActionReview, true);
    assert.deepEqual(ticker.sourceStatus.corporateActionDates, ['2025-12-08']);
    assert.equal(ticker.backtestData.at(-1).amount, 0.163);
});
