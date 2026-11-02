import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptedFifoInput } from '../lib/adopted-fifo-input.js';
import { calculateFifoAssets } from '../lib/fifo-asset-report.js';
import {
    incrementHash as hash,
    overlayIncrements,
} from '../lib/toss-ledger-increments.js';
import { order } from './support/toss-orders-fixture.mjs';
const makeRow = (id, extra = {}) => ({
    id: hash(id),
    accountId: 'wife',
    type: 'BUY',
    symbol: 'TEST',
    currency: 'USD',
    date: '2026-01-02',
    quantity: '1',
    amount: '100',
    commission: '0',
    tax: '0',
    isTransaction: true,
    ...extra,
});
function snapshot(rows, { references = true, sourceFamily = 'toss_api' } = {}) {
    return {
        rows,
        details: new Map(rows.map((r) => [r.id, { sourceFamily, fields: [] }])),
        orderReferences: references
            ? new Map(rows.map((r) => ['order:' + r.id, r.id]))
            : new Map(),
        unassignedRows: [],
        releaseId: hash('release'),
        snapshotAt: '2000-01-01',
    };
}
const run = (input, extra = {}) =>
    calculateFifoAssets({ ...input, today: '2026-01-31', ...extra });
const codes = (row) => row.recordedTradeQuantity.reasons.map((r) => r.code);

test('reference quantity uses canonical cumulative totals with exact decimals, while FIFO and current holdings remain unknown', () => {
    const input = adoptedFifoInput(
        snapshot([
            makeRow('buy', { quantity: '0.123456789123456789' }),
            makeRow('sell', {
                type: 'SELL',
                date: '2026-01-03',
                quantity: '0.023456789123456789',
                amount: '20',
            }),
        ])
    );
    const r = run(input).rows[0];
    assert.equal(r.recordedTradeQuantity.status, 'reference');
    assert.equal(r.recordedTradeQuantity.buys, '0.123456789123456789');
    assert.equal(r.recordedTradeQuantity.sells, '0.023456789123456789');
    assert.equal(r.recordedTradeQuantity.net, '0.1');
    assert.equal(r.quantity, null);
    assert.equal(r.remainingCost, null);
    assert.equal(r.realizedPnl, null);
    assert.equal(r.currentHoldingQuantity, null);
    assert(r.evidenceStatus.some((x) => x.category === 'coverage'));
    assert(r.evidenceStatus.some((x) => x.category === 'order'));
    assert.equal(input.events[0].timing, 'order_aggregate');
});
test('unproven source or missing identity is withheld; new evidence does not change original events or ledger revision', () => {
    const rows = [makeRow('buy')];
    const verified = adoptedFifoInput(snapshot(rows)),
        missing = adoptedFifoInput(snapshot(rows, { references: false }));
    assert.deepEqual(verified.events, missing.events);
    assert.equal(verified.ledgerRevision, missing.ledgerRevision);
    for (const input of [
        missing,
        adoptedFifoInput(
            snapshot(rows, { sourceFamily: 'toss_pdf_saved_parse' })
        ),
        { ...verified, recordedQuantityEvidence: null },
    ]) {
        const r = run(input).rows[0];
        assert.equal(r.recordedTradeQuantity.net, null);
        assert(codes(r).includes('ORDER_IDENTITY_UNVERIFIED'));
    }
    const ambiguous = snapshot(rows);
    ambiguous.orderReferences.set('second-alias', rows[0].id);
    assert.equal(
        run(adoptedFifoInput(ambiguous)).rows[0].recordedTradeQuantity.net,
        null
    );
});
test('replayed totals count once, competing versions are not summed or resolved by execution date', () => {
    const input = adoptedFifoInput(snapshot([makeRow('buy')]));
    const [e] = input.events;
    const replay = run({ ...input, events: [e, { ...e }] });
    assert.equal(replay.rows[0].recordedTradeQuantity.net, '1');
    assert.equal(replay.rows[0].recordedTradeQuantity.includedOrders, 1);
    const later = {
        ...e,
        id: hash('different-observation'),
        quantity: '2',
        amount: '200',
        at: '2026-01-03',
    };
    const evidence = structuredClone(input.recordedQuantityEvidence);
    evidence.orders[later.id] = { ...evidence.orders[e.id] };
    const conflict = run({
        ...input,
        events: [e, later],
        recordedQuantityEvidence: evidence,
    }).rows[0];
    assert.equal(conflict.recordedTradeQuantity.net, null);
    assert(codes(conflict).includes('ORDER_CONFLICT'));
    const cancelled = { ...later, quantity: '0', excluded: true };
    assert.equal(
        run({
            ...input,
            events: [e, cancelled],
            recordedQuantityEvidence: evidence,
        }).rows[0].recordedTradeQuantity.net,
        null
    );
});
test('existing latest-order projection supplies a single current identity and preserves baseline references', () => {
    const baseline = {
        rows: [],
        details: new Map(),
        orderReferences: new Map(),
        snapshotAt: '2000-01-01',
        releaseId: hash('r'),
    };
    const source = (q) => ({
        order: order('same-cumulative-order', {
            execution: {
                ...order().execution,
                filledQuantity: q,
                filledAmount: q === '1' ? '100' : '200',
                commission: '0',
                tax: '0',
            },
        }),
        observedAt: q === '1' ? '2026-01-04T00:00:00Z' : '2026-01-05T00:00:00Z',
        sourceHash: hash(q),
    });
    const projected = overlayIncrements(baseline, {
        verified: [
            {
                marker: { accountId: 'wife' },
                apiAccountHash: hash('account'),
                observations: [],
                apiOrders: [source('1'), source('2')],
            },
        ],
        revision: hash('revision'),
        entryCount: 1,
    });
    assert.equal(projected.rows.length, 1);
    assert.equal(projected.orderReferences.size, 1);
    assert.equal(baseline.orderReferences.size, 0);
    const r = run(adoptedFifoInput(projected)).rows[0];
    assert.equal(r.recordedTradeQuantity.net, '2');
    assert.equal(r.recordedTradeQuantity.includedOrders, 1);
    assert.equal(r.quantity, null);
    // Passing an older extra observation without a final-version reference is unsafe.
    const stale = makeRow('stale', {
        quantity: '1',
        ledgerAccountKey: projected.rows[0].ledgerAccountKey,
    });
    projected.rows.push(stale);
    projected.details.set(stale.id, { sourceFamily: 'toss_api', fields: [] });
    assert.equal(
        run(adoptedFifoInput(projected)).rows[0].recordedTradeQuantity.net,
        null
    );
});
test('partial cancellation retains its filled portion; unfilled, voided and excluded candidates contribute nothing', () => {
    const input = adoptedFifoInput(
        snapshot([
            makeRow('partial', { quantity: '0.5', state: '부분 체결 후 취소' }),
            makeRow('unfilled', { quantity: '0', isTransaction: false }),
            makeRow('void', { voidedAt: '2026-01-03' }),
            makeRow('candidate', { countInTotals: false, quantity: '999' }),
        ])
    );
    const r = run(input).rows[0];
    assert.equal(r.recordedTradeQuantity.net, '0.5');
    assert.equal(r.recordedTradeQuantity.excludedOrders, 3);
    assert.equal(run(input).excluded, 3);
});
test('missing/invalid quantity or record date remains unknown, future records do not become observed holdings', () => {
    for (const quantity of [null, 1, '-1', '0', 'NaN']) {
        const r = run(adoptedFifoInput(snapshot([makeRow('q', { quantity })])))
            .rows[0];
        assert.equal(r.recordedTradeQuantity.net, null);
        assert(codes(r).includes('QUANTITY_UNKNOWN'));
    }
    const dated = run(
        adoptedFifoInput(snapshot([makeRow('date', { date: '' })]))
    ).rows[0];
    assert(codes(dated).includes('RECORD_DATE_UNKNOWN'));
    assert.equal(
        run(
            adoptedFifoInput(
                snapshot([makeRow('future', { date: '2026-02-01' })])
            )
        ).rows.length,
        0
    );
    assert.equal(run(adoptedFifoInput(snapshot([]))).rows.length, 0);
});
test('balanced trade flow zero and negative net selling remain reference flows, never current holdings', () => {
    for (const sold of ['1', '2']) {
        const input = adoptedFifoInput(
            snapshot([
                makeRow('buy'),
                makeRow('sell', {
                    type: 'SELL',
                    quantity: sold,
                    date: '2026-01-03',
                }),
            ])
        );
        const r = run(input).rows[0];
        assert.equal(r.recordedTradeQuantity.net, sold === '1' ? '0' : '-1');
        assert.equal(r.currentHoldingQuantity, null);
        assert.equal(r.quantity, null);
    }
});
test('coinciding suffixes stay isolated by account/profile/currency', () => {
    const input = adoptedFifoInput(
        snapshot([
            makeRow('wife', { ledgerAccountKey: 'wife-toss:synthetic-0042' }),
            makeRow('husband', {
                accountId: 'husband',
                ledgerAccountKey: 'husband-toss:synthetic-0042',
                quantity: '2',
            }),
            makeRow('krw', { currency: 'KRW', quantity: '3' }),
        ])
    );
    const r = run(input);
    assert.equal(r.rows.length, 3);
    assert.deepEqual(
        r.rows.map((x) => x.recordedTradeQuantity.net),
        ['1', '2', '3']
    );
    assert.equal(run(input, { scope: 'wife' }).rows.length, 2);
    assert.equal(
        run(input, { scope: 'husband' }).rows[0].recordedTradeQuantity.net,
        '2'
    );
});
test('known split or transfer blocks unadjusted reference quantity without changing existing FIFO correction behavior', () => {
    const input = adoptedFifoInput(snapshot([makeRow('buy')]));
    const accountId = input.accounts[0].id;
    const split = {
        id: 'split',
        kind: 'SPLIT',
        accountId,
        symbol: 'TEST',
        currency: 'USD',
        at: '2026-01-03',
        numerator: '2',
        denominator: '1',
        note: 'synthetic action confirmed',
    };
    const r = run(input, { corrections: [split] }).rows[0];
    assert.equal(r.recordedTradeQuantity.net, null);
    assert(codes(r).includes('SHARE_MOVEMENT'));
    assert(r.evidenceStatus.some((x) => x.category === 'movement'));
    assert.equal(r.quantity, null);
    const documented = {
        ...input,
        events: input.events.map((e) => ({ ...e, timing: 'execution' })),
    };
    const numeric = run(documented, { corrections: [split] }).rows[0];
    assert.equal(numeric.quantity, '2');
    assert.equal(numeric.remainingCost, '100');
    assert.equal(numeric.currentHoldingQuantity, null);
});
test('manual opening is not recorded buying; cash coverage does not assert stock completeness; FX/cost reasons remain separate', () => {
    const input = adoptedFifoInput(
        snapshot([makeRow('buy', { commission: null })])
    );
    const id = input.accounts[0].id;
    const opening = {
        id: 'opening',
        kind: 'OPENING_LOT',
        accountId: id,
        symbol: 'TEST',
        currency: 'USD',
        at: '2025-01-01',
        quantity: '3',
        cost: '100',
        note: 'synthetic opening lot',
    };
    const coverage = {
        id: 'cash',
        kind: 'CASH_COVERAGE',
        accountId: id,
        currency: 'USD',
        from: '2020-01-01',
        to: '2026-01-31',
        note: 'synthetic cash only',
    };
    const r = run(input, { corrections: [opening, coverage] }).rows[0];
    assert.equal(r.recordedTradeQuantity.net, '1');
    assert.equal(r.currentHoldingQuantity, null);
    assert.equal(r.quantity, null);
    assert(
        r.evidenceStatus.some(
            (x) => x.category === 'coverage' && x.message.includes('미확인')
        )
    );
    assert(r.evidenceStatus.some((x) => x.category === 'cost'));
    assert(r.evidenceStatus.some((x) => x.category === 'fx'));
    const only = run({ ...input, events: [] }, { corrections: [opening] })
        .rows[0];
    assert.equal(only.recordedTradeQuantity.net, null);
    assert.equal(only.quantity, '3');
    assert.equal(only.currentHoldingQuantity, null);
});
