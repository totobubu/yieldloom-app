import test from 'node:test';
import assert from 'node:assert/strict';
import {
    dividendCalendarFile,
    exportableDividendEvents,
    foldCalendarLine,
} from '../src/services/dividendCalendarExport.js';

const today = '2026-10-18';
const row = (values = {}) => ({
    symbol: 'AAPL',
    date: '2026-10-21',
    payableDate: '2026-10-21',
    exDate: '2026-10-19',
    status: 'announced',
    accountId: 'private-account',
    quantity: 1234567,
    amount: 9876543,
    ...values,
});
const options = { today, now: new Date('2026-10-18T08:00:00Z') };
const unfold = (content) => content.replace(/\r\n /g, '');

test('deduplicates holdings and excludes unconfirmed, past, invalid and injected events', () => {
    const rows = [
        row(),
        row({ accountId: 'second-account' }),
        row({ status: 'review' }),
        row({ status: 'forecast' }),
        row({ status: 'recorded' }),
        row({ date: '2026-10-17', payableDate: '2026-10-17' }),
        row({ date: '2026-02-30', payableDate: '2026-02-30' }),
        row({ symbol: 'AAPL\r\nBEGIN:VEVENT' }),
        row({ payableDate: null }),
    ];
    assert.deepEqual(exportableDividendEvents(rows, { today }), [
        {
            key: '["payable","AAPL","2026-10-21"]',
            symbol: 'AAPL',
            date: '2026-10-21',
        },
    ]);
});

test('writes all-day events with exclusive end, stable public UID and reminder; excludes financial details', async () => {
    const first = await dividendCalendarFile(
        [row(), row({ accountId: 'other' })],
        options
    );
    const text = unfold(first.content);
    assert.equal(first.count, 1);
    assert.match(
        text,
        /DTSTART;VALUE=DATE:20261021\r\nDTEND;VALUE=DATE:20261022/
    );
    assert.match(text, /DTSTAMP:20261018T080000Z/);
    assert.match(text, /TRIGGER:-P1D/);
    assert.match(text, /SUMMARY:AAPL 배당 지급일 \(공시\)/);
    assert.ok(text.endsWith('END:VCALENDAR\r\n'));
    for (const privateValue of [
        'private-account',
        '1234567',
        '9876543',
        'second-account',
    ])
        assert.ok(!text.includes(privateValue));
    const second = await dividendCalendarFile(
        [row({ accountId: 'different' })],
        { ...options, reminderDays: 7 }
    );
    assert.equal(
        text.match(/UID:(.*)\r\n/)[1],
        unfold(second.content).match(/UID:(.*)\r\n/)[1]
    );
    assert.match(unfold(second.content), /TRIGGER:-P7D/);
});

test('ex-date basis uses the ex-date and reminder can be disabled', async () => {
    const result = await dividendCalendarFile([row({ date: '2026-10-19' })], {
        ...options,
        basis: 'ex',
        reminderDays: 0,
    });
    assert.match(unfold(result.content), /DTSTART;VALUE=DATE:20261019/);
    assert.match(unfold(result.content), /배당락일/);
    assert.ok(!result.content.includes('VALARM'));
    assert.equal(
        exportableDividendEvents([row()], { basis: 'ex', today }).length,
        0
    );
});

test('all-day end handles leap days and year boundaries', async () => {
    for (const [date, end] of [
        ['2028-02-29', '20280301'],
        ['2026-12-31', '20270101'],
    ]) {
        const { content } = await dividendCalendarFile(
            [row({ date, payableDate: date })],
            options
        );
        assert.ok(content.includes(`DTEND;VALUE=DATE:${end}`));
    }
});

test('UTF-8 folding preserves content without exceeding 75 octets', async () => {
    const line = 'DESCRIPTION:' + '한글🙂'.repeat(50);
    const folded = foldCalendarLine(line);
    assert.equal(unfold(folded), line);
    for (const part of folded.split('\r\n'))
        assert.ok(new TextEncoder().encode(part).length <= 75);
    const { content } = await dividendCalendarFile([row()], options);
    for (const part of content.split('\r\n'))
        assert.ok(new TextEncoder().encode(part).length <= 75);
    assert.ok(!content.replace(/\r\n/g, '').includes('\n'));
});

test('rejects invalid options and empty exports', async () => {
    assert.throws(() => exportableDividendEvents([], { today: 'invalid' }));
    await assert.rejects(
        dividendCalendarFile([row()], { ...options, reminderDays: -1 })
    );
    await assert.rejects(
        dividendCalendarFile([row()], { ...options, basis: 'invalid' })
    );
    await assert.rejects(dividendCalendarFile([], options), /내보낼/);
});
