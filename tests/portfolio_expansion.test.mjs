import test from 'node:test';
import assert from 'node:assert/strict';
import { createFamilyPortfolioClient } from '../src/services/familyPortfolioClient.js';
import {
    advancedLedgerInsights,
    closedLedgerResults,
} from '../src/services/advancedPortfolioInsights.js';
import {
    monthlyBlogText,
    monthlyCardSvg,
} from '../src/services/monthlyContent.js';
test('inspection and reports never invalidate ledger or merge mutation requests', async () => {
    let calls = 0,
        invalidations = 0;
    const user = { getIdToken: async () => 'fixture' };
    const client = createFamilyPortfolioClient({
        getUser: () => user,
        fetcher: async () => {
            calls++;
            return new Response('{}');
        },
    });
    client.onInvalidate(() => invalidations++);
    for (const action of [
        'inspectSpreadsheet',
        'saveMonthlyStatement',
        'deleteMonthlyStatement',
    ])
        await Promise.all([client(action, {}), client(action, {})]);
    assert.equal(calls, 6);
    assert.equal(invalidations, 0);
    await client('commit', {});
    assert.equal(invalidations, 2);
});
const entry = (month, amount, type = 'dividend', extra = {}) => ({
    accountId: 'a',
    row: {
        date: `${month}-10`,
        symbol: 'AAPL',
        currency: 'USD',
        amount,
        type,
        ...extra,
    },
});
test('six-month trend requires every month observed and closed; cancellation stays signed and missing amounts stay unknown', () => {
    const entries = [1, 2, 3, 4, 5, 6].map((n) => entry(`2026-0${n}`, n * 10));
    const options = { month: '2026-06', currency: 'USD', today: '2026-07-01' };
    const result = advancedLedgerInsights(entries, options);
    assert.equal(result.trend.before, 60);
    assert.equal(result.trend.recent, 150);
    assert.equal(result.trend.percent, 150);
    for (const rows of [
        entries.slice(1),
        [...entries, entry('2026-06', null)],
        [...entries, { row: { date: 'bad' } }],
    ])
        assert.equal(advancedLedgerInsights(rows, options).trend.before, null);
    assert.equal(
        advancedLedgerInsights(entries, { ...options, today: '2026-06-30' })
            .trend.before,
        null
    );
    const signed = advancedLedgerInsights(
        [...entries, entry('2026-06', 5, 'dividend_reversal')],
        options
    );
    assert.equal(signed.flows[0].amount, 55);
});
test('closed ledger returns require confirmation, matching holdings and quantities, settlement amounts and no transfers', () => {
    const accounts = [
        { id: 'a', alias: 'test', snapshot: { asOf: '2026-06-30' } },
    ];
    const rows = [
        entry('2026-05', 100, 'buy', {
            quantity: 1,
            nativeSettlementAmount: 101,
        }),
        entry('2026-06', 120, 'sell', {
            quantity: 1,
            nativeSettlementAmount: 119,
        }),
        entry('2026-06', 5),
    ];
    const opts = { currency: 'USD', today: '2026-07-01', confirmed: true };
    const run = (es = rows, positions = []) =>
        closedLedgerResults(es, positions, accounts, opts)[0];
    assert.deepEqual(
        closedLedgerResults(rows, [], accounts, { ...opts, confirmed: false }),
        []
    );
    assert.equal(run().totalProfit, 23);
    assert.equal(run().purchaseCost, 101);
    assert.equal(
        run(rows, [
            { accountId: 'a', symbol: 'AAPL', quantity: 1, currency: 'KRW' },
        ]).available,
        false
    );
    assert.equal(
        run([...rows, entry('2026-06', 0, 'transfer_in')]).available,
        false
    );
    assert.equal(
        run([
            rows[0],
            {
                ...rows[1],
                row: { ...rows[1].row, nativeSettlementAmount: null },
            },
        ]).available,
        false
    );
    assert.equal(
        run([rows[0], { ...rows[1], row: { ...rows[1].row, quantity: 2 } }])
            .available,
        false
    );
    assert.equal(
        closedLedgerResults(rows, [], accounts, { ...opts, currency: 'KRW' })[0]
            .available,
        false
    );
});
const report = (extra = {}) => ({
    schemaVersion: 1,
    kind: 'yieldloom-monthly-dividends',
    month: '2026-06',
    asOf: '2026-07-01',
    scopeHash: 'a'.repeat(64),
    currency: 'USD',
    accountCount: 1,
    recordCount: 2,
    unknownCount: 0,
    knownAmount: 12345.67,
    excludedDateCount: 0,
    ...extra,
});
test('monthly text and cards use aggregate snapshots, hide money by default and suppress incomplete comparison', () => {
    const current = report({ accountIds: ['secret'], symbol: 'SECRET' }),
        previous = report({ month: '2026-05', knownAmount: 12000 });
    for (const text of [
        monthlyBlogText(current, previous),
        monthlyCardSvg(current, previous),
    ]) {
        for (const privateValue of [
            'secret',
            'SECRET',
            '12,345',
            '12345',
            'a'.repeat(64),
        ])
            assert.ok(!text.includes(privateValue));
        assert.ok(text.includes('2026-06'));
    }
    assert.ok(
        monthlyCardSvg(current, previous, { amounts: true }).includes(
            '12,345.67'
        )
    );
    assert.ok(
        monthlyBlogText(current, previous, { amounts: true }).includes(
            '12,345.67'
        )
    );
    assert.ok(
        monthlyCardSvg(report({ unknownCount: 1 }), previous, {
            amounts: true,
        }).includes('대비 증감 미확인 USD')
    );
    assert.throws(
        () =>
            monthlyBlogText(
                current,
                report({ month: '2026-05', scopeHash: 'b'.repeat(64) })
            ),
        /계좌 범위/
    );
});
