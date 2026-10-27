const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const rounded = (value, digits = 2) => {
    const scale = 10 ** digits;
    return Math.round((value + Number.EPSILON) * scale) / scale;
};

const optionalNonNegative = (value, fallback = 0) => {
    if (value === undefined) return fallback;
    if (
        value === null ||
        !['number', 'string'].includes(typeof value) ||
        (typeof value === 'string' && !value.trim())
    )
        return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
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

/**
 * Calculate recovery in USD using explicit external contribution sources.
 *
 * `krwContribution` is total external KRW and `convertedKrw` is an informational
 * subset of it. `usdContribution` is direct external USD only. `krwPerUsd` is
 * the caller-selected KRW-per-USD basis; no exchange rate is inferred.
 * `afterTaxLiquidationValueUsd` must already be net of tax and sale costs. This
 * function never estimates tax. `currentValueUsd` separately reports current
 * market exposure.
 */
export function recoveryModel(input = {}) {
    const krwContribution = optionalNonNegative(input.krwContribution);
    // usdContribution is only externally deposited USD. USD bought with KRW is
    // already represented inside krwContribution and must not be added again.
    const usdContribution = optionalNonNegative(input.usdContribution);
    // convertedKrw is an informational subset of krwContribution.
    const convertedKrw = optionalNonNegative(input.convertedKrw);
    const reinvestedUsd = optionalNonNegative(input.reinvestedUsd);
    const cashWithdrawnUsd = optionalNonNegative(input.cashWithdrawnUsd);
    const afterTaxLiquidationValueUsd = optionalNonNegative(
        input.afterTaxLiquidationValueUsd,
        null
    );
    const currentValueUsd = optionalNonNegative(input.currentValueUsd, null);
    const krwPerUsd = optionalNonNegative(input.krwPerUsd, null);

    const invalidAmounts = [
        krwContribution,
        usdContribution,
        convertedKrw,
        reinvestedUsd,
        cashWithdrawnUsd,
    ].some((value) => value === null);
    const invalidAfterTaxValue =
        input.afterTaxLiquidationValueUsd !== undefined &&
        input.afterTaxLiquidationValueUsd !== null &&
        afterTaxLiquidationValueUsd === null;
    const invalidCurrentValue =
        input.currentValueUsd !== undefined &&
        input.currentValueUsd !== null &&
        currentValueUsd === null;
    const hasKrw = krwContribution !== null && krwContribution > 0;
    const absentFxRate =
        input.krwPerUsd == null ||
        (typeof input.krwPerUsd === 'string' && !input.krwPerUsd.trim());
    const invalidFxRate =
        !absentFxRate && (krwPerUsd === null || krwPerUsd <= 0);
    const missingFxRate =
        hasKrw && (krwPerUsd === null || krwPerUsd <= 0) && !invalidFxRate;
    const convertedMoreThanContributed =
        krwContribution !== null &&
        convertedKrw !== null &&
        convertedKrw > krwContribution;
    const invalidInput =
        invalidAmounts ||
        invalidAfterTaxValue ||
        invalidCurrentValue ||
        invalidFxRate ||
        convertedMoreThanContributed;

    const principalUsd =
        invalidInput || missingFxRate
            ? null
            : usdContribution + (hasKrw ? krwContribution / krwPerUsd : 0);
    const hasPrincipal = principalUsd !== null && principalUsd > 0;
    const cashRecoveryRate =
        hasPrincipal && cashWithdrawnUsd !== null
            ? rounded((cashWithdrawnUsd / principalUsd) * 100)
            : null;
    const economicRecoveryRate =
        hasPrincipal &&
        cashWithdrawnUsd !== null &&
        afterTaxLiquidationValueUsd !== null
            ? rounded(
                  ((cashWithdrawnUsd + afterTaxLiquidationValueUsd) /
                      principalUsd) *
                      100
              )
            : null;
    const issues = [];
    if (invalidInput) issues.push('invalid_input');
    if (!invalidInput && !missingFxRate && !hasPrincipal) {
        issues.push('missing_contribution');
    }
    if (missingFxRate) issues.push('missing_krw_per_usd_rate');
    if (afterTaxLiquidationValueUsd === null && !invalidAfterTaxValue) {
        issues.push('missing_after_tax_liquidation_value');
    }

    return {
        krwContribution,
        usdContribution,
        convertedKrw,
        reinvestedUsd,
        krwPerUsd,
        principalUsd,
        cashRecoveryRate,
        unrecoveredUsd:
            hasPrincipal && cashWithdrawnUsd !== null
                ? Math.max(0, principalUsd - cashWithdrawnUsd)
                : null,
        afterTaxLiquidationValueUsd,
        economicRecoveryRate,
        currentRiskUsd: currentValueUsd,
        status: invalidInput
            ? 'invalid_input'
            : issues.length > 0
              ? 'incomplete'
              : 'ready',
        issues,
    };
}
