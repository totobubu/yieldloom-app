const number = (value) =>
    Number.isFinite(
        Number(typeof value === 'string' ? value.replaceAll(',', '') : value)
    )
        ? Number(typeof value === 'string' ? value.replaceAll(',', '') : value)
        : 0;
const dateValue = (value) => String(value ?? '').replace(/\D/g, '');

export const tickerForAsset = (asset) =>
    String(asset?.symbol ?? '')
        .trim()
        .toUpperCase();
export const nameForAsset = (asset) =>
    asset?.name || tickerForAsset(asset) || asset?.id || '미식별 종목';
export const sortTransactions = (transactions) =>
    [...(transactions ?? [])].sort((left, right) =>
        dateValue(right.date).localeCompare(dateValue(left.date))
    );

export function summarizeAsset(asset) {
    const transactions = sortTransactions(
        (asset.transactions ?? []).map((transaction) => ({
            ...transaction,
            type: /배당|dividend/i.test(
                transaction.type || transaction.rawType || ''
            )
                ? 'dividend'
                : /매수|buy/i.test(
                        transaction.type || transaction.rawType || ''
                    )
                  ? 'buy'
                  : /매도|sell/i.test(
                          transaction.type || transaction.rawType || ''
                      )
                    ? 'sell'
                    : 'unknown',
            date: transaction.date,
            amount: number(
                transaction.amount ?? transaction.transaction_amount_krw
            ),
            commission: number(
                transaction.commission ?? transaction.commission_krw
            ),
            tax: number(transaction.tax ?? transaction.tax_krw),
        }))
    );
    const counts = { buy: 0, sell: 0, dividend: 0 };
    let dividends = 0;
    for (const transaction of transactions) {
        if (transaction.type in counts) counts[transaction.type] += 1;
        if (transaction.type === 'dividend')
            dividends += Math.abs(number(transaction.amount));
    }
    return {
        ...asset,
        ticker: tickerForAsset(asset),
        displayName: nameForAsset(asset),
        transactions,
        transactionCounts: counts,
        dividendTotal: dividends,
        latestTransactionDate: transactions[0]?.date ?? null,
    };
}

export function summarizePortfolio(assets) {
    const summarizedAssets = (assets ?? [])
        .map(summarizeAsset)
        .sort(
            (left, right) =>
                (left.portfolioPriority === 'current' ? 0 : 1) -
                    (right.portfolioPriority === 'current' ? 0 : 1) ||
                left.displayName.localeCompare(right.displayName, 'ko')
        );
    const transactions = sortTransactions(
        summarizedAssets.flatMap((asset) =>
            asset.transactions.map((transaction) => ({ ...transaction, asset }))
        )
    );
    return {
        assets: summarizedAssets,
        transactions,
        summary: {
            currentCount: summarizedAssets.filter(
                (asset) => asset.portfolioPriority === 'current'
            ).length,
            historicalCount: summarizedAssets.filter(
                (asset) => asset.portfolioPriority !== 'current'
            ).length,
            dividendTotal: summarizedAssets.reduce(
                (total, asset) => total + asset.dividendTotal,
                0
            ),
            latestTransactionDate: transactions[0]?.date ?? null,
        },
    };
}
