import test from 'node:test';
import assert from 'node:assert/strict';
import {
    dividendInsights,
    assetConcentration,
    dividendGoal,
    dividendReduction,
} from '../src/services/portfolioInsights.js';

const entry = (
    id,
    symbol,
    amount,
    date = '2026-09-10',
    type = 'dividend',
    currency = 'USD',
    accountId = 'a'
) => ({ id, accountId, row: { symbol, amount, date, type, currency } });
const analyze = (entries, month = '2026-09') =>
    dividendInsights(entries, { month, today: '2026-10-16' });

test('dividends and reversals net by symbol across accounts while currencies remain separate', () => {
    const entries = [
        entry('a', 'TSLY', 100),
        entry('b', 'TSLY', 20, undefined, 'dividend_reversal'),
        entry('c', 'TSLY', 30, undefined, undefined, undefined, 'b'),
        entry('d', 'NVDY', 40),
        entry('e', 'KR', 1000, undefined, undefined, 'KRW'),
        entry('f', 'A', 999, undefined, 'buy'),
    ];
    const group = analyze(entries).currencies.find((g) => g.currency === 'USD');
    assert.equal(group.year.amount, 150);
    assert.equal(group.current.count, 4);
    assert.equal(group.contributions.rows[0].label, 'TSLY');
    assert.equal(group.contributions.rows[0].amount, 110);
    assert.equal(
        analyze(entries).currencies.find((g) => g.currency === 'KRW').current
            .amount,
        1000
    );
    assert.equal(group.contributions.topThree, 100);
});

test('no observations stay unknown while observed zero is preserved, and incomplete amounts suppress goal/growth/scenario', () => {
    const zero = analyze([
        entry('a', 'A', 10),
        entry('b', 'A', 10, undefined, 'dividend_reversal'),
    ]).currencies[0];
    assert.equal(zero.current.amount, 0);
    assert.equal(zero.months[0].amount, null);
    assert.equal(zero.contributions.topThree, null);
    assert.equal(dividendGoal(zero, 10), 0);
    const group = analyze([
        entry('a', 'A', null),
        entry('b', 'B', 10),
        entry('c', 'B', 2, '2025-09-01'),
    ]).currencies[0];
    assert.equal(group.year.unknown, 1);
    assert.equal(group.year.amount, 10);
    assert.equal(
        group.contributions.rows.find((r) => r.label === 'A').amount,
        null
    );
    assert.equal(group.yearOverYear, null);
    assert.equal(dividendGoal(group, 10), null);
    assert.equal(dividendReduction(group, 'B', 20), null);
});

test('comparison uses the same completed month and does not compare partial current month', () => {
    const entries = [
        entry('a', 'A', 20),
        entry('b', 'A', 10, '2025-09-01'),
        entry('c', 'A', 50, '2026-10-01'),
        entry('d', 'A', 25, '2025-10-01'),
    ];
    assert.equal(analyze(entries).currencies[0].yearOverYear, 100);
    assert.equal(analyze(entries).currencies[0].year.amount, 20);
    assert.equal(analyze(entries, '2026-10').currencies[0].yearOverYear, null);
    assert.equal(analyze(entries, '2026-10').currencies[0].year.amount, 70);
});

test('invalid/future dates are counted as excluded, non-dividend transactions are ignored', () => {
    const report = analyze([
        entry('a', 'A', 1, '2026-02-30'),
        entry('b', 'A', 1, '2026-10-17'),
        entry('c', 'A', 1, null),
        entry('d', 'A', 1, '2026-09-10', 'buy'),
    ]);
    assert.equal(report.rejected, 3);
    assert.deepEqual(report.currencies, []);
    assert.throws(() => analyze([], '2026-11'), /분석 월/);
    assert.throws(() => analyze([], '2026-13'), /분석 월/);
});

test('negative net symbols are visible and excluded from the positive concentration denominator', () => {
    const group = analyze([
        entry('a', 'A', 10),
        entry('b', 'B', 30, undefined, 'dividend_reversal'),
        entry('c', 'C', 20),
    ]).currencies[0];
    assert.equal(group.current.amount, 0);
    assert.equal(group.contributions.negativeGroups, 1);
    assert.equal(group.contributions.positiveTotal, 30);
    assert.equal(
        group.contributions.rows.find((r) => r.label === 'B').amount,
        -30
    );
    assert.equal(
        group.contributions.rows.find((r) => r.label === 'B').share,
        0
    );
    assert.equal(group.contributions.topThree, 100);
});

test('top three dividend dependence reflects all positive symbols without double counting accounts', () => {
    const group = analyze(
        ['A', 'B', 'C', 'D'].map((symbol, i) => entry(String(i), symbol, 25))
    ).currencies[0];
    assert.equal(group.contributions.topThree, 75);
    assert.equal(dividendGoal(group, 200), 50);
    assert.equal(dividendGoal(group, 0), null);
    assert.equal(dividendGoal(group, null), null);
    assert.deepEqual(dividendReduction(group, 'A', 20), {
        decrease: 5,
        after: 95,
    });
    assert.equal(dividendReduction(group, 'A', 101), null);
    assert.equal(dividendReduction(group, 'MISSING', 20), null);
});

test('unknown currencies cannot be used as monetary goals or scenarios', () => {
    const group = analyze([entry('a', 'A', 10, undefined, undefined, null)])
        .currencies[0];
    assert.equal(group.currency, 'UNKNOWN');
    assert.equal(dividendGoal(group, 10), null);
    assert.equal(dividendReduction(group, 'A', 20), null);
});

test('asset grouping sums identical instruments, combines mapped underlying groups and keeps unclassified instruments separate', () => {
    const p = (symbol, amount, currency = 'USD', asOf = '2026-10-01') => ({
        symbol,
        amount,
        currency,
        asOf,
    });
    const groups = assetConcentration(
        [
            p('TSLY', 100),
            p('TSLY', 50),
            p('CRSH', 50),
            p('X', 50),
            p('Y', 50),
            p('BAD', null),
            p('NEG', -10),
            p('CASH', 999),
            p('KR', 1000, 'KRW', '2026-10-02'),
        ],
        {
            TSLY: { provider: 'YieldMax', underlying: 'TSLA' },
            CRSH: { provider: 'YieldMax', underlying: 'TSLA' },
        }
    );
    const group = groups.find((g) => g.currency === 'USD');
    assert.equal(group.total, 300);
    assert.equal(group.excluded, 2);
    assert.equal(
        group.symbols.rows.find((r) => r.label === 'TSLY').amount,
        150
    );
    assert.equal(
        group.underlyings.rows.find((r) => r.label === 'TSLA').amount,
        200
    );
    assert.equal(
        group.providers.rows.find((r) => r.label === 'YieldMax').amount,
        200
    );
    assert.ok(group.underlyings.rows.some((r) => r.label === '미분류 · X'));
    assert.ok(group.underlyings.rows.some((r) => r.label === '미분류 · Y'));
    assert.equal(group.unknownUnderlying, 2);
    assert.equal(groups.find((g) => g.currency === 'KRW').total, 1000);
    assert.equal(group.symbols.topThree, (250 / 300) * 100);
});

test('unavailable asset amounts never become zero, and mixed dates are retained', () => {
    const missing = assetConcentration([
        { symbol: 'A', amount: null, currency: 'USD' },
    ])[0];
    assert.equal(missing.total, null);
    assert.equal(missing.symbols.topThree, null);
    assert.equal(missing.excluded, 1);
    const group = assetConcentration([
        { symbol: 'A', amount: 0, currency: 'USD', asOf: '2026-09-01' },
        { symbol: 'B', amount: 10, currency: 'USD', asOf: '2026-10-01' },
    ])[0];
    assert.equal(group.total, 10);
    assert.equal(group.dates.length, 2);
});
