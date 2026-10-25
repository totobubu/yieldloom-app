import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb } from './helpers/sheet-memory-db.mjs';
import {
    submitObservationBatch,
    listObservations,
    listObservationBatches,
    readBatchOriginal,
    readObservation,
    observationHash,
} from '../lib/sheet-observation-store.js';
import {
    readLedgerPage,
    ledgerMutationResponse,
} from '../lib/sheet-ledger-pages.js';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';
import { normalizeObservation } from '../lib/sheet-reconciliation.js';

const fixture = () => {
    const db = memoryDb();
    return { db, root: db.doc('sheetTrialLedgers/synthetic-owner') };
};
const obs = (i, accountId = 'wife') => ({
    kind: 'TOSS_ORDER',
    sourceId: `test-${i}`,
    accountId,
    type: 'BUY',
    symbol: 'TEST',
    location: `합성 상세 ${i}`,
    values: {
        date: '2025-02-03',
        quantity: 1,
        purchaseUsd: 10,
        commissionUsd: null,
        transactionAt: '2025-02-03 14:51:05.005',
    },
    rawText: `  원문 ${i} `,
    extra: { originalField: '정규화되지 않은 원본도 보존' },
});
const batch = (offset, observations, accountId = 'wife') => ({
    batchId: `batch-${offset}`,
    accountId,
    checkpoint: {
        sourceHash: 'a'.repeat(64),
        offset,
        count: observations.length,
    },
    observations,
});
async function all(root, accountId, cursor) {
    const rows = [];
    do {
        const page = await listObservations(root, accountId, { cursor });
        rows.push(...page.observations);
        cursor = page.nextCursor;
    } while (cursor);
    return rows;
}

test('2400 observations and >4MB originals persist independently of 2285 canonical rows, with bounded reads and exact original recovery', async () => {
    const { db, root } = fixture();
    const rows = Array.from({ length: 2285 }, (_, i) => ({
        id: `sheet-${i}`,
        accountId: i < 264 ? 'husband' : 'wife',
        quantity: i,
    }));
    db.store.set(root.path, {
        version: 1,
        pageCount: 23,
        evidencePageCount: 0,
    });
    for (let i = 0; i < 23; i++)
        db.store.set(`${root.path}/pages/${i}`, {
            rows: rows.slice(i * 100, i * 100 + 100),
        });
    const before = observationHash([...db.store]);
    let bytes = 0;
    for (let offset = 0; offset < 2400; offset += 100) {
        const inputs = Array.from({ length: 100 }, (_, i) => ({
            ...obs(offset + i),
            rawText: '합성'.repeat(700),
        }));
        const result = await submitObservationBatch(
            db,
            root,
            batch(offset, inputs)
        );
        bytes += result.receipt.originalBytes;
        assert.equal(result.receipt.inserted, 100);
        assert(Buffer.byteLength(JSON.stringify(result)) < 1_000_000);
    }
    assert(bytes > 4_000_000);
    assert.equal(
        observationHash(
            [...db.store].filter(
                ([p]) => !p.includes('/reconciliationAccounts/')
            )
        ),
        before
    );
    const got = await all(root, 'wife');
    assert.equal(got.length, 2400);
    assert.equal(new Set(got.map((o) => o.id)).size, 2400);
    assert(
        got.every(
            (o) =>
                o.rawText === undefined &&
                o.original === undefined &&
                o.values.commissionUsd === null
        )
    );
    assert.deepEqual(
        (await readBatchOriginal(root, 'wife', 'batch-2300')).originals[99],
        { ...obs(2399), rawText: '합성'.repeat(700) }
    );
    const last = await readObservation(
        root,
        'wife',
        normalizeObservation(obs(2399)).id,
        { includeOriginal: true }
    );
    assert.equal(
        last.original.extra.originalField,
        '정규화되지 않은 원본도 보존'
    );
    assert.equal(
        last.observation.values.transactionAt,
        '2025-02-03 14:51:05.005'
    );
    assert(
        db.writes.every(
            (p) =>
                p.startsWith(`${root.path}/reconciliationAccounts/wife/`) ||
                p === `${root.path}/reconciliationAccounts/wife`
        )
    );
});

test('same-batch retry writes zero; cross-batch IDs deduplicate; changed originals conflict without overwrite', async () => {
    const { db, root } = fixture(),
        input = batch(0, [obs(0), obs(0)]);
    const preview = await submitObservationBatch(db, root, input, {
        preview: true,
    });
    assert.equal(db.writes.length, 0);
    assert.equal(preview.receipt.status, 'preview');
    assert.equal(preview.staged.additions.length, 1);
    const saved = await submitObservationBatch(db, root, {
        ...input,
        fingerprint: preview.fingerprint,
    });
    assert.equal(saved.receipt.inserted, 1);
    assert.equal(saved.receipt.duplicates, 1);
    const before = db.writes.length;
    assert.equal(
        (await submitObservationBatch(db, root, input)).replayed,
        true
    );
    assert.equal(db.writes.length, before);
    const second = await submitObservationBatch(db, root, batch(2, [obs(0)]));
    assert.equal(second.receipt.inserted, 0);
    assert.equal((await all(root, 'wife')).length, 1);
    const snapshot = observationHash([...db.store]);
    await assert.rejects(
        submitObservationBatch(db, root, {
            ...input,
            observations: [obs(1), obs(2)],
        }),
        (e) => e.status === 409
    );
    await assert.rejects(
        submitObservationBatch(
            db,
            root,
            batch(3, [{ ...obs(0), rawText: '다른 값' }])
        ),
        (e) => e.status === 409
    );
    assert.equal(observationHash([...db.store]), snapshot);
    assert.deepEqual(
        (await readBatchOriginal(root, 'wife', 'batch-2')).originals,
        [obs(0)]
    );
});

test('atomic interrupted commit exposes no batch or observation; deterministic retry and checkpoint resume succeed', async () => {
    const { db, root } = fixture(),
        input = batch(0, [obs(0)]);
    db.failNextCommit();
    await assert.rejects(
        submitObservationBatch(db, root, input),
        /interrupted/
    );
    assert.equal(db.store.size, 0);
    assert.deepEqual(await all(root, 'wife'), []);
    await assert.rejects(
        readBatchOriginal(root, 'wife', 'batch-0'),
        (e) => e.status === 404
    );
    await submitObservationBatch(db, root, input);
    const receipts = await listObservationBatches(root, 'wife');
    assert.equal(receipts.batches.length, 1);
    assert.equal(receipts.batches[0].status, 'complete');
    assert.deepEqual(receipts.batches[0].checkpoint, input.checkpoint);
    assert.equal(
        (await listObservationBatches(root, 'wife', { after: 1 })).batches
            .length,
        0
    );
});

test('watermark excludes concurrent arrivals until refresh; account and owner cursors cannot cross-read', async () => {
    const { db, root } = fixture();
    await submitObservationBatch(
        db,
        root,
        batch(
            0,
            Array.from({ length: 100 }, (_, i) => obs(i))
        )
    );
    let page = await listObservations(root, 'wife');
    if (!page.observations.length)
        page = await listObservations(root, 'wife', {
            cursor: page.nextCursor,
        });
    assert.equal(page.observations.length, 100);
    await submitObservationBatch(db, root, batch(100, [obs(100)]));
    assert.equal((await all(root, 'wife', page.nextCursor)).length, 0);
    assert.equal((await all(root, 'wife')).length, 101);
    await assert.rejects(
        listObservations(root, 'husband', { cursor: page.nextCursor }),
        (e) => e.status === 400
    );
    await submitObservationBatch(
        db,
        root,
        batch(0, [obs(0, 'husband')], 'husband')
    );
    assert.equal((await all(root, 'husband')).length, 1);
    assert.equal(
        (await all(db.doc('sheetTrialLedgers/another-owner'), 'wife')).length,
        0
    );
    await assert.rejects(
        readObservation(root, 'husband', normalizeObservation(obs(0)).id),
        (e) => e.status === 404
    );
    await assert.rejects(
        submitObservationBatch(db, root, batch(200, [obs(200, 'husband')])),
        (e) => e.status === 400
    );
});

test('legacy evidence remains readable and deduplicated; large exact rawText and unknown fields survive immutable archive hash verification', async () => {
    const { db, root } = fixture(),
        legacy = normalizeObservation(obs(0));
    db.store.set(root.path, { version: 7, evidencePageCount: 1, pageCount: 0 });
    db.store.set(`${root.path}/evidencePages/0`, { observations: [legacy] });
    const result = await submitObservationBatch(db, root, batch(0, [obs(0)]));
    assert.equal(result.receipt.inserted, 0);
    assert.deepEqual(
        (await all(root, 'wife')).map((o) => o.id),
        [legacy.id]
    );
    assert.deepEqual(
        (
            await readObservation(root, 'wife', legacy.id, {
                includeOriginal: true,
            })
        ).observation.rawText,
        legacy.rawText
    );
    const input = {
        ...obs(1),
        rawText: '  ' + '완전한 원문'.repeat(8000) + '  ',
    };
    await submitObservationBatch(db, root, batch(1, [input]));
    assert.equal(
        (
            await readObservation(
                root,
                'wife',
                normalizeObservation(obs(1)).id,
                { includeOriginal: true }
            )
        ).original.rawText,
        input.rawText
    );
    assert.deepEqual(db.store.get(`${root.path}/evidencePages/0`), {
        observations: [legacy],
    });
    db.store.set(
        `${root.path}/reconciliationAccounts/wife/batches/batch-1/originalChunks/0`,
        { chunk: Buffer.from('[]').toString('base64') }
    );
    await assert.rejects(
        readBatchOriginal(root, 'wife', 'batch-1'),
        (e) => e.status === 409
    );
});

test('oversized or invalid requests fail visibly without truncation or partial writes', async () => {
    const { db, root } = fixture();
    await assert.rejects(
        submitObservationBatch(
            db,
            root,
            batch(0, [{ ...obs(0), rawText: 'a'.repeat(3_000_001) }])
        ),
        (e) => e.status === 413
    );
    await assert.rejects(
        submitObservationBatch(
            db,
            root,
            batch(
                0,
                Array.from({ length: 101 }, (_, i) => obs(i))
            )
        ),
        (e) => e.status === 400
    );
    await assert.rejects(
        submitObservationBatch(db, root, {
            ...batch(0, [obs(0)]),
            checkpoint: {},
        }),
        (e) => e.status === 400
    );
    await assert.rejects(
        submitObservationBatch(
            db,
            root,
            batch(0, [obs(0), { ...obs(0), rawText: 'conflict' }])
        ),
        (e) => e.status === 409
    );
    assert.equal(db.writes.length, 0);
});

test('canonical pages >4MB are complete, version-pinned and response-bounded; large mutation returns delta', async () => {
    const { db, root } = fixture();
    const rows = Array.from({ length: 2285 }, (_, i) => ({
        id: `row-${i}`,
        source: { evidence: '합성'.repeat(1000) },
    }));
    db.store.set(root.path, { version: 1, pageCount: 23 });
    for (let i = 0; i < 23; i++)
        db.store.set(`${root.path}/pages/${i}`, {
            rows: rows.slice(i * 100, i * 100 + 100),
        });
    const got = [];
    let cursor, first;
    do {
        const page = await readLedgerPage(db, root, { cursor });
        first ||= page;
        assert(Buffer.byteLength(JSON.stringify(page)) < 1_000_000);
        got.push(...page.rows);
        cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(got, rows);
    assert.equal(first.totalRows, 2285);
    assert.equal(db.writes.length, 0);
    db.store.set(root.path, { version: 2, pageCount: 23 });
    await assert.rejects(
        readLedgerPage(db, root, { cursor: first.nextCursor }),
        (e) => e.status === 409
    );
    const delta = ledgerMutationResponse(
        { rows, observations: [] },
        {
            rows: [{ ...rows[0], changed: true }, ...rows.slice(1)],
            observations: [],
            version: 2,
        }
    );
    assert.equal(delta.partial, true);
    assert.equal(delta.rowDelta.length, 1);
    assert.equal(delta.reloadRows, false);
});

test('server rejects expired/non-admin requests before DB and retires only legacy writes, not reads', async () => {
    for (const verify of [
        async () => {
            throw Object.assign(Error('expired'), {
                code: 'auth/id-token-expired',
            });
        },
        async () => ({
            uid: 'test',
            email: 'no@example.test',
            email_verified: true,
        }),
    ]) {
        let accessed = 0;
        const handler = sheetLedgerHandler({
            verify,
            database: () => {
                accessed++;
                throw Error('must not access');
            },
        });
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
        await handler(
            { method: 'POST', body: { action: 'batch-commit' }, query: {} },
            res
        );
        assert([401, 403].includes(res.code));
        assert.equal(accessed, 0);
    }
    const { db } = fixture();
    const handler = sheetLedgerHandler({
        verify: async () => ({
            uid: 'synthetic-owner',
            email: 'jomalkeun@gmail.com',
            email_verified: true,
        }),
        database: () => db,
    });
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
    await handler(
        { method: 'POST', body: { action: 'evidence-commit' }, query: {} },
        res
    );
    assert.equal(res.code, 410);
    assert.equal(res.value.code, 'OBSERVATION_BATCH_REQUIRED');
    assert.equal(db.writes.length, 0);
});
