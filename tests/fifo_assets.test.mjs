import test from 'node:test';
import assert from 'node:assert/strict';
import { exact } from '../lib/exact-amount.js';
import {
    calculateFifoAssets as calc,
    applyFifoCorrections,
    validateFifoCorrection,
} from '../lib/fifo-asset-report.js';
const accounts = [
    { id: 'a', ownerId: 'wife', cashComplete: true },
    { id: 'b', ownerId: 'husband', cashComplete: true },
    { id: 'c', ownerId: 'wife', cashComplete: true },
];
const at = (d) => `2026-01-${String(d).padStart(2, '0')}T10:00:00+09:00`;
const event = (id, type, quantity, amount, day = 2, extra = {}) => ({
    id,
    accountId: 'a',
    symbol: 'TEST',
    currency: 'USD',
    at: at(day),
    type,
    quantity,
    amount,
    fee: '0',
    tax: '0',
    timing: 'execution',
    ...extra,
});
const cash = (id, type, amount, accountId = 'a', extra = {}) => ({
    id,
    accountId,
    type,
    amount,
    currency: 'USD',
    at: at(1),
    ...extra,
});
const run = (events, extra = {}) =>
    calc({ events, accounts, today: '2026-01-31', ...extra });
const quote = { TEST: { price: '300', currency: 'USD', date: '2026-01-31' } };
const correction = (id, kind, extra = {}) => ({
    id,
    kind,
    accountId: 'a',
    note: '합성 증빙 확인',
    ...extra,
});

test('FIFO separates remaining cost, cumulative purchases, realized/unrealized profit and withdrawals', () => {
    const r = run(
        [
            cash('deposit', 'EXTERNAL_DEPOSIT', '300'),
            event('b1', 'BUY', '1', '100'),
            event('b2', 'BUY', '1', '200', 3),
            event('sale', 'SELL', '1', '180', 4),
            cash('out', 'EXTERNAL_WITHDRAWAL', '20'),
        ],
        { quotes: quote }
    );
    const p = r.rows[0],
        c = r.currencies[0];
    assert.equal(p.remainingCost, '200');
    assert.equal(p.cumulativeBuys, '300');
    assert.equal(p.realizedPnl, '80');
    assert.equal(p.unrealizedPnl, '100');
    assert.equal(c.netExternal, '280');
    assert.equal(c.externalDeposits, '300');
    assert.equal(c.externalWithdrawals, '20');
});
test('DRIP increases acquisition cost and purchases, never external deposits or recovery denominator', () => {
    const r = run([
        cash('d', 'EXTERNAL_DEPOSIT', '100'),
        event('b', 'BUY', '1', '100'),
        event('div', 'DIVIDEND', null, null, 3, { net: '10' }),
        event('drip', 'BUY', '0.1', '10', 4, { funding: 'dividend' }),
    ]);
    const c = r.currencies[0];
    assert.equal(c.remainingCost, '110');
    assert.equal(c.cumulativeBuys, '110');
    assert.equal(c.reinvestedBuys, '10');
    assert.equal(c.externalDeposits, '100');
    assert.equal(c.netDividends, '10');
    assert.equal(c.dividendRecoveryRate, '10');
});
test('fees are included once; missing fees never become zero, explicit settlement is authoritative', () => {
    const e = event('b', 'BUY', '1', '100', 2, { fee: '2', tax: '1' });
    assert.equal(run([e]).rows[0].remainingCost, '103');
    assert.equal(
        run([{ ...e, settlement: '102' }]).rows[0].remainingCost,
        '102'
    );
    const u = run([{ ...e, fee: null }], { quotes: quote }).rows[0];
    assert.equal(u.remainingCost, null);
    assert.equal(u.unrealizedPnl, null);
    assert.equal(u.marketValue, '300');
});
test('exact rational fractional lot consumption preserves all remaining cost without epsilon loss', () => {
    const q = '0.000000000000000000123456789';
    const r = run([
        event('b', 'BUY', q, '1.123456789123456789'),
        event('s', 'SELL', '0.0000000000000000000617283945', '1', 3),
    ]).rows[0];
    assert.equal(r.quantity, '0.0000000000000000000617283945');
    assert.equal(r.lots.length, 1);
    assert.equal(r.remainingCost, '0.5617283945617283945');
    assert.equal(exact('1').div('3').mul('3').text(), '1');
});
test('same provider IDs and decimal quantities stay isolated per account; exact replay deduplicates, conflicts hold', () => {
    const e = event('same', 'BUY', '1.00000001', '100');
    const r = run([e, { ...e }, { ...e, accountId: 'b', amount: '200' }]);
    assert.equal(r.rows.length, 2);
    assert.equal(r.rows[0].remainingCost, '100');
    assert.equal(r.rows[1].remainingCost, '200');
    const conflict = run([e, { ...e, amount: '101' }]);
    assert.equal(conflict.rows[0].remainingCost, null);
});
test('actual nanosecond instants order same-day trades, not sells-first or identifier order', () => {
    const buy = event('z', 'BUY', '1', '100', 2, {
        at: '2026-01-02T01:00:00.000000001Z',
    });
    const sale = event('a', 'SELL', '1', '120', 2, {
        at: '2026-01-02T10:00:00.000000002+09:00',
    });
    const r = run([sale, buy]).rows[0];
    assert.equal(r.quantity, '0');
    assert.equal(r.realizedPnl, '20');
});
test('date-only same-day or equal instants hold lot calculations rather than inventing sequence', () => {
    for (const time of ['2026-01-02', at(2)]) {
        const r = run([
            event('b', 'BUY', '1', '100', 2, { at: time }),
            event('s', 'SELL', '1', '120', 2, { at: time }),
        ]).rows[0];
        assert.equal(r.realizedPnl, null);
        assert.equal(r.quantity, null);
        assert.match(r.issues.join(' '), /순서/);
    }
});
test('order aggregate requires separate single-execution evidence; unfilled/candidate observations never affect totals', () => {
    const b = event('b', 'BUY', '1', '100', 2, { timing: 'order_aggregate' });
    assert.equal(run([b]).rows[0].remainingCost, null);
    const r = run(
        [
            b,
            event('unfilled', 'BUY', '0', '0', 3, { excluded: true }),
            event('candidate', 'BUY', '1', '999', 4, { excluded: true }),
        ],
        {
            corrections: [
                correction('time', 'EXECUTION_TIME', {
                    targetId: 'b',
                    at: at(2),
                    singleExecutionConfirmed: true,
                }),
            ],
        }
    );
    assert.equal(r.rows[0].remainingCost, '100');
    assert.equal(r.excluded, 2);
});
test('opening and unknown inbound basis remain separate from external capital; manual basis is a reversible layer', () => {
    const c = correction('opening', 'OPENING_LOT', {
        symbol: 'TEST',
        currency: 'USD',
        at: '2025-01-01',
        quantity: '2',
        cost: null,
    });
    const r = run([], { corrections: [c], quotes: quote });
    assert.equal(r.rows[0].quantity, '2');
    assert.equal(r.rows[0].remainingCost, null);
    assert.equal(r.currencies[0].externalDeposits, '0');
    assert.equal(r.currencies[0].dividendRecoveryRate, null);
    assert.match(r.currencies[0].recoveryReason, /0/);
    const basis = correction('basis', 'BASIS', {
        targetId: 'manual:opening',
        cost: '100',
    });
    assert.equal(
        run([], { corrections: [c, basis] }).rows[0].remainingCost,
        '100'
    );
    assert.equal(run([], { corrections: [c] }).rows[0].remainingCost, null);
});
test('insufficient old purchases hold profit and quantity; documented opening restores FIFO without inventing contributions', () => {
    const sell = event('s', 'SELL', '2', '300', 4);
    assert.equal(run([sell]).rows[0].realizedPnl, null);
    const opening = correction('opening', 'OPENING_LOT', {
        symbol: 'TEST',
        currency: 'USD',
        at: '2025-01-01',
        quantity: '2',
        cost: '100',
    });
    const r = run([sell], { corrections: [opening] });
    assert.equal(r.rows[0].realizedPnl, '200');
    assert.equal(r.currencies[0].externalDeposits, '0');
});
test('actual KRW FX cost override preserves original USD trades and distinguishes recorded rate', () => {
    const b = event('b', 'BUY', '2', '100', 2, {
            fxRate: '1300',
            fxBasis: '토스 기록 환율',
        }),
        s = event('s', 'SELL', '1', '60', 3, {
            fxRate: '1400',
            fxBasis: '토스 기록 환율',
        });
    const before = JSON.stringify([b, s]);
    const r = run([b, s], {
        corrections: [
            correction('fx', 'FX_COST', { targetId: 'b', amount: '140000' }),
        ],
    }).rows[0];
    assert.equal(r.remainingCost, '50');
    assert.equal(r.remainingKrwCost, '70000');
    assert.equal(r.realizedPnl, '10');
    assert.equal(r.realizedKrwPnl, '14000');
    assert.ok(r.fxBasis.some((x) => x.includes('수기')));
    assert.equal(JSON.stringify([b, s]), before);
    assert.equal(run([{ ...b, fxRate: null }]).rows[0].remainingKrwCost, null);
});
test('only confirmed family cash pairs are excluded in whole-family flows; account scope preserves its boundary cash', () => {
    const out = cash('out', 'EXTERNAL_WITHDRAWAL', '50'),
        inc = cash('in', 'EXTERNAL_DEPOSIT', '50', 'b');
    assert.equal(run([out, inc]).currencies[0].externalDeposits, '50');
    const c = correction('pair', 'CONFIRM_INTERNAL_TRANSFER', {
        targetId: 'out',
        peerId: 'in',
    });
    assert.equal(
        run([out, inc], { corrections: [c] }).currencies[0].externalDeposits,
        '0'
    );
    assert.equal(
        run([out, inc], { corrections: [c], scope: 'husband' }).currencies[0]
            .externalDeposits,
        '50'
    );
    assert.equal(
        run([cash('u', 'UNKNOWN_CASH', '50')]).currencies[0].externalDeposits,
        null
    );
});
test('same-owner brokerage transfer carries original acquisition date and cost; family gifts are rejected', () => {
    const b = event('b', 'BUY', '2', '100');
    const transfer = correction('move', 'SECURITY_TRANSFER', {
        symbol: 'TEST',
        currency: 'USD',
        at: at(3),
        quantity: '1',
        toAccountId: 'c',
    });
    const r = run([b], { corrections: [transfer] });
    const to = r.rows.find((p) => p.accountId === 'c');
    assert.equal(to.remainingCost, '50');
    assert.equal(to.lots[0].acquiredAt, at(2));
    assert.equal(r.currencies[0].remainingCost, '100');
    assert.equal(r.currencies[0].cumulativeBuys, '100');
    assert.throws(
        () => run([b], { corrections: [{ ...transfer, toAccountId: 'b' }] }),
        /증여/
    );
});
test('verified split/reverse split preserve cost; separate cash-in-lieu is a real disposal', () => {
    const b = event('b', 'BUY', '3', '90');
    const reverse = correction('split', 'SPLIT', {
        symbol: 'TEST',
        currency: 'USD',
        at: at(3),
        numerator: '1',
        denominator: '10',
    });
    const dispose = correction('cash', 'CASH_IN_LIEU', {
        symbol: 'TEST',
        currency: 'USD',
        at: at(4),
        quantity: '0.3',
        amount: '100',
    });
    assert.equal(run([b], { corrections: [reverse] }).rows[0].quantity, '0.3');
    assert.equal(
        run([b], { corrections: [reverse] }).rows[0].remainingCost,
        '90'
    );
    assert.equal(
        run([b], { corrections: [reverse, dispose] }).rows[0].realizedPnl,
        '10'
    );
});
test('cash coverage and missing net dividends keep recovery unknown with a reason, not zero', () => {
    const a = accounts.map((x) => ({ ...x, cashComplete: false }));
    const events = [
        cash('d', 'EXTERNAL_DEPOSIT', '100'),
        event('div', 'DIVIDEND', null, null, 2, { net: null }),
    ];
    const r = run(events, { accounts: a, scope: 'wife' }).currencies[0];
    assert.equal(r.dividendRecoveryRate, null);
    assert.match(r.recoveryReason, /범위/);
    const coverage = accounts
        .filter((x) => x.ownerId === 'wife')
        .map((x) =>
            correction(x.id, 'CASH_COVERAGE', {
                accountId: x.id,
                currency: 'USD',
                from: '2020-01-01',
                to: '2026-01-31',
            })
        );
    assert.match(
        run(events, { accounts: a, scope: 'wife', corrections: coverage })
            .currencies[0].recoveryReason,
        /배당/
    );
});
test('corrections reject unexpected fields, unrelated targets, invalid dates, invented zero and secret fields', () => {
    const ctx = { events: [], accounts };
    const c = correction('x', 'OPENING_LOT', {
        symbol: 'TEST',
        currency: 'USD',
        at: at(2),
        quantity: '1',
        cost: '100',
    });
    delete c.id;
    for (const invalid of [
        { ...c, quantity: '0' },
        { ...c, at: '2026-02-30' },
        { ...c, accessToken: 'secret' },
        { ...c, accountId: 'unrelated' },
    ])
        assert.throws(() => validateFifoCorrection(invalid, ctx));
    assert.equal(applyFifoCorrections([], [], accounts).events.length, 0);
});

test('conflicting IDs hold every cash and stock aggregate of that account', () => {
    const b = event('same', 'BUY', '1', '100', 2, { funding: 'dividend' });
    const r = run([
        b,
        { ...b, symbol: 'OTHER', amount: '200' },
        cash('d', 'EXTERNAL_DEPOSIT', '100'),
        event('div', 'DIVIDEND', null, null, 3, { net: '10' }),
    ]);
    assert.equal(r.currencies[0].externalDeposits, null);
    assert.equal(r.currencies[0].netDividends, null);
    assert.equal(r.rows[0].reinvestedBuys, null);
    assert.equal(r.rows[0].realizedPnl, null);
});

test('transfer preserves original acquisition order uncertainty, not insertion order', () => {
    const buys = [
        event('one', 'BUY', '1', '10', 2, { at: '2025-01-01' }),
        event('two', 'BUY', '1', '20', 2, { accountId: 'c', at: '2025-01-01' }),
        event('sale', 'SELL', '1', '30', 6, { accountId: 'c' }),
    ];
    const move = correction('move', 'SECURITY_TRANSFER', {
        symbol: 'TEST',
        currency: 'USD',
        at: at(5),
        quantity: '1',
        toAccountId: 'c',
    });
    const r = run(buys, { corrections: [move] }).rows.find(
        (p) => p.accountId === 'c'
    );
    assert.equal(r.realizedPnl, null);
    assert.equal(r.remainingCost, null);
    assert.match(r.issues.join(' '), /原|원 취득 순서/);
});

test('currency totals sum exact rationals before a single final rounding', () => {
    const events = ['AAA', 'BBB'].flatMap((symbol) => [
        event(symbol + 'buy', 'BUY', '3', '1', 2, { symbol }),
        event(symbol + 'sell', 'SELL', '1', '1', 3, { symbol }),
    ]);
    const r = run(events);
    assert.equal(r.rows[0].remainingCost, '0.666666666666666667');
    assert.equal(r.currencies[0].remainingCost, '1.333333333333333333');
    assert.equal(r.currencies[0].realizedPnl, '1.333333333333333333');
});
