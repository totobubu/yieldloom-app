const compactDate = (value) => String(value ?? '').replace(/\D/g, '');

export function formatPortfolioQuantity(value) {
    if (value == null || value === '' || !Number.isFinite(Number(value)))
        return '—';
    return Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
}

// Include both boundary dates and leave the current holdings snapshot untouched.
export function portfolioAssetsInPeriod(assets, startDate = '', endDate = '') {
    const start = compactDate(startDate);
    const end = compactDate(endDate);
    return assets.map((asset) => ({
        ...asset,
        transactions: (asset.transactions || []).filter((transaction) => {
            if (!start && !end) return true;
            const date = compactDate(transaction.date);
            return (
                date.length === 8 &&
                (!start || date >= start) &&
                (!end || date <= end)
            );
        }),
    }));
}
