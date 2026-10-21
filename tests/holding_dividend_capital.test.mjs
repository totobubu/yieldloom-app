import test from 'node:test';
import assert from 'node:assert/strict';
import { holdingDividendCapital } from '../src/services/holdingDividendCapital.js';

const cash = (id, date, amount, classification, accountId = 'a') => ({
    entry: { id, date, amount, currency: 'USD' },
    classification: { id, classification },
    accountId,
});
const trade = (id, date, type, symbol, amount, quantity = 0, extra = {}) => ({
    id,
    date,
    type,
    symbol,
    currency: 'USD',
    nativeAmount: amount,
    nativeSettlementAmount: amount,
    quantity,
    assetId: 'ACCOUNT',
    ...extra,
});
const state = (accountId, cashRows, trades) => ({
    accountId,
    state: {
        entries: cashRows.map((row) => row.entry),
        classifications: cashRows.map((row) => row.classification),
        trades,
        allocations: [],
    },
});
const position = (accountId, symbol, quantity = 1) => ({
    accountId,
    symbol,
    quantity,
    currency: 'USD',
});
const near = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('current holding cost follows FIFO lots while dividends use initial principal', () => {
    const deposit = cash('cash', '20260101', 1000, 'external_deposit');
    const report = holdingDividendCapital(
        [
            state(
                'a',
                [deposit],
                [
                    trade('buy', '20260102', 'buy', 'AAA', 1000, 10),
                    trade('dividend', '20260201', 'dividend', 'AAA', 100),
                    trade('reinvest', '20260202', 'buy', 'AAA', 100, 1),
                    trade('sell', '20260301', 'sell', 'AAA', 550, 5.5),
                ]
            ),
        ],
        [position('a', 'AAA', 5.5)],
        { currency: 'USD', today: '2026-12-31' }
    );
    const row = report.rows[0];
    near(row.principalHeld, 450);
    near(row.reinvestedHeld, 100);
    near(row.initialPrincipal, 1000);
    near(row.dividends, 100);
    near(row.reinvestmentRate, (100 / 550) * 100);
    near(row.dividendRate, 10);
    near(report.investedCost, 550);
    near(report.dividendRate, 10);
});

test('same symbol is combined across held accounts and sold positions are excluded', () => {
    const first = cash('c1', '20260101', 100, 'external_deposit', 'a');
    const second = cash('c2', '20260101', 200, 'external_deposit', 'b');
    const report = holdingDividendCapital(
        [
            state(
                'a',
                [first],
                [
                    trade('b1', '20260102', 'buy', 'AAA', 100, 1),
                    trade('d1', '20260201', 'dividend', 'AAA', 10),
                ]
            ),
            state(
                'b',
                [second],
                [
                    trade('b2', '20260102', 'buy', 'AAA', 200, 2),
                    trade('d2', '20260201', 'dividend', 'AAA', 20),
                    trade('sold', '20260102', 'buy', 'OLD', 0, 1),
                ]
            ),
        ],
        [position('a', 'AAA'), position('b', 'AAA', 2)],
        { currency: 'USD', today: '2026-12-31' }
    );
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].symbol, 'AAA');
    near(report.rows[0].initialPrincipal, 300);
    near(report.rows[0].dividends, 30);
});

test('reversals reduce net dividends and missing settlements keep rates unconfirmed', () => {
    const deposit = cash('cash', '20260101', 100, 'external_deposit');
    const report = holdingDividendCapital(
        [
            state(
                'a',
                [deposit],
                [
                    trade('buy', '20260102', 'buy', 'AAA', 100, 1),
                    trade('dividend', '20260201', 'dividend', 'AAA', 20),
                    trade(
                        'reversal',
                        '20260202',
                        'dividend_reversal',
                        'AAA',
                        5
                    ),
                    trade('unknown', '20260301', 'dividend', 'AAA', 10, 0, {
                        nativeSettlementAmount: null,
                    }),
                ]
            ),
        ],
        [position('a', 'AAA')],
        { currency: 'USD', today: '2026-12-31' }
    );
    assert.equal(report.rows[0].dividends, 15);
    assert.equal(report.rows[0].dividendUnknown, 1);
    assert.equal(report.rows[0].dividendRate, null);
    assert.equal(report.dividendRate, null);
    assert.equal(report.complete, false);
});

test('manual holdings without funding history stay visible but are not treated as zero principal', () => {
    const report = holdingDividendCapital([], [position('a', 'AAA')], {
        currency: 'USD',
        today: '2026-12-31',
    });
    assert.equal(report.rows[0].fundingUnknown, true);
    assert.equal(report.rows[0].dividendRate, null);
    assert.equal(report.complete, false);
});
