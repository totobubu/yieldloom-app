import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeObservation,
    acceptEvidence,
    candidates,
} from '../lib/sheet-reconciliation.js';
import {
    dividendState,
    dividendStatusLabel,
    projectDividendState,
} from '../lib/sheet-dividend-state.js';
import {
    submitObservationBatch,
    readBatchOriginal,
    readObservation,
    listObservations,
    observationHash,
} from '../lib/sheet-observation-store.js';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import { memoryDb } from './helpers/sheet-memory-db.mjs';
const input = (confirmation = '확정', payment = '지급', patch = {}) => ({
    kind: 'TOSS_EXPECTED_DIVIDEND',
    sourceId: 'synthetic-dividend',
    accountId: 'wife',
    type: 'DIVIDEND',
    symbol: 'TEST',
    location: '합성 과거 배당 상세',
    dividendState: {
        confirmationStatusRaw: confirmation,
        paymentStatusRaw: payment,
    },
    values: {
        date: '2024-01-02',
        paymentDate: '2024-01-10',
        netDividendUsd: 1,
        ...(payment === '지급' ? { paidAt: '2024-01-10' } : {}),
    },
    rawText: `합성 ${confirmation} ${payment}`,
    ...patch,
});
const receipt = {
    id: 'cash:receipt',
    accountId: 'wife',
    type: 'DEPOSIT',
    symbol: '',
    date: '2024-01-10',
    cashUsd: 1,
};
const body = (o, patch = {}) => ({
    observationId: o.id,
    targetId: receipt.id,
    fields: ['netDividendUsd'],
    note: '합성 실제 입금 원문 대조',
    ...patch,
});
const accept = (rows, o, patch = {}) =>
    acceptEvidence(
        rows,
        [o],
        body(o, patch),
        'synthetic-admin',
        '2026-10-25T00:00:00Z',
        '2026-10-25'
    );
const batch = (observations, batchId = 'synthetic-status-1') => ({
    accountId: 'wife',
    batchId,
    checkpoint: {
        sourceHash: 'a'.repeat(64),
        offset: 0,
        count: observations.length,
    },
    observations,
});

test('menu provenance does not imply forecast: confirmed paid/unpaid, unconfirmed unpaid and missing states remain distinct independent of year', () => {
    for (const [confirmation, payment, expected, eligible, forecast] of [
        ['확정', '지급', '확정 · 지급', true, false],
        ['확정', '미지급', '확정 · 미지급', false, false],
        ['미확정', '미지급', '미확정 · 미지급', false, true],
        ['', '', '미확인 · 미확인', false, false],
    ]) {
        const o = normalizeObservation(input(confirmation, payment));
        assert.equal(dividendStatusLabel(o), expected);
        assert.equal(dividendState(o).cashEligible, eligible);
        assert.equal(o.forecast, forecast);
    }
    const unknown = normalizeObservation(
        input('', '', {
            dividendState: undefined,
            values: { date: '2024-01-10', netDividendUsd: 1 },
        })
    );
    assert.equal(unknown.values.paymentStatus, 'UNKNOWN');
    assert.equal(candidates([receipt], unknown).length, 0);
    assert.throws(() => accept([receipt], unknown), /미확인/);
    assert.equal(
        normalizeObservation(
            input('확정', '지급', { kind: 'TOSS_TRANSACTION' })
        ).forecast,
        false
    );
});

test('status claims require matching raw evidence; contradictory flags, unpaid paidAt and invalid dates are rejected', () => {
    assert.throws(() => normalizeObservation(input('미확정', '지급')), /모순/);
    assert.throws(
        () =>
            normalizeObservation(
                input('확정', '미지급', { values: { paidAt: '2024-01-10' } })
            ),
        /미지급/
    );
    for (const invalid of [
        '2025-02-29',
        '2024-02-30',
        '2024-01-10 24:00',
        '2024-01-10T12:61:00',
        'not-a-date',
    ])
        assert.throws(
            () =>
                normalizeObservation(
                    input('확정', '지급', { values: { paidAt: invalid } })
                ),
            /paidAt/
        );
    assert.throws(
        () =>
            normalizeObservation(
                input('', '', {
                    values: {
                        confirmationStatus: 'CONFIRMED',
                        paymentStatus: 'PAID',
                    },
                })
            ),
        /원문/
    );
    assert.throws(
        () =>
            normalizeObservation(
                input('확정', '미지급', { values: { paymentStatus: 'PAID' } })
            ),
        /원문/
    );
    assert.throws(
        () =>
            normalizeObservation(
                input('확정', '지급', { values: { paymentStatus: 'SETTLED' } })
            ),
        /지급 상태/
    );
    assert.throws(
        () =>
            normalizeObservation({
                ...input(),
                kind: 'TOSS_ORDER',
                type: 'BUY',
            }),
        /배당 관측/
    );
});

test('actual paidAt keeps date/minute/second/millisecond precision; scheduled paymentDate never stands in for paidAt', () => {
    for (const paidAt of [
        '2024-02-29',
        '2024-01-10 14:51',
        '2024-01-10 14:51:05',
        '2024-01-10 14:51:05.005',
    ]) {
        assert.equal(
            normalizeObservation(input('확정', '지급', { values: { paidAt } }))
                .values.paidAt,
            paidAt
        );
    }
    const noActualDate = normalizeObservation(
        input('확정', '지급', {
            values: { paymentDate: receipt.date, netDividendUsd: 1 },
        })
    );
    assert.equal(candidates([receipt], noActualDate).length, 0);
    assert.throws(() => accept([receipt], noActualDate), /実際|실제 지급일/);
});

test('paid evidence can only link an existing matching receipt: no new cash event or financial field overwrite across two sources', () => {
    const rows = [receipt],
        before = structuredClone(rows);
    for (const kind of ['TOSS_EXPECTED_DIVIDEND', 'TOSS_TRANSACTION']) {
        const o = normalizeObservation(input('확정', '지급', { kind }));
        assert.deepEqual(
            candidates(rows, o).map((r) => r.id),
            [receipt.id]
        );
        const result = accept(rows, o);
        assert.equal(result.rows, rows);
        assert.deepEqual(result.rows, before);
        assert.equal(result.observations[0].receiptLink.targetId, receipt.id);
        assert.equal(result.observations[0].values.netDividendUsd, 1);
        assert.throws(
            () => accept(rows, o, { targetId: null, separateEvent: true }),
            /새 입금/
        );
        assert.throws(
            () => accept(rows, result.observations[0], { targetId: 'another' }),
            /기존 입금/
        );
    }
    const sameDividend = {
        ...receipt,
        type: 'DIVIDEND',
        symbol: 'TEST',
        netDividendUsd: 1,
    };
    assert.equal(
        accept([sameDividend], normalizeObservation(input())).rows.length,
        1
    );
    const mixed = [receipt, { ...receipt, id: 'another' }];
    const linked = accept(mixed, normalizeObservation(input())).observations[0];
    assert.throws(
        () => accept(mixed, linked, { targetId: 'another' }),
        /중복 연결/
    );
});

test('receipt matching rejects different account/date/ticker/type/amount, missing shared currency and future actual receipt', () => {
    const o = normalizeObservation(input());
    for (const patch of [
        { accountId: 'husband' },
        { date: '2024-01-11' },
        { symbol: 'OTHER' },
        { type: 'WITHDRAWAL' },
        { cashUsd: 2 },
        { cashUsd: null, cashKrw: 1300 },
        { cashUsd: 0 },
    ])
        assert.throws(() => accept([{ ...receipt, ...patch }], o), /일치/);
    const conflict = normalizeObservation(
        input('확정', '지급', {
            values: { paidAt: receipt.date, netDividendUsd: 1, cashUsd: 2 },
        })
    );
    assert.throws(() => accept([receipt], conflict), /일치/);
    const future = normalizeObservation(
        input('확정', '지급', {
            values: { paidAt: '2027-01-10', netDividendUsd: 1 },
        })
    );
    assert.throws(
        () => accept([{ ...receipt, date: '2027-01-10' }], future),
        /미래/
    );
});

test('batch state and originals roundtrip exactly, replay writes zero, revised status cannot overwrite the original ID', async () => {
    const db = memoryDb(),
        root = db.doc('sheetTrialLedgers/synthetic-dividends');
    const observations = [
        input(),
        input('확정', '미지급', { sourceId: 'unpaid' }),
        input('미확정', '미지급', { sourceId: 'forecast' }),
        input('', '', { sourceId: 'unknown' }),
    ];
    const request = batch(observations);
    await submitObservationBatch(db, root, request);
    const before = db.writes.length;
    assert.equal(
        (await submitObservationBatch(db, root, request)).replayed,
        true
    );
    assert.equal(db.writes.length, before);
    assert.deepEqual(
        (await readBatchOriginal(root, 'wife', request.batchId)).originals,
        observations
    );
    assert.equal((await listObservations(root, 'wife')).observations.length, 4);
    const snapshot = observationHash([...db.store]);
    await assert.rejects(
        submitObservationBatch(
            db,
            root,
            batch([input('확정', '미지급')], 'revision-collision')
        ),
        (e) => e.status === 409
    );
    assert.equal(observationHash([...db.store]), snapshot);
    assert.equal((await root.get()).exists, false); // no canonical ledger was created by ingestion
});

test('legacy missing-state observations stay unknown without migration and identical original imports deduplicate', async () => {
    const db = memoryDb(),
        root = db.doc('sheetTrialLedgers/synthetic-legacy');
    const raw = input('', '', {
        dividendState: undefined,
        values: { date: '2024-01-10', netDividendUsd: 1 },
    });
    const legacy = normalizeObservation(raw);
    delete legacy.dividendState;
    delete legacy.values.confirmationStatus;
    delete legacy.values.paymentStatus;
    legacy.forecast = true;
    db.store.set(root.path, { version: 1, pageCount: 0, evidencePageCount: 1 });
    db.store.set(`${root.path}/evidencePages/0`, { observations: [legacy] });
    const before = observationHash(
        db.store.get(`${root.path}/evidencePages/0`)
    );
    assert.equal(
        projectDividendState(legacy).dividendState.cashEligible,
        false
    );
    assert.equal(
        (await submitObservationBatch(db, root, batch([raw]))).receipt.inserted,
        0
    );
    assert.equal(
        observationHash(db.store.get(`${root.path}/evidencePages/0`)),
        before
    );
    assert.throws(() => accept([receipt], legacy), /미확인/);
});

test('an old record projection can read normalized state from its immutable batch original without changing any stored bytes', async () => {
    const db = memoryDb(),
        root = db.doc('sheetTrialLedgers/synthetic-old-projection');
    await submitObservationBatch(db, root, batch([input()]));
    const key = `${root.path}/reconciliationAccounts/wife/observations/${observationHash(normalizeObservation(input()).id)}`;
    const record = db.store.get(key);
    delete record.observation.dividendState;
    delete record.observation.values.paymentStatus;
    delete record.observation.values.confirmationStatus;
    record.observation.forecast = true;
    const before = observationHash([...db.store]);
    const result = await readObservation(root, 'wife', record.observation.id, {
        includeOriginal: true,
    });
    assert.equal(result.observation.dividendState.cashEligible, true);
    assert.equal(result.observation.forecast, false);
    assert.equal(observationHash([...db.store]), before);
});

test('authenticated API links two paid observations to one receipt without rewriting canonical pages or originals', async () => {
    const db = memoryDb([
        ['sheetTrialLedgers/admin', { version: 1, pageCount: 1, rowCount: 1 }],
        ['sheetTrialLedgers/admin/pages/0', { rows: [receipt] }],
    ]);
    const handler = sheetLedgerHandler({
        database: () => db,
        verify: async () => ({
            uid: 'admin',
            email: 'jomalkeun@gmail.com',
            email_verified: true,
        }),
        now: () => new Date('2026-10-25T00:00:00Z'),
    });
    async function invoke(payload) {
        const res = {
            setHeader() {},
            status(code) {
                this.code = code;
                return this;
            },
            json(value) {
                this.value = value;
            },
        };
        await handler({ method: 'POST', body: payload, query: {} }, res);
        assert.equal(res.code, 200, res.value.error);
        return res.value;
    }
    const raw = [input(), input('확정', '지급', { kind: 'TOSS_TRANSACTION' })],
        saved = await invoke({ action: 'batch-commit', ...batch(raw) });
    const original = observationHash(
        [...db.store].filter(([p]) => p.includes('/originalChunks/'))
    );
    let version = 1;
    for (const o of saved.observationDelta) {
        const linked = await invoke({
            action: 'accept-evidence',
            accountId: 'wife',
            version,
            ...body(o),
        });
        version = linked.version;
        assert.deepEqual(linked.rows, [receipt]);
    }
    assert.deepEqual(db.store.get('sheetTrialLedgers/admin/pages/0').rows, [
        receipt,
    ]);
    assert.equal(
        db.writes.filter((p) => p === 'sheetTrialLedgers/admin/pages/0').length,
        0
    );
    assert.equal(
        observationHash(
            [...db.store].filter(([p]) => p.includes('/originalChunks/'))
        ),
        original
    );
});
