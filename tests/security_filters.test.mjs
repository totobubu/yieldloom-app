import test from 'node:test';
import assert from 'node:assert/strict';
import { inferSecurityType, matchesProductType, topProviders } from '../lib/security-filters.js';
import { createTickerIndex } from '../scripts/publicAssets.mjs';

const stock = { symbol: 'MSFT', securityType: 'stock', dividendEvidence: { latestAmount: 0.9 }, dividendEtfs: [{ ticker: 'DGRO' }, { ticker: 'VYM' }] };

test('product styles overlap while stocks and ETFs remain distinct', () => {
    for (const type of ['stock', 'dividend-stock', 'growth-stock', 'dividend-growth-stock', 'high-dividend-stock']) {
        assert.equal(matchesProductType(stock, type), true, type);
    }
    for (const type of ['etf', 'dividend-etf', 'leveraged-etf']) assert.equal(matchesProductType(stock, type), false, type);
    assert.equal(matchesProductType({ symbol: 'TSLA', securityType: 'stock', noDividends: true }, 'growth-stock'), true);
    assert.equal(matchesProductType({ symbol: 'TSLA', securityType: 'stock', noDividends: true }, 'dividend-stock'), false);
    assert.equal(matchesProductType({ symbol: 'UNKNOWN', securityType: 'stock' }, 'growth-stock'), false);
});

test('dividend and leverage filters use evidence, names and explicit exclusions', () => {
    assert.equal(matchesProductType({ securityType: 'etf' }, 'dividend-etf', { distribution_per_share: '0.2' }), true);
    assert.equal(matchesProductType({ securityType: 'etf', koName: '배당 ETF' }, 'dividend-etf'), true);
    assert.equal(matchesProductType({ securityType: 'etf', noDividends: true, frequency: '분기' }, 'dividend-etf', { distribution_per_share: 1 }), false);
    assert.equal(matchesProductType({ securityType: 'stock', dividendEvidence: { latestAmount: 'NaN' } }, 'dividend-stock'), false);
    assert.equal(matchesProductType({ securityType: 'stock', dividendEtfs: [{ ticker: 'VIG' }] }, 'dividend-growth-stock'), false);
    for (const name of ['QQQ 3배 ETF', 'Daily 2X Bull ETF', 'UltraPro QQQ', '레버리지 ETF']) {
        assert.equal(matchesProductType({ securityType: 'etf', longName: name }, 'leveraged-etf'), true, name);
    }
    assert.equal(matchesProductType({ securityType: 'etf', longName: 'S&P 500 ETF' }, 'leveraged-etf'), false);
});

test('stock inference and search-index creation preserve filter metadata', () => {
    assert.equal(inferSecurityType({ symbol: 'TSLA', market: 'NASDAQ' }), 'stock');
    assert.equal(inferSecurityType({ koName: '지수 ETF' }), 'etf');
    assert.equal(inferSecurityType({ officialProvider: 'Vanguard' }), 'etf');
    assert.equal(inferSecurityType({ securityType: 'stock', company: 'A company' }), 'stock');
    const index = createTickerIndex({ instruments: [{ symbol: 'TSLA', noDividends: true }, { symbol: 'SCHD', officialProvider: 'Schwab', frequency: '분기', ipoDate: '2011-10-20' }] });
    assert.equal(index.nav[0].securityType, 'stock');
    assert.equal(index.nav[0].noDividends, true);
    assert.equal(index.nav[1].securityType, 'etf');
    assert.equal(index.nav[1].frequency, undefined);
    assert.ok(index.nav[1].productTypes.includes('dividend-etf'));
    assert.equal(index.nav[1].ipoDate, '2011-10-20');
});

test('provider shortcuts rank active ETFs by count with deterministic ties', () => {
    const rows = ['B', 'A', 'B', 'C', 'C', 'C', 'D', 'E', 'F'].map((company, index) => ({ company, symbol: `ETF${index}`, securityType: 'etf' }));
    rows.push({ company: 'F', securityType: 'etf', active: false }, { company: 'F', securityType: 'stock' });
    assert.deepEqual(topProviders(rows).map(row => row.name), ['C', 'B', 'A', 'D', 'E']);
    assert.equal(topProviders(rows)[0].count, 3);
    assert.deepEqual(topProviders([]), []);
});

test('holding history includes current and former holdings across product types', () => {
    const states = new Map([['MSFT', 'current'], ['SCHD', 'historical']]);
    assert.equal(matchesProductType(stock, 'holding-history', undefined, states), true);
    assert.equal(matchesProductType({ symbol: ' schd ', securityType: 'etf' }, 'holding-history', undefined, states), true);
    assert.equal(matchesProductType({ symbol: 'TSLA' }, 'holding-history', undefined, states), false);
    assert.equal(matchesProductType(stock, 'holding-history'), false);
    assert.equal(matchesProductType(stock, '', undefined, states), true);
});
