import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    buildPortfolioCsv,
    csvCell,
    loadPortfolioCsv,
    MAX_EXPORT_ROWS,
} from '../src/services/portfolioCsv.js';

const row = {
    date: '2026-10-15',
    symbol: 'AAPL',
    quantity: 0.125,
    amount: null,
    currency: 'USD',
    type: 'buy',
    externalId: 'trade-1',
    nativeSettlementAmount: 12.5,
    nativeTax: 0,
    securityName: '테스트, "주식"\n보통주',
};
const account = {
    id: 'allowed',
    alias: '장기투자',
    snapshot: { rows: [row], asOf: '2026-10-15', source: 'standard-csv-v1' },
    permissions: { fixture: 'viewer' },
};
const overview = { accounts: [account] };

test('transaction export can reuse a validated shared ledger without a second pagination loop', async () => {
    let calls = 0;
    const result = await loadPortfolioCsv({
        familyId: 'f',
        accountId: 'allowed',
        kind: 'transactions',
        request: async () => {
            throw new Error('duplicate request');
        },
        loadLedger: async (options) => {
            calls++;
            assert.deepEqual(options.accounts, [{ id: 'allowed' }]);
            return [{ id: '1', row, asOf: '2026-10-15', source: 'fixture' }];
        },
    });
    assert.equal(calls, 1);
    assert.equal(result.count, 1);
    assert.match(result.csv, /AAPL/);
});

test('CSV preserves missing amounts, zero, Unicode, quoted cells and standard parser compatibility', () => {
    const csv = buildPortfolioCsv('transactions', [
        {
            ...row,
            asOf: '2026-10-15',
            source: 'standard-csv-v1',
            pdfPassword: 'excluded-secret',
        },
    ]);
    assert.ok(csv.startsWith('\uFEFFdate,'));
    assert.ok(!csv.includes('excluded-secret'));
    assert.equal(csv.slice(1).split('\r\n')[0].split(',').length, 20);
    const parsed = spawnSync(
        'python',
        [
            '-c',
            `
import json, sys
from api.family_portfolio_service import parse_csv, validate_rows
rows = parse_csv(sys.argv[1].encode('utf-8'))
normalized, errors = validate_rows(rows, 'transactions', '2026-10-15')
print(json.dumps({'raw': rows[0], 'row': normalized[0], 'errors': errors}, ensure_ascii=False))
`,
            csv,
        ],
        { encoding: 'utf8', timeout: 5000 }
    );
    assert.equal(parsed.status, 0, parsed.stderr);
    const output = JSON.parse(parsed.stdout);
    assert.deepEqual(output.row, row);
    assert.equal(output.raw.amount, '');
    assert.equal(output.raw.nativeTax, '0');
    assert.equal(output.raw.source, 'standard-csv-v1');
    assert.equal(output.raw.asOf, '2026-10-15');
    assert.deepEqual(output.errors, []);
});

test('formula-safe cells and genuine apostrophes roundtrip without changing transaction ids', () => {
    const rows = [
        { ...row, externalId: '=SUM(A1)', securityName: '@수식이 아닌 종목명' },
        { ...row, externalId: "'=SUM(A1)", securityName: "'원래 작은따옴표" },
    ];
    const csv = buildPortfolioCsv('transactions', rows);
    assert.match(csv, /v1:externalId\|securityName/);
    const parsed = spawnSync(
        'python',
        [
            '-c',
            `
import json, sys
from api.family_portfolio_service import parse_csv, validate_rows, row_key
rows, errors = validate_rows(parse_csv(sys.argv[1].encode('utf-8')), 'transactions', '2026-10-15')
print(json.dumps({'rows': rows, 'errors': errors, 'unique': len(set(row_key(row) for row in rows))}, ensure_ascii=False))
`,
            csv,
        ],
        { encoding: 'utf8', timeout: 5000 }
    );
    assert.equal(parsed.status, 0, parsed.stderr);
    const output = JSON.parse(parsed.stdout);
    assert.deepEqual(output.rows, rows);
    assert.deepEqual(output.errors, []);
    assert.equal(output.unique, 2);
});

test('spreadsheet formulas are neutralized even after leading whitespace or CSV quotes', () => {
    for (const text of [
        '=1+1',
        '+SUM(A1)',
        '-cmd',
        '@SUM(A1)',
        '  =1+1',
        '\tSAFE',
        '\r=1',
        '\n=1',
    ])
        assert.ok(csvCell(text).startsWith('"\''), JSON.stringify(text));
    assert.equal(csvCell(0), '"0"');
    assert.equal(csvCell(-2), '"-2"');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell('A,"B"'), '"A,""B"""');
    assert.throws(() => csvCell(Infinity));
    assert.throws(() => buildPortfolioCsv('holdings', []));
    assert.throws(() =>
        buildPortfolioCsv('holdings', Array(MAX_EXPORT_ROWS + 1).fill(row))
    );
});

test('holdings export rechecks readable accounts and keeps snapshot date, source and currency', async () => {
    const calls = [];
    const result = await loadPortfolioCsv({
        kind: 'holdings',
        familyId: 'family',
        accountId: account.id,
        request: async (...args) => {
            calls.push(args);
            return overview;
        },
    });
    assert.equal(result.count, 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][2], { familyId: 'family' });
    assert.match(result.csv, /2026-10-15/);
    assert.match(result.csv, /standard-csv-v1/);
    assert.ok(!result.csv.includes('permissions'));
    await assert.rejects(
        loadPortfolioCsv({
            kind: 'holdings',
            familyId: 'family',
            accountId: 'hidden',
            request: async () => overview,
        }),
        /조회 권한/
    );
    await assert.rejects(
        loadPortfolioCsv({
            kind: 'holdings',
            familyId: 'family',
            accountId: account.id,
            request: async () => ({ accounts: [{ id: account.id }] }),
        }),
        /잔고 자료가 없습니다/
    );
});

test('transaction export loads beyond the first 200 and rechecks permission before returning a file', async () => {
    const calls = [],
        progress = [];
    const first = Array.from({ length: 200 }, (_, i) => ({
        id: `entry-${i}`,
        row: { ...row, externalId: `trade-${i}` },
        asOf: '2026-10-15',
        source: 'toss-pdf',
    }));
    const request = async (_action, _body, query) => {
        calls.push(query);
        if (query.familyId) return overview;
        assert.equal(query.legacy, 'false');
        return query.cursor
            ? {
                  entries: [
                      {
                          ...first[0],
                          id: 'entry-200',
                          row: { ...row, externalId: 'trade-200' },
                      },
                  ],
                  nextCursor: null,
              }
            : { entries: first, nextCursor: 'entry-199' };
    };
    const result = await loadPortfolioCsv({
        request,
        familyId: 'family',
        accountId: account.id,
        kind: 'transactions',
        onProgress: (count) => progress.push(count),
    });
    assert.equal(result.count, 201);
    assert.deepEqual(progress, [200, 201]);
    assert.equal(calls.length, 4);
    assert.equal(calls[2].cursor, 'entry-199');
    assert.deepEqual(calls.at(-1), { familyId: 'family' });
    assert.match(result.csv, /trade-200/);
});

test('revoked permission, a failed later page or changing identity cannot produce a partial export', async () => {
    for (const failure of ['revoked', 'page-failed', 'identity-changed']) {
        let current = true,
            reads = 0;
        const request = async (_action, _body, query) => {
            reads += 1;
            if (query.familyId)
                return reads === 1 ? overview : { accounts: [] };
            if (query.cursor) throw new Error('later-page-failed');
            return {
                entries: [{ id: 'first', row }],
                nextCursor: failure === 'page-failed' ? 'next' : null,
            };
        };
        await assert.rejects(
            loadPortfolioCsv({
                request,
                familyId: 'family',
                accountId: account.id,
                kind: 'transactions',
                isCurrent: () => current,
                onProgress: () => {
                    if (failure === 'identity-changed') current = false;
                },
            }),
            failure === 'revoked'
                ? /조회 권한이 변경/
                : failure === 'page-failed'
                  ? /later-page-failed/
                  : { name: 'AbortError' }
        );
        if (failure === 'identity-changed') assert.equal(reads, 2);
    }
});

test('cancelled and non-advancing pagination stops without downloading duplicate rows', async () => {
    const controller = new AbortController();
    let reads = 0;
    const request = async (_action, _body, query, options) => {
        assert.equal(options.signal, controller.signal);
        reads += 1;
        return query.familyId ? overview : { entries: [], nextCursor: 'same' };
    };
    await assert.rejects(
        loadPortfolioCsv({
            request,
            familyId: 'family',
            accountId: account.id,
            kind: 'transactions',
            signal: controller.signal,
        }),
        /다음 거래/
    );
    assert.equal(reads, 3);
    controller.abort();
    await assert.rejects(
        loadPortfolioCsv({
            request,
            familyId: 'family',
            accountId: account.id,
            kind: 'holdings',
            signal: controller.signal,
        }),
        { name: 'AbortError' }
    );
    assert.equal(reads, 3);
});

test('an import committed between pages invalidates the export even with the same statement date', async () => {
    let overviews = 0;
    const request = async (_action, _body, query) => {
        if (query.familyId)
            return { accounts: [{ ...account, entriesRevision: overviews++ }] };
        return { entries: [{ id: 'first', row }], nextCursor: null };
    };
    await assert.rejects(
        loadPortfolioCsv({
            request,
            familyId: 'family',
            accountId: account.id,
            kind: 'transactions',
        }),
        /거래 목록이 변경/
    );
});
