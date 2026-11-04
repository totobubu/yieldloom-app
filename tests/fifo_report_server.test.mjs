import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptedFifoInput } from '../lib/adopted-fifo-input.js';
import {
    emptyFifoState,
    activeFifoCorrections,
    changeFifoState,
} from '../lib/fifo-adjustments.js';
import { fifoReportHandler } from '../lib/fifo-report-handler.js';
import { readFinalLedger } from '../lib/final-ledger-snapshot.js';
import { finalLedgerFixture } from './support/final-ledger-fixture.mjs';
import { capitalHandler } from '../lib/portfolio-capital-handler.js';
import {
    reportDiagnosticError,
    normalizeReportDiagnostic,
} from '../lib/report-diagnostics.js';
async function fixture() {
    const f = finalLedgerFixture();
    const snapshot = await readFinalLedger(
        async (k) => f.objects.get(k),
        f.checkpoint
    );
    return { ...f, snapshot, input: adoptedFifoInput(snapshot) };
}
const request = (
    input,
    correction,
    expectedRevision = 0,
    id = 'fixture-request-00001'
) => ({
    action: 'add',
    requestId: id,
    expectedRevision,
    ledgerRevision: input.ledgerRevision,
    correction,
});
const opening = (input) => ({
    kind: 'OPENING_LOT',
    accountId: input.accounts[0].id,
    symbol: 'MANUAL',
    currency: 'USD',
    at: '2020-01-01',
    quantity: '1.123456789123456789',
    cost: '100',
    note: '원 취득일·수량 증빙 확인',
});

test('adapter reads adopted rows only; cancelled quantities and unbound PDFs are excluded, aggregates not promoted', async () => {
    const { snapshot, input } = await fixture();
    assert.ok(input.events.some((e) => e.excluded));
    assert.ok(
        input.events
            .filter((e) => e.type === 'BUY' && !e.excluded)
            .every((e) => e.timing === 'order_aggregate')
    );
    assert.ok(!input.accounts.some((a) => a.ownerId === 'unassigned'));
    assert.ok(
        input.events.every(
            (e) => e.quantity === null || typeof e.quantity === 'string'
        )
    );
    assert.equal(snapshot.rows.length, input.events.length);
    const partial = snapshot.rows.find(
        (row) => row.state === '부분 체결 후 취소'
    );
    const partialEvent = input.events.find(
        (e) => e.observationId === partial.id
    );
    assert.equal(partialEvent.quantity, '0.5');
    assert.equal(partialEvent.excluded, false);
    const unfilled = snapshot.rows.find((row) => row.isTransaction === false);
    assert.equal(
        input.events.find((e) => e.observationId === unfilled.id).excluded,
        true
    );
    const same = {
        ...snapshot,
        rows: [
            snapshot.rows[0],
            {
                ...snapshot.rows[0],
                accountId: 'husband',
                ledgerAccountKey: 'husband-toss:separate-account',
            },
        ],
    };
    const isolated = adoptedFifoInput(same);
    assert.equal(isolated.accounts.length, 2);
    assert.notEqual(isolated.events[0].id, isolated.events[1].id);
});
test('manual lot revisions append auditable entries; replay idempotent, conflicts and stale ledger rejected', async () => {
    const { input } = await fixture();
    const r = request(input, opening(input));
    const changed = changeFifoState(emptyFifoState(), r, input, {
        uid: 'fixture',
        now: () => '2026-01-01T00:00:00Z',
    });
    assert.equal(changed.state.revision, 1);
    assert.equal(changed.state.history[0].by, 'fixture');
    assert.equal(activeFifoCorrections(changed.state).length, 1);
    assert.equal(changeFifoState(changed.state, r, input).replayed, true);
    assert.throws(
        () =>
            changeFifoState(
                changed.state,
                { ...r, correction: { ...r.correction, cost: '200' } },
                input
            ),
        /요청 번호/
    );
    assert.throws(
        () =>
            changeFifoState(
                changed.state,
                { ...r, requestId: 'fixture-request-00002' },
                input
            ),
        /저장/
    );
    assert.throws(
        () =>
            changeFifoState(
                changed.state,
                { ...r, ledgerRevision: 'other' },
                input
            ),
        /장부 버전/
    );
    const reverted = changeFifoState(
        changed.state,
        {
            action: 'revert',
            targetId: r.requestId,
            requestId: 'fixture-revert-00001',
            expectedRevision: 1,
            ledgerRevision: input.ledgerRevision,
        },
        input,
        { uid: 'fixture' }
    ).state;
    assert.equal(activeFifoCorrections(reverted).length, 0);
    assert.equal(reverted.history.length, 2);
    assert.equal(changed.state.history.length, 1);
});

test('future confirmations are rejected and the history cap reserves enough room to undo additions', async () => {
    const { input } = await fixture();
    for (const c of [
        { ...opening(input), at: '2027-01-01' },
        {
            kind: 'CASH_COVERAGE',
            accountId: input.accounts[0].id,
            currency: 'USD',
            from: '2020-01-01',
            to: '2027-01-01',
            note: '확인 범위 합성 증빙',
        },
    ])
        assert.throws(
            () =>
                changeFifoState(emptyFifoState(), request(input, c), input, {
                    now: () => '2026-01-01T00:00:00Z',
                }),
            /미래/
        );
    let state = emptyFifoState();
    for (let i = 0; i < 300; i++)
        state = changeFifoState(
            state,
            request(
                input,
                opening(input),
                i,
                'fixture-limit-' + String(i).padStart(6, '0')
            ),
            input,
            { uid: 'fixture' }
        ).state;
    assert.throws(
        () =>
            changeFifoState(
                state,
                request(input, opening(input), 300, 'fixture-over-limit'),
                input
            ),
        /한도/
    );
    const ids = activeFifoCorrections(state).map((c) => c.id);
    for (const [i, id] of ids.entries())
        state = changeFifoState(
            state,
            {
                action: 'revert',
                targetId: id,
                expectedRevision: 300 + i,
                requestId: 'fixture-revert-' + String(i).padStart(6, '0'),
                ledgerRevision: input.ledgerRevision,
            },
            input,
            { uid: 'fixture' }
        ).state;
    assert.equal(state.history.length, 600);
    assert.equal(activeFifoCorrections(state).length, 0);
});
function memoryDatabase() {
    const values = new Map();
    let writes = 0,
        reads = 0;
    const doc = (path) => ({
        path,
        get: async () => {
            reads++;
            const data = values.get(path);
            return { exists: data !== undefined, data: () => data };
        },
        collection: (name) => ({
            doc: (id) => doc(path + '/' + name + '/' + id),
        }),
    });
    let pending = Promise.resolve();
    return {
        values,
        get writes() {
            return writes;
        },
        get reads() {
            return reads;
        },
        collection: (name) => ({ doc: (id) => doc(name + '/' + id) }),
        runTransaction: (fn) => {
            const task = pending.then(() =>
                fn({
                    get: (ref) => ref.get(),
                    set: (ref, data) => {
                        values.set(ref.path, structuredClone(data));
                        writes++;
                    },
                })
            );
            pending = task.catch(() => {});
            return task;
        },
    };
}
const response = () => ({
    headers: {},
    setHeader(k, v) {
        this.headers[k] = v;
    },
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});
async function server() {
    const f = await fixture(),
        db = memoryDatabase();
    db.values.set('sheetTrialLedgers/owner', { pageCount: 1 });
    db.values.set('sheetTrialLedgers/owner/pages/0', {
        rows: [
            {
                accountId: 'wife',
                source: { spreadsheetId: 'synthetic-workbook' },
            },
        ],
    });
    let snapshotFailure = null;
    const diagnosticLogs = [];
    let reads = 0,
        claims = {
            uid: 'owner',
            email: 'jomalkeun@gmail.com',
            email_verified: true,
        };
    const handler = fifoReportHandler({
        verify: async () => claims,
        database: () => db,
        checkpoint: f.checkpoint,
        store: {
            readFinalSnapshot: async () => {
                reads++;
                if (snapshotFailure) throw snapshotFailure;
                return f.snapshot;
            },
        },
        now: () => '2026-01-31T00:00:00Z',
        logDiagnostic: (record) => diagnosticLogs.push(record),
    });
    return {
        ...f,
        db,
        claims,
        calls: () => reads,
        setClaims: (v) => (claims = v),
        setSnapshotFailure: (v) => (snapshotFailure = v),
        diagnosticLogs,
        invoke: async (
            method = 'GET',
            body,
            query = {
                view: 'fifo-report',
                accountId: 'family',
                section: 'assets',
            }
        ) => {
            const res = response();
            await handler({ method, body, query }, res);
            return res;
        },
    };
}
test('GET uses existing workbook authorization, one adopted snapshot and one correction doc; no canonical writes', async () => {
    const s = await server(),
        r = await s.invoke();
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.input.source, 'adopted_private_snapshot');
    assert.equal(r.headers['X-Report-Document-Reads'], '3');
    assert.equal(s.db.reads, 3);
    assert.equal(s.calls(), 1);
    assert.equal(s.db.writes, 0);
    assert.equal(
        r.body.report.rows.find((r) => r.symbol === 'QDTE').remainingCost,
        null
    );
});
test('server additions persist only the separate correction document; restarts, replays and undo retain history', async () => {
    const s = await server(),
        first = await s.invoke(),
        input = first.body.input,
        r = request(input, opening(input));
    assert.equal((await s.invoke('POST', r)).statusCode, 200);
    assert.equal(s.db.writes, 1);
    assert.equal((await s.invoke('POST', r)).body.replayed, true);
    assert.equal(s.db.writes, 1);
    const next = await s.invoke();
    assert.equal(
        next.body.report.rows.find((r) => r.symbol === 'MANUAL').remainingCost,
        '100'
    );
    assert.equal(
        next.body.report.currencies.find((r) => r.currency === 'USD')
            .externalDeposits,
        null
    );
    assert.equal(next.body.adjustments.revision, 1);
    const undo = await s.invoke('POST', {
        action: 'revert',
        requestId: 'fixture-revert-00002',
        expectedRevision: 1,
        targetId: r.requestId,
        ledgerRevision: input.ledgerRevision,
    });
    assert.equal(undo.statusCode, 200);
    const end = await s.invoke();
    assert.equal(
        end.body.report.rows.some((r) => r.symbol === 'MANUAL'),
        false
    );
    assert.equal(end.body.adjustments.history.length, 2);
    assert.ok(
        [...s.db.values.keys()]
            .filter((k) => !k.endsWith('/state'))
            .every(
                (k) =>
                    k === 'sheetTrialLedgers/owner' ||
                    k === 'sheetTrialLedgers/owner/pages/0'
            )
    );
});
test('concurrent amendments use optimistic revision and another uid/workbook cannot read or write', async () => {
    const s = await server(),
        r = await s.invoke(),
        a = request(r.body.input, opening(r.body.input)),
        b = { ...a, requestId: 'fixture-request-00003' };
    const results = await Promise.all([
        s.invoke('POST', a),
        s.invoke('POST', b),
    ]);
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(s.db.writes, 1);
    s.setClaims({
        uid: 'other',
        email: 'jomalkeun@gmail.com',
        email_verified: true,
    });
    assert.equal((await s.invoke()).statusCode, 403);
    assert.equal((await s.invoke('POST', a)).statusCode, 403);
    s.setClaims({
        uid: 'owner',
        email: 'unknown@example.invalid',
        email_verified: true,
    });
    assert.equal((await s.invoke()).statusCode, 403);
});
test('stale dependent corrections remain undoable and never become a silently successful report', async () => {
    const s = await server();
    const first = await s.invoke();
    const c = opening(first.body.input);
    const a = request(first.body.input, c);
    await s.invoke('POST', a);
    const second = request(
        first.body.input,
        {
            kind: 'BASIS',
            accountId: c.accountId,
            targetId: 'manual:' + a.requestId,
            cost: '120',
            note: '수기 원가 근거 갱신',
        },
        1,
        'fixture-request-00004'
    );
    assert.equal((await s.invoke('POST', second)).statusCode, 200);
    await s.invoke('POST', {
        action: 'revert',
        requestId: 'fixture-revert-00003',
        expectedRevision: 2,
        targetId: a.requestId,
        ledgerRevision: first.body.input.ledgerRevision,
    });
    const blocked = await s.invoke();
    assert.equal(blocked.statusCode, 200);
    assert.equal(blocked.body.report, null);
    assert.ok(blocked.body.calculationError);
    assert.equal(blocked.body.adjustments.history.length, 3);
    assert.equal(
        (
            await s.invoke('POST', {
                action: 'revert',
                requestId: 'fixture-revert-00004',
                expectedRevision: 3,
                targetId: second.requestId,
                ledgerRevision: first.body.input.ledgerRevision,
            })
        ).statusCode,
        200
    );
    assert.ok((await s.invoke()).body.report);
});
test('legacy capital API no longer strips cancellation flags and passes voided cash/trades', async () => {
    const row = {
        symbol: 'TEST',
        type: 'buy',
        date: '20260101',
        currency: 'USD',
        quantity: 1,
        nativeSettlementAmount: 100,
    };
    const doc = (id, data) => ({ id, data: () => data });
    const db = {
        doc: (path) => ({
            get: async () => ({
                exists: true,
                data: () =>
                    path.startsWith('investmentAccounts/')
                        ? {
                              permissions: { owner: 'owner' },
                              familyId: 'family',
                              entriesRevision: 1,
                          }
                        : { participantUids: ['owner'] },
            }),
        }),
        collection: (path) => ({
            get: async () => ({
                docs: path.endsWith('/entries')
                    ? [
                          doc('old', { row, voidedAt: '2026-01-02' }),
                          doc('cash', {
                              row: { ...row, symbol: 'CASH' },
                              voidedAt: '2026-01-02',
                          }),
                          doc('active', { row }),
                      ]
                    : [],
            }),
        }),
    };
    const h = capitalHandler({
        verify: async () => ({ uid: 'owner' }),
        database: () => db,
        durableReadModels: false, // Explicitly exercise the legacy rollback path.
    });
    const res = response();
    await h({ method: 'GET', query: { accountId: 'a' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.trades.length, 1);
    assert.equal(res.body.trades[0].id, 'active');
    assert.equal(res.body.importedCash.length, 0);
});

test('authorized failures return stable allowlisted diagnostics with unique opaque IDs; upstream details never escape', async () => {
    const s = await server();
    const secret =
        'SYNTHETIC_PRIVATE_SOURCE account=0042 token=private /private/object hash=' +
        'b'.repeat(64);
    const failures = [
        [
            reportDiagnosticError('INC_RECEIPT_DIGEST'),
            'INC_RECEIPT_DIGEST',
            'receipt',
            409,
        ],
        [
            Object.assign(Error(secret), {
                code: 'INCREMENT_INTEGRITY_FAILED',
                diagnosticCode: secret,
                status: 418,
                cause: secret,
            }),
            'INC_UNCLASSIFIED',
            'increment',
            409,
        ],
        [Error(secret), 'REPORT_SNAPSHOT_READ', 'snapshot', 503],
    ];
    const ids = new Set();
    for (const [failure, code, stage, status] of failures) {
        s.setSnapshotFailure(failure);
        for (let i = 0; i < 2; i++) {
            const r = await s.invoke();
            assert.equal(r.statusCode, status);
            assert.equal(r.body.diagnostic.code, code);
            assert.equal(r.body.diagnostic.stage, stage);
            assert.deepEqual(
                normalizeReportDiagnostic(r.body.diagnostic),
                r.body.diagnostic
            );
            assert.equal(
                r.headers['X-Report-Request-ID'],
                r.body.diagnostic.requestId
            );
            assert(!ids.has(r.body.diagnostic.requestId));
            ids.add(r.body.diagnostic.requestId);
            assert.deepEqual(s.diagnosticLogs.at(-1), {
                requestId: r.body.diagnostic.requestId,
                code,
                stage,
            });
            assert(
                !JSON.stringify([r.body, r.headers, s.diagnosticLogs]).includes(
                    'SYNTHETIC_PRIVATE_SOURCE'
                )
            );
            assert(!JSON.stringify(r.body).includes('b'.repeat(64)));
            assert.equal(r.body.report, undefined);
            assert.equal(r.body.input, undefined);
        }
    }
    assert.equal(s.db.writes, 0);
    s.setSnapshotFailure(null);
    assert.equal((await s.invoke()).statusCode, 200);
});
test('denied admin and workbook paths reveal no diagnostic, object existence or storage failures', async () => {
    const s = await server();
    s.setSnapshotFailure(reportDiagnosticError('INC_INDEX_READ'));
    s.setClaims({
        uid: 'owner',
        email: 'denied@example.invalid',
        email_verified: true,
    });
    const denied = await s.invoke();
    assert.equal(denied.statusCode, 403);
    assert.equal(s.calls(), 0);
    assert.equal(s.db.reads, 0);
    s.setClaims(s.claims);
    s.db.values.delete('sheetTrialLedgers/owner/pages/0');
    const missing = await s.invoke();
    assert.equal(missing.statusCode, 403);
    assert.equal(s.calls(), 0);
    const deniedDatabase = fifoReportHandler({
        verify: async () => s.claims,
        database: () => {
            throw Error('SYNTHETIC_PRIVATE_SOURCE');
        },
        store: {
            readFinalSnapshot: () => {
                throw Error('must_not_read');
            },
        },
        logDiagnostic: () => {
            throw Error('must_not_log');
        },
    });
    const inaccessible = response();
    await deniedDatabase({ method: 'GET', query: {} }, inaccessible);
    assert.equal(inaccessible.statusCode, 503);
    for (const r of [denied, missing, inaccessible]) {
        assert.equal(r.body.diagnostic, undefined);
        assert.equal(r.headers['X-Report-Request-ID'], undefined);
        assert(!JSON.stringify(r.body).includes('SYNTHETIC_PRIVATE_SOURCE'));
    }
    assert.deepEqual(s.diagnosticLogs, []);
});
test('uncertain transaction failure is a write diagnostic and never claims a successful save', async () => {
    const s = await server();
    s.db.runTransaction = async () => {
        throw Error('SYNTHETIC_PRIVATE_SOURCE commit outcome');
    };
    const r = await s.invoke('POST', {});
    assert.equal(r.statusCode, 503);
    assert.equal(r.body.diagnostic.code, 'REPORT_ADJUSTMENTS_WRITE');
    assert.equal(r.body.diagnostic.stage, 'adjustment_write');
    assert.equal(r.body.revision, undefined);
    assert(!JSON.stringify(r.body).includes('SYNTHETIC_PRIVATE_SOURCE'));
    assert.equal(s.db.writes, 0);
});

test('verification exceptions and logging failures cannot disclose upstream messages or alter authorization', async () => {
    const logged = [];
    const handler = fifoReportHandler({
        verify: async () => {
            throw Object.assign(Error('SYNTHETIC_PRIVATE_SOURCE'), {
                code: 'INCREMENT_INTEGRITY_FAILED',
                status: 409,
            });
        },
        database: () => {
            throw Error('must_not_read');
        },
        store: {},
        logDiagnostic: (record) => logged.push(record),
    });
    const r = response();
    await handler({ method: 'GET', query: {} }, r);
    assert.equal(r.statusCode, 401);
    assert.equal(r.body.diagnostic, undefined);
    assert.equal(r.headers['X-Report-Request-ID'], undefined);
    assert.deepEqual(logged, []);
    assert(!JSON.stringify(r).includes('SYNTHETIC_PRIVATE_SOURCE'));
});
