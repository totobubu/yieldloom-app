// Reviewed first-trade evidence; neither a collected price start nor a ticker
// change establishes a fund's launch. No runtime collection or catalog writes.
const reviewed = {
    TOPW: {
        symbol: 'TOPW',
        firstTradeDate: '2025-09-04',
        dateMeaning: 'first_trade',
        verificationStatus: 'official_reviewed',
        sourceUrl: 'https://www.roundhillinvestments.com/etf/topw/',
        reviewedAt: '2026-11-03',
        tickerChanges: [
            { from: 'WPAY', to: 'TOPW', effectiveAfterClose: '2026-03-20' },
        ],
    },
};

export const reviewedFundLifecycle = (symbol) => reviewed[symbol] ?? null;
