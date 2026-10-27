import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { followupFixture } from './support/toss-followup-fixture.mjs';
import {
    verifiedFollowup,
    followupResponse,
} from '../lib/toss-followup-report.js';
import {
    createPrivateReportStore,
    reportIndexKey,
} from '../lib/private-report-store.js';
import { sheetReportHandler } from '../lib/sheet-report-handler.js';
import { createSheetReportClient } from '../src/services/sheetReports.js';
function api({
    claims,
    workbook = 'fictional-workbook',
    fixture = followupFixture(),
    storageError,
} = {}) {
    const reads = [],
        writes = [],
        keys = [];
    const store = createPrivateReportStore({
        checkpoint: fixture.descriptor,
        getStorage: () => ({
            send: async (cmd) => {
                keys.push(cmd.input.Key);
                assert.equal(cmd.input.Bucket, 'yieldloom-data-private');
                if (cmd.input.Key === reportIndexKey)
                    return {
                        Body: Readable.from([
                            JSON.stringify({
                                schemaVersion: 1,
                                sourceBinding: {
                                    spreadsheetIdSha256: fixture.workbookSha256,
                                },
                            }),
                        ]),
                    };
                if (storageError)
                    throw Object.assign(Error('private detail must not leak'), {
                        name: storageError,
                    });
                assert(
                    [
                        fixture.descriptor.key,
                        fixture.descriptor.evidenceKey,
                    ].includes(cmd.input.Key)
                );
                const b =
                    cmd.input.Key === fixture.descriptor.key
                        ? fixture.zip
                        : fixture.evidence;
                return { ContentLength: b.length, Body: Readable.from([b]) };
            },
        }),
    });
    const document = {
        get: async () => {
            reads.push('root');
            return { exists: true, data: () => ({ pageCount: 1 }) };
        },
        collection: () => ({
            doc: () => ({
                get: async () => {
                    reads.push('page');
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
        checkpoint: fixture.descriptor,
        verify: async () => {
            if (claims === 'expired')
                throw Object.assign(Error('token'), {
                    code: 'auth/id-token-expired',
                });
            return (
                claims || {
                    uid: 'fixture-admin',
                    email: 'jomalkeun@gmail.com',
                    email_verified: true,
                }
            );
        },
        database: () => ({
            collection: () => ({ doc: () => document }),
            set: () => writes.push(1),
        }),
        store,
    });
    return {
        reads,
        keys,
        writes,
        invoke: async (
            query = { accountId: 'wife', section: 'followup' },
            method = 'GET'
        ) => {
            const res = {
                headers: {},
                setHeader(k, v) {
                    this.headers[k] = v;
                },
                status(n) {
                    this.statusCode = n;
                    return this;
                },
                json(b) {
                    this.body = b;
                    return this;
                },
            };
            await handler({ method, query }, res);
            return res;
        },
    };
}
test('pinned ZIP, manifest, nine originals and four selection/URL/panel chains verify; response is redacted and read-only', () => {
    const f = followupFixture(),
        v = verifiedFollowup(f.zip, f.evidence, f.descriptor),
        response = followupResponse(v, 'wife', f.workbookSha256, f.descriptor);
    assert.equal(response.observations.length, 4);
    assert.equal(response.remainingEightRows.length, 8);
    assert.equal(response.integrity.evidenceFileCount, 9);
    assert.equal(response.adoptionAvailable, false);
    assert(
        response.observations.every(
            (o) =>
                o.values.purchasedUiAt === '2025-02-03 12:34' &&
                o.targetId === null
        )
    );
    const json = JSON.stringify(response);
    for (const secret of [
        '0000',
        'fictional-order',
        'canonicalRowId',
        'capturedDetailUrl',
        'https://www.tossinvest.com',
        'base64',
    ])
        assert(!json.includes(secret));
    assert.equal(new Set(response.observations.map((o) => o.id)).size, 4);
});
test('digest, member hash, version, account, mixed panel and duplicate order identity fail closed', () => {
    for (const options of [
        { corruptMember: true },
        { crossAccount: true },
        { mixedPanel: true },
        { extraPanelPrecision: true },
        { concatenatedDate: true },
        { duplicateOrderId: true },
        { reportVersion: 1 },
    ]) {
        const f = followupFixture(options);
        assert.throws(
            () => verifiedFollowup(f.zip, f.evidence, f.descriptor),
            (e) => e.code === 'REPORT_INTEGRITY_FAILED'
        );
    }
    const f = followupFixture();
    assert.throws(() =>
        verifiedFollowup(Buffer.from('corrupt'), f.evidence, f.descriptor)
    );
    assert.throws(() =>
        verifiedFollowup(f.zip, Buffer.from('corrupt'), f.descriptor)
    );
    const wrong = followupFixture({ wrongWorkbook: true });
    const v = verifiedFollowup(wrong.zip, wrong.evidence, wrong.descriptor);
    assert.throws(() =>
        followupResponse(v, 'wife', wrong.workbookSha256, wrong.descriptor)
    );
});
test('authenticated owner reads exactly two DB documents and three fixed R2 objects; no writes or arbitrary paths', async () => {
    const f = api();
    const res = await f.invoke();
    assert.equal(res.statusCode, 200);
    assert.equal(f.reads.length, 2);
    assert.equal(f.keys.length, 3);
    assert.deepEqual(f.writes, []);
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    const attack = api();
    assert.equal(
        (
            await attack.invoke({
                section: 'followup',
                accountId: 'wife',
                key: 'secret.json',
            })
        ).statusCode,
        400
    );
    assert.equal(attack.keys.length, 0);
    assert.equal((await api().invoke(undefined, 'POST')).statusCode, 405);
});
test('non-admin, expired and other workbook identities cannot read checkpoint; husband never receives wife data', async () => {
    for (const [claims, status] of [
        [
            { uid: 'other', email: 'other@example.test', email_verified: true },
            403,
        ],
        ['expired', 401],
    ]) {
        const f = api({ claims });
        assert.equal((await f.invoke()).statusCode, status);
        assert.equal(f.keys.length, 0);
        assert.equal(f.reads.length, 0);
    }
    const other = api({ workbook: 'another-workbook' });
    assert.equal((await other.invoke()).statusCode, 403);
    assert.equal(other.keys.length, 1);
    const husband = api();
    const res = await husband.invoke({
        section: 'followup',
        accountId: 'husband',
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'REPORT_NOT_FOUND');
    assert.equal(husband.keys.length, 1);
    assert(!JSON.stringify(res.body).includes('TEST'));
});
test('missing and denied storage are visible errors; neither becomes empty verified results', async () => {
    for (const [name, status, code] of [
        ['NoSuchKey', 404, 'REPORT_NOT_FOUND'],
        ['AccessDenied', 503, 'REPORT_STORAGE_DENIED'],
    ]) {
        const res = await api({ storageError: name }).invoke();
        assert.equal(res.statusCode, status);
        assert.equal(res.body.code, code);
        assert(!res.body.observations);
        assert(!JSON.stringify(res.body).includes('private detail'));
    }
});
test('followup client coalesces, reuses cache and separates account; denied refresh and logout discard old data', async () => {
    const f = followupFixture(),
        good = followupResponse(
            verifiedFollowup(f.zip, f.evidence, f.descriptor),
            'wife',
            f.workbookSha256,
            f.descriptor
        );
    let calls = 0,
        deny = false;
    const user = { getIdToken: async () => 'fixture' };
    const c = createSheetReportClient({
        fetchImpl: async () => {
            calls++;
            return {
                ok: !deny,
                status: deny ? 403 : 200,
                json: async () => (deny ? { error: 'denied' } : good),
            };
        },
    });
    await Promise.all([
        c.load(user, 'wife', 'followup'),
        c.load(user, 'wife', 'followup'),
    ]);
    assert.equal(calls, 1);
    await c.load(user, 'wife', 'followup');
    assert.equal(calls, 1);
    deny = true;
    await assert.rejects(c.load(user, 'wife', 'followup', { refresh: true }));
    deny = false;
    await c.load(user, 'wife', 'followup');
    assert.equal(calls, 3);
    c.clear();
    await c.load(user, 'wife', 'followup');
    assert.equal(calls, 4);
    await assert.rejects(c.load(user, 'husband', 'followup'), /계좌/);
});

test('order UI linkage does not permit assigning that order to a different reference date', () => {
    const f = followupFixture({ wrongReferenceDate: true });
    const value = verifiedFollowup(f.zip, f.evidence, f.descriptor);
    assert.throws(
        () => followupResponse(value, 'wife', f.workbookSha256, f.descriptor),
        (e) => e.code === 'REPORT_INTEGRITY_FAILED'
    );
});
