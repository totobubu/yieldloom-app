import test from 'node:test';
import assert from 'node:assert/strict';
import { numericFields } from '../lib/sheet-ledger.js';
import { normalizeObservation } from '../lib/sheet-reconciliation.js';
import { buildLedgerReview, resolveRowEvidence } from '../lib/sheet-review.js';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import { observationHash } from '../lib/sheet-observation-store.js';
import { memoryDb } from './helpers/sheet-memory-db.mjs';

const row = (overrides = {}) => ({
    ...Object.fromEntries(numericFields.map((field) => [field, null])),
    id: 'sheet:1',
    accountId: 'wife',
    type: 'BUY',
    symbol: 'TEST',
    date: '2025-02-03',
    transactionAt: '2025-02-03 16:10',
    timeZone: 'Asia/Seoul',
    quantity: 1,
    purchaseUsd: 10,
    source: { spreadsheetId: 'synthetic', sheet: '妻', row: 1 },
    fieldStatus: {},
    evidence: [],
    status: '미확인',
    needsReview: true,
    fundingSource: '미확인',
    reinvested: null,
    ...overrides,
});
const source = (id = 'one', values = {}, overrides = {}) =>
    normalizeObservation({
        kind: 'TOSS_TRANSACTION',
        sourceId: id,
        accountId: 'wife',
        type: 'BUY',
        symbol: 'TEST',
        location: `합성 토스 ${id}`,
        rawText: 'immutable synthetic original',
        values: {
            date: '2025-02-03',
            transactionAt: '2025-02-03 16:10',
            timeZone: 'Asia/Seoul',
            quantity: 1,
            purchaseUsd: 10.01,
            ...values,
        },
        ...overrides,
    });
const command = (rows, observations, choices, id = rows[0].id) => ({
    id,
    choices,
    signature: buildLedgerReview(rows, observations).byRow.get(id).signature,
    note: '합성 원문과 실제 체결값을 확인함',
});
const approve = (rows, observations, body) =>
    resolveRowEvidence(
        rows,
        observations,
        body,
        'test-admin',
        '2026-10-27T00:00:00Z',
        '2026-10-27'
    );

test('2,285 legacy unknown flags and missing costs are not unresolved cross-check conflicts', () => {
    const rows = Array.from({ length: 2285 }, (_, i) =>
        row({ id: `sheet:${i}` })
    );
    const { counts } = buildLedgerReview(rows, []);
    assert.equal(counts.conflictRows, 0);
    assert.equal(counts.conflictFields, 0);
    assert.equal(counts.matchedTransactions, 0);
    assert.equal(counts.agreedTransactions, 0);
    assert.equal(counts.missingValues, 2285);
});

test('field approval preserves the sheet baseline, immutable source and actor/time audit', () => {
    const rows = [row()],
        observations = [source()];
    const before = structuredClone(observations);
    const model = buildLedgerReview(rows, observations);
    assert.equal(model.counts.conflictFields, 1);
    const result = approve(
        rows,
        observations,
        command(rows, observations, { purchaseUsd: observations[0].id })
    );
    assert.equal(result.rows[0].purchaseUsd, 10.01);
    assert.equal(result.rows[0].sourceValues.purchaseUsd, 10);
    assert.deepEqual(result.rows[0].review.history[0].changes[0], {
        field: 'purchaseUsd',
        before: 10,
        original: 10,
        after: 10.01,
        sourceId: observations[0].id,
        source: '토스 거래내역',
        location: observations[0].location,
    });
    assert.equal(result.rows[0].review.history[0].actor, 'test-admin');
    assert.equal(result.rows[0].review.history[0].at, '2026-10-27T00:00:00Z');
    assert.equal(result.observations[0].rawText, before[0].rawText);
    assert.equal(
        buildLedgerReview(result.rows, result.observations).counts
            .conflictFields,
        0
    );
    assert.equal(
        buildLedgerReview(result.rows, result.observations).counts
            .agreedTransactions,
        0,
        'An approved discrepancy is resolved, not source agreement'
    );
    assert.equal(rows[0].purchaseUsd, 10);
    assert.deepEqual(observations, before);
});

test('choosing the sheet value resolves a conflict; a new conflicting revision reopens it', () => {
    const rows = [row()],
        observations = [source()];
    const result = approve(
        rows,
        observations,
        command(rows, observations, { purchaseUsd: 'baseline' })
    );
    assert.equal(result.rows[0].purchaseUsd, 10);
    assert.equal(
        buildLedgerReview(result.rows, result.observations).counts.conflictRows,
        0
    );
    assert.equal(
        buildLedgerReview(result.rows, [
            ...result.observations,
            source('revision', { purchaseUsd: 11 }),
        ]).counts.conflictRows,
        1
    );
});

test('same precise time exposes quantity differences; separate fills, zones and date-only ambiguity remain separate', () => {
    const one = row(),
        differentQuantity = source('different-quantity', { quantity: 2 });
    assert.equal(
        buildLedgerReview([one], [differentQuantity]).counts.conflictFields,
        2
    );
    assert.equal(
        buildLedgerReview([one], [source('other-zone', { timeZone: 'UTC' })])
            .counts.unmatched,
        1
    );
    assert.equal(
        buildLedgerReview(
            [row({ transactionAt: '2025-02-03 16:10:01' })],
            [source('other-second', { transactionAt: '2025-02-03 16:10:02' })]
        ).counts.unmatched,
        1
    );
    assert.equal(
        buildLedgerReview(
            [row({ transactionAt: null })],
            [source('date-only', { transactionAt: null, quantity: 2 })]
        ).counts.unmatched,
        1
    );
    const rows = [one, row({ id: 'sheet:second-fill' })],
        observations = [source()];
    const model = buildLedgerReview(rows, observations);
    assert.equal(model.counts.ambiguous, 1);
    assert.equal(model.counts.matchedTransactions, 0);
    assert.equal(model.counts.agreedTransactions, 0);
    assert.equal(model.counts.conflictRows, 0);
    assert.equal(model.byRow.get(one.id).observations[0].ambiguous, true);
    assert.throws(
        () =>
            approve(
                rows,
                observations,
                command(rows, observations, { purchaseUsd: observations[0].id })
            ),
        /모호한 후보/
    );
    assert.equal(rows.length, 2);
});

test('WPAY/TOPW is a candidate alias and approval never rewrites the source symbol', () => {
    const rows = [row({ symbol: 'WPAY' })],
        observations = [source('alias', {}, { symbol: 'TOPW' })];
    const model = buildLedgerReview(rows, observations);
    assert.equal(model.counts.matchedTransactions, 1);
    assert(
        model.byRow
            .get(rows[0].id)
            .fields.get('purchaseUsd')
            .sources.some((item) => item.alias)
    );
    const result = approve(
        rows,
        observations,
        command(rows, observations, { purchaseUsd: observations[0].id })
    );
    assert.equal(result.rows[0].symbol, 'WPAY');
    assert.equal(result.observations[0].symbol, 'TOPW');
});

test('unpaid/unknown dividends are not approved as real receipt corrections', () => {
    const rows = [row({ type: 'DIVIDEND', netDividendUsd: 5 })];
    const observation = source(
        'dividend',
        { paidAt: null },
        { type: 'DIVIDEND', kind: 'TOSS_EXPECTED_DIVIDEND' }
    );
    const model = buildLedgerReview(rows, [observation]);
    assert.equal(model.counts.unmatched, 0);
    assert.equal(model.counts.outsideScope, 1);
    assert.throws(
        () =>
            approve(
                rows,
                [observation],
                command(rows, [observation], { purchaseUsd: observation.id })
            ),
        /실제 출처 값/
    );
});

test('explicitly paid dividend evidence can correct only a selected existing field without creating another receipt', () => {
    const rows = [
        row({
            type: 'DIVIDEND',
            quantity: null,
            purchaseUsd: null,
            netDividendUsd: 5,
        }),
    ];
    const observations = [
        source(
            'paid',
            {
                quantity: null,
                purchaseUsd: null,
                paidAt: '2025-02-03',
                netDividendUsd: 6,
                confirmationStatus: 'CONFIRMED',
                paymentStatus: 'PAID',
            },
            {
                type: 'DIVIDEND',
                kind: 'TOSS_EXPECTED_DIVIDEND',
                dividendState: {
                    confirmationStatusRaw: '확정',
                    paymentStatusRaw: '지급',
                },
            }
        ),
    ];
    const result = approve(
        rows,
        observations,
        command(rows, observations, { netDividendUsd: observations[0].id })
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].netDividendUsd, 6);
    assert.equal(result.rows[0].sourceValues.netDividendUsd, 5);
    assert.equal(result.rows[0].cashUsd, null);
});

test('stale comparisons and forged values cannot be submitted as source choices', () => {
    const rows = [row()],
        observations = [source()];
    const body = command(rows, observations, {
        purchaseUsd: observations[0].id,
    });
    assert.throws(
        () => approve([row({ purchaseUsd: 12 })], observations, body),
        /대조값이 변경/
    );
    assert.throws(
        () =>
            approve(rows, observations, {
                ...body,
                choices: { purchaseUsd: 1000000 },
            }),
        /실제 출처 값/
    );
    assert.throws(
        () => approve(rows, observations, { ...body, note: '' }),
        /확인 근거/
    );
    assert.throws(
        () =>
            approve(rows, observations, {
                ...body,
                choices: { capital: observations[0].id },
            }),
        /실제 출처 값/
    );
});

test('a chosen current value is not considered approved after a later manual value change', () => {
    const rows = [
            row({
                purchaseUsd: 11,
                sourceValues: {
                    date: '2025-02-03',
                    quantity: 1,
                    purchaseUsd: 10,
                },
            }),
        ],
        observations = [source()];
    const result = approve(
        rows,
        observations,
        command(rows, observations, { purchaseUsd: 'current' })
    );
    assert.equal(
        buildLedgerReview(result.rows, result.observations).counts.conflictRows,
        0
    );
    assert.equal(
        buildLedgerReview(
            [{ ...result.rows[0], purchaseUsd: 15 }],
            result.observations
        ).counts.conflictRows,
        1
    );
});

test('approval of a calculated baseline preserves its estimate label', () => {
    const rows = [
            row({ unitPriceUsd: 10, fieldStatus: { unitPriceUsd: '추정' } }),
        ],
        observations = [source('price', { unitPriceUsd: 9 })];
    const result = approve(
        rows,
        observations,
        command(rows, observations, { unitPriceUsd: 'baseline' })
    );
    assert.equal(result.rows[0].unitPriceUsd, 10);
    assert.equal(result.rows[0].fieldStatus.unitPriceUsd, '추정');
    assert.equal(result.rows[0].sourceFieldStatus.unitPriceUsd, '추정');
});

test('existing API saves a canonical source choice atomically; retries/stale evidence/unauthorized calls never duplicate writes', async () => {
    const rows = [row()],
        observation = source(),
        key = observationHash(observation.id),
        root = 'sheetTrialLedgers/test-admin';
    const recordPath = `${root}/reconciliationAccounts/wife/observations/${key}`;
    const db = memoryDb([
        [root, { version: 1, pageCount: 1, evidencePageCount: 0 }],
        [`${root}/pages/0`, { rows }],
        [
            recordPath,
            { observation, digest: 'immutable-digest', reviewVersion: 0 },
        ],
        [`${root}/sourceArchives/original`, { content: 'original unchanged' }],
    ]);
    let claims = {
        uid: 'test-admin',
        email: 'jomalkeun@gmail.com',
        email_verified: true,
    };
    const handler = sheetLedgerHandler({
        database: () => db,
        verify: async () => claims,
        fetchImpl: async () => {
            throw Error('Google must not be contacted');
        },
        now: () => new Date('2026-10-27T00:00:00Z'),
    });
    const invoke = async (body) => {
        const response = {
            setHeader() {},
            status(code) {
                this.code = code;
                return this;
            },
            json(payload) {
                this.payload = payload;
                return this;
            },
        };
        await handler({ method: 'POST', body, query: {} }, response);
        return response;
    };
    const body = {
        action: 'resolve-fields',
        version: 1,
        ...command(rows, [observation], { purchaseUsd: observation.id }),
        evidence: [{ id: observation.id, accountId: 'wife', reviewVersion: 0 }],
    };
    const stale = await invoke({
        ...body,
        evidence: [{ ...body.evidence[0], reviewVersion: 1 }],
    });
    assert.equal(stale.code, 409, stale.payload.error);
    assert.equal(db.writes.length, 0);
    db.store.set(`${root}/reconciliationAccounts/wife`, {
        sequence: 1,
        recordCount: 1,
    });
    const newSource = await invoke(body);
    assert.equal(newSource.code, 409, newSource.payload.error);
    assert.equal(db.writes.length, 0);
    body.observationSequence = 1;
    const saved = await invoke(body);
    assert.equal(saved.code, 200, saved.payload.error);
    assert.equal(db.store.get(`${root}/pages/0`).rows[0].purchaseUsd, 10.01);
    assert.equal(db.store.get(recordPath).digest, 'immutable-digest');
    assert.equal(db.store.get(recordPath).reviewVersion, 1);
    assert.equal(
        db.store.get(`${root}/sourceArchives/original`).content,
        'original unchanged'
    );
    const writes = db.writes.length;
    assert.equal((await invoke(body)).code, 409);
    assert.equal(db.writes.length, writes);
    const restored = db.store.get(`${root}/pages/0`).rows;
    assert.equal(
        buildLedgerReview(restored, [db.store.get(recordPath).observation])
            .counts.conflictRows,
        0
    );
    claims = {
        uid: 'not-admin',
        email: 'member@example.test',
        email_verified: true,
    };
    const reads = db.reads.length;
    assert.equal((await invoke(body)).code, 403);
    assert.equal(db.reads.length, reads);
    assert.equal(db.writes.length, writes);
});
