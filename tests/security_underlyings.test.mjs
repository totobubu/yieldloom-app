import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyVerifiedUnderlyings,
    verifiedUnderlying,
} from '../lib/security-underlyings.js';
import { createTickerIndex } from '../scripts/publicAssets.mjs';
import { catalogEntry, rivalOptions } from '../api/thumbnail-data.js';

test('all registered Apple single-stock ETFs expose AAPL across directory sources', () => {
    for (const symbol of ['AAPB', 'AAPD', 'AAPU', 'AAPY', 'APLY']) {
        assert.equal(verifiedUnderlying(symbol)?.underlying, 'AAPL', symbol);
        const rows = [{ symbol, company: 'issuer' }];
        assert.equal(applyVerifiedUnderlyings(rows)[0].underlying, 'AAPL');
        assert.equal(
            createTickerIndex({ instruments: rows }).nav[0].underlying,
            'AAPL'
        );
        assert.equal(rows[0].underlying, undefined);
        assert.equal(catalogEntry(symbol).underlying, 'AAPL');
    }
});

test('verified search links do not automatically expand curated rivals', () => {
    const entry = catalogEntry('AAPU');
    assert.equal(entry.comparisonEligible, false);
    assert.deepEqual(rivalOptions(entry), []);
    assert.ok(!rivalOptions(catalogEntry('APLY')).includes('AAPU'));
    assert.equal(catalogEntry('CWY').underlying, 'CRWV');
    assert.ok(!rivalOptions(catalogEntry('CWY')).includes('CRWL'));
});

test('invalid, provisional and self-referencing evidence cannot overlay a directory', () => {
    const valid = structuredClone(verifiedUnderlying('AAPY'));
    for (const row of [
        { ...valid, verificationStatus: 'candidate' },
        { ...valid, underlying: 'AAPY' },
        { ...valid, evidence: { url: 'https://example.test' } },
        {
            ...valid,
            evidence: { ...valid.evidence, url: 'https://example.test/fake' },
        },
        { ...valid, symbol: 'OTHER' },
    ]) {
        const registry = { schemaVersion: 1, instruments: { AAPY: row } };
        const rows = [{ symbol: 'AAPY', underlying: 'existing' }];
        assert.equal(verifiedUnderlying('AAPY', registry), null);
        assert.deepEqual(applyVerifiedUnderlyings(rows, registry), rows);
    }
});

test('basket/index titles are not registered as similarly named stocks', () => {
    for (const symbol of ['KMEM', 'COMB', 'LCTO', 'FEPI']) {
        assert.equal(verifiedUnderlying(symbol), null, symbol);
    }
});
