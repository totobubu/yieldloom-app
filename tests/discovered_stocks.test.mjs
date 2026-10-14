import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDiscoveredStocks } from '../lib/discovered-stocks.js';
import { createTickerIndex } from '../scripts/publicAssets.mjs';

const stock = {
    symbol: 'AAON', market: 'NASDAQ', currency: 'USD', securityType: 'stock',
    longName: 'AAON, Inc.', dividendEtfs: [{ ticker: 'DGRO' }],
    dividendEvidence: { source: 'Yahoo Finance', latestExDate: '2026-10-01', latestAmount: 0.1 },
};
const catalog = { schemaVersion: 1, instruments: [stock] };

test('new verified stock appears in index with stock type, name, and ETF provenance', () => {
    const index = createTickerIndex({ instruments: [{ symbol: 'SCHD', market: 'NYSE' }] }, {}, catalog);
    assert.equal(index.nav.length, 2);
    assert.equal(index.nav[1].securityType, 'stock');
    assert.equal(index.nav[1].longName, 'AAON, Inc.');
    assert.equal(index.nav[1].dividendEtfs[0].ticker, 'DGRO');
});

test('overlay preserves existing metadata, aliases, and inactive state without duplicates', () => {
    const rows = [{ symbol: 'AAON', isin: 'US123', koName: '에이온', longName: 'Core name' },
                  { symbol: 'BRK.B', market: 'NYSE', active: false }];
    const merged = mergeDiscoveredStocks(rows, { schemaVersion: 1,
        instruments: [stock, { ...stock, symbol: 'BRK-B' }] });
    assert.equal(merged.length, 2);
    assert.equal(merged[0].isin, 'US123');
    assert.equal(merged[0].koName, '에이온');
    assert.equal(merged[0].longName, 'Core name');
    assert.equal(merged[0].securityType, 'stock');
    assert.equal(merged[1].active, false);
    assert.equal(merged[1].symbol, 'BRK.B');
});

test('invalid catalog or missing dividend evidence cannot create stocks', () => {
    assert.deepEqual(mergeDiscoveredStocks([], { instruments: [stock] }), []);
    assert.deepEqual(mergeDiscoveredStocks([], { schemaVersion: 1, instruments: [
        { ...stock, dividendEvidence: null }, { ...stock, currency: 'GBP' },
        { ...stock, securityType: 'etf' }, { ...stock, symbol: '../bad' },
    ] }), []);
});
