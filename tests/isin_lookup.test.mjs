import test from 'node:test';
import assert from 'node:assert/strict';
import { combineIsinResults, createIsinLookup } from '../lib/isin-lookup.js';
const isin = 'US35953D4016';
const figi = [
    {
        ticker: 'FUBO',
        figi: 'BBG002CV4Q74',
        name: 'FUBOTV INC',
        marketSector: 'Equity',
        exchCode: 'US',
    },
];
const yahoo = [{ symbol: 'FUBO', shortname: 'FuboTV', quoteType: 'EQUITY' }];
test('exact ISIN plus independent Yahoo agreement is a cross-checked match', () => {
    const r = combineIsinResults(isin, figi, yahoo);
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].crossChecked, true);
    assert.equal(r.candidates[0].canonicalIsin, isin);
    assert.equal(r.candidates[0].sources.length, 2);
});
test('Yahoo-only or disagreeing or ambiguous results are never called verified', () => {
    for (const r of [
        combineIsinResults(isin, [], yahoo),
        combineIsinResults(isin, figi, [
            { symbol: 'OTHER', quoteType: 'EQUITY' },
        ]),
        combineIsinResults(
            isin,
            [...figi, { ...figi[0], ticker: 'OTHER' }],
            yahoo
        ),
    ])
        assert.ok(r.candidates.every((c) => !c.crossChecked));
});
test('lookups use fixed hosts, exact ISIN identifiers, cache success, and reject malformed IDs', async () => {
    const calls = [];
    const lookup = createIsinLookup({
        fetcher: async (url, options) => {
            calls.push([url, options]);
            return {
                ok: true,
                json: async () =>
                    url.includes('openfigi')
                        ? [{ data: figi }]
                        : { quotes: yahoo },
            };
        },
    });
    const r = await lookup(isin);
    assert.equal(r.candidates[0].crossChecked, true);
    await lookup(isin);
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[0][1].body), [
        { idType: 'ID_ISIN', idValue: isin, exchCode: 'US' },
    ]);
    await assert.rejects(lookup('https://invalid'), /ISIN/);
});
test('provider outage returns an unverified candidate and an explicit partial status', async () => {
    const lookup = createIsinLookup({
        fetcher: async (url) => {
            if (url.includes('openfigi')) throw new Error('timeout');
            return { ok: true, json: async () => ({ quotes: yahoo }) };
        },
    });
    const r = await lookup(isin);
    assert.equal(r.statuses.openfigi, 'unavailable');
    assert.equal(r.candidates[0].crossChecked, false);
});
