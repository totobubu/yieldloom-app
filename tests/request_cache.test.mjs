import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCache } from '../lib/request-cache.js';
import { loadCoreHistory } from '../lib/core-release.js';
import { sha256, jsonBytes, symbolKey } from '../lib/thumbnail-projection.js';
import { loadProjection } from '../lib/thumbnail-prices.js';

test('server loaders merge active work, isolate consumers and refresh after TTL or failure', async () => {
    let calls = 0,
        clock = 0;
    const read = createRequestCache({ now: () => clock, ttlMs: 10 });
    const loader = async () => ({ n: ++calls });
    const [a, b] = await Promise.all([
        read('same', loader),
        read('same', loader),
    ]);
    a.n = 100;
    assert.equal(b.n, 1);
    await read('same', loader);
    assert.equal(calls, 1);
    clock = 11;
    await read('same', loader);
    assert.equal(calls, 2);
    await assert.rejects(
        read('error', () => {
            throw new Error('failure');
        }),
        /failure/
    );
    assert.deepEqual(await read('error', loader), { n: 3 });
});

test('multiple core histories share one validated pointer/manifest and keep hashes checked', async () => {
    const symbols = ['AAA', 'BBB', 'CCC'];
    const events = Object.fromEntries(
        symbols.map((ticker) => [ticker, { ticker, events: [{ ticker }] }])
    );
    const pointer = {
        schemaVersion: 2,
        releaseId: 'fixture',
        manifestKey: 'core/releases/fixture/manifest.json',
    };
    const manifest = {
        schemaVersion: 2,
        releaseId: 'fixture',
        files: symbols.map((ticker) => ({
            path: `tickers/${ticker}.json`,
            sha256: sha256(jsonBytes(events[ticker])),
        })),
    };
    let calls = 0;
    const fetcher = async (url) => {
        calls++;
        return Response.json(
            url.endsWith('/current.json')
                ? pointer
                : url.endsWith('/manifest.json')
                  ? manifest
                  : events[url.split('/').at(-1).split('.')[0]]
        );
    };
    const result = await Promise.all(
        symbols.map((symbol) =>
            loadCoreHistory(symbol, 'https://fixture.test', fetcher)
        )
    );
    assert.equal(result.length, 3);
    assert.equal(calls, 5); // was 3 pointer + 3 manifest + 3 history reads.
    await Promise.all(
        symbols.map((symbol) =>
            loadCoreHistory(symbol, 'https://fixture.test', fetcher)
        )
    );
    assert.equal(calls, 5);
});

test('comparison and entry projections share one verified summary and directory', async () => {
    const summary = {
        schemaVersion: 1,
        symbol: 'AAA',
        tickerInfo: { price: 100 },
        priceDate: '2026-10-16',
    };
    const history = { symbol: 'AAA', backtestData: [] };
    const manifest = {
        schemaVersion: 1,
        tickers: {
            AAA: {
                root: `thumbnail/v1/objects/${symbolKey('AAA')}/${'a'.repeat(64)}`,
                hashes: {
                    summary: sha256(jsonBytes(summary)),
                    'entry-efficiency': sha256(jsonBytes(history)),
                    'comparison-1y': sha256(jsonBytes(history)),
                },
            },
        },
    };
    const releaseId = sha256(jsonBytes(manifest));
    const pointer = {
        schemaVersion: 1,
        releaseId,
        manifestKey: `thumbnail/v1/releases/${releaseId}/manifest.json`,
    };
    let calls = 0;
    const fetcher = async (url) => {
        calls++;
        return Response.json(
            url.endsWith('/current.json')
                ? pointer
                : url.endsWith('/manifest.json')
                  ? manifest
                  : url.endsWith('/summary.json')
                    ? summary
                    : history
        );
    };
    await Promise.all(
        ['entry-efficiency', 'comparison-1y'].map((kind) =>
            loadProjection('AAA', 'https://fixture.test', fetcher, kind)
        )
    );
    assert.equal(calls, 5); // pointer + manifest + summary + two distinct histories.
});
