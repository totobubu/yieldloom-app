import registry from '../data-v2/security-status.json' with { type: 'json' };

const key = (value) =>
    String(value ?? '')
        .trim()
        .toUpperCase()
        .replaceAll('.', '-');
const statuses = new Map(
    registry.securities.map((row) => [key(row.symbol), row])
);
export const securityStatus = (symbol) => statuses.get(key(symbol)) ?? null;
export const isDelisted = (security) =>
    (securityStatus(typeof security === 'string' ? security : security?.symbol)
        ?.status ?? security?.listingStatus?.status) === 'delisted';

/** Apply reviewed local decisions after every remote/discovered-directory merge. */
export function applySecurityStatus(row) {
    const status = securityStatus(row.symbol);
    return status
        ? {
              market: status.market,
              isin: status.isin,
              currency: status.currency,
              koName: status.koName,
              company: status.company,
              ...row,
              active: false,
              listingStatus: status,
          }
        : row;
}
export function applySecurityStatuses(rows) {
    const merged = new Map(rows.map((row) => [key(row.symbol), row]));
    for (const [symbol, status] of statuses) {
        if (!merged.has(symbol))
            merged.set(symbol, {
                symbol,
                market: status.market,
                isin: status.isin,
                currency: status.currency,
                koName: status.koName,
                company: status.company,
            });
    }
    return [...merged.values()].map(applySecurityStatus);
}
export const isSearchableSecurity = (row, includeDelisted = false) =>
    isDelisted(row) ? includeDelisted : row.active !== false;

/** Never describe a dated archival price as a live quote, even from an old snapshot. */
export function archiveTicker(value) {
    if (!isDelisted(value)) return value;
    const status = securityStatus(value.symbol) ?? value.listingStatus;
    const today = new Date().toISOString().slice(0, 10);
    const validDate = (date) =>
        typeof date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        !Number.isNaN(Date.parse(date)) &&
        new Date(date).toISOString().slice(0, 10) === date &&
        date <= today;
    const backtestData = (value.backtestData ?? []).filter(
        (row) => !row.forecasted && validDate(row.date)
    );
    const latest = backtestData
        .filter(
            (row) => Number.isFinite(Number(row.close)) && Number(row.close) > 0
        )
        .sort((a, b) => b.date.localeCompare(a.date))[0];
    const storedDate = value.sourceStatus?.priceDate;
    const storedPrice = value.tickerInfo?.price;
    const useStored =
        validDate(storedDate) &&
        Number.isFinite(Number(storedPrice)) &&
        Number(storedPrice) > 0 &&
        (!latest || storedDate >= latest.date);
    const priceDate = useStored ? storedDate : (latest?.date ?? null);
    const price = useStored ? Number(storedPrice) : (latest?.close ?? null);
    return {
        ...value,
        listingStatus: status,
        backtestData,
        tickerInfo: { ...value.tickerInfo, price, regularMarketPrice: null },
        sourceStatus: {
            ...value.sourceStatus,
            priceDate,
            freshness: 'archived',
        },
    };
}
