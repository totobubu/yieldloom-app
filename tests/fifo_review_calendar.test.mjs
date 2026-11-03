import test from 'node:test';
import assert from 'node:assert/strict';
import {
    recordedReviewDate,
    reviewMonthDays,
    shiftReviewMonth,
    reviewCalendarCounts,
    filterReviewEvents,
} from '../src/services/fifoReviewCalendar.js';
import { calculateFifoAssets } from '../lib/fifo-asset-report.js';

const events = [
    {
        id: 'same',
        accountId: 'wife',
        type: 'BUY',
        symbol: 'TEST',
        currency: 'USD',
        quantity: '2.000000000000000001',
        amount: '10.000000000000000003',
        fee: '0',
        tax: '0',
        timing: 'execution',
        at: '2024-02-29T00:01:00+14:00',
    },
    {
        id: 'same',
        accountId: 'husband',
        type: 'SELL',
        symbol: 'TEST',
        currency: 'USD',
        quantity: '1',
        amount: '9',
        at: '2024-02-29T23:59:00-12:00',
    },
    {
        id: 'div',
        accountId: 'wife',
        type: 'DIVIDEND',
        symbol: 'TEST',
        currency: 'USD',
        net: '1.234567890123456789',
        at: '2024-02-29',
    },
    {
        id: 'unknown',
        accountId: 'wife',
        type: 'BUY',
        symbol: 'OTHER',
        currency: 'KRW',
        at: null,
    },
    {
        id: 'next',
        accountId: 'wife',
        type: 'BUY',
        symbol: 'OTHER',
        currency: 'KRW',
        at: '2024-03-01',
    },
];

test('recorded basis date survives timezone offsets and rejects invalid or unknown calendar dates', () => {
    assert.equal(recordedReviewDate(events[0].at), '2024-02-29');
    assert.equal(recordedReviewDate(events[1].at), '2024-02-29');
    for (const at of [
        null,
        undefined,
        '',
        '2023-02-29',
        '1900-02-29',
        '2024-04-31',
        '0000-01-01',
        '2024-13-01',
        '2024-00-01',
        '2024-01-00',
        '2024-01-01garbage',
    ])
        assert.equal(recordedReviewDate(at), null);
    assert.equal(recordedReviewDate('2000-02-29'), '2000-02-29');
});

test('calendar grid supports leap years, weekday placement and year/month navigation', () => {
    const days = reviewMonthDays('2024-02');
    assert.equal(days.length % 7, 0);
    assert.equal(days.indexOf('2024-02-01'), 4);
    assert.equal(days.filter(Boolean).length, 29);
    assert.equal(reviewMonthDays('2023-02').filter(Boolean).length, 28);
    assert.equal(reviewMonthDays('invalid').length, 0);
    assert.equal(shiftReviewMonth('2024-01', -1), '2023-12');
    assert.equal(shiftReviewMonth('2023-12', 1), '2024-01');
    assert.equal(shiftReviewMonth('0001-01', -1), '0001-01');
    assert.equal(shiftReviewMonth('9999-12', 1), '9999-12');
});

test('daily counts include each canonical row once, preserving same IDs across accounts and unknown dates', () => {
    const counts = reviewCalendarCounts(events);
    assert.equal(counts.byDate.get('2024-02-29'), 3);
    assert.equal(counts.unknown, 1);
    const selected = filterReviewEvents(events, { date: '2024-02-29' });
    assert.equal(selected.length, 3);
    assert.equal(selected.filter((e) => e.type === 'DIVIDEND').length, 1);
    assert.deepEqual(filterReviewEvents(events, { date: 'unknown' }), [
        events[3],
    ]);
    assert.equal(filterReviewEvents(events, { date: '2024-02-28' }).length, 0);
    assert.deepEqual(filterReviewEvents(events), events);
    assert.deepEqual(
        filterReviewEvents(events, { date: '2024-02-29' }),
        selected
    );
});

test('upstream account, search, symbol and date filters intersect without changing calendar count semantics', () => {
    const wife = events.filter((e) => e.accountId === 'wife');
    const matching = filterReviewEvents(wife, {
        search: ' usd ',
        symbol: 'TEST',
    });
    assert.equal(reviewCalendarCounts(matching).byDate.get('2024-02-29'), 2);
    assert.equal(
        filterReviewEvents(matching, { date: '2024-02-29' }).length,
        2
    );
    assert.equal(
        filterReviewEvents(wife, { search: 'USD', symbol: 'OTHER' }).length,
        0
    );
});

test('review filtering preserves original events, exact amounts and full-history FIFO calculation', () => {
    const input = {
        events: structuredClone(events),
        accounts: [
            { id: 'wife', ownerId: 'wife' },
            { id: 'husband', ownerId: 'husband' },
        ],
        today: '2024-03-02',
    };
    const original = structuredClone(input);
    const before = calculateFifoAssets(input);
    for (const date of ['', '2024-02-29', 'unknown', '2024-03-01']) {
        filterReviewEvents(input.events, { date });
        reviewCalendarCounts(input.events);
        assert.deepEqual(calculateFifoAssets(input), before);
    }
    assert.deepEqual(input, original);
    assert.equal(
        filterReviewEvents(input.events, { date: '2024-02-29' })[0].amount,
        '10.000000000000000003'
    );
});
