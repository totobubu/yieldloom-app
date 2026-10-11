const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

/** Calculates only cash movements recorded in the member's own ledger. */
export function calculateHoldingDividend(asset, schedule) {
    if (!asset || asset.portfolioPriority !== 'current') return { supported: false, reason: '현재 보유 종목에서만 표시됩니다.' };
    const lots = [];
    let dividends = 0;
    for (const transaction of [...(asset.transactions ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        const quantity = numeric(transaction.quantity);
        if (transaction.type === 'buy' && quantity > 0) lots.push({ quantity, cost: Math.abs(numeric(transaction.amount)) });
        if (transaction.type === 'sell' && quantity > 0) {
            let remaining = quantity;
            while (remaining > 0 && lots.length) {
                const lot = lots[0], used = Math.min(lot.quantity, remaining);
                lot.cost -= lot.cost * (used / lot.quantity); lot.quantity -= used; remaining -= used;
                if (lot.quantity <= 1e-9) lots.shift();
            }
        }
        if (transaction.type === 'dividend') dividends += Math.abs(numeric(transaction.amount));
    }
    const remainingCost = lots.reduce((sum, lot) => sum + lot.cost, 0);
    const shares = numeric(asset.holdingShares ?? asset.holdings?.toss?.amount);
    const nextDps = numeric(schedule?.current?.amount);
    return {
        supported: true, dividends, remainingCost, recoveryRate: remainingCost > 0 ? dividends / remainingCost * 100 : null,
        shares, nextCashFlow: shares > 0 && nextDps > 0 ? shares * nextDps : null,
        nextExDate: schedule?.current?.exDate ?? null,
    };
}
