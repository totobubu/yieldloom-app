import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createPublicJsonClient,
    publicRequestCredentials,
} from '../src/services/publicJson.js';
import { loadStockPrices } from '../src/services/stockPrices.js';
import { loadValuationQuotes } from '../src/services/portfolioValuation.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
};

test('public requests share active work, reuse bounded results, expire and force refresh', async () => {
    let calls = 0,
        clock = 0;
    const read = createPublicJsonClient({
        now: () => clock,
        fetcher: async (_url, options) => {
            assert.equal(options.credentials, 'same-origin');
            assert.equal(options.referrerPolicy, 'no-referrer');
            assert.equal(options.headers, undefined);
            calls++;
            return Response.json({ nested: { amount: calls } });
        },
    });
    const [a, b] = await Promise.all([read('/public'), read('/public')]);
    a.nested.amount = 999;
    assert.equal(b.nested.amount, 1);
    assert.equal((await read('/public')).nested.amount, 1);
    assert.equal(calls, 1);
    clock = 60_001;
    await read('/public');
    await read('/public', { force: true });
    assert.equal(calls, 3);
    assert.equal(read.metrics().sharedRequests, 1);
});

test('same-origin public assets keep preview authentication while external URLs omit credentials', () => {
    const origin = 'https://yieldloom-app-git-work.example.vercel.app';
    assert.equal(
        publicRequestCredentials('/ticker-index.json', origin),
        'same-origin'
    );
    assert.equal(
        publicRequestCredentials('ticker-index.json', origin),
        'same-origin'
    );
    assert.equal(
        publicRequestCredentials(`${origin}/ticker-index.json`, origin),
        'same-origin'
    );
    assert.equal(
        publicRequestCredentials(
            'https://public-data.example/ticker-index.json',
            origin
        ),
        'omit'
    );
    assert.equal(
        publicRequestCredentials('https://public-data.example/file.json'),
        'omit'
    );
});

test('cancelling one consumer keeps another alive; last cancellation cannot populate cache', async () => {
    let calls = 0,
        transport;
    const wait = deferred();
    const read = createPublicJsonClient({
        fetcher: async (_url, { signal }) => {
            transport = signal;
            calls++;
            await wait.promise;
            return Response.json({ ok: true });
        },
    });
    const controller = new AbortController();
    const first = read('/public', { signal: controller.signal });
    const second = read('/public');
    await tick();
    controller.abort();
    await assert.rejects(first, { name: 'AbortError' });
    assert.equal(transport.aborted, false);
    wait.resolve();
    await second;
    assert.equal(calls, 1);

    read.clear();
    const c = new AbortController();
    c.abort();
    await assert.rejects(read('/public', { signal: c.signal }), {
        name: 'AbortError',
    });
    assert.equal(read.metrics().entries, 0);
});

test('HTTP and schema failures are retryable and never retained', async () => {
    let calls = 0;
    const read = createPublicJsonClient({
        fetcher: async () => {
            calls++;
            return calls === 1
                ? Response.json({}, { status: 503 })
                : Response.json({ valid: calls > 2 });
        },
    });
    await assert.rejects(read('/public'), (e) => e.status === 503);
    await assert.rejects(read('/public', { validate: (p) => p.valid }), /형식/);
    assert.deepEqual(await read('/public', { validate: (p) => p.valid }), {
        valid: true,
    });
    assert.equal(calls, 3);
});

test('late responses from before force or clear cannot overwrite the new cache', async () => {
    const wait = deferred();
    let calls = 0;
    const read = createPublicJsonClient({
        fetcher: async () => {
            const value = ++calls;
            if (value === 1) await wait.promise;
            return Response.json({ value });
        },
    });
    const old = read('/public');
    await tick();
    assert.equal((await read('/public', { force: true })).value, 2);
    wait.resolve();
    await old;
    assert.equal((await read('/public')).value, 2);
    read.clear();
    assert.equal((await read('/public')).value, 3);
});

test('public response counts and memory are bounded by both keys and payload size', async () => {
    let calls = 0;
    const read = createPublicJsonClient({
        maxEntries: 2,
        maxChars: 40,
        fetcher: async () => {
            calls++;
            return Response.json({ text: 'x'.repeat(15) });
        },
    });
    await read('/one');
    await read('/two');
    await read('/three');
    assert.ok(read.metrics().chars <= 40);
    assert.ok(read.metrics().entries <= 2);
    await read('/one');
    assert.equal(calls, 4);
});

test('chart and portfolio valuation share the same public price response', async () => {
    let calls = 0;
    const fetcher = async () => {
        calls++;
        return Response.json({
            symbol: 'AAPL',
            currency: 'USD',
            candles: [{ date: '2026-10-16', close: 100 }],
            events: [],
        });
    };
    const [chart, valuation] = await Promise.all([
        loadStockPrices('aapl', { fetcher }),
        loadValuationQuotes(['AAPL'], { fetcher }),
    ]);
    assert.equal(chart.candles.length, 1);
    assert.equal(valuation.quotes.AAPL.price, 100);
    assert.equal(calls, 1);
    await loadValuationQuotes(['AAPL'], { fetcher });
    assert.equal(calls, 1);
    await loadValuationQuotes(['AAPL'], { fetcher, force: true });
    assert.equal(calls, 2);
});

test('one subscriber timing out does not expire another subscriber or cache invalid payloads', async () => {
    const wait = deferred();
    const read = createPublicJsonClient({
        fetcher: async () => {
            await wait.promise;
            return Response.json({ ok: true });
        },
    });
    const fast = assert.rejects(read('/public', { timeoutMs: 5 }), {
        name: 'TimeoutError',
    });
    const slow = read('/public', { timeoutMs: 1000 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await fast;
    wait.resolve();
    assert.deepEqual(await slow, { ok: true });
    await assert.rejects(
        read('/public', { validate: () => undefined }),
        /형식/
    );
    assert.equal(read.metrics().entries, 0);
});
