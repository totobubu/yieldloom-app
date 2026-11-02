// Presentation only: keep recorded calendar dates, never normalize an event to UTC.
export function recordedReviewDate(at) {
    if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T| )/.test(at))
        return null;
    const date = at.slice(0, 10);
    const [year, month, day] = date.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return null;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= days[month - 1] ? date : null;
}

export function shiftReviewMonth(month, amount) {
    const [year, number] = month.split('-').map(Number);
    const index = Math.max(
        12,
        Math.min(9999 * 12 + 11, year * 12 + number - 1 + amount)
    );
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function reviewMonthDays(month) {
    if (!recordedReviewDate(`${month}-01`)) return [];
    // UTC is used only to construct the calendar grid, never to parse ledger timestamps.
    const first = new Date(0);
    first.setUTCFullYear(
        Number(month.slice(0, 4)),
        Number(month.slice(5)) - 1,
        1
    );
    first.setUTCHours(0, 0, 0, 0);
    const days = Array(first.getUTCDay()).fill(null);
    for (let day = 1; day <= 31; day++) {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        if (recordedReviewDate(date)) days.push(date);
    }
    while (days.length % 7) days.push(null);
    return days;
}

export function reviewCalendarCounts(events) {
    const byDate = new Map();
    let unknown = 0;
    // A dividend appears in two presentation tables, but enters this list only once.
    for (const event of events) {
        const date = recordedReviewDate(event.at);
        if (date) byDate.set(date, (byDate.get(date) || 0) + 1);
        else unknown++;
    }
    return { byDate, unknown };
}

export function filterReviewEvents(
    events,
    { search = '', symbol = '', date = '' } = {}
) {
    const query = search.trim().toLocaleLowerCase();
    return events.filter((event) => {
        if (symbol && event.symbol !== symbol) return false;
        if (
            query &&
            ![event.symbol, event.sourceLabel, event.currency].some((value) =>
                String(value || '')
                    .toLocaleLowerCase()
                    .includes(query)
            )
        )
            return false;
        const recorded = recordedReviewDate(event.at);
        return !date || (date === 'unknown' ? !recorded : recorded === date);
    });
}
