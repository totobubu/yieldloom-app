import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkbook, validateEdit } from '../lib/sheet-ledger.js';
import {
    acceptEvidence,
    classifyCash,
    compareEvidence,
    normalizeObservation,
    stageObservations,
    summarizeCapital,
} from '../lib/sheet-reconciliation.js';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import { memoryDb } from './helpers/sheet-memory-db.mjs';

test('manual add keeps unknowns and precision, survives reads and retry without duplicate writes', async () => {
    const h = harness();
    const body = {
        action: 'add-manual',
        requestId: '00000000-0000-4000-8000-000000000001',
        version: 0,
        data: {
            accountId: 'wife',
            type: 'BUY',
            symbol: 'FAKE',
            values: {
                date: '2025-02-03',
                transactionAt: '2025-02-03 13:42',
                purchaseUsd: 123,
                commissionUsd: null,
                timeZone: null,
            },
        },
    };
    const added = await h.invoke('POST', body);
    assert.equal(added.code, 200, added.payload.error);
    const r = added.payload.rows[0];
    assert.equal(r.source.kind, 'manual');
    assert.equal(r.needsReview, true);
    assert.equal(r.status, '미확인');
    assert.equal(r.commissionUsd, null);
    assert.equal(r.timePrecision, 'minute');
    assert.equal(r.transactionAt, '2025-02-03 13:42');
    const writes = h.db.writes.length;
    const retry = await h.invoke('POST', body);
    assert.equal(retry.code, 200);
    assert.equal(retry.payload.imported, 0);
    assert.equal(h.db.writes.length, writes);
    assert.deepEqual((await h.invoke('GET')).payload.rows, added.payload.rows);
    assert.equal(
        (
            await h.invoke('POST', {
                ...body,
                data: {
                    ...body.data,
                    values: { date: '2025-02-03', purchaseUsd: 999 },
                },
            })
        ).code,
        409
    );
    assert.equal(
        (
            await h.invoke('POST', {
                ...body,
                requestId: '00000000-0000-4000-8000-000000000002',
                version: 1,
                data: {
                    ...body.data,
                    values: { date: '2025-02-30', commissionUsd: -1 },
                },
            })
        ).code,
        400
    );
    assert.equal(h.googleReads(), 0);
    assert(
        h.db.writes.every(
            (p) =>
                p === 'sheetTrialLedgers/admin' ||
                p.startsWith('sheetTrialLedgers/admin/')
        )
    );
});

const buy = (id = 'sheet:buy', accountId = 'wife') => ({
    id,
    accountId,
    type: 'BUY',
    date: '2025-02-03',
    symbol: 'TEST',
    quantity: 1.25,
    purchaseUsd: 25,
    sourceValues: { date: '2025-02-03', quantity: 1.25, purchaseUsd: 25 },
    source: { sheet: '妻', row: 10 },
    fieldStatus: {},
    evidence: [],
    status: '미확인',
    fundingSource: '미확인',
    reinvested: null,
});
const observation = (patch = {}) => ({
    kind: 'TOSS_ORDER',
    sourceId: 'synthetic-order',
    accountId: 'wife',
    type: 'BUY',
    symbol: 'TEST',
    location: '합성 주문 상세',
    values: {
        date: '2025-02-03',
        quantity: 1.25,
        purchaseUsd: 25,
        orderAmountUsd: 27,
        executedAt: '2025-02-03 16:10',
        transactionAt: '2025-02-03 16:10:12.345',
        fxFeeKrw: 7,
        usedKrw: 30007,
        fxFeeIncluded: true,
        timeZone: null,
    },
    ...patch,
});
const accept = (rows, observations, patch = {}) =>
    acceptEvidence(
        rows,
        observations,
        {
            observationId: observations[0].id,
            targetId: rows[0]?.id ?? null,
            fields: ['fxFeeKrw', 'executedAt'],
            note: '합성 상세 원문 확인',
            ...patch,
        },
        'admin',
        '2026-10-25T00:00:00Z',
        '2026-10-25'
    );

test('observed minute/millisecond precision and unknown costs remain exact; no inferred fee from order difference', () => {
    const o = normalizeObservation(observation());
    assert.equal(o.values.executedAt, '2025-02-03 16:10');
    assert.equal(o.values.transactionAt, '2025-02-03 16:10:12.345');
    assert.equal(o.values.timeZone, null);
    assert.equal(o.values.commissionUsd, undefined);
    assert.equal(o.values.usedKrw, 30007);
    assert.equal(o.values.fxFeeIncluded, true);
    assert.throws(() =>
        normalizeObservation(
            observation({ values: { executedAt: '2025-02-30 24:00' } })
        )
    );
    assert.throws(() =>
        normalizeObservation(observation({ values: { fxFeeKrw: -1 } }))
    );
    assert.throws(() =>
        normalizeObservation(observation({ accountId: 'third' }))
    );
    assert.throws(() =>
        normalizeObservation(observation({ values: { unknownColumn: 1 } }))
    );
});

test('staging never overwrites ledger; unique same-account matching is only a suggestion; duplicate IDs cannot overwrite evidence', () => {
    const rows = [buy(), buy('husband', 'husband')],
        before = structuredClone(rows);
    const stage = stageObservations(rows, [], [observation(), observation()]);
    assert.equal(stage.additions.length, 1);
    assert.equal(stage.duplicates, 1);
    assert.equal(stage.additions[0].targetId, 'sheet:buy');
    assert.deepEqual(rows, before);
    const reversed = {
        ...observation(),
        values: Object.fromEntries(
            Object.entries(observation().values).reverse()
        ),
    };
    assert.equal(
        stageObservations(rows, stage.additions, [reversed]).duplicates,
        1
    );
    assert.throws(() =>
        stageObservations(rows, stage.additions, [
            observation({ values: { date: '2025-02-03', purchaseUsd: 10 } }),
        ])
    );
    assert.equal(
        stageObservations([buy(), buy('second')], [], [observation()])
            .additions[0].targetId,
        null
    );
});

test('field acceptance preserves sheet source and parallel PDF/Toss conflicts with administrator audit', () => {
    const row = buy(),
        input = observation({
            values: {
                date: row.date,
                purchaseUsd: 25.01,
                fxFeeKrw: 7,
                executedAt: '2025-02-03 16:10',
            },
        });
    const pdf = observation({
        kind: 'PDF',
        sourceId: 'pdf-1',
        values: { date: row.date, purchaseUsd: 25.02 },
    });
    const obs = stageObservations([row], [], [input, pdf]).additions;
    const before = structuredClone({ row, obs });
    const result = accept([row], obs, {
        fields: ['purchaseUsd', 'executedAt'],
    });
    assert.deepEqual({ row, obs }, before);
    assert.equal(result.rows[0].purchaseUsd, 25.01);
    assert.equal(result.rows[0].fxFeeKrw, undefined);
    assert.equal(result.rows[0].sourceValues.purchaseUsd, 25);
    assert.deepEqual(result.rows[0].source, row.source);
    const comparison = compareEvidence(
        result.rows[0],
        result.observations
    ).find((c) => c.field === 'purchaseUsd');
    assert.equal(comparison.conflict, true);
    assert.equal(comparison.sources.length, 2);
    assert.equal(comparison.decision.actor, 'admin');
    assert.equal(result.rows[0].review.history.length, 1);
    assert.throws(() => accept([buy('husband', 'husband')], obs));
    assert.throws(() => accept([row], obs, { note: '' }));
});

test('expected dividends and future actual events cannot become paid ledger transactions', () => {
    const forecast = stageObservations(
        [],
        [],
        [
            observation({
                kind: 'TOSS_EXPECTED_DIVIDEND',
                type: 'DIVIDEND',
                values: { date: '2027-01-01', netDividendUsd: 10 },
            }),
        ]
    ).additions;
    assert.equal(forecast[0].targetId, null);
    assert.throws(
        () => accept([], forecast, { fields: ['date', 'netDividendUsd'] }),
        /예상 배당/
    );
    const future = stageObservations(
        [],
        [],
        [observation({ values: { date: '2027-01-01', purchaseUsd: 10 } })]
    ).additions;
    assert.throws(
        () => accept([], future, { fields: ['date', 'purchaseUsd'] }),
        /미래/
    );
    const scheduled = stageObservations(
        [],
        [],
        [
            observation({
                values: {
                    date: '2025-02-03',
                    scheduledSettlementDate: '2027-01-01',
                    settlementLabel: '예정',
                },
            }),
        ]
    ).additions;
    const saved = accept([], scheduled, {
        fields: ['date', 'scheduledSettlementDate', 'settlementLabel'],
    });
    assert.equal(saved.rows[0].scheduledSettlementDate, '2027-01-01');
    assert.equal(saved.rows[0].settledAt, undefined);
    assert.throws(
        () =>
            accept(saved.rows, saved.observations, {
                targetId: null,
                fields: ['date'],
            }),
        /중복/
    );
});

const cash = (
    id,
    type,
    amount,
    origin,
    scope = 'EXTERNAL',
    accountId = 'wife'
) => ({
    id,
    type,
    accountId,
    date: '2025-02-03',
    cashKrw: amount,
    capital: origin ? { origin, scope } : null,
});
test('external net and principal differ; dividend reuse withdrawal never reduces principal; mixed/unknown remains unconfirmed', () => {
    const rows = [
        cash('in', 'DEPOSIT', 1000, 'PRINCIPAL'),
        cash('profit', 'WITHDRAWAL', 200, 'DIVIDEND_PROFIT'),
        cash('unknown', 'WITHDRAWAL', 100, 'UNKNOWN'),
        cash('principal', 'WITHDRAWAL', 100, 'PRINCIPAL'),
        cash('mixed', 'WITHDRAWAL', 50, 'MIXED'),
        { ...buy(), purchaseKrw: 30007, type: 'FX', fxFeeKrw: 7 },
        buy('second'),
    ];
    const totals = summarizeCapital(rows).currencies.Krw;
    assert.equal(totals.externalNet, 550);
    assert.equal(totals.confirmedPrincipal, 900);
    assert.equal(totals.dividendReuseWithdrawals, 200);
    assert.equal(totals.pending, 2);
    assert.equal(totals.complete, false);
    assert.equal(summarizeCapital([]).currencies.Krw.complete, false);
});
test('household transfers are not external principal, retain separate account direction, and never allocate mixed origin', () => {
    const rows = [
        cash('wife-out', 'WITHDRAWAL', 300, 'MIXED', 'ACCOUNT_TRANSFER'),
        cash(
            'husband-in',
            'DEPOSIT',
            300,
            'MIXED',
            'ACCOUNT_TRANSFER',
            'husband'
        ),
    ];
    assert.equal(summarizeCapital(rows).currencies.Krw.externalNet, 0);
    assert.equal(summarizeCapital(rows).currencies.Krw.confirmedPrincipal, 0);
    assert.equal(
        summarizeCapital(rows, 'wife').currencies.Krw.transferNet,
        -300
    );
    assert.equal(
        summarizeCapital(rows, 'husband').currencies.Krw.transferNet,
        300
    );
});
test('cash classification requires linked same-account evidence and explicit reason; amount changes invalidate classification', () => {
    const obs = stageObservations(
        [],
        [],
        [
            observation({
                kind: 'TOSS_TRANSACTION',
                type: 'WITHDRAWAL',
                symbol: '',
                values: { date: '2025-02-03', cashKrw: 200 },
            }),
        ]
    ).additions;
    const created = accept([], obs, { fields: ['date', 'cashKrw'] });
    const row = created.rows[0],
        body = {
            id: row.id,
            scope: 'EXTERNAL',
            origin: 'DIVIDEND_PROFIT',
            evidenceIds: [obs[0].id],
            note: '배당 현금 → 환전 → 출금 연결 근거 확인',
        };
    const classified = classifyCash(
        created.rows,
        created.observations,
        body,
        'admin',
        'now'
    );
    assert.equal(
        summarizeCapital(classified).currencies.Krw.confirmedPrincipal,
        0
    );
    assert.throws(() =>
        classifyCash(
            created.rows,
            created.observations,
            { ...body, evidenceIds: [] },
            'admin',
            'now'
        )
    );
    assert.throws(() =>
        classifyCash(
            created.rows,
            created.observations,
            { ...body, scope: 'ACCOUNT_TRANSFER', peerAccountId: 'wife' },
            'admin',
            'now'
        )
    );
    const changed = validateEdit(classified[0], {
        ...classified[0],
        cashKrw: 300,
    });
    assert.equal(changed.capital, null);
    assert.equal(changed.sourceValues.cashKrw, undefined);
    const conflict = stageObservations(classified, created.observations, [
        observation({
            kind: 'TOSS_TRANSACTION',
            sourceId: 'revision',
            type: 'WITHDRAWAL',
            symbol: '',
            values: { date: '2025-02-03', cashKrw: 300 },
        }),
    ]);
    const revised = accept(
        classified,
        [...created.observations, ...conflict.additions],
        {
            observationId: conflict.additions[0].id,
            targetId: row.id,
            fields: ['cashKrw'],
        }
    );
    assert.equal(revised.rows[0].capital, null);
});

const fakeDb = memoryDb;
const response = () => ({
    setHeader() {},
    status(code) {
        this.code = code;
        return this;
    },
    json(payload) {
        this.payload = payload;
        return this;
    },
});
const testWorkbook = () => ({
    spreadsheetId: 'fixture',
    sheets: ['夫', '夫배당', '妻', '妻배당'].map((title, sheetId) => ({
        properties: { title, sheetId },
        data: [
            {
                startRow: 10,
                rowData: [
                    {
                        values: [
                            {
                                userEnteredValue: {
                                    stringValue: title.includes('배당')
                                        ? 'TEST'
                                        : '2027-01-01',
                                },
                            },
                            {
                                userEnteredValue: title.includes('배당')
                                    ? { stringValue: '2027-01-01' }
                                    : { numberValue: 1 },
                            },
                            { userEnteredValue: { numberValue: 10 } },
                            {},
                            {},
                            {
                                userEnteredValue: { formulaValue: '=A1' },
                                effectiveValue: { numberValue: 5 },
                            },
                        ],
                    },
                ],
            },
        ],
    })),
});
function harness() {
    const db = fakeDb(),
        source = testWorkbook();
    let googleReads = 0;
    const handler = sheetLedgerHandler({
        database: () => db,
        verify: async () => ({
            uid: 'admin',
            email: 'jomalkeun@gmail.com',
            email_verified: true,
        }),
        fetchImpl: async () => {
            googleReads++;
            return { ok: true, json: async () => structuredClone(source) };
        },
        now: () => new Date('2026-10-25T00:00:00Z'),
    });
    const invoke = async (method, body, query) => {
        const res = response();
        await handler({ method, body, query }, res);
        return res;
    };
    return { db, source, invoke, googleReads: () => googleReads };
}
test('API keeps complete source snapshot including excluded forecasts/formulas, isolated from PDF portfolios and original sheet', async () => {
    const h = harness(),
        original = structuredClone(h.source),
        input = {
            url: 'https://docs.google.com/spreadsheets/d/fixture/edit',
            googleToken: 'fixture',
        };
    const preview = await h.invoke('POST', { ...input, action: 'preview' });
    const saved = await h.invoke('POST', {
        ...input,
        action: 'commit',
        version: preview.payload.version,
        fingerprint: preview.payload.fingerprint,
    });
    assert.equal(saved.code, 200, saved.payload.error);
    assert.equal(saved.payload.rows.length, 0);
    assert.equal(saved.payload.archives.length, 1);
    const downloaded = await h.invoke('GET', undefined, {
        sourceArchive: saved.payload.archives[0].id,
    });
    assert.deepEqual(downloaded.payload.archive.workbook, original);
    assert(downloaded.payload.archive.excluded.length > 0);
    assert.deepEqual(h.source, original);
    assert(
        h.db.writes.every(
            (p) =>
                p === 'sheetTrialLedgers/admin' ||
                p.startsWith('sheetTrialLedgers/admin/')
        )
    );
    const writes = h.db.writes.length,
        again = await h.invoke('POST', { ...input, action: 'preview' });
    await h.invoke('POST', {
        ...input,
        action: 'commit',
        version: again.payload.version,
        fingerprint: again.payload.fingerprint,
    });
    assert.equal(h.db.writes.length, writes);
    assert.equal(
        (await h.invoke('GET', undefined, { sourceArchive: 'f'.repeat(64) }))
            .code,
        404
    );
});
test('API evidence import uses existing administrator auth without Google reconnect, changes no ledger values until explicit field acceptance', async () => {
    const h = harness(),
        obs = observation({
            kind: 'TOSS_TRANSACTION',
            type: 'DEPOSIT',
            symbol: '',
            values: { date: '2025-02-03', cashKrw: 1000 },
        });
    const preview = await h.invoke('POST', {
        action: 'batch-preview',
        batchId: 'test-0',
        accountId: 'wife',
        checkpoint: { sourceHash: 'a'.repeat(64), offset: 0, count: 1 },
        version: 0,
        observations: [obs],
    });
    assert.equal(preview.code, 200);
    assert.equal(h.db.writes.length, 0);
    const saved = await h.invoke('POST', {
        action: 'batch-commit',
        batchId: 'test-0',
        accountId: 'wife',
        checkpoint: { sourceHash: 'a'.repeat(64), offset: 0, count: 1 },
        version: 0,
        observations: [obs],
        fingerprint: preview.payload.fingerprint,
    });
    assert.equal(saved.code, 200, saved.payload.error);
    assert.equal(saved.payload.rows.length, 0);
    assert.equal(saved.payload.observationDelta.length, 1);
    assert.equal(h.googleReads(), 0);
    const accepted = await h.invoke('POST', {
        action: 'accept-evidence',
        version: saved.payload.version,
        observationId: saved.payload.observationDelta[0].id,
        accountId: 'wife',
        targetId: null,
        fields: ['date', 'cashKrw'],
        note: '입금 상세 확인',
    });
    assert.equal(accepted.code, 200, accepted.payload.error);
    assert.equal(accepted.payload.rows.length, 1);
    const classified = await h.invoke('POST', {
        action: 'classify-cash',
        version: accepted.payload.version,
        id: accepted.payload.rows[0].id,
        scope: 'EXTERNAL',
        origin: 'PRINCIPAL',
        evidenceIds: [saved.payload.observationDelta[0].id],
        note: '외부 원금 입금 근거',
    });
    assert.equal(classified.code, 200, classified.payload.error);
    assert.equal(
        summarizeCapital(classified.payload.rows).currencies.Krw
            .confirmedPrincipal,
        1000
    );
    assert.equal(
        (await h.invoke('POST', { action: 'classify-cash', version: 0 })).code,
        409
    );
    assert(
        h.db.writes.every(
            (p) =>
                p === 'sheetTrialLedgers/admin' ||
                p.startsWith('sheetTrialLedgers/admin/')
        )
    );
});
test('sheet source baseline survives manual correction; serial datetime never rounds to next date', () => {
    const fixture = testWorkbook();
    fixture.sheets[0].data[0].rowData[0].values = [
        { userEnteredValue: { numberValue: 45943.9999 } },
        { userEnteredValue: { numberValue: 1 } },
        {},
        { userEnteredValue: { numberValue: 10 } },
    ];
    const row = normalizeWorkbook(fixture, '2026-10-25').rows[0];
    assert(row);
    const edited = validateEdit(row, {
        ...row,
        purchaseUsd: 11,
        sourceValues: { purchaseUsd: 1234 },
    });
    assert.equal(edited.sourceValues.purchaseUsd, 10);
    assert.equal(edited.date, row.date);
});
