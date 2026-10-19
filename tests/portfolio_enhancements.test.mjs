import test from 'node:test';
import assert from 'node:assert/strict';
import {
    brokerHeaderSignature,
    loadBrokerPreset,
    saveBrokerPreset,
    deleteBrokerPreset,
    BROKER_PRESET_KEY,
} from '../src/services/brokerPresets.js';
import { reconcileDividends } from '../src/services/dividendReconciliation.js';
import { calculateXirr, accountXirr } from '../src/services/portfolioXirr.js';
import { holdingsChanges } from '../src/services/holdingsChanges.js';

test('presets persist only allowlisted layout metadata, identify reordered headers and can be deleted', async () => {
    const data = new Map(),
        storage = {
            getItem: (k) => data.get(k),
            setItem: (k, v) => data.set(k, v),
        };
    const headerSignature = await brokerHeaderSignature([
        '종목',
        '수량',
        '평가액',
    ]);
    saveBrokerPreset(storage, 'toss', 'holdings', {
        encoding: 'cp949',
        headerRow: 2,
        defaultCurrency: 'USD',
        columnCount: 3,
        headerSignature,
        mapping: {
            symbol: 0,
            quantity: 1,
            amount: 2,
            account: 0,
            nativeTax: 500,
        },
        accountId: 'PRIVATE',
        sheet: 'PRIVATE',
        rows: ['PRIVATE'],
    });
    const value = loadBrokerPreset(storage, 'toss', 'holdings');
    assert.deepEqual(value.mapping, { symbol: 0, quantity: 1, amount: 2 });
    assert.equal(value.headerSignature, headerSignature);
    assert.equal(value.sheetIndex, 0);
    saveBrokerPreset(storage, 'kiwoom', 'holdings', {
        ...value,
        sheetIndex: 1,
    });
    assert.equal(loadBrokerPreset(storage, 'kiwoom', 'holdings').sheetIndex, 1);
    assert.throws(() =>
        saveBrokerPreset(storage, 'kiwoom', 'holdings', {
            ...value,
            sheetIndex: 20,
        })
    );
    assert.notEqual(
        await brokerHeaderSignature(['수량', '종목', '평가액']),
        headerSignature
    );
    assert.ok(!data.get(BROKER_PRESET_KEY).includes('PRIVATE'));
    assert.equal(loadBrokerPreset(storage, 'toss', 'transactions'), null);
    assert.throws(() =>
        saveBrokerPreset(storage, 'invalid', 'holdings', value)
    );
    assert.throws(() =>
        saveBrokerPreset(storage, 'toss', 'holdings', {
            ...value,
            headerRow: 21,
        })
    );
    deleteBrokerPreset(storage, 'toss', 'holdings');
    assert.equal(loadBrokerPreset(storage, 'toss', 'holdings'), null);
    data.set(BROKER_PRESET_KEY, '{');
    assert.throws(() => loadBrokerPreset(storage, 'toss', 'holdings'));
    deleteBrokerPreset(storage, 'toss', 'holdings');
    assert.equal(loadBrokerPreset(storage, 'toss', 'holdings'), null);
    assert.throws(() =>
        saveBrokerPreset(
            {
                getItem: () => null,
                setItem: () => {
                    throw new Error('blocked');
                },
            },
            'toss',
            'holdings',
            value
        )
    );
});

const expected = (id, payableDate = '2026-10-01') => ({
    id,
    accountId: 'a',
    symbol: 'AAPL',
    currency: 'USD',
    status: 'announced',
    payableDate,
    date: payableDate,
    quantity: 10,
    perShare: 1,
    amount: null,
});
const record = (id, amount, extra = {}) => ({
    id,
    accountId: 'a',
    symbol: 'AAPL',
    currency: 'USD',
    date: '2026-10-03',
    amount,
    ...extra,
});
test('reconciliation never asserts receipt, compares only confirmed bases, and nets reversals', () => {
    const events = [expected('e')],
        recorded = [record('r', 12), record('cancel', -2)];
    const options = { today: '2026-10-19' };
    const unconfirmed = reconcileDividends(events, recorded, options)[0];
    assert.equal(unconfirmed.status, 'candidate');
    assert.equal(unconfirmed.reference, null);
    assert.equal(unconfirmed.difference, null);
    const confirmed = reconcileDividends(events, recorded, {
        ...options,
        confirmedBasis: true,
    })[0];
    assert.equal(confirmed.status, 'matched');
    assert.equal(confirmed.actual, 10);
    assert.equal(
        reconcileDividends(events, [record('r', 8.5)], {
            ...options,
            confirmedBasis: true,
        })[0].status,
        'difference'
    );
    assert.equal(
        reconcileDividends(events, [], options)[0].status,
        'unrecorded'
    );
    assert.equal(
        reconcileDividends([expected('next', '2026-10-20')], [], options)[0]
            .status,
        'upcoming'
    );
    assert.equal(
        reconcileDividends(events, [record('unknown', null)], {
            ...options,
            confirmedBasis: true,
        })[0].difference,
        null
    );
});
test('weekly schedule overlap is ambiguous, accounts/currencies stay separate, missing public schedules remain visible', () => {
    const result = reconcileDividends(
        [expected('a'), expected('b', '2026-10-08')],
        [record('r', 10)],
        { today: '2026-10-19', confirmedBasis: true }
    );
    assert.ok(
        result.every(
            (r) =>
                r.status === 'ambiguous' &&
                r.actual === null &&
                r.difference === null
        )
    );
    const unmatched = reconcileDividends(
        [expected('a')],
        [
            record('r', 10, { accountId: 'b' }),
            record('krw', 100, { currency: 'KRW' }),
        ],
        { today: '2026-10-19' }
    );
    assert.equal(unmatched.filter((r) => r.status === 'unlinked').length, 2);
    assert.equal(unmatched.find((r) => r.id === 'a').status, 'unrecorded');
    assert.equal(
        reconcileDividends([{ ...expected('a'), status: 'review' }], [], {
            today: '2026-10-19',
        }).length,
        0
    );
    const exact = reconcileDividends(
        [expected('a'), expected('b', '2026-10-08')],
        [
            record('r1', 10, { date: '2026-10-01' }),
            record('r2', 10, { date: '2026-10-08' }),
        ],
        { today: '2026-10-19', confirmedBasis: true }
    );
    assert.ok(exact.every((r) => r.status === 'matched' && r.actual === 10));
});

test('XIRR uses dated ACT/365 cashflows and handles losses, zero return, missing inputs and ambiguous signs', () => {
    const flows = (end) => [
        { date: '2025-01-01', amount: -100 },
        { date: '2026-01-01', amount: end },
    ];
    assert.ok(Math.abs(calculateXirr(flows(110)).percent - 10) < 1e-8);
    assert.ok(Math.abs(calculateXirr(flows(75)).percent + 25) < 1e-8);
    assert.ok(Math.abs(calculateXirr(flows(100)).percent) < 1e-8);
    assert.equal(
        calculateXirr([
            { date: '2025-01-01', amount: -100 },
            { date: '2025-01-01', amount: 110 },
        ]).available,
        false
    );
    assert.equal(
        calculateXirr([{ date: '2025-02-30', amount: -100 }, ...flows(110)])
            .available,
        false
    );
    assert.equal(
        calculateXirr([
            { date: '2025-01-01', amount: -100 },
            { date: '2026-01-01', amount: 230 },
            { date: '2027-01-01', amount: -132 },
            { date: '2028-01-01', amount: 1 },
        ]).available,
        false
    );
    assert.equal(calculateXirr([]).available, false);
    assert.equal(
        calculateXirr([
            { date: '2025-01-01', amount: -1 },
            { date: '2025-01-02', amount: 1e15 },
        ]).available,
        false
    );
});
test('account XIRR includes terminal cash and external flows only, declines incomplete or mixed ledgers', () => {
    const account = {
        id: 'a',
        snapshot: {
            asOf: '2026-01-01',
            rows: [
                { symbol: 'AAPL', amount: 100, currency: 'USD' },
                { symbol: 'CASH', amount: 10, currency: 'USD' },
            ],
        },
    };
    const entry = {
        accountId: 'a',
        row: {
            date: '2025-01-01',
            type: 'cash_in',
            currency: 'USD',
            amount: 100,
            cashKind: 'external_deposit',
        },
    };
    const internal = {
        accountId: 'a',
        row: {
            date: '2025-07-01',
            type: 'dividend',
            currency: 'USD',
            amount: 10,
        },
    };
    const options = { currency: 'USD', today: '2026-10-19', confirmed: true };
    assert.ok(
        Math.abs(
            accountXirr([entry, internal], account, options).percent - 10
        ) < 1e-8
    );
    assert.equal(
        accountXirr([entry], account, { ...options, confirmed: false })
            .available,
        false
    );
    for (const row of [
        { ...entry.row, cashKind: 'exchange' },
        { ...entry.row, cashKind: 'unknown' },
        { ...entry.row, currency: 'KRW' },
        { ...entry.row, date: 'unknown' },
        { ...entry.row, type: 'transfer_in' },
        { ...entry.row, type: 'cash_out' },
    ])
        assert.equal(
            accountXirr([entry, { accountId: 'a', row }], account, options)
                .available,
            false
        );
    assert.equal(
        accountXirr(
            [entry],
            {
                ...account,
                snapshot: {
                    ...account.snapshot,
                    rows: [{ currency: 'USD', amount: null }],
                },
            },
            options
        ).available,
        false
    );
    assert.equal(
        accountXirr(
            [entry],
            {
                ...account,
                snapshot: {
                    ...account.snapshot,
                    rows: [{ currency: 'KRW', amount: 100 }],
                },
            },
            options
        ).available,
        false
    );
    assert.equal(
        accountXirr(
            [entry, { accountId: 'other', row: { date: 'bad' } }],
            account,
            options
        ).available,
        true
    );
});
test('holdings diff preserves zero vs missing amounts, additions, removals and currencies', () => {
    const row = { symbol: 'AAPL', currency: 'USD', quantity: 1, amount: null };
    assert.deepEqual(holdingsChanges([row], [row]), []);
    assert.equal(
        holdingsChanges([row], [{ ...row, amount: 0 }])[0].beforeAmount,
        null
    );
    assert.deepEqual(
        holdingsChanges([row], [{ ...row, currency: 'KRW' }]).map(
            (r) => r.status
        ),
        ['제외', '추가']
    );
});
