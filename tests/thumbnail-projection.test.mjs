import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjection, validateProjection, jsonBytes } from '../lib/thumbnail-projection.js';
import { refresh } from '../scripts/thumbnail_pipeline/refresh.mjs';
import { calculateEntryIncomeEfficiency } from '../src/services/thumbnail/entryIncomeEfficiency.js';
import { calculateRivalComparison } from '../src/services/thumbnail/rivalComparison.js';
import { loadProjection, loadYahooQuote } from '../lib/thumbnail-prices.js';

const makeRows = () => Array.from({ length: 72 }, (_, i) => ({ date: new Date(Date.UTC(2020, i, 2)).toISOString().slice(0,10), close: 100 + i, amount: '1.0000', amountFixed: 1 }));
const project = (payload, previousDates) => buildProjection({ symbol: 'TEST', payload, sourceBytes: jsonBytes(payload), sourceKey: 'data/nyse/test.json', asOf: '2025-12-31', previousDates });

test('read models preserve calculation inputs without promoting source dividends or mutating split prices', () => {
    const payload = { tickerInfo: { Symbol: 'TEST', events: { splits: [{ date: '2025-01-02', ratio: '1:8' }] } }, backtestData: makeRows() };
    const before = JSON.stringify(payload);
    const models = validateProjection(project(payload));
    assert.equal(JSON.stringify(payload), before);
    assert.equal(models.summary.source.rowCount, 72);
    assert.deepEqual(models.summary.splits, [{ date: '2025-01-02', ratio: '1:8' }]);
    const recent = models['entry-efficiency'].backtestData;
    assert.ok(recent.length < payload.backtestData.length);
    assert.ok(recent.every(row => Object.keys(row).join(',') === 'date,close'));
    const dividends = new Map(payload.backtestData.map(row => [row.date, row.amountFixed]));
    const joined = recent.map(row => ({ ...row, amountFixed: dividends.get(row.date) }));
    const full = calculateEntryIncomeEfficiency({ symbol: 'TEST', backtestData: payload.backtestData }, { asOfDate: '2025-12-31' });
    const compact = calculateEntryIncomeEfficiency({ symbol: 'TEST', backtestData: joined }, { asOfDate: '2025-12-31' });
    assert.deepEqual(compact, full);
    const ticker = rows => ({ symbol: 'TEST', backtestData: rows });
    const compactComparison = models['comparison-1y'].backtestData.map(row => ({ ...row, amountFixed: dividends.get(row.date) }));
    assert.deepEqual(calculateRivalComparison([ticker(compactComparison), ticker(compactComparison)], ticker(compactComparison), '2025-12-31'), calculateRivalComparison([ticker(payload.backtestData), ticker(payload.backtestData)], ticker(payload.backtestData), '2025-12-31'));
});

test('source shrink and interior deletion are rejected, while corrected prices are allowed', () => {
    const original = { backtestData: makeRows() };
    const dates = project(original)['source-coverage'].dates;
    for (const rows of [original.backtestData.slice(12), original.backtestData.filter((_,i)=>i!==30)]) assert.throws(() => project({backtestData:rows}, dates), /history shrank/);
    const corrected = structuredClone(original); corrected.backtestData[0].close = 99;
    assert.doesNotThrow(() => project(corrected, dates));
});

test('invalid, future, forecast and conflicting prices cannot become latest prices', () => {
    const payload = { backtestData: [...makeRows(), { date:'2026-01-02',close:999 }, {date:'2025-12-30',close:500,forecasted:true}, {date:'2025-99-01',close:999}] };
    assert.equal(project(payload).summary.priceDate, '2025-12-02');
    assert.throws(() => project({ backtestData: [{date:'2025-01-02',close:1},{date:'2025-01-02',close:2}] }), /Conflicting close/);
});

class Storage {
    objects = new Map(); writes = [];
    async send(command) {
        const { Key, Body } = command.input;
        if (command.constructor.name === 'PutObjectCommand') { this.objects.set(Key, Buffer.from(Body).toString()); this.writes.push(Key); return {}; }
        const value = this.objects.get(Key);
        if (value == null) { const error = new Error('missing'); error.name = 'NoSuchKey'; throw error; }
        return { Body: { transformToString: async () => value } };
    }
}
const source = payload => async () => new Response(JSON.stringify(payload), { headers: { etag: 'version' } });
const config = { nav: {nav:[{symbol:'TEST', dataPaths:['data/nyse/test.json']}]}, sourceBase:'https://source.example', asOf:'2025-12-31' };

test('only derivative R2 keys are written and rejected history preserves current pointer', async () => {
    const storage = new Storage();
    const report = await refresh({ ...config, storage, bucket:'derived', fetcher:source({backtestData:makeRows()}) });
    assert.deepEqual(report.changed,['TEST']);
    assert.ok(storage.writes.every(key=>key.startsWith('thumbnail/v1/')));
    const before = storage.objects.get('thumbnail/v1/current.json');
    const writes = storage.writes.length;
    const rejected = await refresh({ ...config, storage, bucket:'derived', fetcher:source({backtestData:makeRows().slice(12)}) });
    assert.equal(rejected.rejected[0].retainedPrevious,true);
    assert.equal(storage.objects.get('thumbnail/v1/current.json'),before);
    assert.equal(storage.writes.length,writes);
    const unchanged = await refresh({ ...config, storage, bucket:'derived', fetcher:source({backtestData:makeRows()}) });
    assert.deepEqual(unchanged.unchanged,['TEST']);
    assert.equal(storage.writes.length,writes);
});

test('failed object upload cannot expose an incomplete release', async () => {
    const storage = new Storage();
    const send = storage.send.bind(storage);
    storage.send = async command => { if (command.input.Key.endsWith('/entry-efficiency.json')) throw new Error('upload failure'); return send(command); };
    const report = await refresh({ ...config, storage, bucket:'derived', fetcher:source({backtestData:makeRows()}) });
    assert.equal(report.rejected.length,1);
    assert.equal(storage.objects.has('thumbnail/v1/current.json'),false);
});

test('projection loader consumes the verified compact objects', async () => {
    const storage = new Storage();
    await refresh({ ...config, storage, bucket:'derived', fetcher:source({backtestData:makeRows()}) });
    const fetcher = async url => new Response(storage.objects.get(new URL(url).pathname.slice(1)), {status:200});
    const result = await loadProjection('TEST','https://projection.example',fetcher);
    assert.equal(result.source,'thumbnail_projection');
    assert.equal(result.price,171);
    assert.ok(result.backtestData.length <72);
});

test('Yahoo unknown ticker returns 404 and valid dotted symbols remain intact', async () => {
    await assert.rejects(loadYahooQuote('MISSING',async()=>new Response('{}',{status:404})),error=>error.statusCode===404);
    let requested;
    const result = await loadYahooQuote('005930.KS',async(url,options)=>{
        requested=url;assert.ok(options.signal);
        return new Response(JSON.stringify({chart:{result:[{meta:{regularMarketPrice:100,regularMarketTime:1767178800,exchangeTimezoneName:'Asia/Seoul',currency:'KRW'}}]}}));
    });
    assert.match(requested,/005930\.KS\?range=5d/);
    assert.equal(result.price,100);
    assert.deepEqual(result.backtestData,[]);
});

test('corrupt published projection is rejected rather than used for pricing', async () => {
    const storage = new Storage();
    await refresh({...config,storage,bucket:'derived',fetcher:source({backtestData:makeRows()})});
    const key=[...storage.objects.keys()].find(key=>key.endsWith('/summary.json'));
    const summary=JSON.parse(storage.objects.get(key));summary.tickerInfo.price=9999;
    storage.objects.set(key,JSON.stringify(summary));
    await assert.rejects(loadProjection('TEST','https://projection.example',async url=>new Response(storage.objects.get(new URL(url).pathname.slice(1)))),/hash mismatch/);
});

test('thumbnail API uses a compact projection without downloading the raw source', async () => {
    const {loadTicker}=await import('../api/thumbnail-data.js');
    const storage=new Storage();
    await refresh({...config,storage,bucket:'derived',fetcher:source({backtestData:makeRows()})});
    const requested=[];
    const ticker=await loadTicker('TEST','https://app.example',{
        projectionBaseUrl:'https://projection.example',priceDataBaseUrl:'https://source.example',asOfDate:'2025-12-31',
        fetcher:async url=>{requested.push(String(url));assert.equal(new URL(url).host,'projection.example');return new Response(storage.objects.get(new URL(url).pathname.slice(1)));},
    });
    assert.equal(ticker.tickerInfo.price,171);
    assert.equal(ticker.sourceStatus.price,'thumbnail_projection');
    assert.ok(ticker.backtestData.length<72);
});

test('source timeout retains last approved objects and pointer', async () => {
    const storage=new Storage();
    await refresh({...config,storage,bucket:'derived',fetcher:source({backtestData:makeRows()})});
    const pointer=storage.objects.get('thumbnail/v1/current.json');
    const result=await refresh({...config,storage,bucket:'derived',fetcher:async(url,options)=>{assert.ok(options.signal);throw new DOMException('timeout','TimeoutError');}});
    assert.equal(result.rejected[0].retainedPrevious,true);
    assert.equal(storage.objects.get('thumbnail/v1/current.json'),pointer);
});

test('source missing backtestData is rejected and retains the last approved objects and pointer', async () => {
    const storage=new Storage();
    await refresh({...config,storage,bucket:'derived',fetcher:source({backtestData:makeRows()})});
    const pointer=storage.objects.get('thumbnail/v1/current.json');
    const writes=storage.writes.length;
    const result=await refresh({...config,storage,bucket:'derived',fetcher:source({tickerInfo:{symbol:'TEST'}})});
    assert.deepEqual(result.rejected,[{symbol:'TEST',reason:'Source requires backtestData',retainedPrevious:true}]);
    assert.equal(storage.objects.get('thumbnail/v1/current.json'),pointer);
    assert.equal(storage.writes.length,writes);
});

test('transient source HTTP errors are retried before rejecting a symbol', async () => {
    const storage=new Storage();
    let attempts=0;
    const result=await refresh({...config,storage,bucket:'derived',fetcher:async()=>{
        attempts+=1;
        if(attempts<3)return new Response(null,{status:503});
        return new Response(JSON.stringify({backtestData:makeRows()}));
    }});
    assert.equal(attempts,3);
    assert.deepEqual(result.changed,['TEST']);
    assert.deepEqual(result.rejected,[]);
    assert.ok(storage.objects.has('thumbnail/v1/current.json'));
});

test('R2 object keys for index and currency symbols contain no URL escapes', async () => {
    const {symbolKey}=await import('../lib/thumbnail-projection.js');
    for(const symbol of ['^GSPC','EURUSD=X','005930.KS','BRK.B']) assert.match(symbolKey(symbol),/^[A-Za-z0-9_-]+$/);
});

test('bounded concurrent processing waits for every ticker before publishing a deterministic manifest', async () => {
    const nav={nav:['ZTEST','ATEST','MTEST'].map(symbol=>({symbol,dataPaths:[`data/nyse/${symbol.toLowerCase()}.json`]}))};
    const identities=[];
    for(const concurrency of [1,2]) {
        const storage=new Storage();let active=0,maxActive=0;
        const fetcher=async url=>{
            active++;maxActive=Math.max(maxActive,active);
            await new Promise(resolve=>setTimeout(resolve,String(url).includes('ztest')?15:1));
            active--;
            return new Response(JSON.stringify({backtestData:makeRows()}));
        };
        const result=await refresh({...config,nav,storage,bucket:'derived',fetcher,concurrency});
        assert.equal(result.rejected.length,0);
        assert.equal(result.changed.length,3);
        assert.equal(maxActive,concurrency);
        const pointer=JSON.parse(storage.objects.get('thumbnail/v1/current.json'));
        identities.push(pointer.releaseId);
        const manifest=JSON.parse(storage.objects.get(pointer.manifestKey));
        assert.deepEqual(Object.keys(manifest.tickers),['ATEST','MTEST','ZTEST']);
        assert.equal(storage.writes.at(-1),'thumbnail/v1/current.json');
        for(const row of Object.values(manifest.tickers))assert.ok(storage.objects.has(`${row.root}/entry-efficiency.json`));
    }
    assert.equal(identities[0],identities[1]);
});
