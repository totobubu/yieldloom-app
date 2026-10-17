import test from 'node:test';
import assert from 'node:assert/strict';
import {
    loadDataReleaseIndex,
    loadDataReleaseHistory,
} from '../src/services/dataRelease.js';

const event = {
    eventId: 1,
    provider: 'fixture',
    ticker: 'AAA',
    amount: { raw: '0.123400', currency: 'USD' },
    source: { url: 'https://fixture.test' },
    verificationStatus: 'official',
};
const pointer = {
    schemaVersion: 2,
    releaseId: 'a',
    manifestKey: 'core/releases/a/manifest.json',
};
const manifest = { schemaVersion: 2, releaseId: 'a', indexPath: 'index.json' };
const index = {
    providers: ['fixture'],
    tickers: [
        {
            ticker: 'AAA',
            provider: 'fixture',
            latest: event,
            historyPath: 'tickers/AAA.json',
            historyCount: 1,
        },
    ],
};

test('public release consumers share pointer, manifest, index and ticker history without rounding', async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = original;
    });
    let calls = 0;
    globalThis.fetch = async (url) => {
        calls++;
        return Response.json(
            url.endsWith('/current.json')
                ? pointer
                : url.endsWith('/manifest.json')
                  ? manifest
                  : url.endsWith('/index.json')
                    ? index
                    : { ticker: 'AAA', events: [event] }
        );
    };
    const [a, b] = await Promise.all([
        loadDataReleaseIndex(),
        loadDataReleaseIndex(),
    ]);
    assert.equal(calls, 3);
    const [first, second] = await Promise.all([
        loadDataReleaseHistory(a.tickers[0].historyUrl),
        loadDataReleaseHistory(b.tickers[0].historyUrl),
    ]);
    assert.equal(calls, 4);
    assert.equal(first.history[0].distribution_per_share, '0.123400');
    second.history[0].distribution_per_share = 'changed';
    assert.equal(
        (await loadDataReleaseHistory(a.tickers[0].historyUrl)).history[0]
            .distribution_per_share,
        '0.123400'
    );
    await loadDataReleaseIndex();
    assert.equal(calls, 4);
});

test('invalid release pointer is not cached and a corrected release is immediately retryable', async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = original;
    });
    let calls = 0;
    globalThis.fetch = async (url) => {
        calls++;
        return Response.json(
            calls === 1
                ? { schemaVersion: 0 }
                : url.endsWith('/current.json')
                  ? pointer
                  : url.endsWith('/manifest.json')
                    ? manifest
                    : index
        );
    };
    await assert.rejects(loadDataReleaseIndex());
    assert.equal((await loadDataReleaseIndex()).tickers.length, 1);
    assert.equal(calls, 4);
});
