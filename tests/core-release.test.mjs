import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCoreHistory } from '../lib/core-release.js';
import { sha256, jsonBytes } from '../lib/thumbnail-projection.js';

const ticker = {
    ticker: 'SPYI',
    events: [
        {
            ticker: 'SPYI',
            exDate: '2026-09-16',
            amount: { raw: '0.25660', decimal: '0.25660', currency: 'USD' },
            verificationStatus: 'cross_checked',
        },
    ],
};
const pointer = {
    schemaVersion: 2,
    releaseId: 'test',
    manifestKey: 'core/releases/test/manifest.json',
};
const manifest = {
    schemaVersion: 2,
    releaseId: 'test',
    files: [{ path: 'tickers/SPYI.json', sha256: sha256(jsonBytes(ticker)) }],
};
const mock =
    (altered = ticker) =>
    async (url) =>
        new Response(
            JSON.stringify(
                String(url).endsWith('current.json')
                    ? pointer
                    : String(url).endsWith('manifest.json')
                      ? manifest
                      : altered
            )
        );

test('core consumer reads canonical release path and preserves dividend precision', async () => {
    const events = await loadCoreHistory(
        'SPYI',
        'https://core.example',
        mock()
    );
    assert.equal(events[0].amount.raw, '0.25660');
    assert.equal(events[0].verificationStatus, 'cross_checked');
});
test('core consumer rejects history corruption and returns no events for a ticker outside release', async () => {
    await assert.rejects(
        loadCoreHistory(
            'SPYI',
            'https://core.example',
            mock({ ...ticker, events: [] })
        ),
        /hash mismatch/
    );
    assert.deepEqual(
        await loadCoreHistory('MISSING', 'https://core.example', mock()),
        []
    );
});

test('index and history share the release directory and reject corrupt index data', async () => {
    const { loadCoreIndex } = await import('../lib/core-release.js');
    const index = {
        providers: ['neos'],
        tickers: [{ ticker: 'SPYI', latest: ticker.events[0] }],
    };
    const fullManifest = {
        ...manifest,
        indexPath: 'index.json',
        files: [
            ...manifest.files,
            { path: 'index.json', sha256: sha256(jsonBytes(index)) },
        ],
    };
    const calls = [];
    const fetcher = async (url) => {
        calls.push(url);
        return Response.json(
            url.endsWith('current.json')
                ? pointer
                : url.endsWith('manifest.json')
                  ? fullManifest
                  : url.endsWith('index.json')
                    ? index
                    : ticker
        );
    };
    const [directory, events] = await Promise.all([
        loadCoreIndex('https://core.example', fetcher),
        loadCoreHistory('SPYI', 'https://core.example', fetcher),
    ]);
    assert.equal(directory.tickers[0].latest.amount.raw, '0.25660');
    assert.equal(events.length, 1);
    assert.equal(calls.length, 4);
    await loadCoreIndex('https://core.example', fetcher);
    assert.equal(calls.length, 4);
    const corrupt = async (url) =>
        Response.json(
            url.endsWith('current.json')
                ? pointer
                : url.endsWith('manifest.json')
                  ? fullManifest
                  : { ...index, tickers: [] }
        );
    await assert.rejects(
        loadCoreIndex('https://core.example', corrupt),
        /hash mismatch/
    );
});

test('configured official ledger never falls back to legacy history during an outage', async () => {
    const { loadOfficialHistory, loadOfficialIndex } = await import(
        '../lib/official-dividends.js'
    );
    const calls = [];
    const fetcher = async (url) => {
        calls.push(url);
        return new Response('', { status: 503 });
    };
    await assert.rejects(
        loadOfficialHistory(
            'SPYI',
            'https://legacy.example',
            fetcher,
            'https://core.example'
        )
    );
    await assert.rejects(
        loadOfficialIndex({ base: 'https://core.example', fetcher })
    );
    assert.equal(calls.length, 2);
    assert.ok(
        calls.every((url) => url === 'https://core.example/core/current.json')
    );
});
