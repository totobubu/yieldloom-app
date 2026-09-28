import {
    annualized,
    type DistributionTicker,
} from '../composables/studio/useDividendPortfolio.ts';

export type StabilitySignal = 'stable' | 'caution' | 'review';
export type PriceQuality = 'fresh' | 'stale' | 'missing';

export type ComparisonPriceIndex = {
    prices: Record<string, { close: number; stale: boolean }>;
};

export type ComparisonSignals = {
    stability: StabilitySignal;
    stabilityReasons: string[];
    priceQuality: PriceQuality;
    annualYield: number | null;
};

const relativeDifference = (value: number, baseline: number) =>
    baseline === 0 ? null : Math.abs(value - baseline) / Math.abs(baseline);

export function getPriceQuality(
    ticker: string,
    priceIndex: ComparisonPriceIndex
): PriceQuality {
    const quote = priceIndex.prices[ticker];
    if (!quote) return 'missing';
    return quote.stale ? 'stale' : 'fresh';
}

export function getStabilitySignal(
    row: DistributionTicker
): Pick<ComparisonSignals, 'stability' | 'stabilityReasons'> {
    const event = row.latest;
    const reasons: string[] = [];
    const amount = Number(event.distribution_per_share);
    const average4 = event.average4;
    const average12 = event.average12;

    if (!['official', 'cross_checked'].includes(event.verification_status))
        reasons.push('공식 검증 대기');
    if (event.comparisonBasis === 'corporate_action_or_frequency_change')
        reasons.push('기업행동 또는 지급 주기 변경');
    if (row.historyCount < 4) reasons.push(`이력 ${row.historyCount}회`);
    if (!Number.isFinite(amount) || average4 === null || average12 === null)
        reasons.push('비교 가능한 배당 이력 부족');

    if (reasons.length)
        return { stability: 'review', stabilityReasons: reasons };

    const versus4 = relativeDifference(amount, average4 as number);
    const versus12 = relativeDifference(amount, average12 as number);
    if (
        row.historyCount >= 12 &&
        versus4 !== null &&
        versus12 !== null &&
        versus4 <= 0.2 &&
        versus12 <= 0.15
    )
        return {
            stability: 'stable',
            stabilityReasons: [
                `이력 ${row.historyCount}회`,
                `4회 평균 대비 ${(versus4 * 100).toFixed(1)}%`,
                `12회 평균 대비 ${(versus12 * 100).toFixed(1)}%`,
            ],
        };

    if (row.historyCount < 12) reasons.push(`이력 ${row.historyCount}회`);
    if (versus4 !== null && versus4 > 0.2)
        reasons.push(`4회 평균 대비 ${(versus4 * 100).toFixed(1)}%`);
    if (versus12 !== null && versus12 > 0.15)
        reasons.push(`12회 평균 대비 ${(versus12 * 100).toFixed(1)}%`);
    return { stability: 'caution', stabilityReasons: reasons };
}

export function getComparisonSignals(
    row: DistributionTicker,
    priceIndex: ComparisonPriceIndex
): ComparisonSignals {
    const quote = priceIndex.prices[row.ticker];
    return {
        ...getStabilitySignal(row),
        priceQuality: getPriceQuality(row.ticker, priceIndex),
        annualYield:
            annualized(row.latest) === null ||
            !quote ||
            quote.close <= 0 ||
            quote.stale
                ? null
                : annualized(row.latest)! / quote.close,
    };
}
