const numeric = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(
        typeof value === 'string' ? value.replaceAll(',', '') : value
    );
    return Number.isFinite(parsed) ? parsed : null;
};

// A fully closed position needs no assumed lot order or cost-basis method.
// Always pass the complete ledger, never just the selected reporting period.
export function closedPositionPerformance(asset, currency = 'KRW') {
    const dollar = currency === 'USD';
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
            const amount = numeric(
                dollar ? transaction.nativeAmount : transaction.amount
            );
            if (amount == null)
                return unavailable(
                    dollar
                        ? '달러 배당 금액 확인이 필요합니다.'
                        : '배당 금액 확인이 필요합니다.'
                );
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
        const amount = numeric(
            dollar ? transaction.nativeAmount : transaction.amount
        );
        if (quantity == null || quantity <= 0 || amount == null)
            return unavailable('거래 수량과 금액 확인이 필요합니다.');
        const settlement = numeric(
            dollar
                ? transaction.nativeSettlementAmount
                : transaction.settlementAmount
        );
        if (
            dollar &&
            settlement == null &&
            (numeric(transaction.nativeCommission) == null ||
                numeric(transaction.nativeTax) == null)
        )
            return unavailable(
                '달러 정산액 또는 수수료·세금 확인이 필요합니다.'
            );
        const fees =
            Math.abs(
                numeric(
                    dollar
                        ? transaction.nativeCommission
                        : transaction.commission
                ) || 0
            ) +
            Math.abs(
                numeric(dollar ? transaction.nativeTax : transaction.tax) || 0
            );
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
    if (dollar) {
        purchaseCost = Math.round(purchaseCost * 100) / 100;
        saleProceeds = Math.round(saleProceeds * 100) / 100;
        dividends = Math.round(dividends * 100) / 100;
    }
    const tradingProfit = dollar
        ? Math.round((saleProceeds - purchaseCost) * 100) / 100
        : saleProceeds - purchaseCost;
    const totalProfit = dollar
        ? Math.round((tradingProfit + dividends) * 100) / 100
        : tradingProfit + dividends;
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

export function transactionExchangeRate(transaction) {
    const recorded = numeric(transaction.exchangeRate);
    if (recorded > 0) return { value: recorded, recorded: true };
    const won = numeric(transaction.amount);
    const dollars = numeric(transaction.nativeAmount);
    return won > 0 && dollars > 0
        ? { value: won / dollars, recorded: false }
        : null;
}
