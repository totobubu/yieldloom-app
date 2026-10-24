import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeWorkbook,
    spreadsheetId,
    validateEdit,
    summarize,
    inferReinvestment,
} from '../lib/sheet-ledger.js';
import { sheetLedgerHandler } from '../lib/sheet-ledger-handler.js';

const cell = (v) => ({
    userEnteredValue:
        typeof v === 'number'
            ? { numberValue: v }
            : String(v).startsWith('=')
              ? { formulaValue: v }
              : { stringValue: v },
});
const row = (values) => ({
    values: values.map((v) => (v == null ? {} : cell(v))),
});
export function workbook() {
    return {
        spreadsheetId: 'synthetic',
        sheets: [
            {
                properties: { title: '夫', sheetId: 1 },
                data: [
                    {
                        startRow: 9,
                        rowData: [
                            row(['25. 1. 4', 10, 10, 100]),
                            row(['27. 1. 1', 10, 10, 100]),
                            row(['25. 1. 5', '=2+3', null, '=20+30']),
                        ],
                    },
                ],
            },
            {
                properties: { title: '夫배당', sheetId: 2 },
                data: [
                    {
                        startRow: 5,
                        rowData: [
                            row([
                                'YMAX',
                                '25. 1. 1\n25. 1. 3',
                                null,
                                null,
                                100,
                                90,
                                100,
                                140000,
                                126000,
                                1400,
                                1,
                            ]),
                            row(['JEPI', null, null, null, 10, 10, 12]),
                            row(['YMAX', '27. 1. 1', null, null, 100, 90]),
                            row(['YMAX', '25. 1. 3', null, null, 100, '=A1']),
                        ],
                    },
                ],
            },
            {
                properties: { title: '妻', sheetId: 3 },
                data: [
                    {
                        startRow: 9,
                        rowData: [
                            row(['25. 1. 4', 1, 50]),
                            row(['25. 1. 20', 1, 50]),
                            row(['25. 1. 6', -1, -50]),
                            row(['25. 1. 5', 2, '=C11']),
                        ],
                    },
                ],
            },
            {
                properties: { title: '妻배당', sheetId: 4 },
                data: [
                    {
                        startRow: 5,
                        rowData: [
                            row(['TQQQ', '25. 1. 3', null, null, 10, 20, 25]),
                        ],
                    },
                ],
            },
            {
                properties: { title: 'YMAX', sheetId: 99 },
                data: [
                    {
                        startRow: 5,
                        rowData: [row(['25. 1. 4', 1000, 1, 1000])],
                    },
                ],
            },
        ],
    };
}
test('four source tabs map event rows, dates, taxes, null costs and future/formula exclusions', () => {
    const p = normalizeWorkbook(workbook(), '2026-10-24');
    assert.equal(p.rows.length, 8);
    assert.equal(p.rows.filter((r) => r.accountId === 'husband').length, 4);
    const dividend = p.rows.find(
        (r) => r.symbol === 'YMAX' && r.type === 'DIVIDEND'
    );
    assert.equal(dividend.date, '2025-01-03');
    assert.equal(dividend.exDate, '2025-01-01');
    assert.equal(dividend.taxUsd, 10);
    assert.equal(dividend.taxKrw, 14000);
    assert.equal(dividend.commissionUsd, null);
    assert.equal(dividend.fieldStatus.taxUsd, '추정');
    assert(p.excluded.some((r) => r.reason.includes('계산식 배당')));
    assert(p.excluded.some((r) => r.reason.includes('미래')));
    assert(p.rows.some((r) => r.type === 'SELL'));
    assert(!p.rows.some((r) => r.source.sheetId === 99));
});
test('reinvestment consumes same-account funds once, prioritizes own ticker and obeys 7 days/90%', () => {
    const rows = normalizeWorkbook(workbook(), '2026-10-24').rows;
    const h = rows.find((r) => r.type === 'BUY' && r.accountId === 'husband');
    assert.equal(h.reinvested, true);
    assert.equal(h.fundingSource, '배당금');
    assert.equal(summarize(rows).reinvestedUsd, 120);
    const edited = validateEdit(h, { ...h, commissionUsd: 1 });
    assert.equal(edited.fieldStatus.reinvested, '추정');
    const wife = rows.find((r) => r.type === 'BUY' && r.accountId === 'wife');
    assert.equal(wife.fundingSource, '혼합');
    assert.equal(wife.reinvested, false);
    assert.equal(rows.find((r) => r.date === '2025-01-20').reinvested, null);
    assert.equal(
        rows.find((r) => r.accountId === 'husband' && r.date === '2025-01-05')
            .dividendFundingUsd,
        0
    );
});
test('90 percent threshold and seven-day boundary do not reuse consumed dividends', () => {
    const check = (amount, date) => {
        const base = {
            accountId: 'husband',
            symbol: 'YMAX',
            evidence: [],
            fieldStatus: {},
            source: { sheet: '夫배당', row: 1 },
        };
        const dividend = {
            ...base,
            id: 'd',
            type: 'DIVIDEND',
            date: '2025-01-01',
            netDividendUsd: amount,
        };
        const buy = {
            ...base,
            id: 'b',
            type: 'BUY',
            date,
            purchaseUsd: 100,
            reinvested: null,
        };
        inferReinvestment([buy, dividend]);
        return buy;
    };
    assert.equal(check(90, '2025-01-08').reinvested, true);
    assert.equal(check(89.99, '2025-01-08').reinvested, false);
    assert.equal(check(100, '2025-01-09').reinvested, null);
});
test('URL and edit validation rejects untrusted input and preserves source identity', () => {
    assert.throws(() => spreadsheetId('https://evil.test/spreadsheets/d/foo'));
    const row = normalizeWorkbook(workbook(), '2026-10-24').rows[0];
    const patch = {
        ...row,
        commissionUsd: 1,
        fundingSource: '본인원금',
        status: '확정',
        reinvested: false,
        source: {},
    };
    const edited = validateEdit(row, patch);
    assert.deepEqual(edited.source, row.source);
    assert.equal(edited.commissionUsd, 1);
    assert.throws(() => validateEdit(row, { ...patch, exchangeRate: -1 }));
    assert.throws(() => validateEdit(row, { ...patch, date: '2025-02-30' }));
    assert(summarize([edited]).unknown > 0);
});

function fakeDb() {
    const store = new Map();
    const calls = { reads: 0, writes: 0 };
    const ref = (path) => ({
        path,
        collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
        get: async () => {
            calls.reads++;
            return { exists: store.has(path), data: () => store.get(path) };
        },
    });
    return {
        calls,
        collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
        getAll: (...refs) => Promise.all(refs.map((r) => r.get())),
        runTransaction: async (fn) => {
            const writes = [];
            const result = await fn({
                get: (r) => r.get(),
                set: (r, v) => writes.push([r.path, v]),
            });
            for (const [path, v] of writes) {
                store.set(path, v);
                calls.writes++;
            }
            return result;
        },
    };
}
const response = () => ({
    statusCode: 0,
    payload: null,
    setHeader() {},
    status(n) {
        this.statusCode = n;
        return this;
    },
    json(v) {
        this.payload = v;
        return this;
    },
});
test('preview/commit are server-normalized, duplicate safe, versioned and isolated; denied auth never reads DB', async () => {
    const db = fakeDb();
    const handler = sheetLedgerHandler({
        verify: async () => ({
            uid: 'admin',
            email: 'jomalkeun@gmail.com',
            email_verified: true,
        }),
        database: () => db,
        fetchImpl: async () => ({ ok: true, json: async () => workbook() }),
        now: () => new Date('2026-10-24'),
    });
    const invoke = async (method, body) => {
        const res = response();
        await handler({ method, body }, res);
        assert.equal(res.statusCode, 200, JSON.stringify(res.payload));
        return res.payload;
    };
    const input = {
        url: 'https://docs.google.com/spreadsheets/d/synthetic/edit',
        googleToken: 'not-a-real-token',
    };
    const preview = await invoke('POST', { ...input, action: 'preview' });
    assert.equal(db.calls.writes, 0);
    const saved = await invoke('POST', {
        ...input,
        action: 'commit',
        fingerprint: preview.fingerprint,
        version: preview.version,
        rows: [{ symbol: 'EVIL' }],
    });
    assert.equal(saved.imported, preview.rows.length);
    assert(!saved.rows.some((r) => r.symbol === 'EVIL'));
    const again = await invoke('POST', { ...input, action: 'preview' });
    assert(again.rows.every((r) => r.duplicate));
    const originalWrites = db.calls.writes;
    await invoke('PATCH', {
        id: saved.rows[0].id,
        version: saved.version,
        patch: saved.rows[0],
    });
    assert.equal(db.calls.writes, originalWrites);
    const writes = db.calls.writes;
    await invoke('POST', {
        ...input,
        action: 'commit',
        fingerprint: again.fingerprint,
        version: again.version,
    });
    assert.equal(db.calls.writes, writes);
    const conflict = response();
    await handler(
        { method: 'PATCH', body: { id: saved.rows[0].id, version: 0 } },
        conflict
    );
    assert.equal(conflict.statusCode, 409);
    const denied = sheetLedgerHandler({
        verify: async () => ({
            uid: 'other',
            email: 'other@example.test',
            email_verified: true,
        }),
        database: () => {
            throw new Error('must not access');
        },
    });
    const res = response();
    await denied({ method: 'GET' }, res);
    assert.equal(res.statusCode, 403);
});
test('Google permission errors are actionable and do not expose upstream bodies', async () => {
    const handler = sheetLedgerHandler({
        verify: async () => ({
            uid: 'admin',
            email: 'jomalkeun@gmail.com',
            email_verified: true,
        }),
        database: fakeDb,
        fetchImpl: async () => ({ ok: false, status: 403 }),
    });
    const res = response();
    await handler(
        {
            method: 'POST',
            body: {
                action: 'preview',
                url: 'https://docs.google.com/spreadsheets/d/test/edit',
                googleToken: 'token',
            },
        },
        res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /접근 권한/);
});
