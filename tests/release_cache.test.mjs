import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseCacheOptions } from '../src/services/releaseCache.js';

test('long caching is restricted to immutable public release paths', () => {
    for (const url of [
        '/core/releases/one/manifest.json',
        'https://data.test/prefix/datasets/holdings/releases/one/entities/a.json',
    ]) {
        const options = releaseCacheOptions(url, { force: true });
        assert.equal(options.cachePolicy, 'immutable');
        assert.equal(options.ttlMs, 86_400_000);
        assert.equal(options.force, false);
    }
    for (const url of [
        '/core/current.json',
        '/api/family/ledger',
        '/data/AAPL.json',
        '/core/releases/../current.json',
        '/core/releases/one/a.json?query=1',
    ]) {
        const options = releaseCacheOptions(url, { force: true });
        assert.equal(options.cachePolicy, 'memory');
        assert.equal(options.ttlMs, 60_000);
        assert.equal(options.force, true);
    }
});
