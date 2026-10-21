const positive = (value) =>
    value != null && Number.isFinite(Number(value)) && Number(value) > 0;

export function dividendAvailability({
    security = {},
    distribution = {},
    sourceStatus = {},
    history = [],
} = {}) {
    if (security.noDividends === true) return 'none';

    const hasEvidence =
        positive(distribution.distribution_per_share) ||
        Boolean(distribution.ex_date) ||
        positive(security.dividendEvidence?.latestAmount) ||
        Boolean(security.dividendEvidence?.latestExDate) ||
        history.some(
            (row) => row?.date && positive(row.amountFixed ?? row.amount)
        );
    if (hasEvidence || sourceStatus.dividends === 'official_projection')
        return 'available';
    return 'unavailable';
}

export const hasDividendInformation = (input) =>
    dividendAvailability(input) === 'available';
