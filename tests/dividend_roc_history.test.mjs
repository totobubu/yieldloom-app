import assert from 'node:assert/strict';
import test from 'node:test';
import {
    dividendRocHistory,
    monthlyDividendRocSummary,
} from '../lib/dividend-roc-history.js';
const base = {
    scope: 'payment',
    classificationStatus: 'unclassified',
    currency: 'USD',
    exDate: '2026-10-15',
    payableDate: '2026-10-16',
    distributionAmount: '0.1570',
    rocPercent: '100.00',
    rocAmount: null,
    observationId: 'r1',
};
test('matching payment joins without rounding decimals or deriving a missing ROC amount', () => {
    const rows = dividendRocHistory(
        [{ date: '2026-10-15', amount: 0.157 }],
        [base]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].distributionAmount, '0.1570');
    assert.equal(rows[0].rocAmount, null);
    assert.equal(rows[0].rocPercent, '100.00');
    assert.equal(rows[0].payableDate, '2026-10-16');
});
test('ROC-only payments remain visible and annual summaries never become payment rows', () => {
    const rows = dividendRocHistory(
        [],
        [
            base,
            {
                ...base,
                scope: 'fiscal_year_to_date',
                observationId: 'annual',
                distributionAmount: '99',
            },
        ]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].distributionAmount, '0.1570');
});
test('different currencies, amounts, and ambiguous same-date payments do not merge', () => {
    for (const history of [
        [{ date: '2026-10-15', amount: 0.157, currency: 'CAD' }],
        [{ date: '2026-10-15', amount: 0.2 }],
        [{ date: '2026-10-15', amount: 0.157000001 }],
        [
            { date: '2026-10-15', amount: 0.157 },
            { date: '2026-10-15', amount: 0.157 },
        ],
    ]) {
        const rows = dividendRocHistory(history, [base]);
        assert.equal(rows.length, history.length + 1);
        assert.equal(rows.filter((row) => row.evidence.length).length, 1);
    }
});
test('payable date does not match the ex-date without an explicit shared date', () => {
    assert.equal(
        dividendRocHistory(
            [{ date: '2026-10-16', amount: 0.157 }],
            [{ ...base, exDate: null }]
        ).length,
        2
    );
    assert.equal(
        dividendRocHistory(
            [{ date: '2026-10-15', payableDate: '2026-10-16', amount: 0.157 }],
            [{ ...base, exDate: null }]
        ).length,
        1
    );
});
test('final evidence takes priority without duplicating payments; conflicting peers remain unknown', () => {
    const history = [{ date: '2026-10-15', amount: 0.157 }];
    const estimated = {
        ...base,
        classificationStatus: 'estimated',
        rocPercent: '90',
    };
    const final = {
        ...base,
        classificationStatus: 'final',
        rocPercent: '85',
        observationId: 'final',
    };
    const rows = dividendRocHistory(history, [estimated, final]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].rocPercent, '85');
    assert.equal(rows[0].evidence.length, 2);
    const conflict = dividendRocHistory(history, [
        final,
        { ...final, rocPercent: '84', observationId: 'other' },
    ])[0];
    assert.equal(conflict.rocPercent, null);
    assert.match(conflict.note, /ROC 자료 간/);
});
test('missing dates are not joined together and forecast rows are excluded', () => {
    assert.equal(
        dividendRocHistory(
            [{ date: '2026-10-15', amount: 0.157, forecasted: true }],
            [
                { ...base, exDate: null, payableDate: null },
                {
                    ...base,
                    exDate: null,
                    payableDate: null,
                    observationId: 'r2',
                },
            ]
        ).length,
        2
    );
});

test('monthly summary totals weekly payments and weights only known ROC percentages', () => {
    const rows = [
        {
            id: '1',
            exDate: '2026-10-01',
            currency: 'USD',
            distributionAmount: '1',
            rocPercent: '80',
        },
        {
            id: '2',
            exDate: '2026-10-08',
            currency: 'USD',
            distributionAmount: '3',
            rocPercent: '20',
        },
        {
            id: '3',
            exDate: '2026-10-15',
            currency: 'USD',
            distributionAmount: '2',
            rocPercent: null,
        },
        {
            id: '4',
            exDate: '2026-09-24',
            currency: 'USD',
            distributionAmount: '0.5',
            rocPercent: '0',
        },
        {
            id: 'unknown',
            exDate: null,
            currency: 'USD',
            distributionAmount: '9',
            rocPercent: '100',
        },
    ];
    const summary = monthlyDividendRocSummary(rows);
    assert.equal(summary.length, 2);
    assert.deepEqual(
        summary.map(
            ({
                key,
                distributionTotal,
                paymentCount,
                rocKnownCount,
                weightedRocPercent,
            }) => ({
                key,
                distributionTotal,
                paymentCount,
                rocKnownCount,
                weightedRocPercent,
            })
        ),
        [
            {
                key: '2026-09',
                distributionTotal: 0.5,
                paymentCount: 1,
                rocKnownCount: 1,
                weightedRocPercent: 0,
            },
            {
                key: '2026-10',
                distributionTotal: 6,
                paymentCount: 3,
                rocKnownCount: 2,
                weightedRocPercent: 35,
            },
        ]
    );
});

test('monthly summary keeps missing ROC distinct from zero ROC', () => {
    const [month] = monthlyDividendRocSummary([
        {
            id: '1',
            exDate: '2026-10-01',
            currency: 'USD',
            distributionAmount: '1',
            rocPercent: null,
        },
    ]);
    assert.equal(month.weightedRocPercent, null);
    assert.equal(month.rocKnownCount, 0);
});
