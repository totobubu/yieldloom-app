import type { DistributionTicker } from '@/composables/studio/useDividendPortfolio';

export type PriceQuote = {
    close: number;
    priceDate: string;
    stale: boolean;
    currency: string | null;
    source: 'yahoo_eod';
    dataPath: string;
};

export type PriceIndex = {
    generatedAt: string;
    source: 'yahoo_eod';
    prices: Record<string, PriceQuote>;
};

export const isEstimateEligible = (row?: DistributionTicker) =>
    Boolean(
        row &&
            ['official', 'cross_checked'].includes(
                row.latest.verification_status
            ) &&
            row.latest.comparisonBasis !==
                'corporate_action_or_frequency_change'
    );

export const yieldPercent = (annual: number | null, quote?: PriceQuote) =>
    annual === null || !quote || quote.close <= 0 || quote.stale
        ? null
        : (annual / quote.close) * 100;

export async function loadMarketInputs() {
    const [distributionResponse, priceResponse] = await Promise.all([
        fetch('/content-studio/distribution-index.json', { cache: 'no-store' }),
        fetch('/content-studio/price-index.json', { cache: 'no-store' }),
    ]);
    if (!distributionResponse.ok)
        throw new Error('공식 배당 원장을 불러오지 못했습니다.');
    const distribution = await distributionResponse.json();
    const priceIndex: PriceIndex = priceResponse.ok
        ? await priceResponse.json()
        : { generatedAt: '', source: 'yahoo_eod', prices: {} };
    return {
        rows: (distribution.tickers || []) as DistributionTicker[],
        priceIndex,
    };
}
