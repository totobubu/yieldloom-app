import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { collectOpenOrders } from '../scripts/toss/collect-closed-orders.mjs';
import {
    prepareManualPublication,
    loadPublication,
    publishExisting,
    createExistingR2Transport,
    attachBrowserObservation,
} from '../scripts/toss/publish-account-observations.mjs';
import {
    verifyIncrement,
    publishIncrement,
    readIncrements,
    overlayIncrements,
} from '../lib/toss-ledger-increments.js';
import { readFinalLedger } from '../lib/final-ledger-snapshot.js';
import { createPrivateReportStore } from '../lib/private-report-store.js';
import { summarizeFinalRows } from '../lib/final-ledger-view.js';
import {
    finalLedgerFixture,
    fixtureId,
} from './support/final-ledger-fixture.mjs';
import { order, page } from './support/toss-orders-fixture.mjs';

async function fixture(
    t,
    {
        orders = [],
        symbol = 'TESTDIV',
        currency = 'USD',
        observedAt = '2025-02-06T07:00:00.000Z',
        date = '2025-02-06',
        run = 'open-fixture',
        root,
    } = {}
) {
    root ??= await mkdtemp(join(tmpdir(), 'toss-increment-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const scope = await collectOpenOrders(
        { accountSeq: '123456', token: 'synthetic-token-not-uploaded', run },
        {
            root,
            sleep: async () => {},
            fetchImpl: async () => new Response(page(orders)),
        }
    );
    scope.run = run;
    const ui = {
        checkedAt: observedAt,
        accountVerified: true,
        currency,
        symbol,
        depositAtDisplayed: date + ' 13:23',
        gross: '12.3456',
        tax: '1.2345',
        net: '11.1111',
        coverage:
            'synthetic today-only evidence; stable provider ID unavailable',
        detail: {
            url:
                'https://www.tossinvest.com/account/transactions/' +
                (currency === 'USD' ? 'us' : 'kr') +
                '/all/4',
            detailFields: [
                '거래유형\n' +
                    (currency === 'USD' ? '외화배당금입금' : '배당금입금'),
                `입금일시\n${Number(date.slice(0, 4))}년 ${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일 13:23`,
                '총 금액\n' + (currency === 'USD' ? '$12.3456' : '12.3456원'),
                '제세금\n' + (currency === 'USD' ? '$1.2345' : '1.2345원'),
                '입금 금액\n' + (currency === 'USD' ? '$11.1111' : '11.1111원'),
            ],
        },
    };
    const browserFile = join(root, 'browser-' + run + '.json');
    await writeFile(browserFile, JSON.stringify(ui));
    const plan = await prepareManualPublication({
        root,
        accountSeq: '123456',
        accountSuffix: '9999',
        scopes: { OPEN: scope, CLOSED: { status: 'not_requested' } },
        browserFile,
        checkedAt: observedAt,
    });
    const publication = await loadPublication(plan.localDirectory);
    return { root, browserFile, plan, ...publication };
}
function memory(objects = new Map()) {
    let failKey = null,
        failGet = false;
    const writes = [];
    return {
        objects,
        writes,
        setFailKey: (k) => (failKey = k),
        setFailGet: (b) => (failGet = b),
        readBytes: async (key) => {
            if (failGet) throw Error('read_failed');
            if (!objects.has(key))
                throw Object.assign(Error('missing'), { status: 404 });
            return objects.get(key);
        },
        putIfAbsent: async (key, bytes) => {
            if (key === failKey) throw Error('interrupted_upload');
            if (objects.has(key))
                throw Object.assign(Error('precondition'), { status: 412 });
            objects.set(key, Buffer.from(bytes));
            writes.push(key);
        },
        listEntries: async (prefix) => ({
            keys: [...objects.keys()].filter((k) => k.startsWith(prefix)),
            truncated: false,
        }),
    };
}
async function baseline() {
    const f = finalLedgerFixture();
    return {
        f,
        p: await readFinalLedger(
            async (key) => f.objects.get(key),
            f.checkpoint
        ),
    };
}
test('ego evidence attaches after API preparation without any fresh provider request; replay uses identical publication', async (t) => {
    const f = await fixture(t);
    const api = await prepareManualPublication({
        root: f.root,
        accountSeq: '123456',
        accountSuffix: '9999',
        scopes: {
            OPEN: { status: 'complete', run: 'open-fixture' },
            CLOSED: { status: 'not_requested' },
        },
        checkedAt: '2025-02-06T07:00:00.000Z',
    });
    const attached = await attachBrowserObservation(
        api.localDirectory,
        f.browserFile
    );
    const replay = await attachBrowserObservation(
        api.localDirectory,
        f.browserFile
    );
    assert.equal(attached.localDirectory, replay.localDirectory);
    const p = await loadPublication(attached.localDirectory);
    assert.equal(
        (
            await verifyIncrement(
                async (key) => p.objects.get(key),
                p.marker.value
            )
        ).observations.length,
        1
    );
});
test('structured amounts must match actually captured detail fields and credentials cannot enter browser archives', async (t) => {
    const f = await fixture(t);
    const api = await prepareManualPublication({
        root: f.root,
        accountSeq: '123456',
        accountSuffix: '9999',
        scopes: {
            OPEN: { status: 'complete', run: 'open-fixture' },
            CLOSED: { status: 'not_requested' },
        },
        checkedAt: '2025-02-06T07:00:00.000Z',
    });
    const ui = JSON.parse(await readFile(f.browserFile));
    ui.gross = '9999';
    await writeFile(f.browserFile, JSON.stringify(ui));
    await assert.rejects(
        () => attachBrowserObservation(api.localDirectory, f.browserFile),
        /무결성/
    );
    ui.gross = '12.3456';
    ui.access_token = 'synthetic-private-token';
    await writeFile(f.browserFile, JSON.stringify(ui));
    await assert.rejects(
        () => attachBrowserObservation(api.localDirectory, f.browserFile),
        /무결성/
    );
});

test('verified remote publication writes immutable commit marker last and survives restart idempotently', async (t) => {
    const f = await fixture(t),
        s = memory();
    const result = await publishExisting({ directory: f.dir, ...s });
    assert.equal(result.status, 'linked');
    assert.equal(s.writes.at(-1), f.marker.key);
    const count = s.writes.length;
    await publishExisting({ directory: f.dir, ...s });
    assert.equal(s.writes.length, count);
    const r = await readIncrements(s);
    assert.equal(r.entryCount, 1);
    assert.equal(r.verified[0].observations.length, 1);
    assert(
        !JSON.stringify(
            [...s.objects.values()].map((b) => b.toString())
        ).includes('synthetic-token-not-uploaded')
    );
});
test('partial upload never publishes receipt or marker; unchanged local plan resumes', async (t) => {
    const f = await fixture(t),
        s = memory();
    s.setFailKey(f.marker.value.manifest.key);
    await assert.rejects(() => publishExisting({ directory: f.dir, ...s }));
    assert(!s.objects.has(f.marker.key));
    assert(!s.objects.has(f.marker.value.receipt.key));
    assert.equal((await readIncrements(s)).entryCount, 0);
    s.setFailKey(null);
    await publishExisting({ directory: f.dir, ...s });
    assert.equal((await readIncrements(s)).entryCount, 1);
});
test('corrupt GET or conflicting preexisting bytes stop linkage, never report zero complete', async (t) => {
    const f = await fixture(t),
        s = memory(new Map(f.objects));
    s.objects.set(f.marker.value.manifest.key, Buffer.from('{}'));
    await assert.rejects(
        () => publishIncrement({ ...s, marker: f.marker.value }),
        /무결성/
    );
    assert(!s.objects.has(f.marker.key));
    s.setFailGet(true);
    await assert.rejects(() =>
        readIncrements({
            ...s,
            listEntries: async () => ({
                keys: [f.marker.key],
                truncated: false,
            }),
        })
    );
});
test('concurrent independent index appends cannot lose each other and identical append conflict is verified', async (t) => {
    const a = await fixture(t),
        b = await fixture(t, { symbol: 'SECOND', run: 'open-second' }),
        s = memory(new Map([...a.objects, ...b.objects]));
    await Promise.all([
        publishIncrement({ ...s, marker: a.marker.value }),
        publishIncrement({ ...s, marker: b.marker.value }),
    ]);
    assert.equal((await readIncrements(s)).entryCount, 2);
    await Promise.all([
        publishIncrement({ ...s, marker: a.marker.value }),
        publishIncrement({ ...s, marker: a.marker.value }),
    ]);
    assert.equal((await readIncrements(s)).entryCount, 2);
});
test('index body conflict, traversal, truncation, and excessive entries fail closed', async (t) => {
    const f = await fixture(t),
        s = memory(new Map(f.objects));
    s.objects.set(f.marker.key, Buffer.from('{}'));
    await assert.rejects(
        () => publishIncrement({ ...s, marker: f.marker.value }),
        /무결성/
    );
    for (const listed of [
        { keys: ['../other'], truncated: false },
        { keys: [], truncated: true },
        { keys: Array(129).fill(f.marker.key), truncated: false },
    ])
        await assert.rejects(
            () => readIncrements({ ...s, listEntries: async () => listed }),
            /무결성/
        );
});
test('new web deposit adds once with exact native gross/tax/net/minute precision; adopted baseline unchanged', async (t) => {
    const f = await fixture(t),
        b = await baseline(),
        v = await verifyIncrement(
            async (k) => f.objects.get(k),
            f.marker.value
        );
    const before = JSON.stringify(b.p.rows),
        sums = JSON.stringify(summarizeFinalRows(b.p.rows));
    const p = overlayIncrements(b.p, {
        verified: [v, v],
        revision: 'test',
        entryCount: 1,
    });
    assert.equal(p.rows.length, b.p.rows.length + 1);
    assert.equal(JSON.stringify(b.p.rows), before);
    assert.equal(JSON.stringify(summarizeFinalRows(b.p.rows)), sums);
    const row = p.rows.find((r) => r.sourceLabel === '토스 웹 입금');
    assert.equal(row.amount, '11.1111');
    assert.equal(row.tax, '1.2345');
    assert.equal(row.gross, '12.3456');
    assert.equal(row.timestamp, '2025-02-06 13:23');
    assert.equal(row.quantity, null);
    assert.equal(row.currency, 'USD');
    assert.equal(row.countInTotals, true);
    assert.equal(p.details.get(row.id).missing[0], 'originalTransactionId');
});
test('separate UI observations without provider ID remain separate and do not double count ambiguous deposits', async (t) => {
    const a = await fixture(t),
        b = await fixture(t, {
            observedAt: '2025-02-06T08:00:00Z',
            run: 'open-later',
        }),
        base = await baseline();
    const vs = await Promise.all(
        [a, b].map((x) =>
            verifyIncrement(async (k) => x.objects.get(k), x.marker.value)
        )
    );
    const p = overlayIncrements(base.p, {
        verified: vs,
        revision: 'x',
        entryCount: 2,
    });
    assert.equal(p.rows.filter((r) => r.increment).length, 2);
    assert(
        p.rows
            .filter((r) => r.increment)
            .every((r) => r.countInTotals === false)
    );
    assert.deepEqual(
        summarizeFinalRows(p.rows),
        summarizeFinalRows(base.p.rows)
    );
});
test('same date symbol baseline candidate is preserved; web observation is excluded from sums', async (t) => {
    const a = await fixture(t, { symbol: 'TEST', date: '2025-02-04' }),
        base = await baseline();
    const p = overlayIncrements(base.p, {
        verified: [
            await verifyIncrement(
                async (k) => a.objects.get(k),
                a.marker.value
            ),
        ],
        revision: 'x',
        entryCount: 1,
    });
    assert.equal(p.rows.at(-1).countInTotals, false);
    assert.deepEqual(
        summarizeFinalRows(p.rows),
        summarizeFinalRows(base.p.rows)
    );
});
test('KRW remains separate and missing configuration does not issue credentials or expose values', async (t) => {
    const a = await fixture(t, { currency: 'KRW' }),
        base = await baseline();
    const p = overlayIncrements(base.p, {
        verified: [
            await verifyIncrement(
                async (k) => a.objects.get(k),
                a.marker.value
            ),
        ],
        revision: 'x',
        entryCount: 1,
    });
    assert.equal(p.rows.at(-1).currency, 'KRW');
    assert.equal(p.rows.at(-1).amount, '11.1111');
    await assert.rejects(
        () => createExistingR2Transport({}),
        /existing_r2_configuration_required/
    );
});
test('API empty observations never delete baseline; latest account/order version replaces projection only', async (t) => {
    const empty = await fixture(t),
        base = await baseline();
    const zero = await verifyIncrement(
        async (k) => empty.objects.get(k),
        empty.marker.value
    );
    const p = overlayIncrements(base.p, {
        verified: [{ ...zero, observations: [] }],
        revision: 'empty',
        entryCount: 1,
    });
    assert.deepEqual(p.rows, base.p.rows);
    const o = order('synthetic-order-1', {
        orderedAt: '2025-02-03T00:00:00+09:00',
        status: 'CANCELED',
        execution: {
            ...order().execution,
            filledQuantity: '0.5',
            filledAmount: '2.5000',
            filledAt: '2025-02-06T01:00:00+09:00',
        },
    });
    const newer = await fixture(t, { orders: [o], run: 'open-update' }),
        v = await verifyIncrement(
            async (k) => newer.objects.get(k),
            newer.marker.value
        );
    const changed = overlayIncrements(base.p, {
        verified: [{ ...v, observations: [] }],
        revision: 'new',
        entryCount: 1,
    });
    assert.equal(changed.rows.length, base.p.rows.length);
    const row = changed.rows.find(
        (r) => r.previousObservationId === fixtureId(1)
    );
    assert.equal(row.quantity, '0.5');
    assert.equal(row.state, 'CANCELED');
    assert.equal(row.isTransaction, true);
    assert.equal(base.p.rows[0].quantity, '1');
    assert(!JSON.stringify(changed.rows).includes('synthetic-order-1'));
});
test('reader sees appended index after baseline cache and enforces denied/integrity failures', async (t) => {
    const a = await fixture(t),
        base = await baseline(),
        s = memory(new Map([...base.f.objects, ...a.objects]));
    let denied = false;
    const store = createPrivateReportStore({
        finalCheckpoint: base.f.checkpoint,
        getStorage: () => ({
            send: async (cmd) => {
                if (denied)
                    throw Object.assign(Error('denied'), {
                        name: 'AccessDenied',
                    });
                if (cmd.input.Prefix)
                    return {
                        Contents: [...s.objects.keys()]
                            .filter((k) => k.startsWith(cmd.input.Prefix))
                            .map((Key) => ({ Key })),
                        IsTruncated: false,
                    };
                const bytes = s.objects.get(cmd.input.Key);
                return {
                    ContentLength: bytes.length,
                    Body: Readable.from([bytes]),
                };
            },
        }),
    });
    assert.equal(
        (await store.readFinalSnapshot('owner')).rows.length,
        base.p.rows.length
    );
    await publishIncrement({ ...s, marker: a.marker.value });
    assert.equal(
        (await store.readFinalSnapshot('owner')).rows.length,
        base.p.rows.length + 1
    );
    denied = true;
    await assert.rejects(() => store.readFinalSnapshot('owner'));
    denied = false;
    s.objects.set(a.marker.key, Buffer.from('changed'));
    await assert.rejects(() => store.readFinalSnapshot('owner'), /무결성/);
});
