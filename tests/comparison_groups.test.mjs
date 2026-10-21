import test from 'node:test';
import assert from 'node:assert/strict';
import {
    themeMatch,
    themeProducts,
    comparisonThemes,
} from '../lib/comparison-groups.js';
import {
    underlyingProducts,
    comparisonProducts,
} from '../lib/underlying-comparison.js';

test('themes match fund names without classifying by issuer names', () => {
    const finance = comparisonThemes.find((row) => row.value === 'finance');
    const travel = comparisonThemes.find((row) => row.value === 'travel');
    assert.equal(
        themeMatch({ koName: '글로벌 금융 ETF' }, finance).kind,
        'name'
    );
    assert.equal(
        themeMatch({ koName: '국채 ETF', company: 'Financial Bank' }, finance),
        null
    );
    assert.equal(themeMatch({ underlying: 'ABNB' }, travel).kind, 'underlying');
    assert.ok(themeMatch({ longName: 'Airlines ETF' }, travel));
    assert.equal(themeMatch({ longName: 'Semiconductor ETF' }, travel), null);
});
test('theme keywords exclude aerospace travel and issuer bank names', () => {
    const travel = comparisonThemes.find((row) => row.value === 'travel');
    const finance = comparisonThemes.find((row) => row.value === 'finance');
    assert.equal(
        themeMatch({ koName: '디렉시온 항공우주 방산 3배 ETF' }, travel),
        null
    );
    assert.equal(
        themeMatch({ koName: '뉴욕 멜론은행 핵심 채권 ETF' }, finance),
        null
    );
    assert.ok(themeMatch({ koName: '미국 은행 ETF' }, finance));
    assert.ok(themeMatch({ koName: 'US 글로벌 항공 ETF' }, travel));
});

test('dividend availability distinguishes known none from missing history', () => {
    const products = comparisonProducts([
        { symbol: 'NONE', noDividends: true, frequency: 'monthly' },
        { symbol: 'MISSING' },
        {
            symbol: 'PAYER',
            dividendEvidence: { latestAmount: 0.5 },
            frequency: 'monthly',
        },
    ]);
    assert.equal(products[0].dividendStatus, 'none');
    assert.equal(products[0].frequency, '해당 없음');
    assert.equal(products[1].dividendStatus, 'unavailable');
    assert.equal(products[2].dividendStatus, 'available');
    assert.equal(products[2].frequency, '매월');
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

test('theme constituents include actual stocks first and do not match unrelated stock names', () => {
    const m7 = comparisonThemes.find((row) => row.value === 'm7');
    const faang = comparisonThemes.find((row) => row.value === 'faang');
    const rows = comparisonProducts([
        { symbol: 'AAPU', securityType: 'etf', underlying: 'AAPL' },
        { symbol: 'NFLX', securityType: 'stock', noDividends: true },
        {
            symbol: 'AAPL',
            securityType: 'stock',
            dividendEvidence: { latestAmount: 0.26 },
        },
        {
            symbol: 'UNRELATED',
            securityType: 'stock',
            longName: 'M7 FAANG company',
        },
    ]);
    assert.deepEqual(
        themeProducts(rows, m7).map((row) => row.symbol),
        ['AAPL', 'AAPU']
    );
    assert.deepEqual(
        themeProducts(rows, faang).map((row) => row.symbol),
        ['AAPL', 'NFLX', 'AAPU']
    );
    const apple = themeProducts(rows, m7)[0];
    assert.equal(apple.strategy, 'underlying-stock');
    assert.equal(apple.direction, 'long');
    assert.equal(apple.leverage, null);
    assert.equal(apple.verified, false);
    assert.equal(apple.dividend, 0.26);
    assert.equal(themeMatch(apple, m7).kind, 'constituent');
    assert.equal(
        rows.find((row) => row.symbol === 'NFLX').dividendStatus,
        'none'
    );
});
