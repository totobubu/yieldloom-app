import test from 'node:test';
import assert from 'node:assert/strict';
import {
    capitalSummary,
    capitalRecovery,
    combineCapitalStates,
    stockRecovery,
    purchaseBasis,
    validateFunding,
    fundingCandidates,
    withdrawalBreakdown,
} from '../lib/portfolio-capital.js';
import { capitalHandler } from '../lib/portfolio-capital-handler.js';

test('capital API reports database quota exhaustion as 429', async () => {
    const handler = capitalHandler({
        verify: async () => ({ uid: 'owner' }),
        database: () => {
            throw Object.assign(new Error('Quota exceeded'), { code: 8 });
        },
        timestamp: () => null,
    });
    let status, data;
    await handler(
        { method: 'GET' },
        {
            setHeader() {},
            status(value) {
                status = value;
                return this;
            },
            json(value) {
                data = value;
                return this;
            },
        }
    );
    assert.equal(status, 429);
    assert.equal(data.code, 'DATA_RESOURCE_EXHAUSTED');
    assert.equal(data.entries, undefined);
});

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
    assert.equal(result.pending, 2); // Legacy generic withdrawals still need their source confirmed.
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
    const reads = [],
        usage = [];
    const ref = (path) => ({
        path,
        get: async () => {
            reads.push(path);
            return snapshot(path);
        },
    });
    const snapshot = (path) => ({
        id: path.split('/').at(-1),
        exists: records.has(path),
        data: () => records.get(path),
    });
    const db = {
        doc: ref,
        collection: (path) => {
            const get = async (field, value) => {
                reads.push(path);
                return {
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
                };
            };
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
        onReadUsage: (row) => usage.push(row),
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
    return { call, records, reads, usage };
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

test('recovery uses gross deposits, confirmed proceeds and separate currencies', () => {
    const entries = [
        { id: 'in', currency: 'KRW', amount: 1000 },
        { id: 'out', currency: 'KRW', amount: 300 },
        { id: 'div', currency: 'KRW', amount: 200 },
        { id: 'sale', currency: 'KRW', amount: 1000 },
        { id: 'usd', currency: 'USD', amount: 50 },
        { id: 'pending', currency: 'KRW', amount: 9000 },
        { id: 'fx', currency: 'KRW', amount: 5000 },
    ].map((row) => ({ ...row, date: '20261015' }));
    const classifications = [
        { id: 'in', classification: 'external_deposit' },
        { id: 'out', classification: 'external_withdrawal' },
        { id: 'div', classification: 'dividend' },
        { id: 'sale', classification: 'sale' },
        { id: 'usd', classification: 'dividend' },
        { id: 'fx', classification: 'exchange' },
    ];
    const [krw, usd] = capitalRecovery(entries, classifications, 'proceeds');
    assert.equal(krw.principal, 1000);
    assert.equal(krw.recovered, 1200);
    assert.equal(krw.rate, 120);
    assert.equal(krw.remaining, 0);
    assert.equal(usd.recovered, 50);
    assert.equal(usd.rate, null);
    assert.equal(
        capitalRecovery(entries, classifications, 'withdrawals')[0].rate,
        30
    );
    assert.equal(
        capitalRecovery(entries, classifications, 'dividends')[0].rate,
        20
    );
    assert.equal(capitalRecovery([], [])[0].rate, null);
});

test('whole-account recovery defaults to actual withdrawals and namespaces identical local IDs', () => {
    const state = (classification) => ({
        entries: [
            { id: 'same', currency: 'KRW', date: '20261015', amount: 100 },
        ],
        classifications: [{ id: 'same', classification }],
    });
    const combined = combineCapitalStates([
        { accountId: 'a', state: state('external_deposit') },
        { accountId: 'b', state: state('transfer') },
        { accountId: 'c', state: state('external_withdrawal') },
    ]);
    const [krw] = capitalRecovery(combined.entries, combined.classifications);
    assert.equal(krw.principal, 100);
    assert.equal(krw.recovered, 100);
    assert.equal(krw.rate, 100);
});

test('A dividend reinvested in B remains A performance and B purchase cost, with stored origin', () => {
    const buy = {
        id: 'buy-b',
        accountId: 'a',
        assetId: 'ACCOUNT',
        symbol: 'B',
        type: 'buy',
        date: '20261015',
        currency: 'KRW',
        amount: 100000,
        settlementAmount: 100000,
    };
    const input = {
        basisKey: purchaseBasis(buy).basisKey,
        parts: [
            {
                method: 'krw_cash',
                amount: 100000,
                source: 'other_dividend',
                sourceSymbol: 'a',
            },
        ],
    };
    const allocation = {
        ...validateFunding(input, buy),
        accountId: 'a',
        assetId: 'ACCOUNT',
        transactionId: buy.id,
    };
    assert.equal(allocation.parts[0].sourceSymbol, 'A');
    assert.throws(
        () =>
            validateFunding(
                { ...input, parts: [{ ...input.parts[0], sourceSymbol: '' }] },
                buy
            ),
        /종목 코드/
    );
    const result = stockRecovery(
        [
            {
                id: 'div-a',
                accountId: 'a',
                symbol: 'A',
                currency: 'KRW',
                type: 'dividend',
                amount: 100000,
            },
            {
                id: 'reversal',
                accountId: 'a',
                symbol: 'A',
                currency: 'KRW',
                type: 'dividend_reversal',
                amount: 10000,
            },
            buy,
        ],
        [allocation]
    );
    assert.equal(result.find((row) => row.symbol === 'A').dividends, 90000);
    const b = result.find((row) => row.symbol === 'B');
    assert.equal(b.purchaseCost, 100000);
    assert.equal(b.dividends, 0);
    assert.equal(b.funding['A 배당금 재투자'], 100000);
    assert.equal(b.rate, 0);
    assert.equal(stockRecovery([buy])[0].unknownFunding, 100000);
    assert.equal(
        stockRecovery([buy], [{ ...allocation, basisKey: 'old' }])[0]
            .unknownFunding,
        100000
    );
    assert.equal(
        stockRecovery([{ ...buy, settlementAmount: null }])[0].rate,
        null
    );
});

test('overseas trades with KRW equivalents report USD settlement and USD funding together', () => {
    const imported = {
        ...trade,
        id: 'T',
        assetId: 'ACCOUNT',
        accountId: 'a',
        symbol: 'B',
        currency: 'KRW',
    };
    const allocation = {
        ...validateFunding(request(), imported),
        transactionId: 'T',
        assetId: 'ACCOUNT',
        accountId: 'a',
    };
    const [row] = stockRecovery([imported], [allocation]);
    assert.equal(row.currency, 'USD');
    assert.equal(row.purchaseCost, 100.1);
    assert.equal(row.funding['배당금 (출처 종목 미확인)'], 70);
});
test('spending dividends changes cash flow without reducing invested principal or counting as reinvestment', () => {
    const entries = [
        { id: 'D', date: '20261001', currency: 'KRW', amount: 1000000 },
        { id: 'W', date: '20261015', currency: 'KRW', amount: 30000 },
    ];
    const annotations = [
        { id: 'D', classification: 'external_deposit' },
        { id: 'W', classification: 'dividend_withdrawal' },
    ];
    const s = capitalSummary(entries, annotations);
    assert.equal(s.KRW.capitalAfterRecovery, 1000000);
    assert.equal(s.KRW.net, 970000);
    assert.equal(s.KRW.dividendUsed, 30000);
    assert.equal(s.KRW.principalWithdrawals, 0);
    assert.equal(s.pending, 0);
});
test('mixed withdrawals preserve separate sources, unknown amounts and currencies', () => {
    const entries = [
        { id: 'D', date: '20261001', currency: 'USD', amount: 100 },
        { id: 'W', date: '20261015', currency: 'USD', amount: 30 },
    ];
    const annotation = {
        id: 'W',
        classification: 'mixed_withdrawal',
        withdrawalParts: { principal: 10, dividend: 15, profit: 3, unknown: 2 },
    };
    const s = capitalSummary(entries, [
        { id: 'D', classification: 'external_deposit' },
        annotation,
    ]);
    assert.equal(s.USD.capitalAfterRecovery, 90);
    assert.equal(s.USD.net, 70);
    assert.equal(s.USD.dividendUsed, 15);
    assert.equal(s.USD.profitUsed, 3);
    assert.equal(s.USD.unknownWithdrawals, 2);
    assert.equal(s.pending, 1);
    assert.equal(s.KRW.net, 0);
    const old = capitalSummary(entries, [
        { id: 'D', classification: 'external_deposit' },
        { id: 'W', classification: 'external_withdrawal' },
    ]);
    assert.equal(old.USD.principalWithdrawals, 0);
    assert.equal(old.USD.unknownWithdrawals, 30);
    assert.equal(old.pending, 1);
    assert.throws(
        () =>
            withdrawalBreakdown(entries[1], {
                ...annotation,
                withdrawalParts: { principal: 31 },
            }),
        /합계/
    );
    assert.throws(
        () =>
            withdrawalBreakdown(entries[1], {
                ...annotation,
                withdrawalParts: { principal: -1, dividend: 31 },
            }),
        /0 이상/
    );
    assert.throws(
        () =>
            withdrawalBreakdown(entries[1], {
                ...annotation,
                withdrawalParts: { principal: 'Infinity' },
            }),
        /0 이상/
    );
});
test('withdrawal source annotations save atomically, reject mismatched totals and leave the cash ledger untouched', async () => {
    const f = fixture();
    const before = structuredClone(
        f.records.get('portfolios/owner/cashEntries/E')
    );
    const input = {
        action: 'classifyCash',
        id: 'E',
        classification: 'mixed_withdrawal',
        revision: 0,
        withdrawalParts: {
            principal: 10000,
            dividend: 30000,
            profit: 2140,
            unknown: 0,
        },
    };
    assert.equal((await f.call(input)).status, 200);
    assert.equal(
        f.records.get('portfolios/owner/cashClassifications/E').withdrawalParts
            .dividend,
        30000
    );
    assert.equal(
        (
            await f.call({
                ...input,
                revision: 1,
                withdrawalParts: { dividend: 1 },
            })
        ).status,
        400
    );
    assert.equal(
        f.records.get('portfolios/owner/cashClassifications/E').revision,
        1
    );
    assert.deepEqual(f.records.get('portfolios/owner/cashEntries/E'), before);
    assert.equal(
        (
            await f.call({
                action: 'classifyCash',
                id: 'E',
                classification: 'dividend_withdrawal',
                revision: 1,
            })
        ).status,
        200
    );
    assert.equal(
        f.records.get('portfolios/owner/cashClassifications/E').withdrawalParts
            .dividend,
        42140
    );
});

test('unchanged account capital reads only authorization documents; revoked access cannot use a version', async () => {
    const f = accountFixture();
    const first = await f.call(undefined, 'GET', { accountId: 'AC' });
    assert.equal(first.status, 200);
    assert.ok(f.reads.includes('investmentAccounts/AC/entries'));
    f.reads.length = 0;
    const same = await f.call(undefined, 'GET', {
        accountId: 'AC',
        version: first.data.version,
    });
    assert.equal(same.data.unchanged, true);
    assert.deepEqual(f.reads, ['investmentAccounts/AC', 'familySpaces/F']);
    f.records.get('investmentAccounts/AC').permissions = {};
    assert.equal(
        (
            await f.call(undefined, 'GET', {
                accountId: 'AC',
                version: first.data.version,
            })
        ).status,
        403
    );
});

test('annotation writes change capital version without re-reading the immutable ledger; imports change ledger version', async () => {
    const f = accountFixture();
    const first = await f.call(undefined, 'GET', { accountId: 'AC' });
    const saved = await f.call({
        action: 'classifyCash',
        accountId: 'AC',
        id: 'E',
        classification: 'exchange',
        revision: 0,
    });
    assert.equal(saved.status, 200);
    f.reads.length = 0;
    const updated = await f.call(undefined, 'GET', {
        accountId: 'AC',
        version: first.data.version,
        ledgerVersion: first.data.ledgerVersion,
    });
    assert.equal(updated.status, 200);
    assert.notEqual(updated.data.version, first.data.version);
    assert.equal(updated.data.ledgerUnchanged, true);
    assert.ok(!f.reads.includes('investmentAccounts/AC/entries'));
    assert.equal(updated.data.classifications.length, 1);
    f.records.get('investmentAccounts/AC').entriesRevision = 1;
    f.reads.length = 0;
    const imported = await f.call(undefined, 'GET', {
        accountId: 'AC',
        version: updated.data.version,
        ledgerVersion: first.data.ledgerVersion,
    });
    assert.equal(imported.data.ledgerUnchanged, false);
    assert.ok(f.reads.includes('investmentAccounts/AC/entries'));
    assert.equal(imported.data.trades.length, 1);
});

test('fresh clients reuse a large ledger while annotations stay fresh and imported revisions invalidate it', async () => {
    const f = accountFixture();
    for (let i = 0; i < 6000; i++) {
        f.records.set(`investmentAccounts/AC/entries/row${i}`, { row: trade });
    }
    const first = await f.call(undefined, 'GET', { accountId: 'AC' });
    const second = await f.call(undefined, 'GET', { accountId: 'AC' });
    assert.equal(first.status, 200);
    assert.deepEqual(second.data, first.data);
    assert.equal(
        f.reads.filter((path) => path === 'investmentAccounts/AC/entries')
            .length,
        1
    );
    assert.equal(f.usage[0].documentReadEstimate, 6007);
    assert.equal(f.usage[1].documentReadEstimate, 5);
    assert.equal(f.usage[1].ledgerCache, 'hit');

    const saved = await f.call({
        action: 'classifyCash',
        accountId: 'AC',
        id: 'E',
        classification: 'exchange',
        revision: 0,
    });
    assert.equal(saved.status, 200);
    const annotated = await f.call(undefined, 'GET', { accountId: 'AC' });
    assert.equal(annotated.data.classifications[0].classification, 'exchange');
    assert.equal(
        f.reads.filter((path) => path === 'investmentAccounts/AC/entries')
            .length,
        1
    );

    f.records.set('investmentAccounts/AC/entries/imported', { row: trade });
    f.records.get('investmentAccounts/AC').entriesRevision = 'new-import';
    const imported = await f.call(undefined, 'GET', { accountId: 'AC' });
    assert.equal(imported.data.trades.length, first.data.trades.length + 1);
    assert.equal(
        f.reads.filter((path) => path === 'investmentAccounts/AC/entries')
            .length,
        2
    );

    f.records.set('familySpaces/F', { participantUids: [] });
    assert.equal(
        (await f.call(undefined, 'GET', { accountId: 'AC' })).status,
        403
    );
    assert.equal(
        f.reads.filter((path) => path === 'investmentAccounts/AC/entries')
            .length,
        2
    );
});
