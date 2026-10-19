export function holdingsChanges(before = [], after = []) {
    const key = (row) => JSON.stringify([row.symbol, row.currency]);
    const old = new Map(before.map((row) => [key(row), row]));
    const next = new Map(after.map((row) => [key(row), row]));
    return [...new Set([...old.keys(), ...next.keys()])].flatMap((id) => {
        const a = old.get(id),
            b = next.get(id);
        if (a && b && a.quantity === b.quantity && a.amount === b.amount)
            return [];
        return [
            {
                symbol: (b || a).symbol,
                currency: (b || a).currency,
                status: !a ? '추가' : !b ? '제외' : '변경',
                beforeQuantity: a?.quantity ?? null,
                afterQuantity: b?.quantity ?? null,
                beforeAmount: a?.amount ?? null,
                afterAmount: b?.amount ?? null,
            },
        ];
    });
}
