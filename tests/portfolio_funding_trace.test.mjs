import test from 'node:test';
import assert from 'node:assert/strict';
import { tracePortfolioFunding } from '../src/services/portfolioFundingTrace.js';
import { purchaseBasis } from '../lib/portfolio-capital.js';

const cash = (
    id,
    date,
    amount,
    classification,
    accountId = 'a',
    currency = 'USD'
) => ({
    entry: { id, date, amount, accountId, currency },
    annotation: { id, accountId, classification },
});
const trade = (id, date, type, symbol, amount, quantity = 1, extra = {}) => ({
    id,
    date,
    type,
    symbol,
    accountId: 'a',
    assetId: 'ACCOUNT',
    currency: 'USD',
    nativeAmount: amount,
    nativeSettlementAmount: amount,
    quantity,
    ...extra,
});
const run = (cashRows, trades, allocations = []) =>
    tracePortfolioFunding({
        entries: cashRows.map((c) => c.entry),
        classifications: cashRows.map((c) => c.annotation),
        trades,
        allocations,
    });
const near = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('own and cross-stock dividend reinvestment never add external principal or recovery', () => {
    const r = run(
        [cash('D', '20260101', 1000, 'external_deposit')],
        [
            trade('B', '20260102', 'buy', 'A', 1000, 10),
            trade('DIV', '20260201', 'dividend', 'A', 100),
            trade('RE', '20260202', 'buy', 'B', 100, 2),
            trade('DIV2', '20260301', 'dividend', 'B', 10),
            trade('RE2', '20260302', 'buy', 'B', 10, 0.2),
        ]
    );
    const b = r.stocks.find((s) => s.symbol === 'B');
    assert.equal(b.direct, 0);
    assert.equal(b.reinvestedHeld, 110);
    near(b.reinvestedQuantity, 2.2);
    near(b.quantity, 2.2);
    assert.equal(b.rate, null);
    assert.ok(b.sources.includes('A → B'));
    assert.ok(b.sources.includes('B → B'));
    assert.equal(r.currencies[0].deposits, 1000);
    assert.equal(r.currencies[0].recovered, 0);
    assert.equal(r.timelines.USD.at(-1).trackedAssetsAtCost, 1110);
    assert.equal(r.warnings.length, 0);
});

test('sale preserves original principal across stocks, reinvests only profit, attributes actual withdrawals proportionally', () => {
    const r = run(
        [
            cash('D', '20260101', 1000, 'external_deposit'),
            cash('W', '20260401', 600, 'external_withdrawal'),
        ],
        [
            trade('B', '20260102', 'buy', 'A', 1000, 10),
            trade('S', '20260201', 'sell', 'A', 1200, 10),
            trade('B2', '20260202', 'buy', 'B', 1200, 12),
            trade('S2', '20260301', 'sell', 'B', 600, 6),
        ]
    );
    const a = r.stocks.find((s) => s.symbol === 'A');
    const b = r.stocks.find((s) => s.symbol === 'B');
    near(a.direct, 1000);
    near(a.recovered, 600);
    near(a.rate, 60);
    near(b.direct, 0);
    near(b.principalHeld, 500);
    near(b.reinvestedHeld, 100);
    near(b.quantity, 6);
    near(r.currencies[0].rate, 60);
    near(r.timelines.USD.at(-1).trackedAssetsAtCost, 600);
});

test('losses and partial sales reduce every funding source proportionally', () => {
    const r = run(
        [cash('D', '20260101', 100, 'external_deposit')],
        [
            trade('B', '20260102', 'buy', 'A', 100, 10),
            trade('S', '20260201', 'sell', 'A', 40, 5),
            trade('B2', '20260202', 'buy', 'B', 40, 4),
        ]
    );
    near(r.stocks.find((s) => s.symbol === 'A').principalHeld, 50);
    near(r.stocks.find((s) => s.symbol === 'B').principalHeld, 40);
    near(r.timelines.USD.at(-1).trackedAssetsAtCost, 90);
});

test('no balance, missing net dividend, overselling and separate account/currency never manufacture principal', () => {
    const r = run(
        [cash('D', '20260101', 100, 'external_deposit', 'b', 'KRW')],
        [
            trade('GROSS', '20260102', 'dividend', 'A', 100, 1, {
                nativeSettlementAmount: null,
            }),
            trade('B', '20260103', 'buy', 'A', 100, 10),
            trade('S', '20260201', 'sell', 'A', 200, 20),
        ]
    );
    near(r.stocks[0].direct, 0);
    near(r.stocks[0].unknownHeld, 100);
    near(r.currencies[0].deposits, 0);
    near(r.currencies[1].deposits, 100);
    assert.ok(r.warnings.some((w) => w.includes('세후')));
    assert.ok(r.warnings.some((w) => w.includes('기초 잔액')));
});

test('confirmed allocation overrides dividend-first without inventing cash', () => {
    const buy = trade('B', '20260103', 'buy', 'A', 100, 10);
    const allocation = {
        accountId: 'a',
        assetId: 'ACCOUNT',
        transactionId: 'B',
        ...purchaseBasis(buy),
        parts: [{ amount: 100, source: 'principal', method: 'usd_balance' }],
    };
    const r = run(
        [cash('D', '20260101', 100, 'external_deposit')],
        [trade('DIV', '20260102', 'dividend', 'A', 100), buy],
        [allocation]
    );
    assert.equal(r.stocks[0].direct, 100);
    assert.equal(r.stocks[0].reinvestedHeld, 0);
    near(r.timelines.USD.at(-1).cash, 100);
});

test('recovery can exceed 100%, fresh deposits lower the rate, no zero denominator', () => {
    const r = run(
        [
            cash('D', '20260101', 100, 'external_deposit'),
            cash('W', '20260301', 120, 'profit_withdrawal'),
            cash('D2', '20260401', 100, 'external_deposit'),
        ],
        [
            trade('B', '20260102', 'buy', 'A', 100, 10),
            trade('S', '20260201', 'sell', 'A', 120, 10),
        ]
    );
    near(r.timelines.USD[3].recovered, 120);
    near(r.currencies[0].rate, 60);
    near(r.stocks[0].rate, 120);
    assert.equal(r.currencies[1].rate, null);
});

test('duplicate cash dividend is not added to security dividend and reversals suspend trace', () => {
    const r = run(
        [cash('DIV-COPY', '20260101', 100, 'dividend')],
        [trade('DIV', '20260101', 'dividend', 'A', 100)]
    );
    near(r.timelines.USD.at(-1).cash, 100);
    const reversed = run(
        [],
        [
            trade('DIV', '20260101', 'dividend', 'A', 100),
            trade('R', '20260102', 'dividend_reversal', 'A', 100),
        ]
    );
    assert.equal(reversed.unavailable, true);
    assert.equal(reversed.timelines.USD.length, 0);
});

test('a conflicting manual funding source consumes cash without double-counting assets', () => {
    const buy = trade('B', '20260102', 'buy', 'A', 100, 10);
    const allocation = {
        accountId: 'a',
        assetId: 'ACCOUNT',
        transactionId: 'B',
        ...purchaseBasis(buy),
        parts: [{ amount: 100, source: 'dividend', method: 'usd_balance' }],
    };
    const r = run(
        [cash('D', '20260101', 100, 'external_deposit')],
        [buy],
        [allocation]
    );
    near(r.timelines.USD.at(-1).cash, 0);
    near(r.timelines.USD.at(-1).trackedAssetsAtCost, 100);
    near(r.stocks[0].unknownHeld, 100);
    assert.ok(r.warnings.length > 0);
});

test('reinvested lots retain cumulative funding and realized gains after closing', () => {
    const r = run(
        [],
        [
            trade('D', '20260101', 'dividend', 'A', 100),
            trade('B', '20260102', 'buy', 'B', 100, 2),
            trade('S', '20260103', 'sell', 'B', 120, 2),
        ]
    );
    const b = r.stocks.find((s) => s.symbol === 'B');
    near(b.reinvested, 100);
    near(b.reinvestmentRealizedPnl, 20);
    near(b.reinvestedQuantity, 0);
    near(b.direct, 0);
});

test('same-day rule is deterministic, inputs untouched and chart value is conserved by reinvestment', () => {
    const inputs = [
        trade('B', '20260101', 'buy', 'A', 100, 10),
        trade('DIV', '20260101', 'dividend', 'A', 100),
    ];
    const original = structuredClone(inputs);
    const r = run([], inputs);
    assert.deepEqual(inputs, original);
    assert.equal(r.timelines.USD.at(-1).trackedAssetsAtCost, 100);
    assert.equal(r.stocks[0].direct, 0);
    assert.ok(r.warnings.some((w) => w.includes('같은 날')));
    assert.deepEqual(run([], [...inputs].reverse()), r);
});
