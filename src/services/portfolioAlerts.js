import { exportableDividendEvents } from './dividendCalendarExport.js';
import { validCalendarDate } from './portfolioCalendar.js';

const delivered = new WeakMap();
export function upcomingDividendAlerts(rows, { basis, today, leadDays }) {
    if (![1, 3, 7].includes(leadDays) || !validCalendarDate(today)) return [];
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + leadDays);
    const through = end.toISOString().slice(0, 10);
    return exportableDividendEvents(rows, { basis, today }).filter(
        (event) => event.date <= through
    );
}
export function takeUndeliveredAlerts(user, events, basis, today) {
    let seen = delivered.get(user);
    if (!seen) {
        seen = new Set();
        delivered.set(user, seen);
    }
    const fresh = [];
    for (const event of events) {
        const key = `${today}:${basis}:${event.key}`;
        if (seen.has(key)) continue;
        // Notifications contain public schedule information only and stay in session memory.
        if (seen.size >= 2000) seen.delete(seen.values().next().value);
        seen.add(key);
        fresh.push(event);
    }
    return fresh;
}
