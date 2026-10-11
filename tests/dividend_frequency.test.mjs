import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizeFrequency } from '../src/services/thumbnail/frequency.js';

test('compact core catalog index excludes product-specific frequency metadata', async () => {
    const index = JSON.parse(await fs.readFile('dist/ticker-index.json', 'utf8'));
    const schd = index.nav.find(row => row.symbol === 'SCHD');
    assert.equal(schd.frequency, undefined);
});

test('frequency aliases support legacy metadata and official event values', () => {
    for (const [input, expected] of [['분기', 'quarterly'], ['quarterly', 'quarterly'], ['매주', 'weekly'], ['weekly', 'weekly'], ['매월', 'monthly'], ['월', 'monthly'], ['반기', 'semiannual'], ['매년', 'annual']]) {
        assert.equal(normalizeFrequency(input), expected);
    }
    assert.equal(normalizeFrequency(null), null);
    assert.equal(normalizeFrequency('unknown'), null);
});
