import { validCalendarDate } from './portfolioCalendar.js';

const text = (value) =>
    String(value)
        .replace(/\\/g, '\\\\')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
const encoder = new TextEncoder();

// RFC 5545 folds at 75 octets, including the continuation space.
export function foldCalendarLine(value) {
    const lines = [];
    let line = '',
        bytes = 0;
    for (const char of value) {
        const size = encoder.encode(char).length;
        if (bytes + size > 75) {
            lines.push(line);
            line = ' ';
            bytes = 1;
        }
        line += char;
        bytes += size;
    }
    return [...lines, line].join('\r\n');
}

export function exportableDividendEvents(
    rows,
    { basis = 'payable', today } = {}
) {
    if (!['payable', 'ex'].includes(basis) || !validCalendarDate(today))
        throw new Error('일정 기준과 오늘 날짜를 확인하세요.');
    const events = new Map();
    for (const row of rows) {
        const date = basis === 'ex' ? row.exDate : row.payableDate;
        if (
            row.status !== 'announced' ||
            !validCalendarDate(date) ||
            date < today ||
            row.date !== date ||
            !/^[A-Z0-9.^:_-]{1,40}$/.test(row.symbol || '')
        )
            continue;
        const key = JSON.stringify([basis, row.symbol, date]);
        // A public schedule is one event even when several accounts hold it.
        if (!events.has(key))
            events.set(key, { key, symbol: row.symbol, date });
    }
    return [...events.values()].sort(
        (a, b) =>
            a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)
    );
}

export async function dividendCalendarFile(
    rows,
    { basis = 'payable', today, reminderDays = 1, now = new Date() } = {}
) {
    if (![0, 1, 3, 7].includes(reminderDays))
        throw new Error('지원하는 사전 알림을 선택하세요.');
    const events = exportableDividendEvents(rows, { basis, today });
    if (!events.length)
        throw new Error('선택 기간에 내보낼 오늘 이후 공시 일정이 없습니다.');
    if (events.length > 2000)
        throw new Error(
            '일정이 너무 많습니다. 월간 보기 또는 계좌 필터로 범위를 줄이세요.'
        );
    const stamp = now
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
    const dateLabel = basis === 'ex' ? '배당락일' : '지급일';
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Yieldloom//Dividend Calendar//KO',
        'CALSCALE:GREGORIAN',
        'X-WR-CALNAME:배당 공시 일정',
    ];
    for (const event of events) {
        const hash = await crypto.subtle.digest(
            'SHA-256',
            encoder.encode(event.key)
        );
        const uid = [...new Uint8Array(hash)]
            .map((n) => n.toString(16).padStart(2, '0'))
            .join('');
        const end = new Date(`${event.date}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 1);
        const endDate = end.toISOString().slice(0, 10);
        if (!validCalendarDate(endDate))
            throw new Error('내보낼 일정 날짜를 확인하세요.');
        lines.push(
            'BEGIN:VEVENT',
            `UID:${uid}@yieldloom-app.vercel.app`,
            `DTSTAMP:${stamp}`,
            `DTSTART;VALUE=DATE:${event.date.replace(/-/g, '')}`,
            `DTEND;VALUE=DATE:${endDate.replace(/-/g, '')}`,
            `SUMMARY:${text(`${event.symbol} 배당 ${dateLabel} (공시)`)}`,
            `URL:https://yieldloom-app.vercel.app/stock/${encodeURIComponent(event.symbol)}`,
            `DESCRIPTION:${text('공시로 분류된 일정입니다. 보유·지급 자격과 실제 증권사 입금일은 확인되지 않았습니다. 원문과 최신 일정을 확인하세요. 가져온 일정은 자동 갱신되지 않습니다.')}`,
            'TRANSP:TRANSPARENT'
        );
        if (reminderDays)
            lines.push(
                'BEGIN:VALARM',
                'ACTION:DISPLAY',
                `TRIGGER:-P${reminderDays}D`,
                `DESCRIPTION:${text(`${event.symbol} 배당 ${dateLabel} 확인`)}`,
                'END:VALARM'
            );
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return {
        count: events.length,
        content: lines.map(foldCalendarLine).join('\r\n') + '\r\n',
    };
}
