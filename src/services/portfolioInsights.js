import {
    recordedDividendRows,
    validCalendarDate,
} from './portfolioCalendar.js';

const finite = (value) =>
    value == null ||
    value === '' ||
    typeof value === 'boolean' ||
    !Number.isFinite(Number(value))
        ? null
        : Number(value);
const symbolOf = (symbol) =>
    String(symbol || '')
        .trim()
        .toUpperCase() || '미식별';

function contributions(rows, keyFor = (row) => symbolOf(row.symbol)) {
    const groups = new Map();
    for (const row of rows) {
        const label = keyFor(row);
        const item = groups.get(label) || {
            label,
            amount: 0,
            known: 0,
            unknown: 0,
        };
        const amount = finite(row.amount);
        if (amount == null) item.unknown++;
        else {
            item.amount += amount;
            item.known++;
        }
        groups.set(label, item);
    }
    const items = [...groups.values()];
    const positiveTotal = items.reduce(
        (sum, row) => sum + Math.max(0, row.amount),
        0
    );
    return {
        positiveTotal,
        negativeGroups: items.filter((row) => row.amount < 0).length,
        rows: items
            .map((row) => ({
                ...row,
                amount: row.known ? row.amount : null,
                share:
                    row.known && positiveTotal > 0
                        ? (Math.max(0, row.amount) / positiveTotal) * 100
                        : null,
            }))
            .sort(
                (a, b) =>
                    (b.amount ?? -Infinity) - (a.amount ?? -Infinity) ||
                    a.label.localeCompare(b.label)
            ),
        topThree:
            positiveTotal > 0
                ? (items
                      .map((row) => Math.max(0, row.amount))
                      .sort((a, b) => b - a)
                      .slice(0, 3)
                      .reduce((a, b) => a + b, 0) /
                      positiveTotal) *
                  100
                : null,
    };
}

function summarize(rows) {
    const known = rows.filter((row) => finite(row.amount) != null);
    return {
        amount: known.length
            ? known.reduce((sum, row) => sum + Number(row.amount), 0)
            : null,
        count: rows.length,
        unknown: rows.length - known.length,
    };
}

// This describes uploaded records, never the completeness of actual dividend receipts.
export function dividendInsights(
    entries,
    { month, today = new Date().toISOString().slice(0, 10) } = {}
) {
    if (
        !validCalendarDate(`${month}-01`) ||
        !validCalendarDate(today) ||
        month > today.slice(0, 7)
    )
        throw new Error('분석 월을 확인해 주세요.');
    const dividends = entries.filter((entry) =>
        ['dividend', 'dividend_reversal'].includes(entry.row?.type)
    );
    const valid = dividends.filter(
        (entry) => validCalendarDate(entry.row.date) && entry.row.date <= today
    );
    const rows = recordedDividendRows(valid);
    const year = Number(month.slice(0, 4));
    const selected = rows.filter(
        (row) =>
            row.date.slice(0, 4) === String(year) &&
            row.date.slice(0, 7) <= month
    );
    const currencies = [
        ...new Set(
            rows
                .filter((row) =>
                    [String(year), String(year - 1)].includes(
                        row.date.slice(0, 4)
                    )
                )
                .map((row) => row.currency || 'UNKNOWN')
        ),
    ].sort();
    return {
        rejected: dividends.length - valid.length,
        currencies: currencies.map((currency) => {
            const inCurrency = (rows) =>
                rows.filter((row) => (row.currency || 'UNKNOWN') === currency);
            const yearRows = inCurrency(selected);
            const monthRows = yearRows.filter((row) =>
                row.date.startsWith(month)
            );
            const previousMonth = `${year - 1}${month.slice(4)}`;
            const previous = summarize(
                inCurrency(
                    rows.filter((row) => row.date.startsWith(previousMonth))
                )
            );
            const current = summarize(monthRows);
            const bySymbol = contributions(yearRows);
            return {
                currency,
                year: summarize(yearRows),
                current,
                previous,
                yearOverYear:
                    month < today.slice(0, 7) &&
                    current.amount != null &&
                    current.unknown === 0 &&
                    previous.amount > 0 &&
                    previous.unknown === 0
                        ? (current.amount / previous.amount - 1) * 100
                        : null,
                contributions: bySymbol,
                monthContributions: contributions(monthRows),
                months: Array.from({ length: 12 }, (_, i) => {
                    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
                    const totals = summarize(
                        yearRows.filter((row) => row.date.startsWith(key))
                    );
                    return { month: key, ...totals, afterRange: key > month };
                }),
            };
        }),
    };
}

export function dividendReduction(group, symbol, reductionPercent) {
    const reduction = finite(reductionPercent);
    const row = group?.monthContributions.rows.find(
        (row) => row.label === symbol
    );
    if (
        reduction == null ||
        reduction < 0 ||
        reduction > 100 ||
        !row ||
        !(row.amount > 0) ||
        group.current.amount == null ||
        group.current.unknown ||
        group.currency === 'UNKNOWN'
    )
        return null;
    const decrease = (row.amount * reduction) / 100;
    return { decrease, after: group.current.amount - decrease };
}

export function dividendGoal(group, input) {
    const goal = finite(input);
    return goal > 0 &&
        group?.current.amount != null &&
        !group.current.unknown &&
        group.currency !== 'UNKNOWN'
        ? (group.current.amount / goal) * 100
        : null;
}

export function assetConcentration(positions, classifications = {}) {
    const currencies = [
        ...new Set(
            positions
                .filter((row) => row.symbol !== 'CASH')
                .map((row) => row.currency || 'UNKNOWN')
        ),
    ].sort();
    return currencies.map((currency) => {
        const rows = positions.filter(
            (row) =>
                row.symbol !== 'CASH' &&
                (row.currency || 'UNKNOWN') === currency
        );
        const eligible = rows.filter(
            (row) => finite(row.amount) != null && Number(row.amount) >= 0
        );
        const metadata = (row) =>
            Object.hasOwn(classifications, symbolOf(row.symbol))
                ? classifications[symbolOf(row.symbol)] || {}
                : {};
        const classified = (field) =>
            contributions(
                eligible,
                (row) =>
                    metadata(row)[field] || `미분류 · ${symbolOf(row.symbol)}`
            );
        const total = eligible.reduce(
            (sum, row) => sum + Number(row.amount),
            0
        );
        return {
            currency,
            total: eligible.length ? total : null,
            known: eligible.length,
            excluded: rows.length - eligible.length,
            dates: [
                ...new Set(eligible.map((row) => row.asOf || '미확인')),
            ].sort(),
            symbols: contributions(eligible),
            providers: classified('provider'),
            underlyings: classified('underlying'),
            unknownProvider: eligible.filter((row) => !metadata(row).provider)
                .length,
            unknownUnderlying: eligible.filter(
                (row) => !metadata(row).underlying
            ).length,
        };
    });
}
