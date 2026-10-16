import test from 'node:test';
import assert from 'node:assert/strict';
import {
    simulateDividends,
    normalizeSimulationSetup,
} from '../src/services/dividendSimulation.js';
const input = {
    initial: 1000,
    contribution: 0,
    months: 12,
    price: 10,
    annualDividend: 1.2,
    taxRate: 15,
    fee: 0,
    annualPriceChange: 0,
    frequency: 'monthly',
    currency: 'USD',
    reinvest: false,
    fractional: true,
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
test('fixed nominal dividend, withholding and accumulated cash remain distinct from wealth', () => {
    const r = simulateDividends(input).summary;
    near(r.grossTotal, 120);
    near(r.taxTotal, 18);
    near(r.netTotal, 102);
    near(r.wealth, 1102);
    near(r.gain, 102);
    assert.equal(r.shares, 100);
});
test('reinvestment buys only after each dividend payout and taxes precede reinvestment', () => {
    const r = simulateDividends({ ...input, reinvest: true }).summary;
    near(r.wealth, 1000 * (1 + 0.01 * 0.85) ** 12);
    near(r.stockValue, r.wealth);
    near(r.cash, 0);
    assert.ok(r.shares > 100);
});
test('quarterly and annual payments do not pay before their cycle', () => {
    for (const [frequency, month] of [
        ['quarterly', 3],
        ['semiannual', 6],
        ['annual', 12],
    ]) {
        const r = simulateDividends({ ...input, frequency });
        assert.equal(r.rows[month - 2].gross, 0);
        near(r.rows[month - 1].gross, 120 / (12 / month));
        near(r.summary.grossTotal, 120);
    }
});
test('whole-share residual cash, fees and fresh contributions conserve capital', () => {
    const r = simulateDividends({
        ...input,
        initial: 101,
        contribution: 11,
        fee: 1,
        fractional: false,
        annualDividend: 0,
        months: 2,
    }).summary;
    assert.equal(r.shares, 12);
    assert.equal(r.fees, 3);
    near(r.contributed, 123);
    near(r.wealth, 120);
    near(r.gain, -3);
});
test('zero dividend/contribution/period and unaffordable shares are supported', () => {
    const zero = simulateDividends({ ...input, initial: 0, months: 0 }).summary;
    assert.equal(zero.wealth, 0);
    assert.equal(zero.gain, 0);
    const noBuy = simulateDividends({
        ...input,
        initial: 5,
        fractional: false,
    });
    assert.equal(noBuy.summary.shares, 0);
    assert.equal(noBuy.summary.cash, 5);
    assert.equal(noBuy.summary.netTotal, 0);
});
test('negative price scenarios show loss, not a dividend-only return', () => {
    const r = simulateDividends({ ...input, annualPriceChange: -50 }).summary;
    near(r.stockValue, 500);
    near(r.wealth, 602);
    near(r.gain, -398);
});
test('100 percent withholding yields zero reinvestment and fees are not charged for unaffordable buys', () => {
    near(
        simulateDividends({ ...input, taxRate: 100, reinvest: true }).summary
            .wealth,
        1000
    );
    assert.equal(
        simulateDividends({ ...input, initial: 5, fee: 10 }).summary.fees,
        0
    );
});
test('invalid inputs, unsupported currencies and runaway assumptions do not emit plausible results', () => {
    for (const change of [
        { months: 1.5 },
        { months: 361 },
        { initial: -1 },
        { taxRate: 101 },
        { price: 0 },
        { price: null },
        { frequency: 'weekly' },
        { currency: 'EUR' },
        { contribution: NaN },
        { annualPriceChange: -100 },
    ])
        assert.throws(() => simulateDividends({ ...input, ...change }));
    assert.throws(
        () =>
            simulateDividends({
                ...input,
                price: 0.000001,
                annualDividend: 1e7,
                reinvest: true,
                months: 360,
            }),
        /범위/
    );
});

test('saved setups keep only supported fields and reject obsolete or malformed settings', () => {
    const { months, currency, annualPriceChange, ...a } = input;
    const setup = {
        version: 1,
        comparison: 'tax',
        common: { months, currency, annualPriceChange, secret: 'excluded' },
        a: { ...a, initial: '1000' },
        b: a,
        privateAccount: 'excluded',
    };
    const normalized = normalizeSimulationSetup(setup);
    assert.equal(normalized.a.initial, 1000);
    assert.equal(normalized.privateAccount, undefined);
    assert.equal(normalized.common.secret, undefined);
    assert.throws(() => normalizeSimulationSetup({ ...setup, version: 2 }));
    assert.throws(() =>
        normalizeSimulationSetup({ ...setup, a: { ...a, reinvest: 'false' } })
    );
});
