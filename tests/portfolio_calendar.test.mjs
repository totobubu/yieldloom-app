import test from 'node:test';
import assert from 'node:assert/strict';
import {
    portfolioScheduleRows,
    recordedDividendRows,
    calendarTotals,
    monthDays,
    validCalendarDate,
} from '../src/services/portfolioCalendar.js';
import { loadCalendarLedger } from '../src/services/portfolioLedger.js';
const position = {
    accountId: 'a',
    symbol: 'TSLY',
    quantity: 10,
    currency: 'KRW',
    asOf: '2026-10-01',
};
const event = {
    id: 1,
    exDate: '2026-10-20',
    payableDate: '2026-10-23',
    amount: '0.2',
    currency: 'USD',
    verificationStatus: 'official',
};
const schedule = {
    TSLY: {
        history: [
            event,
            {
                ...event,
                id: 2,
                exDate: '2026-09-20',
                payableDate: '2026-09-23',
            },
        ],
        reviewHistory: [],
        forecastExDate: '2026-10-27',
    },
};
test('only future ex-dates with a valid quantity snapshot produce gross reference amounts in the distribution currency', () => {
    const { rows } = portfolioScheduleRows([position], schedule, {
        today: '2026-10-16',
    });
    assert.equal(rows[0].amount, null);
    assert.equal(rows[1].amount, 2);
    assert.equal(rows[1].currency, 'USD');
    for (const asOf of ['2026-10-21', '2026-10-18', null])
        assert.equal(
            portfolioScheduleRows([{ ...position, asOf }], schedule, {
                today: '2026-10-16',
            }).rows[1].amount,
            null
        );
    assert.equal(
        portfolioScheduleRows(
            [position],
            { TSLY: { history: [{ ...event, currency: null }] } },
            { today: '2026-10-16' }
        ).rows[0].amount,
        null
    );
});
test('missing payout dates, reviewed announcements and periodic forecasts never invent payments or amounts', () => {
    const result = portfolioScheduleRows(
        [position],
        {
            TSLY: {
                history: [{ ...event, payableDate: null }],
                reviewHistory: [{ ...event, id: 3 }],
                forecastExDate: '2026-10-27',
            },
        },
        { today: '2026-10-16' }
    );
    assert.equal(result.undated.length, 1);
    assert.equal(result.rows[0].amount, null);
    const ex = portfolioScheduleRows([position], schedule, {
        basis: 'ex',
        today: '2026-10-16',
    });
    assert.equal(ex.rows.at(-1).status, 'forecast');
    assert.equal(ex.rows.at(-1).amount, null);
    assert.equal(
        portfolioScheduleRows([{ ...position, quantity: 0 }], schedule).rows
            .length,
        0
    );
});
test('recorded reversals subtract, native zero is retained, unknown amounts stay unknown and currencies never combine', () => {
    const entries = [
        {
            id: '1',
            accountId: 'a',
            row: {
                type: 'dividend',
                date: '2026-10-01',
                symbol: 'TSLY',
                currency: 'KRW',
                amount: 1200,
                nativeAmount: 1,
            },
        },
        {
            id: '2',
            accountId: 'a',
            row: {
                type: 'dividend_reversal',
                date: '2026-10-02',
                symbol: 'TSLY',
                currency: 'USD',
                amount: 0.4,
            },
        },
        {
            id: '3',
            row: {
                type: 'dividend',
                date: '2026-10-03',
                currency: 'USD',
                amount: null,
            },
        },
        {
            id: '4',
            row: {
                type: 'dividend',
                date: '2026-10-04',
                currency: 'KRW',
                amount: 100,
                nativeAmount: 0,
            },
        },
        {
            id: '5',
            row: {
                type: 'dividend',
                date: '2026-10-05',
                currency: 'KRW',
                amount: 100,
            },
        },
    ];
    const rows = recordedDividendRows(entries);
    const totals = calendarTotals(rows);
    assert.deepEqual(totals, [
        { currency: 'USD', amount: 0.6, known: 3, unknown: 1 },
        { currency: 'KRW', amount: 100, known: 1, unknown: 0 },
    ]);
    assert.deepEqual(calendarTotals([]), []);
});
test('month grid handles leap years and invalid dates', () => {
    assert.equal(validCalendarDate('2026-02-29'), false);
    assert.equal(validCalendarDate('2024-02-29'), true);
    assert.equal(monthDays('2024-02').filter((d) => d.inMonth).length, 29);
    assert.equal(monthDays('2026-02').filter((d) => d.inMonth).length, 28);
    assert.equal(monthDays('2026-13').length, 0);
});
const overview = { accounts: [{ id: 'a', entriesRevision: 1 }] };
test('ledger reads every page and rechecks revisions and permissions', async () => {
    let calls = 0;
    const entries = await loadCalendarLedger({
        familyId: 'f',
        accounts: [{ id: 'a' }],
        request: async (_a, _b, q) => {
            calls++;
            if (q.familyId) return overview;
            return q.cursor
                ? { entries: [{ id: '2', row: { type: 'dividend' } }] }
                : {
                      entries: [{ id: '1', row: { type: 'buy' } }],
                      nextCursor: 'page2',
                  };
        },
    });
    assert.equal(entries.length, 2);
    assert.equal(calls, 4);
    for (const latest of [
        { accounts: [] },
        { accounts: [{ id: 'a', entriesRevision: 2 }] },
    ]) {
        let reads = 0;
        await assert.rejects(
            loadCalendarLedger({
                familyId: 'f',
                accounts: [{ id: 'a' }],
                request: async (_a, _b, q) =>
                    q.familyId
                        ? ++reads === 1
                            ? overview
                            : latest
                        : { entries: [] },
            }),
            /변경/
        );
    }
});
test('ledger discards duplicate pages and responses from a replaced user scope', async () => {
    await assert.rejects(
        loadCalendarLedger({
            familyId: 'f',
            accounts: [{ id: 'a' }],
            request: async (_a, _b, q) =>
                q.familyId ? overview : { entries: [{ id: '1' }, { id: '1' }] },
        }),
        /변경/
    );
    let active = true;
    await assert.rejects(
        loadCalendarLedger({
            familyId: 'f',
            accounts: [{ id: 'a' }],
            isCurrent: () => active,
            request: async () => {
                active = false;
                return overview;
            },
        }),
        { name: 'AbortError' }
    );
});
