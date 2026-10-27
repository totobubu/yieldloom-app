const day = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value));
const positive = (value) =>
    value != null &&
    value !== '' &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0;
export function validateStockEvidence(value, symbol) {
    if (
        value?.schemaVersion !== 1 ||
        value.symbol !== symbol ||
        value.currency !== 'USD' ||
        !Array.isArray(value.announcements) ||
        !Array.isArray(value.history) ||
        !Array.isArray(value.candles)
    )
        return false;
    if (value.history.length > 20000 || value.candles.length > 20000)
        return false;
    if (!value.candles.every((row) => day(row.date) && positive(row.close)))
        return false;
    if (
        !value.history.every(
            (row) =>
                row.ticker === symbol &&
                day(row.ex_date) &&
                positive(row.distribution_per_share) &&
                row.currency === 'USD' &&
                row.source_class === 'public_aggregator' &&
                row.verification_status === 'needs_review'
        )
    )
        return false;
    return value.announcements.every(
        (row) =>
            row.ticker === symbol &&
            positive(row.amountRaw) &&
            day(row.declaredDate) &&
            row.currency === 'USD' &&
            (row.exDate == null || day(row.exDate)) &&
            (row.recordDate == null || day(row.recordDate)) &&
            (row.payableDate == null || day(row.payableDate)) &&
            row.sourceClass === 'issuer_official' &&
            /^https:\/\/(?:newsroom|investor)\.bankofamerica\.com\//.test(
                row.sourceUrl
            )
    );
}
export function mergeStockReference(official, reference = []) {
    // An official-ledger outage is handled by the caller, never hidden with observations.
    const occupied = new Set(official.map((row) => row.ex_date ?? row.exDate));
    return [
        ...official,
        ...reference
            .filter((row) => !occupied.has(row.ex_date))
            .map((row) => ({
                ...row,
                verification_status: 'needs_review',
                source_class: 'public_aggregator',
                official_url: null,
                source_url: row.source_url ?? 'https://finance.yahoo.com/',
            })),
    ];
}
