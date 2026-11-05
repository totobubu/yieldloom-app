import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    shareMonthlyDividends,
    dividendMarketDate,
} from '../src/services/thumbnail/monthlyDividends.js';
import { monthlyDividendSeries } from '../src/services/stockAnalysis.js';
import { toBacktestData } from '../api/thumbnail-data.js';

const declared = (date, amount, extra = {}) => ({
    date,
    amount,
    dividendVerified: true,
    declaredDate: '2026-11-03',
    ...extra,
});

test('archived YMAX projection counts the Nov 4 ex-date declaration on Nov 3 without changing historical charts', () => {
    const events = JSON.parse(
        fs.readFileSync(
            new URL(
                './fixtures/ymax-declaration-20261103.json',
                import.meta.url
            )
        )
    ).history;
    const rows = toBacktestData(events);
    const series = shareMonthlyDividends(rows, '2026-11-03');
    assert.deepEqual(
        series.map((r) => Number(r.total?.toFixed(4))),
        [0.2973, 0.2314, 0.0528]
    );
    assert.deepEqual(
        series.map((r) => r.partial),
        [false, false, true]
    );
    assert.equal(shareMonthlyDividends(rows, '2026-11-04')[2].total, 0.0528);
    assert.equal(monthlyDividendSeries(rows, '2026-11-03', 3)[2].total, null);
    assert.equal(shareMonthlyDividends(rows, '2026-11-02')[2].total, null);
});

// Preserve the current projection policy when later captures disagree on declaration date.
// A null product value is unavailable, not a NaN amount or a fabricated zero.
test('duplicate official captures preserve the current latest-declaration cutoff', () => {
    const capture = {
        ex_date: '2026-11-04',
        declared_date: '2026-11-03',
        distribution_per_share: '0.0528',
        verification_status: 'official',
    };
    for (const events of [
        [capture, { ...capture, declared_date: '2026-11-04' }],
        [{ ...capture, declared_date: '2026-11-04' }, capture],
    ]) {
        const rows = toBacktestData(events);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].declaredDate, '2026-11-04');
        assert.equal(shareMonthlyDividends(rows, '2026-11-03')[2].total, null);
        assert.equal(
            shareMonthlyDividends(rows, '2026-11-04')[2].total,
            0.0528
        );
    }
});

test('future amount requires verified already declared evidence, never forecast, reference or review', () => {
    for (const extra of [
        { dividendVerified: false },
        { declaredDate: undefined },
        { declaredDate: '2026-11-05' },
        { declaredDate: '2026-02-30' },
        { forecasted: true },
        { isReference: true },
        { verificationStatus: 'needs_review' },
        { amountFixed: 'bad' },
        { amount: -1 },
        { amount: Infinity },
    ]) {
        assert.equal(
            shareMonthlyDividends(
                [declared('2026-11-04', 0.1, extra)],
                '2026-11-03'
            )[2].total,
            null
        );
    }
    assert.equal(
        shareMonthlyDividends([declared('2026-12-04', 0.1)], '2026-11-03')[2]
            .total,
        null
    );
});

test('duplicates count once, fixed precision wins, conflicting corrections are withheld', () => {
    const row = declared('2026-11-04', 0.1, { amountFixed: 0.12 });
    assert.equal(
        shareMonthlyDividends([row, { ...row }], '2026-11-03')[2].total,
        0.12
    );
    assert.equal(
        shareMonthlyDividends(
            [row, { ...row, amountFixed: 0.13 }],
            '2026-11-03'
        )[2].total,
        null
    );
    assert.equal(
        shareMonthlyDividends(
            [row, { ...row, dividendVerified: false, amountFixed: 99 }],
            '2026-11-04'
        )[2].total,
        0.12
    );
});

test('previous months and unrelated tickers stay isolated; missing data stays null', () => {
    const rows = [
        { date: '2026-09-05', amount: 0.2 },
        { date: '2026-10-05', amount: 0.3 },
    ];
    assert.deepEqual(
        shareMonthlyDividends(rows, '2026-11-03'),
        monthlyDividendSeries(rows, '2026-11-03', 3)
    );
    assert.equal(shareMonthlyDividends([], '2026-11-03')[2].total, null);
    assert.deepEqual(shareMonthlyDividends(rows, 'invalid'), []);
});

test('market dates handle UTC, Korean viewers, DST and year boundaries', () => {
    assert.equal(
        dividendMarketDate(new Date('2026-11-04T00:30:00Z')),
        '2026-11-03'
    );
    assert.equal(
        dividendMarketDate(new Date('2026-11-04T00:30:00Z'), 'KRW'),
        '2026-11-04'
    );
    assert.equal(
        dividendMarketDate(new Date('2027-01-01T01:00:00Z')),
        '2026-12-31'
    );
    assert.equal(
        dividendMarketDate(new Date('2026-07-01T04:00:00Z')),
        '2026-07-01'
    );
    const series = shareMonthlyDividends(
        [
            {
                date: '2027-01-05',
                amount: 0.2,
                dividendVerified: true,
                declaredDate: '2026-12-31',
            },
        ],
        '2027-01-01'
    );
    assert.deepEqual(
        series.map((r) => r.month),
        ['2026-11', '2026-12', '2027-01']
    );
    assert.equal(series[2].total, 0.2);
    assert.equal(series[2].partial, true);
});

test('existing JEPQ history retains its review status and historical monthly amounts', () => {
    const { history } = JSON.parse(
        fs.readFileSync(
            new URL(
                '../public/content-studio/distribution-ticker-jepq.json',
                import.meta.url
            )
        )
    );
    const rows = toBacktestData(history);
    assert.deepEqual(
        shareMonthlyDividends(rows, '2026-11-03'),
        monthlyDividendSeries(rows, '2026-11-03', 3)
    );
    assert.equal(rows.at(-1).verificationStatus, 'needs_review');
});
