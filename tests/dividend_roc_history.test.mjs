import assert from 'node:assert/strict';
import test from 'node:test';
import { dividendRocHistory } from '../lib/dividend-roc-history.js';
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
