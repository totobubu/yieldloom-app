import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortfolioPreferencesClient } from '../src/services/portfolioPreferencesClient.js';
import { createFamilyPortfolioClient } from '../src/services/familyPortfolioClient.js';
import {
    advancedLedgerInsights,
    closedLedgerResults,
} from '../src/services/advancedPortfolioInsights.js';
import {
    monthlyBlogText,
    monthlyCardSvg,
} from '../src/services/monthlyContent.js';
import {
    upcomingDividendAlerts,
    takeUndeliveredAlerts,
} from '../src/services/portfolioAlerts.js';
const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
};
const prefs = (revision = 0, enabled = false) => ({
    revision,
    preferences: { enabled, leadDays: 3, browser: false },
});

test('preferences share concurrent loads, reuse session cache, expire and clear on identity changes', async () => {
    let user = {},
        clock = 0,
        calls = 0;
    const gate = deferred();
    const client = createPortfolioPreferencesClient({
        getUser: () => user,
        now: () => clock,
        request: async () => {
            calls++;
            if (calls === 1) await gate.promise;
            return prefs();
        },
    });
    const a = client.get(),
        b = client.get();
    gate.resolve();
    assert.deepEqual(await a, await b);
    assert.equal(calls, 1);
    await client.get();
    assert.equal(calls, 1);
    clock = 300001;
    await client.get();
    assert.equal(calls, 2);
    user = {};
    await client.get();
    assert.equal(calls, 3);
    client.clear();
    await client.get();
    assert.equal(calls, 4);
    user = null;
    await assert.rejects(client.get(), /로그인/);
});

test('old preference reads cannot overwrite saves, reads during save share its response, failures never cache', async () => {
    const gate = deferred(),
        write = deferred();
    let calls = 0;
    const user = {};
    const client = createPortfolioPreferencesClient({
        getUser: () => user,
        request: async (action) => {
            calls++;
            return action ? write.promise : gate.promise;
        },
    });
    const old = client.get();
    const rejected = assert.rejects(old, { name: 'AbortError' });
    const saved = client.save(prefs(1, true).preferences, 0),
        joined = client.get();
    write.resolve(prefs(1, true));
    await saved;
    await joined;
    gate.resolve(prefs());
    await rejected;
    assert.equal((await client.get()).revision, 1);
    assert.equal(calls, 2);
    const malformed = createPortfolioPreferencesClient({
        getUser: () => user,
        request: async () => ({ preferences: {}, revision: 0 }),
    });
    await assert.rejects(malformed.get(), /응답/);
    await assert.rejects(malformed.get(), /응답/);
});

test('logout during a preference request discards its response', async () => {
    let user = {};
    const gate = deferred();
    const client = createPortfolioPreferencesClient({
        getUser: () => user,
        request: () => gate.promise,
    });
    const task = client.get();
    user = null;
    gate.resolve(prefs());
    await assert.rejects(task, { name: 'AbortError' });
});

test('inspection, reports and preferences never invalidate ledger or merge mutation requests', async () => {
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
        'savePreferences',
    ])
        await Promise.all([client(action, {}), client(action, {})]);
    assert.equal(calls, 8);
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
test('alerts include only announced near-term events, deduplicate across accounts and isolate login sessions', () => {
    const row = {
        date: '2026-10-21',
        payableDate: '2026-10-21',
        symbol: 'AAPL',
        status: 'announced',
    };
    const opts = { basis: 'payable', today: '2026-10-18', leadDays: 3 };
    const events = upcomingDividendAlerts(
        [
            row,
            { ...row, accountId: 'other' },
            { ...row, status: 'forecast' },
            { ...row, date: '2026-10-25', payableDate: '2026-10-25' },
        ],
        opts
    );
    assert.equal(events.length, 1);
    assert.equal(
        upcomingDividendAlerts([row], { ...opts, leadDays: 1 }).length,
        0
    );
    const user = {};
    assert.equal(
        takeUndeliveredAlerts(user, events, opts.basis, opts.today).length,
        1
    );
    assert.equal(
        takeUndeliveredAlerts(user, events, opts.basis, opts.today).length,
        0
    );
    assert.equal(
        takeUndeliveredAlerts({}, events, opts.basis, opts.today).length,
        1
    );
    assert.equal(
        takeUndeliveredAlerts(user, events, opts.basis, '2026-10-19').length,
        1
    );
});
