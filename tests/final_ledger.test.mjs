import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
    projectFinalLedger,
    sumFinalDecimals,
    filterFinalRows,
    summarizeFinalRows,
} from '../lib/final-ledger-view.js';
import { readFinalLedger } from '../lib/final-ledger-snapshot.js';
import { createPrivateReportStore } from '../lib/private-report-store.js';
import { sheetReportHandler } from '../lib/sheet-report-handler.js';
import { createSheetReportClient } from '../src/services/sheetReports.js';
import {
    finalLedgerFixture,
    finalObservation,
    fixtureId,
} from './support/final-ledger-fixture.mjs';

test('source roles avoid duplicate sheet trades, preserve independent QDTE orders and isolate PDF refunds', () => {
    const f = finalLedgerFixture(),
        p = projectFinalLedger(f.observations);
    assert.equal(p.rows.filter((r) => r.isTransaction).length, 5);
    assert.equal(p.rows.filter((r) => r.symbol === 'QDTE').length, 2);
    assert.equal(p.unassignedRows.length, 1);
    assert.equal(p.unassignedRows[0].type, 'TAX_REFUND');
    assert.equal(p.rows.find((r) => r.id === fixtureId(4)).quantity, '0.5');
    assert.equal(p.rows.find((r) => r.id === fixtureId(3)).amount, null);
    assert.equal(p.rows[0].unitPrice, null);
    assert.equal(p.rows[0].date, '2025-02-04');
    assert(!JSON.stringify(p.rows).includes('synthetic-order-'));
    assert(
        !p.details
            .get(fixtureId(1))
            .fields.some((f) => f.field === 'providerOrderId')
    );
});
test('exact decimal sums and currency/type summaries share the filtered row set; cancellations never enter sums', () => {
    assert.equal(sumFinalDecimals(['0.003', '0.0015', null]), '0.0045');
    assert.equal(sumFinalDecimals([null]), null);
    const p = projectFinalLedger(finalLedgerFixture().observations);
    const rows = filterFinalRows(p.rows, { search: 'QDTE' });
    assert.equal(rows.length, 2);
    assert.equal(summarizeFinalRows(rows)[0].amount, '7.2500');
    assert.equal(filterFinalRows(p.rows, { type: 'CANCELED' }).length, 1);
    assert.deepEqual(
        summarizeFinalRows(filterFinalRows(p.rows, { type: 'CANCELED' })),
        []
    );
    assert.equal(
        summarizeFinalRows(filterFinalRows(p.rows, { currency: 'KRW' }))[0]
            .currency,
        'KRW'
    );
    assert.equal(filterFinalRows(p.rows, { from: '2025-03-01' }).length, 0);
});
test('same snapshot provider order duplicates are rejected; other account observations cannot leak', () => {
    const f = finalLedgerFixture();
    f.observations.push({
        ...f.observations[0],
        observationId: fixtureId(100),
    });
    assert.throws(() => projectFinalLedger(f.observations), /중복/);
    assert.equal(
        projectFinalLedger([finalObservation(200, { scope: 'husband' })]).rows
            .length,
        0
    );
});
test('immutable R2 bundle verifies manifest, receipt, parts and nested gzip member before projection', async () => {
    const f = finalLedgerFixture();
    const p = await readFinalLedger(
        async (key) => f.objects.get(key),
        f.checkpoint
    );
    assert.equal(p.rows.length, 6);
    assert.equal(p.unassignedRows.length, 1);
    const part = f.manifest.parts[0].key;
    f.objects.set(part, Buffer.from('AAAA'));
    await assert.rejects(
        () => readFinalLedger(async (key) => f.objects.get(key), f.checkpoint),
        /무결성/
    );
});
test('private snapshot storage coalesces reads per owner and never serves failed loads as a success cache', async () => {
    const f = finalLedgerFixture();
    let calls = 0,
        denied = true;
    const store = createPrivateReportStore({
        finalCheckpoint: f.checkpoint,
        getStorage: () => ({
            send: async (command) => {
                calls++;
                if (denied)
                    throw Object.assign(new Error('denied'), {
                        name: 'AccessDenied',
                    });
                const b = f.objects.get(command.input.Key);
                return { ContentLength: b.length, Body: Readable.from([b]) };
            },
        }),
    });
    await assert.rejects(
        () => store.readFinalSnapshot('owner'),
        (e) => e.code === 'REPORT_STORAGE_DENIED'
    );
    denied = false;
    calls = 0;
    const [a, b] = await Promise.all([
        store.readFinalSnapshot('owner'),
        store.readFinalSnapshot('owner'),
    ]);
    assert.equal(a, b);
    assert.equal(calls, 3);
    await store.readFinalSnapshot('other-owner');
    assert.equal(calls, 6);
});
function handlerFixture({
    email = 'jomalkeun@gmail.com',
    workbook = 'synthetic-workbook',
} = {}) {
    const f = finalLedgerFixture();
    let dbReads = 0,
        storeReads = 0;
    const root = {
        get: async () => {
            dbReads++;
            return { exists: true, data: () => ({ pageCount: 1 }) };
        },
        collection: () => ({
            doc: () => ({
                get: async () => {
                    dbReads++;
                    return {
                        data: () => ({
                            rows: [
                                {
                                    accountId: 'wife',
                                    source: { spreadsheetId: workbook },
                                },
                            ],
                        }),
                    };
                },
            }),
        }),
    };
    const handler = sheetReportHandler({
        verify: async () => ({
            uid: 'synthetic-owner',
            email,
            email_verified: true,
        }),
        database: () => ({ collection: () => ({ doc: () => root }) }),
        finalCheckpoint: f.checkpoint,
        store: {
            readFinalSnapshot: async () => {
                storeReads++;
                return {
                    ...projectFinalLedger(f.observations),
                    releaseId: f.checkpoint.gzipSha256,
                    snapshotAt: '2025-02-05',
                };
            },
            read: () => {
                throw Error('Legacy report must not load');
            },
        },
    });
    const invoke = async (query = {}, method = 'GET') => {
        const res = {
            headers: {},
            setHeader(k, v) {
                this.headers[k] = v;
            },
            status(n) {
                this.statusCode = n;
                return this;
            },
            json(body) {
                this.body = body;
                return this;
            },
        };
        await handler(
            {
                method,
                query: { accountId: 'wife', section: 'final', ...query },
            },
            res
        );
        return res;
    };
    return { invoke, reads: () => ({ dbReads, storeReads }) };
}
test('final handler uses existing admin and workbook ownership, reads twice and does not read comparison index', async () => {
    const f = handlerFixture();
    const r = await f.invoke();
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.adopted, true);
    assert.equal(r.body.comparisonRequired, false);
    assert.deepEqual(f.reads(), { dbReads: 2, storeReads: 1 });
    assert.equal(r.headers['Cache-Control'], 'private, no-store');
    assert.equal(
        (await f.invoke({ observationId: fixtureId(1) })).body.detail.id,
        fixtureId(1)
    );
});
test('final handler denies nonadmin, different workbook, other account, arbitrary paths and writes', async () => {
    const no = handlerFixture({ email: 'nobody@example.invalid' });
    assert.equal((await no.invoke()).statusCode, 403);
    assert.equal(no.reads().storeReads, 0);
    const wrong = handlerFixture({ workbook: 'other' });
    assert.equal((await wrong.invoke()).statusCode, 403);
    assert.equal(wrong.reads().storeReads, 0);
    const f = handlerFixture();
    assert.equal((await f.invoke({ accountId: 'husband' })).statusCode, 404);
    assert.equal((await f.invoke({ objectKey: 'arbitrary' })).statusCode, 400);
    assert.equal(
        (await f.invoke({ observationId: '../other' })).statusCode,
        400
    );
    assert.equal((await f.invoke({}, 'POST')).statusCode, 405);
});
test('report client caches final reads/details per session and clears on denied refresh', async () => {
    const f = finalLedgerFixture(),
        p = projectFinalLedger(f.observations);
    let calls = 0,
        denied = false;
    const client = createSheetReportClient({
        fetchImpl: async (url) => {
            calls++;
            const id = new URL(url, 'https://example.invalid').searchParams.get(
                'observationId'
            );
            return {
                ok: !denied,
                status: denied ? 403 : 200,
                json: async () =>
                    denied
                        ? { error: 'denied' }
                        : {
                              schemaVersion: 1,
                              section: 'final',
                              accountId: 'wife',
                              readOnly: true,
                              adopted: true,
                              comparisonRequired: false,
                              releaseId: f.checkpoint.gzipSha256,
                              ...(id
                                  ? { detail: p.details.get(id) }
                                  : {
                                        rows: p.rows,
                                        unassignedRows: p.unassignedRows,
                                    }),
                          },
            };
        },
    });
    const user = { getIdToken: async () => 'synthetic' };
    await Promise.all([
        client.load(user, 'wife', 'final'),
        client.load(user, 'wife', 'final'),
    ]);
    await client.load(user, 'wife', 'final');
    assert.equal(calls, 1);
    await client.load(user, 'wife', 'final', { observationId: fixtureId(1) });
    await client.load(user, 'wife', 'final', { observationId: fixtureId(1) });
    assert.equal(calls, 2);
    denied = true;
    await assert.rejects(() =>
        client.load(user, 'wife', 'final', { refresh: true })
    );
    denied = false;
    await client.load(user, 'wife', 'final');
    assert.equal(calls, 4);
});
