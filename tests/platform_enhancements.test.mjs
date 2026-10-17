import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assertRelease,
    waitForReleases,
} from '../scripts/deploy/verify-release.mjs';
import {
    underlyingProducts,
    comparableMetric,
    candleRisk,
} from '../lib/underlying-comparison.js';
import {
    holdingSimulationBaseline,
    estimateHoldingDividend,
    simulateHeldPortfolio,
} from '../src/services/holdingSimulation.js';
import { simulateDividends } from '../src/services/dividendSimulation.js';
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ~= ${b}`);
test('deployment synchronization rejects a correct commit with stale metadata and waits for both sites', async () => {
    const expected = {
        schemaVersion: 1,
        commit: 'a'.repeat(40),
        metadataSha256: 'b'.repeat(64),
    };
    assert.throws(() =>
        assertRelease({ ...expected, metadataSha256: 'c'.repeat(64) }, expected)
    );
    const calls = new Map();
    await waitForReleases(
        ['https://a.test/', 'https://b.test/base/'],
        expected,
        {
            attempts: 2,
            report: () => {},
            pause: async () => {},
            fetcher: async (url) => {
                const key = url.hostname,
                    count = (calls.get(key) || 0) + 1;
                calls.set(key, count);
                assert.ok(url.pathname.endsWith('/app-release.json'));
                return new Response(
                    JSON.stringify(
                        key === 'b.test' && count === 1
                            ? { ...expected, commit: 'c'.repeat(40) }
                            : expected
                    )
                );
            },
        }
    );
    assert.equal(calls.get('a.test'), 1);
    assert.equal(calls.get('b.test'), 2);
    await assert.rejects(
        waitForReleases(['https://a.test/'], expected, {
            attempts: 1,
            report: () => {},
            fetcher: async () => new Response('{}'),
        }),
        /미완료/
    );
});
test('underlying comparison keeps inverse exposure distinct and missing or unverified metrics unavailable', () => {
    const rows = underlyingProducts(
        [
            { symbol: 'AAPD', underlying: 'AAPL' },
            { symbol: 'AAPY', underlying: 'AAPL' },
            { symbol: 'OTHER', underlying: 'TSLA' },
        ],
        'AAPL',
        { tickers: [] }
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].direction, 'inverse');
    assert.equal(rows[0].leverage, -1);
    assert.equal(rows[1].strategy, 'income');
    assert.equal(rows[1].dividend, null);
    assert.equal(
        comparableMetric({
            value: 99,
            status: 'needs_corporate_action_review',
        }),
        null
    );
    assert.equal(comparableMetric({ value: null, status: 'available' }), null);
    assert.equal(comparableMetric({ value: 0, status: 'available' }).value, 0);
    const prices = {
        candles: [
            { date: '2026-01-01', close: 10 },
            { date: '2026-02-01', close: 20 },
            { date: '2026-03-01', close: 12 },
        ],
        events: [],
    };
    const risk = candleRisk(prices, '2026-04-01');
    near(risk.priceReturn, 20);
    near(risk.maxDrawdown, -40);
    assert.match(
        candleRisk(
            { ...prices, events: [{ date: '2026-02-01', kind: 'split' }] },
            '2026-04-01'
        ).unavailable,
        /분할/
    );
});
const position = (
    accountId,
    quantity = 10,
    amount = 100,
    currency = 'USD'
) => ({
    symbol: 'AAPY',
    accountId,
    quantity,
    amount,
    currency,
    asOf: '2026-09-30',
});
const entry = (accountId, amount, date = '2026-09-10', type = 'dividend') => ({
    accountId,
    id: date + type,
    row: { symbol: 'AAPY', amount, currency: 'USD', date, type },
});
test('holding baseline isolates account and currency, subtracts reversals and leaves missing dividends unknown', () => {
    const result = holdingSimulationBaseline(
        [
            position('a'),
            position('b', 5, 50),
            position('c', 10, 100, 'KRW'),
            { ...position('d'), amount: null },
        ],
        [
            entry('a', 12),
            entry('a', 2, '2026-09-12', 'dividend_reversal'),
            entry('c', 999),
        ],
        'USD',
        '2026-09',
        '2026-10-17'
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].quantity, 15);
    assert.equal(result.rows[0].initial, 150);
    assert.equal(result.rows[0].recordedNet, 10);
    assert.equal(result.excluded, 1);
    assert.equal(estimateHoldingDividend(result.rows[0], 15, false), null);
    near(estimateHoldingDividend(result.rows[0], 0, true), 10 / 15);
    assert.equal(estimateHoldingDividend(result.rows[0], 100, true), null);
    const missing = holdingSimulationBaseline(
        [position('a')],
        [],
        'USD',
        '2026-09',
        '2026-10-17'
    );
    assert.equal(missing.rows[0].recordedNet, null);
});
const model = {
    symbol: 'AAPY',
    currency: 'USD',
    initial: 1000,
    quantity: 100,
    price: 10,
    annualDividend: 1.2,
    frequency: 'weekly',
};
const setup = {
    currency: 'USD',
    contribution: 0,
    reduction: 50,
    months: 12,
    taxRate: 0,
    fee: 0,
    annualPriceChange: 0,
};
test('held securities incur no initial purchase fee and weekly reinvestment includes reduction and tax', () => {
    const r = simulateHeldPortfolio([model], setup);
    near(r.scenarios[0].summary.wealth, 1120);
    near(r.scenarios[1].summary.wealth, 1000 * (1 + 0.12 / 52) ** 52);
    near(r.scenarios[2].summary.wealth, 1000 * (1 + 0.06 / 52) ** 52);
    assert.ok(r.scenarios[1].summary.wealth > r.scenarios[2].summary.wealth);
    const fees = simulateHeldPortfolio([model], { ...setup, fee: 1 });
    near(fees.scenarios[0].summary.fees, 0);
    near(fees.scenarios[1].summary.fees, 52);
    const taxed = simulateHeldPortfolio([model], { ...setup, taxRate: 100 });
    near(taxed.scenarios[1].summary.wealth, 1000);
});
test('portfolio contributions are allocated once by selected valuation and unavailable assumptions fail', () => {
    const result = simulateHeldPortfolio(
        [model, { ...model, symbol: 'APLY', quantity: 50, initial: 500 }],
        { ...setup, months: 1, contribution: 300 }
    );
    near(result.scenarios[0].summary.contributed, 1800);
    assert.throws(
        () =>
            simulateHeldPortfolio(
                [model, { ...model, currency: 'KRW', symbol: 'OTHER' }],
                setup
            ),
        /통화/
    );
    assert.throws(
        () =>
            simulateHeldPortfolio([{ ...model, annualDividend: null }], setup),
        /배당금/
    );
    assert.throws(() => simulateHeldPortfolio([model, model], setup), /중복/);
    assert.throws(
        () =>
            simulateDividends({
                ...model,
                ...setup,
                startingShares: 1000,
                initial: 1000,
                fractional: true,
                reinvest: true,
            }),
        /일치/
    );
    const zero = simulateHeldPortfolio([model], {
        ...setup,
        months: 0,
        fee: 10,
    });
    near(zero.scenarios[1].summary.wealth, 1000);
    near(zero.scenarios[1].summary.fees, 0);
});
