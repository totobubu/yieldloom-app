const numeric = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(
        typeof value === 'string' ? value.replaceAll(',', '') : value
    );
    return Number.isFinite(parsed) ? parsed : null;
};

// A fully closed position needs no assumed lot order or cost-basis method.
// Always pass the complete ledger, never just the selected reporting period.
export function closedPositionPerformance(asset) {
    const unavailable = (reason) => ({ available: false, reason });
    if (asset.ledgerUnavailable)
        return unavailable('거래 원장을 조회하지 못했습니다.');
    if (asset.portfolioPriority === 'current')
        return unavailable('현재 보유 종목입니다.');
    let bought = 0,
        sold = 0,
        purchaseCost = 0,
        saleProceeds = 0,
        dividends = 0;
    for (const transaction of asset.transactions || []) {
        const quantity = numeric(transaction.quantity);
        if (
            transaction.type === 'dividend' ||
            transaction.type === 'dividend_reversal'
        ) {
            const amount = numeric(transaction.amount);
            if (amount == null)
                return unavailable('배당 금액 확인이 필요합니다.');
            dividends +=
                Math.abs(amount) * (transaction.type === 'dividend' ? 1 : -1);
            continue;
        }
        if (transaction.type !== 'buy' && transaction.type !== 'sell') {
            if (
                (quantity !== null && quantity !== 0) ||
                /입고|출고|분할|병합/.test(transaction.rawType || '')
            ) {
                return unavailable(
                    '주식 입출고·분할·병합 내역의 취득원가 확인이 필요합니다.'
                );
            }
            continue;
        }
        const amount = numeric(transaction.amount);
        if (quantity == null || quantity <= 0 || amount == null)
            return unavailable('거래 수량과 금액 확인이 필요합니다.');
        const settlement = numeric(transaction.settlementAmount);
        const fees =
            Math.abs(numeric(transaction.commission) || 0) +
            Math.abs(numeric(transaction.tax) || 0);
        if (transaction.type === 'buy') {
            bought += quantity;
            purchaseCost +=
                settlement == null
                    ? Math.abs(amount) + fees
                    : Math.abs(settlement);
        } else {
            sold += quantity;
            saleProceeds +=
                settlement == null
                    ? Math.abs(amount) - fees
                    : Math.abs(settlement);
        }
    }
    if (!bought || !sold || Math.abs(bought - sold) > 0.0000005) {
        return unavailable(
            '매수·매도 수량이 맞지 않아 전체 취득원가 확인이 필요합니다.'
        );
    }
    const tradingProfit = saleProceeds - purchaseCost;
    const totalProfit = tradingProfit + dividends;
    return {
        available: true,
        purchaseCost,
        saleProceeds,
        dividends,
        tradingProfit,
        totalProfit,
        totalReturnPercent:
            purchaseCost > 0 ? (totalProfit / purchaseCost) * 100 : null,
    };
}
