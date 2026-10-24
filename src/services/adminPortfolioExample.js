const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const rounded = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round((value + Number.EPSILON) * scale) / scale;
};

export const sheetPortfolioExample = Object.freeze({
    sourceTitle: '토또부부 배당 월 천만원',
    asOf: '2026-10-22',
    displayedPrincipalUsd: 32276.29,
    cumulativeDividendUsd: 31060.66,
    husband: {
        displayedPrincipalUsd: 11114.41,
        cumulativeDividendUsd: 14079.03,
        displayedRecoveryRate: 124.22,
    },
    wife: {
        displayedPrincipalUsd: 21161.88,
        cumulativeDividendUsd: 16981.63,
        displayedRecoveryRate: 94.82,
    },
});

export const temporaryProjectionHoldings = Object.freeze(
    [
        {
            symbol: 'JEPI',
            currency: 'USD',
            quantity: 41.353744,
            price: 57.48,
            annualDividend: 0.37142 * 12,
            frequency: 'monthly',
        },
        {
            symbol: 'LFGY',
            currency: 'USD',
            quantity: 105.682598,
            price: 15.96,
            annualDividend: 0.1295 * 52,
            frequency: 'weekly',
        },
        {
            symbol: 'MSTY',
            currency: 'USD',
            quantity: 40,
            price: 14.49,
            annualDividend: 0.1671 * 52,
            frequency: 'weekly',
        },
        {
            symbol: 'TOPW',
            currency: 'USD',
            quantity: 244.024235,
            price: 32,
            annualDividend: 0.235513 * 52,
            frequency: 'weekly',
        },
        {
            symbol: 'TSLY',
            currency: 'USD',
            quantity: 240,
            price: 21.59,
            annualDividend: 0.1909 * 52,
            frequency: 'weekly',
        },
        {
            symbol: 'YMAX',
            currency: 'USD',
            quantity: 1782.875167,
            price: 7.9,
            annualDividend: 0.0563 * 52,
            frequency: 'weekly',
        },
    ].map((holding) =>
        Object.freeze({
            ...holding,
            initial: holding.quantity * holding.price,
        })
    )
);

export function dividendRecoveryRate(principal, dividends) {
    const basis = finite(principal);
    return basis > 0 ? rounded((finite(dividends) / basis) * 100) : null;
}

export function recoveryModel(input = {}) {
    const krwContribution = finite(input.krwContribution);
    const usdContribution = finite(input.usdContribution);
    const convertedKrw = finite(input.convertedKrw);
    const reinvestedUsd = finite(input.reinvestedUsd);
    const cashWithdrawnUsd = finite(input.cashWithdrawnUsd);
    const liquidationValueUsd = finite(input.liquidationValueUsd);
    const externalUsd = usdContribution;

    return {
        krwContribution,
        usdContribution,
        convertedKrw,
        reinvestedUsd,
        cashRecoveryRate:
            externalUsd > 0
                ? rounded((cashWithdrawnUsd / externalUsd) * 100)
                : null,
        unrecoveredUsd: rounded(Math.max(0, externalUsd - cashWithdrawnUsd)),
        economicRecoveryRate:
            externalUsd > 0
                ? rounded(
                      ((cashWithdrawnUsd + liquidationValueUsd) / externalUsd) *
                          100
                  )
                : null,
        currentRiskUsd: rounded(liquidationValueUsd),
    };
}
