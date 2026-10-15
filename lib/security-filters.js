export const productTypeOptions = [
    { value: '', label: '전체 종목' },
    { value: 'etf', label: 'ETF' },
    { value: 'dividend-etf', label: '배당 ETF' },
    { value: 'leveraged-etf', label: '레버리지 ETF' },
    { value: 'stock', label: '일반 주식' },
    { value: 'dividend-stock', label: '배당주' },
    { value: 'growth-stock', label: '성장주' },
    { value: 'dividend-growth-stock', label: '배당성장주' },
    { value: 'high-dividend-stock', label: '고배당주' },
];

// A representative discovery list, not a quantitative growth rating.
const representativeGrowthStocks = new Set([
    'AAPL', 'AMZN', 'AVGO', 'CRM', 'GOOG', 'GOOGL', 'META', 'MSFT',
    'NFLX', 'NOW', 'NVDA', 'PLTR', 'SHOP', 'TSLA', 'AMD', 'ADBE',
]);
const dividendGrowthEtfs = new Set(['DGRO', 'VIG']);
const highDividendEtfs = new Set(['SCHD', 'VYM', 'HDV']);

export function inferSecurityType(row) {
    if (row.securityType === 'stock' || row.securityType === 'etf') return row.securityType;
    return row.officialProvider || row.company || /\bETF\b/i.test(`${row.koName ?? ''} ${row.longName ?? ''}`)
        ? 'etf' : 'stock';
}

export function matchesProductType(row, type, distribution) {
    if (!type) return true;
    const securityType = inferSecurityType(row);
    if (type === 'stock' || type === 'etf') return securityType === type;
    const name = `${row.koName ?? ''} ${row.longName ?? ''}`;
    const tags = Array.isArray(row.productTypes) ? row.productTypes : [];
    const positive = value => value != null && Number.isFinite(Number(value)) && Number(value) > 0;
    const hasDividend = row.noDividends !== true && (
        positive(distribution?.distribution_per_share) || positive(row.dividendEvidence?.latestAmount)
        || Boolean(row.frequency) || tags.includes('dividend-stock') || tags.includes('dividend-etf')
    );
    const heldBy = tickers => (row.dividendEtfs ?? []).some(etf => tickers.has(String(etf.ticker).toUpperCase()));
    switch (type) {
        case 'dividend-etf':
            return securityType === 'etf' && row.noDividends !== true && (hasDividend || /배당|분배|인컴|dividend|income/i.test(name));
        case 'leveraged-etf':
            return securityType === 'etf' && (tags.includes(type) || /레버리지|leverag|ultra|(?:[2-9]|[1-9]\d)(?:\.\d+)?\s*(?:배|x\b)/i.test(name));
        case 'dividend-stock':
            return securityType === 'stock' && hasDividend;
        case 'growth-stock':
            return securityType === 'stock' && (tags.includes(type) || representativeGrowthStocks.has(String(row.symbol).toUpperCase()));
        case 'dividend-growth-stock':
            return securityType === 'stock' && hasDividend && (tags.includes(type) || heldBy(dividendGrowthEtfs));
        case 'high-dividend-stock':
            return securityType === 'stock' && hasDividend && (tags.includes(type) || heldBy(highDividendEtfs));
        default:
            return false;
    }
}

// Rank the full ETF directory so search text and product filters do not shuffle shortcuts.
export function topProviders(rows, limit = 5) {
    const counts = new Map();
    for (const row of rows) {
        const company = (row.company ?? row.officialProvider)?.trim();
        if (!company || row.active === false || inferSecurityType(row) !== 'etf') continue;
        counts.set(company, (counts.get(company) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
}
