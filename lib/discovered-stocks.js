/** Merge the product's verified stock directory without replacing core metadata. */
export function mergeDiscoveredStocks(rows, catalog = {}) {
    const key = symbol => String(symbol ?? '').trim().toUpperCase().replaceAll('.', '-');
    const merged = new Map((rows ?? []).map(row => [key(row.symbol), { ...row }]));
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.instruments)) return [...merged.values()];
    for (const stock of catalog.instruments) {
        if (!/^[A-Z]{1,5}(?:-[A-Z])?$/.test(stock.symbol ?? '') || stock.securityType !== 'stock'
            || stock.currency !== 'USD' || !stock.dividendEvidence?.latestExDate
            || !Number.isFinite(Number(stock.dividendEvidence.latestAmount))
            || Number(stock.dividendEvidence.latestAmount) <= 0) continue;
        const existing = merged.get(key(stock.symbol));
        if (existing?.active === false) continue;
        merged.set(key(stock.symbol), existing ? {
            ...existing,
            longName: existing.longName || stock.longName,
            securityType: 'stock',
            dividendEtfs: stock.dividendEtfs,
            dividendEvidence: stock.dividendEvidence,
        } : { ...stock });
    }
    return [...merged.values()];
}
