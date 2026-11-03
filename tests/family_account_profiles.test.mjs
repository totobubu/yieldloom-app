import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import {
    resolveAccountProfile,
    profileBinding,
    profileIndexPrefix,
} from '../lib/toss-account-profiles.js';
import {
    incrementHash as hash,
    readIncrements,
    overlayIncrements,
    verifyIncrement,
} from '../lib/toss-ledger-increments.js';
import { readAccountOrders } from '../scripts/toss/read-account-orders.mjs';
import { loadLocalCredentials } from '../scripts/toss/collect-closed-orders.mjs';
import {
    loadPublication,
    publishExisting,
    attachBrowserObservation,
    prepareManualPublication,
} from '../scripts/toss/publish-account-observations.mjs';
import { createPrivateReportStore } from '../lib/private-report-store.js';
import { sheetReportHandler } from '../lib/sheet-report-handler.js';
import { createSheetReportClient } from '../src/services/sheetReports.js';
import {
    familyFinalRows,
    summarizeFinalRows,
} from '../lib/final-ledger-view.js';
import { finalLedgerFixture } from './support/final-ledger-fixture.mjs';
import { order, page } from './support/toss-orders-fixture.mjs';

const numbers = { wife: '00000000042', husband: '00000000043' };
const refs = {
    TOSS_ACCESS_TOKEN: 'stale-global-token',
    TOSS_WIFE_ACCESS_TOKEN: 'wife-token',
    TOSS_HUSBAND_ACCESS_TOKEN: 'husband-token',
    TOSS_WIFE_ACCOUNT_SUFFIX: '0042',
    TOSS_HUSBAND_ACCOUNT_SUFFIX: '0043',
    TOSS_WIFE_ACCOUNT_SHA256: hash(numbers.wife),
    TOSS_HUSBAND_ACCOUNT_SHA256: hash(numbers.husband),
};
async function rootFor(t) {
    const root = await mkdtemp(join(tmpdir(), 'family-profile-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}
async function collect(
    t,
    owner,
    {
        credentials = refs,
        mutateAccount,
        apiOrders = [order('same-provider-id')],
        prepare = true,
    } = {}
) {
    const root = await rootFor(t),
        calls = [];
    const result = await readAccountOrders(
        {
            profileId: owner + '-toss',
            status: 'OPEN',
            preparePublication: prepare,
        },
        {
            root,
            credentials,
            sleep: async () => {},
            fetchImpl: async (url, request) => {
                calls.push({
                    url: new URL(url),
                    token: request.headers.Authorization,
                });
                const account = {
                    accountNo: numbers[owner],
                    accountSeq: owner === 'wife' ? 42 : 43,
                    accountType: 'BROKERAGE',
                };
                return new Response(
                    new URL(url).pathname.endsWith('/accounts')
                        ? JSON.stringify({
                              result: mutateAccount
                                  ? mutateAccount(account)
                                  : [account],
                          })
                        : page(apiOrders)
                );
            },
        }
    );
    return {
        root,
        result,
        calls,
        publication: result.publication?.localDirectory
            ? await loadPublication(result.publication.localDirectory)
            : null,
    };
}
function memory(initial = new Map()) {
    const objects = new Map(initial),
        writes = [];
    return {
        objects,
        writes,
        readBytes: async (key) => {
            if (!objects.has(key)) throw Error('missing_fixture');
            return objects.get(key);
        },
        putIfAbsent: async (key, bytes) => {
            if (objects.has(key))
                throw Object.assign(Error('exists'), { status: 412 });
            writes.push(key);
            objects.set(key, bytes);
        },
        listEntries: async (prefix) => ({
            keys: [...objects.keys()].filter((key) => key.startsWith(prefix)),
            truncated: false,
        }),
    };
}

test('profile switching never reuses a global or other owner token; missing scoped token performs no lookup', async (t) => {
    for (const owner of ['wife', 'husband', 'wife']) {
        const f = await collect(t, owner);
        assert.equal(f.result.apiStatus, 'complete');
        assert.equal(f.result.publication.status, 'prepared_not_uploaded');
        assert.ok(f.calls.every((c) => c.token === `Bearer ${owner}-token`));
        for (const token of [
            'stale-global-token',
            'wife-token',
            'husband-token',
        ])
            assert.ok(!JSON.stringify(f.result).includes(token));
    }
    const f = await collect(t, 'husband', {
        credentials: { ...refs, TOSS_HUSBAND_ACCESS_TOKEN: undefined },
    });
    assert.equal(f.result.reason, 'authentication_required');
    assert.equal(f.calls.length, 0);
});

test('explicit file credentials are isolated from inherited OS values and other files', async (t) => {
    const root = await rootFor(t),
        file = join(root, 'synthetic.env');
    await writeFile(
        file,
        'TOSS_HUSBAND_CLIENT_ID=synthetic-client\nTOSS_HUSBAND_CLIENT_SECRET=synthetic-secret\nTOSS_HUSBAND_ACCOUNT_SUFFIX=0043\nTOSS_HUSBAND_ACCOUNT_SHA256=' +
            hash(numbers.husband)
    );
    const loaded = await loadLocalCredentials(file, {});
    assert.equal(loaded.TOSS_ACCESS_TOKEN, undefined);
    assert.equal(loaded.TOSS_HUSBAND_ACCESS_TOKEN, undefined);
    assert.equal(loaded.TOSS_WIFE_ACCESS_TOKEN, undefined);
    assert.equal(loaded.TOSS_HUSBAND_CLIENT_ID, 'synthetic-client');
});

test('actual account hash, suffix collision, ambiguous response and duplicate owner binding fail before order reads', async (t) => {
    for (const mutateAccount of [
        (a) => [{ ...a, accountNo: '99999990043' }],
        (a) => [a, a],
        () => [],
    ]) {
        const f = await collect(t, 'husband', { mutateAccount });
        assert.equal(f.result.apiStatus, 'partial');
        assert.equal(f.calls.length, 1);
        assert.equal(f.result.publication, undefined);
    }
    const ambiguous = {
        ...refs,
        TOSS_HUSBAND_ACCOUNT_SHA256: refs.TOSS_WIFE_ACCOUNT_SHA256,
    };
    assert.throws(
        () => resolveAccountProfile('wife-toss', ambiguous),
        /ambiguous/
    );
    assert.throws(() => resolveAccountProfile('unknown', refs), /unknown/);
});

test('profile publication restart verifies binding and refuses a different owner before any writes', async (t) => {
    const wife = await collect(t, 'wife'),
        husband = await collect(t, 'husband');
    assert.notEqual(
        wife.publication.marker.key,
        husband.publication.marker.key
    );
    assert.match(
        husband.publication.marker.key,
        /^reconciliation\/increments\/v2\/husband\/toss\//
    );
    assert.ok(
        husband.publication.marker.value.prefix.includes(
            '/husband-0043/accounts/'
        )
    );
    const io = memory();
    await assert.rejects(
        () =>
            publishExisting({
                directory: husband.publication.dir,
                profile: resolveAccountProfile('wife-toss', refs),
                ...io,
            }),
        /mapping/
    );
    assert.equal(io.writes.length, 0);
    await assert.rejects(
        () =>
            publishExisting({
                directory: husband.publication.dir,
                expectedAccountSuffix: '0043',
                ...io,
            }),
        /mapping/
    );
    const profile = resolveAccountProfile('husband-toss', refs);
    assert.equal(
        (
            await publishExisting({
                directory: husband.publication.dir,
                profile,
                ...io,
            })
        ).status,
        'linked'
    );
    const writes = io.writes.length;
    assert.equal(
        (
            await publishExisting({
                directory: (await loadPublication(husband.publication.dir)).dir,
                profile,
                ...io,
            })
        ).status,
        'linked'
    );
    assert.equal(io.writes.length, writes);
    assert.equal(io.writes.at(-1), husband.publication.marker.key);
    const own = await readIncrements({ profile, ...io });
    assert.equal(own.entryCount, 1);
    assert.equal(
        (
            await readIncrements({
                profile: resolveAccountProfile('wife-toss', refs),
                ...io,
            })
        ).entryCount,
        0
    );
    const forged = {
        ...husband.publication.marker.value,
        binding: profileBinding(
            resolveAccountProfile('wife-toss', refs),
            hash('42')
        ),
    };
    await assert.rejects(() => verifyIncrement(io.readBytes, forged));
});

test('browser attachment requires independent profile/account evidence and collector account sequence stays bound', async (t) => {
    const f = await collect(t, 'husband');
    const ui = {
        accountVerified: true,
        profileId: 'wife-toss',
        accountNoSha256: refs.TOSS_WIFE_ACCOUNT_SHA256,
        accountSuffix: '0042',
        paymentStatus: 'PAID',
        detail: { paymentStatus: 'PAID' },
    };
    const file = join(f.root, 'ui.json');
    await writeFile(file, JSON.stringify(ui));
    await assert.rejects(
        () => attachBrowserObservation(f.publication.dir, file),
        /browser_account_mismatch/
    );
    const valid = {
        ...ui,
        profileId: 'husband-toss',
        accountNoSha256: refs.TOSS_HUSBAND_ACCOUNT_SHA256,
        accountSuffix: '0043',
        checkedAt: '2026-01-02T04:23:00Z',
        symbol: 'TESTDIV',
        currency: 'USD',
        gross: '12.00',
        tax: '2.00',
        net: '10.00',
        depositAtDisplayed: '2026-01-02 13:23',
        coverage: 'synthetic independent account verification',
        detail: {
            paymentStatus: 'PAID',
            url: 'https://www.tossinvest.com/account/transactions/us/all/fixture',
            detailFields: [
                '거래유형\n외화배당금입금',
                '입금일시\n2026년 1월 2일 13:23',
                '총 금액\n$12.00',
                '제세금\n$2.00',
                '입금 금액\n$10.00',
            ],
        },
    };
    await writeFile(file, JSON.stringify(valid));
    const attached = await loadPublication(
        (await attachBrowserObservation(f.publication.dir, file)).localDirectory
    );
    const checked = await verifyIncrement(
        async (key) => attached.objects.get(key),
        attached.marker.value
    );
    assert.equal(checked.observations[0].accountId, 'husband');
    const m = JSON.parse(
        f.publication.objects.get(f.publication.marker.value.manifest.key)
    );
    const binding = { ...m.binding, accountSeqSha256: hash('wrong-sequence') };
    // Preparing with an account binding that disagrees with the collector must fail offline.
    await assert.rejects(
        () =>
            prepareManualPublication({
                root: join(f.publication.dir, '..'),
                accountSeq: '43',
                accountSuffix: '0043',
                binding,
                scopes: f.result.scopes,
                checkedAt: f.result.checkedAt,
            }),
        /무결성/
    );
});

test('same provider ID on two accounts stays separate; repeated same-account state is counted once', async (t) => {
    const wife = await collect(t, 'wife'),
        husband = await collect(t, 'husband');
    const verified = await Promise.all(
        [wife, husband].map((f) =>
            verifyIncrement(
                async (key) => f.publication.objects.get(key),
                f.publication.marker.value
            )
        )
    );
    const base = { rows: [], details: new Map(), snapshotAt: '2000-01-01' };
    const projected = overlayIncrements(base, {
        verified: [...verified, verified[1]],
        revision: hash('revision'),
        entryCount: 3,
    });
    assert.equal(projected.rows.length, 2);
    assert.deepEqual(
        new Set(projected.rows.map((r) => r.accountId)),
        new Set(['wife', 'husband'])
    );
    assert.notEqual(projected.rows[0].id, projected.rows[1].id);
    assert.equal(base.rows.length, 0);
});

test('family totals deduplicate account observations, retain native currencies and exclude transfers without guessing classification', () => {
    const row = {
        id: hash('same'),
        accountId: 'wife',
        type: 'DIVIDEND',
        currency: 'USD',
        amount: '1.234567890123456789',
        isTransaction: true,
    };
    const rows = [
        row,
        { ...row },
        { ...row, accountId: 'husband' },
        { ...row, id: hash('krw'), currency: 'KRW', amount: '1000' },
        { ...row, id: hash('transfer'), type: 'DEPOSIT', amount: '9999' },
    ];
    const totals = summarizeFinalRows(rows);
    assert.equal(
        totals.find((r) => r.currency === 'USD').amount,
        '2.469135780246913578'
    );
    assert.equal(totals.find((r) => r.currency === 'KRW').amount, '1000');
    assert.equal(totals.length, 2);
    assert.throws(
        () => summarizeFinalRows([row, { ...row, amount: '5' }]),
        /conflicting/
    );
    assert.equal(
        familyFinalRows({ rows, unassignedRows: [] }, 'husband').length,
        1
    );
    assert.equal(
        familyFinalRows({ rows, unassignedRows: [] }, 'unknown').length,
        0
    );
});

test('server family read uses existing baseline once, legacy wife index plus isolated registered profile indices; filters cannot expose other account details', async (t) => {
    const wife = await collect(t, 'wife'),
        husband = await collect(t, 'husband');
    const baseline = finalLedgerFixture();
    const io = memory(
        new Map([
            ...baseline.objects,
            ...wife.publication.objects,
            ...husband.publication.objects,
        ])
    );
    for (const f of [wife, husband])
        io.objects.set(f.publication.marker.key, f.publication.marker.bytes);
    const calls = [];
    const store = createPrivateReportStore({
        environment: refs,
        finalCheckpoint: baseline.checkpoint,
        getStorage: () => ({
            send: async (cmd) => {
                calls.push(cmd.input);
                if (cmd.input.Prefix)
                    return {
                        Contents: [...io.objects.keys()]
                            .filter((k) => k.startsWith(cmd.input.Prefix))
                            .map((Key) => ({ Key })),
                        IsTruncated: false,
                    };
                const bytes = io.objects.get(cmd.input.Key);
                assert.ok(bytes, 'unexpected read');
                return {
                    ContentLength: bytes.length,
                    Body: Readable.from([bytes]),
                };
            },
        }),
    });
    const [a, b] = await Promise.all([
        store.readFinalSnapshot('owner', 'family'),
        store.readFinalSnapshot('owner', 'family'),
    ]);
    assert.equal(a, b);
    assert.equal(a.profileStates.length, 2);
    const lists = calls.filter((c) => c.Prefix);
    assert.equal(lists.length, 3);
    assert.equal(
        lists.filter(
            (c) => c.Prefix === 'reconciliation/increments/v1/wife/index/'
        ).length,
        1
    );
    const scoped = await store.readFinalSnapshot('owner', 'husband');
    assert.ok(scoped.rows.length > 0);
    assert.ok(scoped.rows.every((r) => r.accountId === 'husband'));
    assert.equal(scoped.unassignedRows.length, 0);
    assert.equal(scoped.details.size, scoped.rows.length);
    assert.ok(
        lists.some(
            (c) =>
                c.Prefix ===
                profileIndexPrefix(resolveAccountProfile('husband-toss', refs))
        )
    );
});

test('family client coalesces concurrent requests; local scope switching makes no requests, and permission loss clears cached results', async () => {
    const f = finalLedgerFixture();
    let requests = 0,
        denied = false;
    const user = { getIdToken: async () => 'synthetic' };
    const client = createSheetReportClient({
        fetchImpl: async () => {
            requests++;
            return new Response(
                JSON.stringify(
                    denied
                        ? { error: 'denied' }
                        : {
                              schemaVersion: 1,
                              section: 'final',
                              accountId: 'family',
                              readOnly: true,
                              adopted: true,
                              comparisonRequired: false,
                              releaseId: f.checkpoint.gzipSha256,
                              rows: [],
                              unassignedRows: [],
                          }
                ),
                { status: denied ? 403 : 200 }
            );
        },
    });
    const [a] = await Promise.all([
        client.load(user, 'family', 'final'),
        client.load(user, 'family', 'final'),
    ]);
    for (const scope of ['wife', 'husband', 'family'])
        familyFinalRows(a, scope);
    await client.load(user, 'family', 'final');
    assert.equal(requests, 1);
    denied = true;
    await assert.rejects(() =>
        client.load(user, 'family', 'final', { refresh: true })
    );
    denied = false;
    await client.load(user, 'family', 'final');
    assert.equal(requests, 3);
    client.clear();
    await client.load(user, 'family', 'final');
    assert.equal(requests, 4);
});

test('legacy wife and v2 profile observations of the same API receipt stay one order with account-scoped identity', async (t) => {
    const f = await collect(t, 'wife');
    const legacy = await prepareManualPublication({
        root: join(f.publication.dir, '..'),
        accountSeq: '42',
        accountSuffix: '0042',
        scopes: f.result.scopes,
        checkedAt: f.result.checkedAt,
    });
    const old = await loadPublication(legacy.localDirectory);
    const verified = await Promise.all(
        [old, f.publication].map((p) =>
            verifyIncrement(async (key) => p.objects.get(key), p.marker.value)
        )
    );
    const rows = overlayIncrements(
        { rows: [], details: new Map(), snapshotAt: '2000-01-01' },
        { verified, revision: hash('legacy-v2'), entryCount: 2 }
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(
        rows[0].id,
        hash(
            'wife-toss:' +
                refs.TOSS_WIFE_ACCOUNT_SHA256 +
                ':same-provider-id:' +
                verified[0].apiOrders[0].sourceHash
        )
    );
});

test('manual CLI explicit env file cannot inherit stale OS tokens, and absent file fails without fallback', async (t) => {
    const root = await rootFor(t),
        file = join(root, 'isolated.env'),
        preload = join(root, 'mock-fetch.mjs');
    await writeFile(
        file,
        `TOSS_HUSBAND_ACCOUNT_SUFFIX=0043\nTOSS_HUSBAND_ACCOUNT_SHA256=${refs.TOSS_HUSBAND_ACCOUNT_SHA256}\nTOSS_HUSBAND_CLIENT_ID=synthetic\nTOSS_HUSBAND_CLIENT_SECRET=synthetic`
    );
    await writeFile(
        preload,
        "globalThis.fetch = async () => { throw Error('Unexpected network attempt in mock test'); }; "
    );
    const run = (path) =>
        spawnSync(
            process.execPath,
            [
                '--import',
                pathToFileURL(preload).href,
                'scripts/toss/read-account-orders.mjs',
                '--live',
                '--profile',
                'husband-toss',
                '--status',
                'OPEN',
                '--env-file',
                path,
            ],
            { encoding: 'utf8', env: { PATH: process.env.PATH, ...refs } }
        );
    const isolated = run(file);
    assert.equal(isolated.status, 2);
    assert.equal(JSON.parse(isolated.stdout).reason, 'authentication_required');
    assert.deepEqual(JSON.parse(isolated.stdout).requests, {
        token: 0,
        accounts: 0,
        orders: 0,
    });
    // Node versions may reject a missing --env-file before entering the script.
    const absent = run(join(root, 'absent.env'));
    assert.notEqual(absent.status, 0);
    assert.equal(absent.stdout, '');
});

test('family client → authenticated handler → real store reads both account indices with identical suffix/order IDs and never emits raw evidence', async (t) => {
    const husbandNumber = '99999990042';
    const sameSuffixRefs = {
        ...refs,
        TOSS_HUSBAND_ACCOUNT_SUFFIX: '0042',
        TOSS_HUSBAND_ACCOUNT_SHA256: hash(husbandNumber),
    };
    const sourceOrder = (currency, amount) =>
        order('identical-provider-order', {
            currency,
            execution: { ...order().execution, filledAmount: amount },
            unknownProviderField: {
                rawPrivate: 'RAW-FINANCIAL-FIXTURE-DO-NOT-EMIT',
            },
        });
    const [wife, husband] = await Promise.all([
        collect(t, 'wife', {
            credentials: sameSuffixRefs,
            apiOrders: [sourceOrder('USD', '1.2345')],
        }),
        collect(t, 'husband', {
            credentials: sameSuffixRefs,
            mutateAccount: (a) => [{ ...a, accountNo: husbandNumber }],
            apiOrders: [sourceOrder('KRW', '1000')],
        }),
    ]);
    assert.equal(wife.result.apiStatus, 'complete');
    assert.equal(husband.result.apiStatus, 'complete');
    const wrongAccount = await collect(t, 'husband', {
        credentials: sameSuffixRefs,
        mutateAccount: (a) => [{ ...a, accountNo: numbers.wife }],
    });
    assert.equal(wrongAccount.result.reason, 'profile_account_mismatch');
    assert.equal(wrongAccount.calls.length, 1);
    assert.equal(wrongAccount.result.publication, undefined);
    assert.ok(wife.calls.every((c) => c.token === 'Bearer wife-token'));
    assert.ok(husband.calls.every((c) => c.token === 'Bearer husband-token'));
    assert.notEqual(
        wife.publication.marker.key,
        husband.publication.marker.key
    );
    const baseline = finalLedgerFixture();
    const io = memory(baseline.objects);
    // Matching last four digits cannot authorize a different profile's restart.
    await assert.rejects(
        () =>
            publishExisting({
                directory: husband.publication.dir,
                profile: resolveAccountProfile('wife-toss', sameSuffixRefs),
                ...io,
            }),
        /profile_account_mapping_required/
    );
    assert.equal(io.writes.length, 0);
    await Promise.all(
        [wife, husband].map((f) =>
            publishExisting({
                directory: f.publication.dir,
                profile: resolveAccountProfile(
                    f.result.profileId,
                    sameSuffixRefs
                ),
                ...io,
            })
        )
    );
    const storageCalls = [];
    const store = createPrivateReportStore({
        environment: sameSuffixRefs,
        finalCheckpoint: baseline.checkpoint,
        getStorage: () => ({
            send: async (command) => {
                storageCalls.push(command.input);
                if (command.input.Prefix)
                    return {
                        Contents: [...io.objects.keys()]
                            .filter((key) =>
                                key.startsWith(command.input.Prefix)
                            )
                            .map((Key) => ({ Key })),
                        IsTruncated: false,
                    };
                const bytes = io.objects.get(command.input.Key);
                assert.ok(bytes, 'fixture object must exist');
                return {
                    ContentLength: bytes.length,
                    Body: Readable.from([bytes]),
                };
            },
        }),
    });
    let documentReads = 0,
        requests = 0;
    const uid = 'synthetic-family-owner';
    const database = () => ({
        collection: (name) => {
            assert.equal(name, 'sheetTrialLedgers');
            return {
                doc: (owner) => {
                    assert.equal(owner, uid);
                    return {
                        get: async () => {
                            documentReads++;
                            return {
                                exists: true,
                                data: () => ({ pageCount: 1 }),
                            };
                        },
                        collection: (name) => {
                            assert.equal(name, 'pages');
                            return {
                                doc: (pageId) => {
                                    assert.equal(pageId, '0');
                                    return {
                                        get: async () => {
                                            documentReads++;
                                            return {
                                                data: () => ({
                                                    rows: [
                                                        {
                                                            accountId: 'wife',
                                                            source: {
                                                                spreadsheetId:
                                                                    'synthetic-workbook',
                                                            },
                                                        },
                                                    ],
                                                }),
                                            };
                                        },
                                    };
                                },
                            };
                        },
                    };
                },
            };
        },
    });
    const handler = sheetReportHandler({
        verify: async (req) => {
            assert.equal(
                req.headers.Authorization,
                'Bearer fixture-firebase-token'
            );
            return { uid, email: 'jomalkeun@gmail.com', email_verified: true };
        },
        database,
        store,
        finalCheckpoint: baseline.checkpoint,
    });
    const client = createSheetReportClient({
        fetchImpl: async (url, request) => {
            requests++;
            const response = {
                statusCode: 200,
                setHeader() {},
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                json(body) {
                    this.body = body;
                    return this;
                },
            };
            await handler(
                {
                    method: 'GET',
                    query: Object.fromEntries(
                        new URL(url, 'http://fixture.local').searchParams
                    ),
                    headers: request.headers,
                },
                response
            );
            return new Response(JSON.stringify(response.body), {
                status: response.statusCode,
            });
        },
    });
    const user = { getIdToken: async () => 'fixture-firebase-token' };
    const [family, concurrent] = await Promise.all([
        client.load(user, 'family', 'final'),
        client.load(user, 'family', 'final'),
    ]);
    assert.equal(family, concurrent);
    assert.equal(requests, 1);
    assert.equal(documentReads, 2);
    const prefixes = storageCalls.filter((c) => c.Prefix).map((c) => c.Prefix);
    for (const id of ['wife-toss', 'husband-toss'])
        assert.ok(
            prefixes.includes(
                profileIndexPrefix(resolveAccountProfile(id, sameSuffixRefs))
            )
        );
    assert.equal(
        prefixes.filter((p) => p === 'reconciliation/increments/v1/wife/index/')
            .length,
        1
    );
    const incrementalRows = family.rows.filter((r) => r.increment);
    assert.equal(incrementalRows.length, 2);
    assert.equal(familyFinalRows(family, 'husband').length, 1);
    assert.equal(
        familyFinalRows(family, 'wife').filter((r) => r.increment).length,
        1
    );
    assert.notEqual(incrementalRows[0].id, incrementalRows[1].id);
    const totals = summarizeFinalRows(incrementalRows);
    assert.equal(
        totals.find((total) => total.currency === 'USD').amount,
        '1.2345'
    );
    assert.equal(
        totals.find((total) => total.currency === 'KRW').amount,
        '1000'
    );
    assert.deepEqual(family.aggregation, {
        currencyMode: 'native_currency_only',
        fxRate: null,
        transfersAreIncome: false,
    });
    const serialized = JSON.stringify(family);
    for (const hidden of [
        numbers.wife,
        husbandNumber,
        'wife-token',
        'husband-token',
        'stale-global-token',
        'fixture-firebase-token',
        'RAW-FINANCIAL-FIXTURE-DO-NOT-EMIT',
        'bodyBase64',
        'dataBase64',
        'accountSeqSha256',
    ])
        assert.ok(
            !serialized.includes(hidden),
            'private transport fields must not reach the API response'
        );
    for (const row of incrementalRows) {
        const own = await client.load(user, row.accountId, 'final', {
            observationId: row.id,
        });
        assert.equal(own.detail.id, row.id);
        const other = row.accountId === 'wife' ? 'husband' : 'wife';
        await assert.rejects(
            () => client.load(user, other, 'final', { observationId: row.id }),
            (error) => error.status === 404
        );
    }
    const [wifeOnly, husbandOnly] = await Promise.all([
        client.load(user, 'wife', 'final'),
        client.load(user, 'husband', 'final'),
    ]);
    assert.ok(wifeOnly.rows.every((r) => r.accountId === 'wife'));
    assert.equal(husbandOnly.rows.length, 1);
    assert.ok(husbandOnly.rows.every((r) => r.accountId === 'husband'));
    assert.equal(husbandOnly.unassignedRows.length, 0);
});

test('legacy alias requires verified collector account hash: equal suffix/order IDs cannot collapse different accounts', async (t) => {
    const owner = await collect(t, 'wife');
    const anotherNumber = '99999990042';
    const other = await collect(t, 'wife', {
        credentials: { ...refs, TOSS_WIFE_ACCOUNT_SHA256: hash(anotherNumber) },
        mutateAccount: (a) => [
            { ...a, accountNo: anotherNumber, accountSeq: 84 },
        ],
        apiOrders: [
            order('same-provider-id', {
                execution: { ...order().execution, filledAmount: '20' },
            }),
        ],
    });
    const legacyFor = async (f, accountSeq) =>
        loadPublication(
            (
                await prepareManualPublication({
                    root: join(f.publication.dir, '..'),
                    accountSeq,
                    accountSuffix: '0042',
                    scopes: f.result.scopes,
                    checkedAt: f.result.checkedAt,
                })
            ).localDirectory
        );
    const [legacyOwner, legacyOther] = await Promise.all([
        legacyFor(owner, '42'),
        legacyFor(other, '84'),
    ]);
    const verified = await Promise.all(
        [owner.publication, legacyOwner, legacyOther].map((p) =>
            verifyIncrement(async (key) => p.objects.get(key), p.marker.value)
        )
    );
    assert.equal(verified[1].apiAccountHash, hash('42'));
    assert.equal(verified[2].apiAccountHash, hash('84'));
    for (const batches of [
        [verified[0], verified[2]],
        [verified[1], verified[2]],
    ]) {
        assert.throws(
            () =>
                overlayIncrements(
                    { rows: [], details: new Map(), snapshotAt: '2000-01-01' },
                    {
                        verified: batches,
                        revision: hash('different-account'),
                        entryCount: 2,
                    }
                ),
            /무결성/
        );
    }
});

test('v2 cannot overwrite an unbound baseline order or apply the baseline date cutoff to another profile account', async (t) => {
    const f = await collect(t, 'wife', {
        apiOrders: [order('synthetic-order-1')],
    });
    const verified = await verifyIncrement(
        async (key) => f.publication.objects.get(key),
        f.publication.marker.value
    );
    const fixture = finalLedgerFixture();
    const store = createPrivateReportStore({
        finalCheckpoint: fixture.checkpoint,
        environment: {},
        getStorage: () => ({
            send: async (command) => {
                const bytes = fixture.objects.get(command.input.Key);
                return {
                    ContentLength: bytes.length,
                    Body: Readable.from([bytes]),
                };
            },
        }),
    });
    const baseline = await store.readFinalBaseline('fixture-owner');
    // This new account observation predates the adopted snapshot; it must remain visible.
    verified.apiOrders[0].observedAt = '2020-01-01T00:00:00Z';
    const before = JSON.stringify(baseline.rows);
    const result = overlayIncrements(baseline, {
        verified: [verified],
        revision: hash('unbound-baseline'),
        entryCount: 1,
    });
    assert.equal(result.rows.length, baseline.rows.length + 1);
    assert.equal(
        JSON.stringify(result.rows.filter((row) => !row.increment)),
        before
    );
    const added = result.rows.find((row) => row.increment);
    assert.equal(added.countInTotals, false);
    assert.match(added.state, /기준 계좌 연결 미확인/);
    assert.equal(
        result.details.get(added.id).duplicateStatus,
        'baseline_account_binding_unverified'
    );
    assert.equal(
        JSON.stringify(summarizeFinalRows(result.rows)),
        JSON.stringify(summarizeFinalRows(baseline.rows))
    );
    assert.equal(JSON.stringify(baseline.rows), before);
});

test('legacy/v2 mixed verification remains compatible; individual pass cannot override combined account conflict', async (t) => {
    const modern = await collect(t, 'wife');
    const legacy = async (collector, seq) => {
        const plan = await prepareManualPublication({
            root: join(
                collector.root,
                'wife-toss',
                refs.TOSS_WIFE_ACCOUNT_SHA256
            ),
            accountSeq: seq,
            accountSuffix: '0042',
            scopes: collector.result.scopes,
            checkedAt: collector.result.checkedAt,
        });
        return loadPublication(plan.localDirectory);
    };
    const same = await legacy(modern, '42');
    const changedCollector = await collect(t, 'wife', {
        mutateAccount: (a) => [{ ...a, accountSeq: 84 }],
    });
    const different = await legacy(changedCollector, '84');
    const verified = await Promise.all(
        [modern.publication, same, different].map((p) =>
            verifyIncrement(async (key) => p.objects.get(key), p.marker.value)
        )
    );
    const base = { rows: [], details: new Map(), snapshotAt: '2000-01-01' };
    assert.ok(
        overlayIncrements(base, {
            verified: verified.slice(0, 2),
            revision: hash('compatible'),
            entryCount: 2,
        }).rows.length > 0
    );
    for (const mixed of [
        [verified[0], verified[2]],
        [verified[2], verified[0]],
    ]) {
        assert.throws(
            () =>
                overlayIncrements(base, {
                    verified: mixed,
                    revision: hash('conflict'),
                    entryCount: 2,
                }),
            (e) => e.diagnosticCode === 'INC_INTEGRATION_SEQUENCE_CONFLICT'
        );
    }
    assert.equal(base.rows.length, 0);
    const io = memory(
        new Map([...same.objects, [same.marker.key, same.marker.bytes]])
    );
    await assert.rejects(
        () => readIncrements({ ...io, expectedLegacySuffix: '0000' }),
        (e) => e.diagnosticCode === 'INC_LEGACY_BINDING'
    );
    assert.equal(
        (await readIncrements({ ...io, expectedLegacySuffix: '0042' }))
            .entryCount,
        1
    );
});

test('binding JSON field order is immaterial while every own field, type and nested value remains verified', async (t) => {
    const { rewriteIncrementFixture } = await import(
        './support/increment-fixture-rewrite.mjs'
    );
    const f = (await collect(t, 'wife')).publication;
    const original = f.marker.value.binding;
    const reversed = Object.fromEntries(Object.entries(original).reverse());
    const reordered = rewriteIncrementFixture(f, {
        manifest: (m) => {
            m.binding = reversed;
        },
    });
    assert.equal(
        (
            await verifyIncrement(
                async (key) => reordered.objects.get(key),
                reordered.marker.value
            )
        ).apiOrders.length,
        1
    );
    const io = memory(new Map([...f.objects, [f.marker.key, f.marker.bytes]]));
    assert.equal(
        (await readIncrements({ ...io, binding: reversed })).entryCount,
        1
    );
    const mutate = (change) => {
        const b = structuredClone(original);
        change(b);
        return b;
    };
    const different = [
        mutate((b) => {
            delete b.accountSeqSha256;
        }),
        mutate((b) => {
            b.accountNoSha256 = hash('different-account');
        }),
        mutate((b) => {
            b.accountSeqSha256 = hash('different-collector');
        }),
        mutate((b) => {
            b.ownerId = 'husband';
        }),
        mutate((b) => {
            b.profileId = 'husband-toss';
        }),
        mutate((b) => {
            b.brokerId = 'other';
        }),
        mutate((b) => {
            b.suffix = '9999';
        }),
        mutate((b) => {
            b.suffix = Number(b.suffix);
        }),
        mutate((b) => {
            b.extra = 'unknown';
        }),
        {
            ...original,
            ...JSON.parse('{"__proto__":{"own":"must-be-compared"}}'),
        },
        null,
    ];
    for (const binding of different) {
        const changed = rewriteIncrementFixture(f, {
            manifest: (m) => {
                m.binding = binding;
            },
        });
        await assert.rejects(
            () =>
                verifyIncrement(
                    async (key) => changed.objects.get(key),
                    changed.marker.value
                ),
            (e) => e.diagnosticCode === 'INC_BUNDLE_BINDING'
        );
    }
    for (const binding of [
        { ...original, accountSeqSha256: hash('different-collector') },
        { ...original, suffix: '9999' },
        { ...original, extra: 'unknown' },
        {
            ...original,
            ...JSON.parse('{"__proto__":{"own":"must-be-compared"}}'),
        },
    ])
        await assert.rejects(
            () => readIncrements({ ...io, binding }),
            (e) => e.diagnosticCode === 'INC_INDEX_SCOPE'
        );
    const binding = {
        ...original,
        extra: { a: 1, b: [1, 2] },
        ...JSON.parse('{"__proto__":{"own":"compared"}}'),
    };
    const extraManifest = rewriteIncrementFixture(f, {
        manifest: (m) => {
            m.binding = binding;
        },
    });
    const bound = {
        ...extraManifest.marker.value,
        binding: structuredClone(binding),
    };
    assert.equal(
        (
            await verifyIncrement(
                async (key) => extraManifest.objects.get(key),
                bound
            )
        ).apiOrders.length,
        1
    );
    const nestedReorder = {
        ...bound,
        binding: { ...binding, extra: { b: [1, 2], a: 1 } },
    };
    assert.equal(
        (
            await verifyIncrement(
                async (key) => extraManifest.objects.get(key),
                nestedReorder
            )
        ).apiOrders.length,
        1
    );
    for (const extra of [
        { a: 1, b: [2, 1] },
        { a: '1', b: [1, 2] },
        { a: 1, b: [1, 2], c: null },
    ]) {
        await assert.rejects(
            () =>
                verifyIncrement(async (key) => extraManifest.objects.get(key), {
                    ...bound,
                    binding: { ...binding, extra },
                }),
            (e) => e.diagnosticCode === 'INC_BUNDLE_BINDING'
        );
    }
    const ownProtoChanged = structuredClone(bound);
    ownProtoChanged.binding['__proto__'].own = 'changed';
    await assert.rejects(
        () =>
            verifyIncrement(
                async (key) => extraManifest.objects.get(key),
                ownProtoChanged
            ),
        (e) => e.diagnosticCode === 'INC_BUNDLE_BINDING'
    );
    const corrupted = new Map(reordered.objects);
    corrupted.set(reordered.marker.value.manifest.key, Buffer.from('{}'));
    await assert.rejects(
        () =>
            verifyIncrement(
                async (key) => corrupted.get(key),
                reordered.marker.value
            ),
        (e) => e.diagnosticCode === 'INC_MANIFEST_DIGEST'
    );
    const wrongSeq = mutate((b) => {
        b.accountSeqSha256 = hash('different-collector');
    });
    const collectorMismatch = rewriteIncrementFixture(f, {
        manifest: (m) => {
            m.binding = wrongSeq;
        },
    });
    await assert.rejects(
        () =>
            verifyIncrement(async (key) => collectorMismatch.objects.get(key), {
                ...collectorMismatch.marker.value,
                binding: wrongSeq,
            }),
        (e) => e.diagnosticCode === 'INC_COLLECTOR_BINDING'
    );
});
