import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandleLedger, mergeCandles } from '../lib/candle-ledger.js';
import { createStockCandleLoader, verifiedCandleIdentity } from '../api/stock-prices.js';
const identity = { symbol: 'AAPL', isin: 'US0378331005', currency: 'USD', market: 'NASDAQ', ipoDate: '1980-12-12' };
const row = (date, close = 101) => ({ date, open: 100, high: 110, low: 90, close, volume: 10 });
const value = (candles) => ({ symbol: 'AAPL', currency: 'USD', candles, events: [], asOf: '2026-01-02', source: 'Yahoo Finance' });
function fixture() {
    const objects = new Map();
    let version = 0, puts = 0;
    const storage = { async send({ input: i }) {
        const old = objects.get(i.Key);
        if (i.Body === undefined) {
            if (!old) throw Object.assign(Error('missing'), { name: 'NoSuchKey' });
            return { ETag: old.etag, Body: { transformToString: async () => old.body } };
        }
        if ((i.IfNoneMatch === '*' && old) || (i.IfMatch && i.IfMatch !== old?.etag))
            throw Object.assign(Error('conflict'), { $metadata: { httpStatusCode: 412 } });
        puts++;
        objects.set(i.Key, { body: i.Body, etag: String(++version) });
        return {};
    } };
    return { ledger: () => createCandleLedger({ storage, bucket: 'private-test' }), puts: () => puts };
}
test('independent writers retain all dates with CAS and survive process recreation', async () => {
    const f = fixture();
    await Promise.all([
        f.ledger().append(value([row('2010-01-01')]), identity, { sample: 1 }),
        f.ledger().append(value([row('2026-01-01')]), identity, { sample: 2 }),
    ]);
    const saved = (await f.ledger().read('AAPL')).value;
    assert.equal(saved.candles.length, 2);
    assert.equal(saved.coverage.status, 'partial');
    assert.equal(saved.collectionRequest.targetStart, '1980-12-12');
});
test('shorter refresh and conflicting rebased prices preserve old values and evidence', async () => {
    const f = fixture(), ledger = f.ledger();
    await ledger.append(value([row('2010-01-01'), row('2026-01-01')]), identity, { sample: 1 });
    await ledger.append(value([row('2026-01-01', 102)]), identity, { sample: 2 });
    const saved = (await ledger.read('AAPL')).value;
    assert.equal(saved.candles.length, 2);
    assert.equal(saved.candles[1].close, 101);
    assert.equal(saved.revisions[0].observed.close, 102);
    const before = f.puts();
    await assert.rejects(ledger.append(value([]), identity, {}), /empty/);
    assert.equal(f.puts(), before);
    assert.throws(() => mergeCandles(saved, { ...value([row('2026-01-01')]), currency: 'KRW' }, identity, 'x'), /identity/);
});
const upstream = () => ({ ok: true, json: async () => ({ chart: { result: [{
    meta: { symbol: 'AAPL', exchangeName: 'NMS', currency: 'USD', exchangeTimezoneName: 'America/New_York' },
    timestamp: [1767272400], indicators: { quote: [{ open: [100], high: [110], low: [90], close: [101], volume: [10] }] },
}] } }) });
test('API shares requests, persists once and returns history after empty response or outage', async () => {
    const f = fixture();
    const make = () => createStockCandleLoader({ getLedger: f.ledger });
    let calls = 0;
    const fetcher = async () => { calls++; return upstream(); };
    const load = make();
    await Promise.all([load('AAPL', fetcher), load('aapl', fetcher)]);
    await load('AAPL', fetcher);
    assert.equal(calls, 1);
    assert.equal(f.puts(), 3); // Source observation, ledger and durable collection request.
    for (const failed of [async () => ({ ok: false, status: 503 }), async () => ({ ok: true, json: async () => ({ chart: { result: [] } }) })]) {
        const saved = await make()('AAPL', failed);
        assert.equal(saved.stale, true);
        assert.equal(saved.candles.length, 1);
    }
    assert.equal(f.puts(), 3);
});
test('identity verification rejects wrong currency, symbol and exchange before persistence', () => {
    const meta = { symbol: 'AAPL', exchangeName: 'NMS', currency: 'USD' };
    assert.ok(verifiedCandleIdentity('AAPL', meta));
    for (const change of [{ symbol: 'MSFT' }, { currency: 'KRW' }, { exchangeName: 'NYQ' }])
        assert.equal(verifiedCandleIdentity('AAPL', { ...meta, ...change }), null);
});
