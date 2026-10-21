import test from 'node:test';
import assert from 'node:assert/strict';
import {
    similarProducts,
    themeProducts,
    comparisonThemes,
} from '../lib/comparison-groups.js';
import {
    underlyingProducts,
    comparisonProducts,
} from '../lib/underlying-comparison.js';

test('similar ETFs match known strategy, direction and leverage; same underlying comes first', () => {
    const base = {
        symbol: 'BASE',
        underlying: 'AAPL',
        strategy: 'leveraged',
        direction: 'long',
        leverage: 1,
    };
    const other = { ...base, symbol: 'AAA', underlying: 'NVDA' };
    const same = { ...base, symbol: 'ZZZ' };
    const rows = [
        base,
        other,
        same,
        { ...base, symbol: 'INVERSE', direction: 'inverse' },
        { ...base, symbol: 'DOUBLE', leverage: 2 },
        { ...base, symbol: 'LEVERAGED', strategy: 'income' },
        { ...base, symbol: 'UNKNOWN', leverage: null },
    ];
    assert.deepEqual(
        similarProducts(rows, base).map((row) => row.symbol),
        ['ZZZ', 'AAA']
    );
    assert.deepEqual(
        similarProducts(rows, { ...base, strategy: 'unknown' }),
        []
    );
    assert.deepEqual(
        similarProducts(rows, { ...base, direction: 'unknown' }),
        []
    );
    assert.deepEqual(similarProducts(rows, { ...base, leverage: null }), []);
    assert.deepEqual(similarProducts(rows, null), []);
    assert.deepEqual(similarProducts(rows, { symbol: 'NO_METADATA' }), []);
    const income = { ...base, strategy: 'income', leverage: null };
    assert.equal(
        similarProducts([income, { ...income, symbol: 'OTHER' }], income)
            .length,
        1,
        'Income funds need not declare a daily leverage target'
    );
});

test('M7 includes both Alphabet share classes and excludes unrelated ETFs', () => {
    const rows = ['AAPL', 'GOOGL', 'GOOG', 'NVDA', 'AMD', 'SPY'].map(
        (underlying) => ({ symbol: `${underlying}-ETF`, underlying })
    );
    assert.deepEqual(
        themeProducts(rows, comparisonThemes[0]).map((row) => row.underlying),
        ['AAPL', 'GOOGL', 'GOOG', 'NVDA']
    );
    assert.deepEqual(
        themeProducts(rows, comparisonThemes[1]).map((row) => row.underlying),
        ['NVDA', 'AMD']
    );
    assert.deepEqual(themeProducts(rows, null), []);
});

test('shared card metadata preserves missing dividend state and verified connections', () => {
    const rows = [
        { symbol: 'APLY', underlying: 'AAPL' },
        { symbol: 'AAPL' },
        { symbol: 'LEGACY', underlying: 'AAPL' },
    ];
    assert.equal(comparisonProducts(rows, null)[0].dividend, null);
    const products = underlyingProducts(rows, 'AAPL', null);
    assert.deepEqual(
        products.map((row) => row.symbol),
        ['APLY', 'LEGACY']
    );
    assert.equal(products[0].verified, true);
    assert.equal(products[1].verified, false);
    assert.equal(products[1].strategy, 'unknown');
});
