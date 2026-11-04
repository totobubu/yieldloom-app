import { monthlyDividendSeries } from '../stockAnalysis.js';

const validDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
    );
};

// Ex-dates are market calendar dates, independent of the viewer's timezone.
export function dividendMarketDate(now = new Date(), currency = 'USD') {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: currency === 'KRW' ? 'Asia/Seoul' : 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const part = (type) => parts.find((entry) => entry.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

// Share cards show known declarations in the current month. Historical analysis
// must continue to use monthlyDividendSeries's strict ex-date cutoff.
export function shareMonthlyDividends(rows, asOf, months = 3) {
    if (!validDate(asOf)) return [];
    const groups = new Map();
    for (const row of rows ?? []) {
        const amount = Number(row.amountFixed ?? row.amount);
        if (
            !validDate(row.date) ||
            row.forecasted ||
            !Number.isFinite(amount) ||
            amount <= 0
        )
            continue;
        if (
            row.declaredDate &&
            (!validDate(row.declaredDate) || row.declaredDate > asOf)
        )
            continue;
        if (
            row.date > asOf &&
            (row.date.slice(0, 7) !== asOf.slice(0, 7) ||
                row.isReference ||
                (row.verificationStatus &&
                    !['official', 'cross_checked'].includes(
                        row.verificationStatus
                    )) ||
                row.dividendVerified !== true ||
                !validDate(row.declaredDate))
        )
            continue;
        const group = groups.get(row.date) ?? [];
        group.push(row);
        groups.set(row.date, group);
    }
    const actual = [];
    for (const group of groups.values()) {
        const verified = group.filter((row) => row.dividendVerified === true);
        const candidates = verified.length ? verified : group;
        // Never guess which conflicting declaration is the correction.
        if (
            new Set(
                candidates.map((row) => Number(row.amountFixed ?? row.amount))
            ).size !== 1
        )
            continue;
        actual.push(candidates[0]);
    }
    const monthEnd = new Date(`${asOf.slice(0, 7)}-01T12:00:00Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    return monthlyDividendSeries(
        actual,
        monthEnd.toISOString().slice(0, 10),
        months
    );
}
