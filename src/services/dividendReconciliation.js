import { validCalendarDate } from './portfolioCalendar.js';
const day = (value) => Date.parse(`${value}T00:00:00Z`) / 86400000;
// Candidate matching only: broker booking dates and gross/net bases can differ.
export function reconcileDividends(
    schedules,
    recorded,
    { today, confirmedBasis = false } = {}
) {
    const expected = schedules.filter(
        (r) => r.status === 'announced' && validCalendarDate(r.payableDate)
    );
    const groupKey = (r) => JSON.stringify([r.accountId, r.symbol, r.currency]);
    const exactDates = new Set(
        expected.map((r) => `${groupKey(r)}:${r.payableDate}`)
    );
    const groups = new Map(),
        links = new Map(),
        used = new Set();
    for (const r of recorded) {
        if (!r.currency || !validCalendarDate(r.date)) continue;
        const key = groupKey(r);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const candidates = expected.map((row) =>
        (groups.get(groupKey(row)) || []).filter(
            (r) =>
                Math.abs(day(row.payableDate) - day(r.date)) <= 7 &&
                (!exactDates.has(`${groupKey(r)}:${r.date}`) ||
                    row.payableDate === r.date)
        )
    );
    for (const matches of candidates)
        for (const r of matches) {
            used.add(r);
            links.set(r, (links.get(r) || 0) + 1);
        }
    const output = expected.map((row, index) => {
        const matches = candidates[index];
        const ambiguous = matches.some((r) => links.get(r) > 1);
        const comparable =
            confirmedBasis &&
            !ambiguous &&
            Number.isFinite(row.perShare) &&
            row.perShare >= 0 &&
            Number.isFinite(row.quantity) &&
            row.quantity > 0 &&
            matches.length > 0 &&
            matches.every((r) => Number.isFinite(r.amount));
        const reference =
            confirmedBasis &&
            Number.isFinite(row.perShare) &&
            row.perShare >= 0 &&
            Number.isFinite(row.quantity) &&
            row.quantity > 0 &&
            Number.isFinite(row.perShare * row.quantity)
                ? row.perShare * row.quantity
                : null;
        const actual =
            !ambiguous &&
            matches.length > 0 &&
            matches.every((r) => Number.isFinite(r.amount))
                ? matches.reduce((sum, r) => sum + r.amount, 0)
                : null;
        const difference =
            comparable && Number.isFinite(reference) && Number.isFinite(actual)
                ? actual - reference
                : null;
        return {
            ...row,
            date: row.payableDate,
            reference,
            actual,
            difference,
            status: ambiguous
                ? 'ambiguous'
                : !matches.length
                  ? validCalendarDate(today) && row.payableDate < today
                      ? 'unrecorded'
                      : 'upcoming'
                  : difference === null
                    ? 'candidate'
                    : Math.abs(difference) <=
                        (row.currency === 'KRW' ? 1 : 0.01)
                      ? 'matched'
                      : 'difference',
            matches: matches.length,
        };
    });
    // Include records with no public schedule, including disposed holdings.
    for (const row of recorded.filter((r) => !used.has(r)))
        output.push({
            ...row,
            reference: null,
            actual: row.amount,
            difference: null,
            status: 'unlinked',
            matches: 0,
        });
    return output.sort(
        (a, b) =>
            a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol)
    );
}
