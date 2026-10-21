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
