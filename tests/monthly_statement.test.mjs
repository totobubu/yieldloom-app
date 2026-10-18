import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createMonthlyStatement,
    validateMonthlyStatement,
    parseMonthlyStatement,
    monthlyScopeHash,
    compareMonthlyStatements,
} from '../src/services/monthlyStatement.js';
import { dividendInsights } from '../src/services/portfolioInsights.js';

const scopeHash = 'a'.repeat(64);
const statement = (values = {}) => ({
    schemaVersion: 1,
    kind: 'yieldloom-monthly-dividends',
    month: '2026-08',
    asOf: '2026-09-01',
    currency: 'USD',
    scopeHash,
    accountCount: 2,
    recordCount: 2,
    unknownCount: 0,
    knownAmount: 100,
    excludedDateCount: 0,
    ...values,
});

test('uses existing dividend cancellation semantics and exports aggregates only', () => {
    const entries = [
        {
            row: {
                date: '2026-08-01',
                currency: 'USD',
                symbol: 'AAPL',
                type: 'dividend',
                amount: 30,
            },
        },
        {
            row: {
                date: '2026-08-02',
                currency: 'USD',
                symbol: 'AAPL',
                type: 'dividend_reversal',
                amount: 5,
            },
        },
    ];
    const group = dividendInsights(entries, {
        month: '2026-08',
        today: '2026-09-01',
    }).currencies[0];
    const report = createMonthlyStatement({
        group,
        month: '2026-08',
        today: '2026-09-01',
        scopeHash,
        accountCount: 2,
    });
    assert.equal(report.knownAmount, 25);
    assert.equal(report.recordCount, 2);
    const safe = validateMonthlyStatement({
        ...report,
        accountId: 'private',
        symbol: 'private',
        entries,
    });
    assert.ok(!JSON.stringify(safe).includes('private'));
    assert.ok(!('entries' in safe));
    assert.deepEqual(
        parseMonthlyStatement('\uFEFF' + JSON.stringify(report)),
        report
    );
});

test('no records, all unknown, observed zero, and partially known values stay distinct', () => {
    const empty = statement({
        recordCount: 0,
        unknownCount: 0,
        knownAmount: null,
    });
    assert.equal(validateMonthlyStatement(empty).knownAmount, null);
    assert.equal(
        validateMonthlyStatement(
            statement({ unknownCount: 2, knownAmount: null })
        ).knownAmount,
        null
    );
    assert.equal(
        validateMonthlyStatement(statement({ knownAmount: 0 })).knownAmount,
        0
    );
    assert.equal(
        validateMonthlyStatement(
            statement({ unknownCount: 1, knownAmount: 20 })
        ).knownAmount,
        20
    );
    assert.throws(
        () => validateMonthlyStatement({ ...empty, knownAmount: 0 }),
        /금액/
    );
});

test('rejects malformed, oversized, nonfinite and inconsistent files', () => {
    for (const change of [
        { schemaVersion: 2 },
        { month: '2026-13' },
        { asOf: '2026-02-30' },
        { month: '2026-10' },
        { currency: 'UNKNOWN' },
        { scopeHash: 'bad' },
        { recordCount: -1 },
        { unknownCount: 3 },
        { accountCount: 0 },
        { knownAmount: '100' },
        { knownAmount: Infinity },
        { knownAmount: null },
    ])
        assert.throws(() => validateMonthlyStatement(statement(change)));
    assert.throws(() => parseMonthlyStatement('not json'), /JSON/);
    assert.throws(() => parseMonthlyStatement(' '.repeat(32769)), /32KB/);
    assert.throws(() => parseMonthlyStatement('null'));
});

test('scope hashing ignores order but distinguishes identities, families and account sets', async () => {
    const hash = await monthlyScopeHash('u', 'f', ['b', 'a']);
    assert.equal(hash, await monthlyScopeHash('u', 'f', ['a', 'b']));
    for (const args of [
        ['v', 'f', ['a', 'b']],
        ['u', 'g', ['a', 'b']],
        ['u', 'f', ['a']],
    ])
        assert.notEqual(hash, await monthlyScopeHash(...args));
});

test('comparison requires matching scope/currency and an older month', () => {
    const current = statement({
        month: '2026-09',
        asOf: '2026-10-01',
        knownAmount: 125,
    });
    assert.deepEqual(compareMonthlyStatements(current, statement()), {
        difference: 25,
        percent: 25,
        reason: '',
    });
    assert.throws(
        () => compareMonthlyStatements(current, statement({ currency: 'KRW' })),
        /통화/
    );
    assert.throws(
        () =>
            compareMonthlyStatements(
                current,
                statement({ scopeHash: 'b'.repeat(64) })
            ),
        /계좌 범위/
    );
    assert.throws(() => compareMonthlyStatements(current, current), /이전 월/);
});

test('incomplete/current-month reports cannot claim growth, and zero/negative baseline has no percent', () => {
    const current = statement({
        month: '2026-09',
        asOf: '2026-10-01',
        knownAmount: 125,
    });
    for (const changed of [
        { asOf: '2026-09-30' },
        { unknownCount: 1 },
        { excludedDateCount: 1 },
        { recordCount: 0, unknownCount: 0, knownAmount: null },
    ]) {
        const comparison = compareMonthlyStatements(
            { ...current, ...changed },
            statement()
        );
        assert.equal(comparison.difference, null);
        assert.equal(comparison.percent, null);
        assert.ok(comparison.reason);
    }
    assert.equal(
        compareMonthlyStatements(current, statement({ asOf: '2026-08-31' }))
            .percent,
        null
    );
    for (const knownAmount of [0, -10]) {
        const comparison = compareMonthlyStatements(
            current,
            statement({ knownAmount })
        );
        assert.equal(comparison.difference, 125 - knownAmount);
        assert.equal(comparison.percent, null);
    }
});
