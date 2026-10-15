import test from 'node:test';
import assert from 'node:assert/strict';
import {
    capitalSummary,
    purchaseBasis,
    validateFunding,
    fundingCandidates,
} from '../lib/portfolio-capital.js';
import { capitalHandler } from '../lib/portfolio-capital-handler.js';

const trade = {
    type: 'buy',
    rawType: '구매',
    date: '20261015',
    currency: 'USD',
    amount: 140000,
    settlementAmount: 140140,
    nativeAmount: 100,
    nativeSettlementAmount: 100.1,
};
const request = () => ({
    basisKey: purchaseBasis(trade).basisKey,
    parts: [
        { method: 'usd_balance', amount: 70, source: 'dividend' },
        {
            method: 'krw_conversion',
            amount: 30.1,
            paidKrw: 42140,
            source: 'principal',
        },
    ],
    evidenceIds: [],
    note: '실제 결제 내역 확인',
});

test('net contributed capital excludes unconfirmed cash, conversions, internal transfers and reinvestments; currencies stay separate', () => {
    const entries = [
        'deposit',
        'withdraw',
        'fx',
        'dividend',
        'sale',
        'interest',
        'transfer',
        'pending',
        'dollar',
    ].map((id, i) => ({
        id,
        date: '20261015',
        currency: id === 'dollar' ? 'USD' : 'KRW',
        amount: i === 1 ? 200000 : id === 'dollar' ? 100 : 1000000,
    }));
    const classifications = [
        'external_deposit',
        'external_withdrawal',
        'exchange',
        'dividend',
        'sale',
        'interest',
        'transfer',
        null,
        'external_deposit',
    ].flatMap((classification, i) =>
        classification ? [{ id: entries[i].id, classification }] : []
    );
    const result = capitalSummary(entries, classifications);
    assert.equal(result.KRW.net, 800000);
    assert.equal(result.USD.net, 100);
    assert.equal(result.pending, 1);
    classifications.push({ id: 'pending', classification: 'unknown' });
    assert.equal(capitalSummary(entries, classifications).KRW.net, 800000);
});
test('mixed USD balance and KRW conversion validate against actual settlement including fees', () => {
    const allocation = validateFunding(request(), trade);
    assert.equal(allocation.total, 100.1);
    assert.equal(allocation.status, 'confirmed');
    assert.equal(allocation.parts[1].paidKrw, 42140);
    const input = request();
    input.parts[0].source = 'principal';
    assert.equal(validateFunding(input, trade).parts[0].source, 'principal'); // USD is not automatically dividend money.
    input.parts[1].source = 'unknown';
    assert.equal(validateFunding(input, trade).status, 'partial');
    input.parts[1].source = 'principal';
    input.parts[0].method = 'unknown';
    assert.equal(validateFunding(input, trade).status, 'partial');
    input.parts[0].amount = 69;
    assert.throws(() => validateFunding(input, trade), /합계/);
});
test('missing/changed settlement, incompatible currencies, negative values and malformed evidence cannot be confirmed', () => {
    assert.throws(
        () => purchaseBasis({ ...trade, nativeSettlementAmount: null }),
        /정산액/
    );
    assert.throws(
        () =>
            validateFunding(request(), {
                ...trade,
                nativeSettlementAmount: 101,
            }),
        /변경/
    );
    const input = request();
    input.parts[1].paidKrw = -1;
    assert.throws(() => validateFunding(input, trade), /원화/);
    input.parts[1].paidKrw = 42140;
    input.parts[0].method = 'krw_cash';
    assert.throws(() => validateFunding(input, trade), /통화/);
    input.parts[0].method = 'usd_balance';
    input.evidenceIds = ['../../other'];
    assert.throws(() => validateFunding(input, trade), /근거/);
});
test('same-day cash is a candidate, with known other accounts excluded', () => {
    const rows = [
        { id: '1', date: trade.date, accountId: 'A' },
        { id: '2', date: trade.date, accountId: 'B' },
        { id: '3', date: '20261014', accountId: 'A' },
        { id: '4', date: trade.date },
    ];
    assert.deepEqual(
        fundingCandidates(trade, rows, 'A').map((r) => r.id),
        ['1', '4']
    );
});

function fixture(uid = 'owner') {
    const records = new Map([
        ['portfolios/owner/assets/A/transactions/T', trade],
        [
            'portfolios/owner/cashEntries/E',
            { amount: 42140, currency: 'KRW', date: trade.date },
        ],
    ]);
    const ref = (path) => ({ path, get: async () => snapshot(path) });
    const snapshot = (path) => ({
        id: path.split('/').at(-1),
        exists: records.has(path),
        data: () => records.get(path),
    });
    const db = {
        doc: ref,
        collection: (path) => {
            const get = async (field, value) => ({
                docs: [...records.keys()]
                    .filter(
                        (k) =>
                            k.startsWith(path + '/') &&
                            !k.slice(path.length + 1).includes('/') &&
                            (!field ||
                                field
                                    .split('.')
                                    .reduce(
                                        (v, key) => v?.[key],
                                        records.get(k)
                                    ) === value)
                    )
                    .map(snapshot),
            });
            return {
                get: () => get(),
                where: (field, op, value) => ({ get: () => get(field, value) }),
            };
        },
        runTransaction: async (fn) => {
            const writes = [];
            const result = await fn({
                get: async (r) => snapshot(r.path),
                set: (r, d) => writes.push([r.path, d]),
            });
            for (const [p, d] of writes) records.set(p, d);
            return result;
        },
    };
    const handler = capitalHandler({
        verify: async () => {
            if (!uid) throw Object.assign(new Error('login'), { status: 401 });
            return { uid };
        },
        database: () => db,
        timestamp: () => 'now',
    });
    const call = async (body, method = 'POST', query = {}) => {
        let status, data;
        await handler(
            { method, body, query },
            {
                setHeader() {},
                status(s) {
                    status = s;
                    return this;
                },
                json(d) {
                    data = d;
                    return this;
                },
            }
        );
        return { status, data };
    };
    return { call, records };
}
test('owner can save, reload and reset funding without modifying the financial ledger', async () => {
    const f = fixture();
    const input = {
        ...request(),
        action: 'saveFunding',
        assetId: 'A',
        transactionId: 'T',
        revision: 0,
        evidenceIds: ['E'],
    };
    assert.equal((await f.call(input)).status, 200);
    const read = await f.call(null, 'GET');
    assert.equal(read.data.allocations[0].parts.length, 2);
    assert.equal((await f.call(input)).status, 409); // stale edit
    assert.deepEqual(
        f.records.get('portfolios/owner/assets/A/transactions/T'),
        trade
    );
    assert.equal(
        (await f.call({ ...input, action: 'resetFunding', revision: 1 }))
            .status,
        200
    );
    assert.equal(
        f.records.get('portfolios/owner/fundingAllocations/A.T').status,
        'reset'
    );
});
test('cross-owner reads, edits and foreign evidence are blocked even with supplied UID', async () => {
    const f = fixture('other');
    assert.equal(
        (
            await f.call({
                ...request(),
                action: 'saveFunding',
                uid: 'owner',
                assetId: 'A',
                transactionId: 'T',
                revision: 0,
            })
        ).status,
        404
    );
    assert.deepEqual((await f.call(null, 'GET')).data.entries, []);
    assert.equal((await fixture(null).call(null, 'GET')).status, 401);
    const own = fixture();
    assert.equal(
        (
            await own.call({
                ...request(),
                action: 'saveFunding',
                assetId: 'A',
                transactionId: 'T',
                revision: 0,
                evidenceIds: ['foreign'],
            })
        ).status,
        400
    );
});
test('cash additions are idempotent, separate from imported entries, and invalid dates cannot create false principal', async () => {
    const f = fixture();
    const input = {
        action: 'addCash',
        id: 'M',
        date: '2026-10-15',
        currency: 'KRW',
        amount: 1000000,
        classification: 'external_deposit',
        note: '은행 입금 내역 확인',
    };
    assert.equal((await f.call(input)).status, 200);
    assert.equal((await f.call(input)).status, 200);
    assert.equal(
        (await f.call({ ...input, id: 'bad', date: '2026-02-31' })).status,
        400
    );
    assert.equal(
        (await f.call({ ...input, id: 'bad', amount: 'Infinity' })).status,
        400
    );
    const original = structuredClone(
        f.records.get('portfolios/owner/cashEntries/E')
    );
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                id: 'E',
                classification: 'exchange',
                note: '확인',
                revision: 0,
            })
        ).status,
        200
    );
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                id: 'E',
                classification: 'external_deposit',
                revision: 0,
            })
        ).status,
        409
    );
    assert.deepEqual(f.records.get('portfolios/owner/cashEntries/E'), original);
});

function accountFixture(uid = 'owner') {
    const f = fixture(uid);
    f.records.set('investmentAccounts/AC', {
        familyId: 'F',
        permissions: { owner: 'owner', viewer: 'viewer', editor: 'editor' },
    });
    f.records.set('familySpaces/F', {
        participantUids: ['owner', 'viewer', 'editor', 'admin'],
        adminUid: 'admin',
    });
    f.records.set('investmentAccounts/AC/entries/T', {
        row: trade,
        source: 'toss-pdf',
    });
    f.records.set('investmentAccounts/AC/entries/E', {
        row: {
            date: '2026-10-15',
            symbol: 'CASH',
            type: 'cash_out',
            cashKind: 'exchange',
            currency: 'KRW',
            amount: 42140,
            exchangeRate: 1400,
        },
        source: 'toss-pdf',
    });
    return f;
}
test('account-scoped capital uses family membership AND account ACL; viewer cannot edit and family administrator has no implicit account access', async () => {
    const viewer = accountFixture('viewer');
    const read = await viewer.call(undefined, 'GET', { accountId: 'AC' });
    assert.equal(read.status, 200);
    assert.equal(read.data.entries[0].id, 'E');
    assert.equal(
        (
            await viewer.call({
                action: 'classifyCash',
                accountId: 'AC',
                id: 'E',
                classification: 'exchange',
                revision: 0,
            })
        ).status,
        403
    );
    assert.equal(
        (
            await accountFixture('admin').call(undefined, 'GET', {
                accountId: 'AC',
            })
        ).status,
        403
    );
    const removed = accountFixture('owner');
    removed.records.set('familySpaces/F', { participantUids: [] });
    assert.equal(
        (await removed.call(undefined, 'GET', { accountId: 'AC' })).status,
        403
    );
});
test('editable account funding reads exact settlement from the account ledger and annotations stay separate', async () => {
    const f = accountFixture('editor');
    const input = {
        ...request(),
        action: 'saveFunding',
        assetId: 'ACCOUNT',
        transactionId: 'T',
        revision: 0,
        accountId: 'AC',
        evidenceIds: ['E'],
    };
    assert.equal((await f.call(input)).status, 200);
    assert.equal(
        f.records.get('investmentAccounts/AC/fundingAllocations/ACCOUNT.T')
            .status,
        'confirmed'
    );
    assert.deepEqual(
        f.records.get('investmentAccounts/AC/entries/T').row,
        trade
    );
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                accountId: 'AC',
                id: 'E',
                classification: 'exchange',
                revision: 0,
            })
        ).status,
        200
    );
    assert.equal(
        (await f.call({ ...input, accountId: 'missing' })).status,
        404
    );
});
