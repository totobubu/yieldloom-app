import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCapitalFixture } from './support/capital-api-fixture.mjs';
import { capitalReadModel } from '../lib/capital-read-model.js';
import { randomBytes } from 'node:crypto';

const root = 'investmentAccounts/AC';
function fixture(count = 10, options = {}) {
    const records =
        options.records ||
        new Map([
            [
                root,
                {
                    entriesRevision: 1,
                    familyId: 'F',
                    permissions: { owner: 'owner' },
                },
            ],
            ['familySpaces/F', { participantUids: ['owner'] }],
            [
                `${root}/cashEntries/M`,
                {
                    amount: 10000,
                    currency: 'KRW',
                    date: '20261015',
                    source: 'manual',
                },
            ],
        ]);
    if (!options.records)
        for (let i = 0; i < count; i++)
            records.set(`${root}/entries/E${i}`, {
                source: 'toss-pdf',
                row: {
                    date: '20261015',
                    symbol: i % 3 ? 'TEST' : 'CASH',
                    type: i % 3 ? 'buy' : 'cash_in',
                    currency: 'USD',
                    amount: i + 1,
                    quantity: 1,
                    rawType: i % 3 ? '구매' : '외화입금',
                    nativeAmount: i + 1,
                    nativeSettlementAmount: i + 1,
                    externalId: createHash('sha256')
                        .update(String(i))
                        .digest('hex'),
                },
            });
    return createCapitalFixture('owner', [], {
        ...options,
        records,
        handlerOptions: { durableReadModels: true, ...options.handlerOptions },
    });
}
const get = (f, query = {}) =>
    f.call(undefined, 'GET', { accountId: 'AC', ...query });

test('30,000-row ledger: cold instance and refresh reuse a chunked model; full result equals original calculations', async () => {
    const f = fixture(30000);
    const baseline = fixture(0, {
        records: f.records,
        handlerOptions: { durableReadModels: false },
    });
    const expected = await get(baseline);
    const first = await get(f);
    assert.equal(first.status, 200);
    assert.deepEqual(first.data, expected.data);
    assert.ok(
        f.records.get(`${root}/capitalReadModels/response`).partCount > 1
    );
    const cold = fixture(0, { records: f.records });
    const next = await get(cold);
    assert.deepEqual(next.data, expected.data);
    assert.ok(
        !cold.reads.some((p) =>
            /\/(entries|cashEntries|cashClassifications|fundingAllocations|cashFxLinks)$/.test(
                p
            )
        )
    );
    const repeated = await get(cold, { version: first.data.version });
    assert.equal(repeated.data.unchanged, true);
    assert.equal(cold.usage.at(-1).documentReadEstimate, 2);
    const parts = f.records.get(`${root}/capitalReadModels/response`).partCount;
    assert.equal(cold.usage[0].documentReadEstimate, 5 + parts);
    console.log(
        JSON.stringify({
            scenario: '30000 rows',
            initialReadEstimate: f.usage[0].documentReadEstimate,
            coldReadEstimate: cold.usage[0].documentReadEstimate,
            versionReadEstimate: 2,
            parts,
        })
    );
});

test('capital writes invalidate response across instances while reusing the unchanged ledger; imports invalidate both', async () => {
    const f = fixture();
    const first = await get(f);
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                accountId: 'AC',
                id: 'M',
                classification: 'external_deposit',
                revision: 0,
            })
        ).status,
        200
    );
    const cold = fixture(0, { records: f.records });
    const changed = await get(cold, {
        ledgerVersion: first.data.ledgerVersion,
    });
    assert.equal(changed.status, 200);
    assert.equal(changed.data.ledgerUnchanged, true);
    assert.notEqual(changed.data.version, first.data.version);
    assert.equal(
        changed.data.classifications.find((r) => r.id === 'M').classification,
        'external_deposit'
    );
    assert.ok(!cold.reads.includes(`${root}/entries`));
    f.records.get(root).entriesRevision++;
    f.records.get(`${root}/entries/E1`).voidedAt = 'now';
    const latest = await get(cold);
    assert.equal(latest.status, 200);
    assert.equal(latest.data.trades.length, first.data.trades.length - 1);
    assert.ok(cold.reads.includes(`${root}/entries`));
});

test('simultaneous independent instances build once; contenders return a retryable response without a scan', async () => {
    let release, started;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const loading = new Promise((resolve) => {
        started = resolve;
    });
    const f = fixture(10, {
        onCollectionRead: async (path) => {
            if (path === `${root}/entries`) {
                started();
                await gate;
            }
        },
    });
    const a = get(f);
    await loading;
    const cold = fixture(0, { records: f.records });
    const b = await get(cold);
    assert.equal(b.status, 503);
    assert.equal(b.data.code, 'CAPITAL_READ_MODEL_BUSY');
    assert.ok(!cold.reads.includes(`${root}/entries`));
    release();
    assert.equal((await a).status, 200);
    assert.equal((await get(cold)).status, 200);
    assert.ok(!cold.reads.includes(`${root}/entries`));
});

test('revoked family membership and account permission cannot read durable data, including unchanged version', async () => {
    const f = fixture();
    const first = await get(f);
    f.records.get(root).permissions = {};
    assert.equal((await get(f, { version: first.data.version })).status, 403);
    f.records.get(root).permissions = { owner: 'owner' };
    f.records.get('familySpaces/F').participantUids = [];
    assert.equal((await get(f)).status, 403);
    assert.equal(
        (await f.call(undefined, 'GET', { accountId: 'OTHER' })).status,
        404
    );
});

test('mutation or permission revocation during build cannot publish a stale successful response', async () => {
    for (const revoke of [false, true]) {
        const f = fixture(10, {
            onCollectionRead: async (path) => {
                if (path === `${root}/entries`) {
                    if (revoke)
                        f.records.get('familySpaces/F').participantUids = [];
                    else f.records.get(root).entriesRevision++;
                }
            },
        });
        const result = await get(f);
        assert.equal(result.status, revoke ? 403 : 409);
        assert.notEqual(
            f.records.get(`${root}/capitalReadModels/response`).state,
            'ready'
        );
    }
});

test('corrupted cache fails closed without re-scanning or changing source records', async () => {
    const f = fixture();
    await get(f);
    const record = f.records.get(`${root}/capitalReadModels/response`);
    record.sha256 = 'invalid';
    const cold = fixture(0, { records: f.records });
    const result = await get(cold);
    assert.equal(result.status, 503);
    assert.equal(result.data.code, 'CAPITAL_READ_MODEL_CORRUPT');
    assert.ok(!cold.reads.includes(`${root}/entries`));
});

test('quota failure is not cached as success and another instance cannot immediately repeat the scan', async () => {
    const f = fixture(10, {
        onCollectionRead: async (path) => {
            if (path === `${root}/entries`)
                throw Object.assign(new Error('quota'), { code: 8 });
        },
    });
    assert.equal((await get(f)).status, 429);
    const cold = fixture(0, { records: f.records });
    assert.equal((await get(cold)).status, 503);
    assert.ok(!cold.reads.includes(`${root}/entries`));
});

function modelFixture() {
    const f = fixture(0);
    let clock = 0;
    return {
        f,
        advance: (value) => {
            clock = value;
        },
        load: (version, load) =>
            capitalReadModel({
                db: f.db,
                root,
                name: 'ledger',
                version,
                load,
                read: (ref, tx) => (tx ? tx.get(ref) : ref.get()),
                validate: async () => {},
                now: () => clock,
            }),
    };
}

test('expired builder is fenced out after another instance recovers its lease', async () => {
    const m = modelFixture();
    let release, started;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const ready = new Promise((resolve) => {
        started = resolve;
    });
    const old = m.load('1', async () => {
        started();
        await gate;
        return { stale: true };
    });
    await ready;
    m.advance(120001);
    assert.deepEqual((await m.load('1', async () => ({ fresh: true }))).value, {
        fresh: true,
    });
    release();
    await assert.rejects(old, (error) => error.status === 503);
    assert.deepEqual(
        (await m.load('1', async () => assert.fail('must reuse'))).value,
        { fresh: true }
    );
});

test('shrinking revisions remove obsolete chunks and oversized versions do not repeatedly scan', async () => {
    const m = modelFixture();
    await m.load('1', async () => ({
        synthetic: randomBytes(800000).toString('base64'),
    }));
    assert.ok(m.f.records.has(`${root}/capitalReadModels/ledger-part-1`));
    await m.load('2', async () => ({ small: true }));
    assert.ok(!m.f.records.has(`${root}/capitalReadModels/ledger-part-1`));
    let scans = 0;
    const load = async () => {
        scans++;
        return { synthetic: randomBytes(5000000).toString('base64') };
    };
    await assert.rejects(
        m.load('3', load),
        (error) => error.code === 'CAPITAL_READ_MODEL_TOO_LARGE'
    );
    m.advance(3600000);
    await assert.rejects(m.load('3', load), (error) => error.status === 503);
    assert.equal(scans, 1);
    assert.deepEqual(
        (await m.load('4', async () => ({ recovered: true }))).value,
        { recovered: true }
    );
});
