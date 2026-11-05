// Group the already-loaded, already-filtered snapshot positions. No FX or quotes.
// A known partial sum is preserved; no known amounts means unknown, never zero.
export function groupStoredPositions(positions) {
    const groups = new Map();
    for (const row of positions) {
        const key = `${row.symbol}:${row.currency}`;
        const item = groups.get(key) || {
            symbol: row.symbol,
            currency: row.currency,
            quantity: 0,
            amount: 0,
            complete: true,
            knownAmounts: 0,
        };
        item.quantity += row.quantity;
        const known =
            row.amount != null &&
            row.amount !== '' &&
            Number.isFinite(Number(row.amount));
        if (known) {
            item.amount += Number(row.amount);
            item.knownAmounts++;
        } else item.complete = false;
        groups.set(key, item);
    }
    return [...groups.values()].map(({ knownAmounts, ...item }) => ({
        ...item,
        amount: knownAmounts ? item.amount : null,
    }));
}
