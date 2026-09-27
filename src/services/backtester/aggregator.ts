// src/services/backtester/aggregator.ts

import { calculateCAGR } from './utils';
import type { DividendPayout } from './simulator';

/**
 * 포트폴리오 항목
 */
export interface PortfolioItem {
    symbol: string;
    weight: number;
}

/**
 * 시리즈 데이터
 */
export interface SeriesData {
    name: string;
    data: Array<[string, number]>;
}

/**
 * 요약 통계
 */
export interface Summary {
    totalReturn: number;
    cagr: number;
    endingInvestment: number;
    dividendsCollected?: number;
}

/**
 * 집계 결과
 */
export interface AggregatedResult {
    withReinvest: {
        series: SeriesData[];
        summary?: Summary;
    };
    withoutReinvest: {
        series: SeriesData[];
        summary?: Summary;
    };
    cashDividends: DividendPayout[];
    dripDividends: DividendPayout[];
    initialInvestment?: number;
    years?: number;
    symbols?: string[];
    comparisonSymbol?: string;
    individualResults?: Record<string, SimulationResultWithMeta>;
    comparisonResult?: SimulationResultWithMeta | null;
}

/**
 * 시뮬레이션 결과 (에러 포함)
 */
export interface SimulationResultWithMeta {
    withReinvest?: {
        history: Array<[string, number]>;
    };
    withoutReinvest?: {
        history: Array<[string, number]>;
        cashHistory: Array<[string, number]>;
    };
    dividendPayouts?: DividendPayout[];
    dividendPayoutsWithReinvest?: DividendPayout[];
    error?: string;
}

/**
 * 집계 옵션
 */
export interface AggregateOptions {
    portfolio: PortfolioItem[];
    comparisonSymbol: string;
    results: Record<string, SimulationResultWithMeta>;
    initialInvestmentUSD: number;
    initialStartDate: string;
    endDate: string;
}

/**
 * 백테스팅 결과 집계
 * @param options - 집계 옵션
 * @returns 집계된 결과
 */
export function aggregateResults(options: AggregateOptions): AggregatedResult {
    const {
        portfolio,
        comparisonSymbol,
        results,
        initialInvestmentUSD,
        initialStartDate,
        endDate,
    } = options;
    console.log('[Aggregator] Starting to aggregate results', { results });

    // 유효한 포트폴리오 심볼 필터링
    const validPortfolioSymbols = portfolio
        .map((p) => p.symbol.toUpperCase())
        .filter((s) => results[s] && !results[s].error);

    if (validPortfolioSymbols.length === 0) {
        throw new Error(
            results[portfolio[0].symbol.toUpperCase()]?.error ||
                '모든 포트폴리오 종목의 백테스팅에 실패했습니다.'
        );
    }

    // 기간 계산 (년 단위)
    const years =
        (new Date(endDate).getTime() - new Date(initialStartDate).getTime()) /
            (365.25 * 24 * 60 * 60 * 1000) || 1;

    const validBaseSymbol = validPortfolioSymbols[0];
    const baseHistory = results[validBaseSymbol].withReinvest?.history;
    if (!baseHistory) {
        throw new Error(
            `[${validBaseSymbol}] 데이터 처리 중 오류가 발생했습니다.`
        );
    }

    const finalResult: AggregatedResult = {
        withReinvest: { series: [] },
        withoutReinvest: { series: [] },
        cashDividends: [],
        dripDividends: [],
    };

    // 포트폴리오 재투자 히스토리
    const portfolioHistoryWithReinvest = baseHistory.map(
        ([date]) =>
            [
                date,
                validPortfolioSymbols.reduce(
                    (sum, s) =>
                        sum +
                        (results[s].withReinvest?.history.find(
                            (h) => h[0] === date
                        )?.[1] || 0),
                    0
                ),
            ] as [string, number]
    );

    // 포트폴리오 재투자 없는 히스토리
    const portfolioHistoryWithoutReinvest = baseHistory.map(
        ([date]) =>
            [
                date,
                validPortfolioSymbols.reduce(
                    (sum, s) =>
                        sum +
                        (results[s].withoutReinvest?.history.find(
                            (h) => h[0] === date
                        )?.[1] || 0),
                    0
                ),
            ] as [string, number]
    );

    // 포트폴리오 현금 배당 히스토리
    const portfolioCashHistory = baseHistory.map(
        ([date]) =>
            [
                date,
                validPortfolioSymbols.reduce(
                    (sum, s) =>
                        sum +
                        (results[s].withoutReinvest?.cashHistory.find(
                            (h) => h[0] === date
                        )?.[1] || 0),
                    0
                ),
            ] as [string, number]
    );

    // 시리즈 데이터 추가
    finalResult.withReinvest.series.push({
        name: 'Portfolio',
        data: portfolioHistoryWithReinvest,
    });
    finalResult.withoutReinvest.series.push({
        name: 'Portfolio (주가)',
        data: portfolioHistoryWithoutReinvest,
    });
    finalResult.withoutReinvest.series.push({
        name: 'Portfolio (현금 배당)',
        data: portfolioCashHistory,
    });

    // 개별 결과 저장
    const individualResults: Record<string, SimulationResultWithMeta> = {};
    validPortfolioSymbols.forEach((symbol) => {
        individualResults[symbol] = results[symbol];
    });

    // 비교 심볼 처리
    let comparisonDataResult: SimulationResultWithMeta | null = null;
    const safeComparisonSymbol = comparisonSymbol.toUpperCase();
    if (
        comparisonSymbol &&
        comparisonSymbol !== 'None' &&
        results[safeComparisonSymbol] &&
        !results[safeComparisonSymbol].error
    ) {
        const compResult = results[safeComparisonSymbol];
        comparisonDataResult = compResult;
        if (compResult.withReinvest?.history) {
            finalResult.withReinvest.series.push({
                name: safeComparisonSymbol,
                data: compResult.withReinvest.history,
            });
        }
    }

    // 최종 값 계산
    const totalEndingWithReinvest =
        portfolioHistoryWithReinvest.length > 0
            ? portfolioHistoryWithReinvest[
                  portfolioHistoryWithReinvest.length - 1
              ][1]
            : 0;
    const totalEndingWithoutReinvest =
        portfolioHistoryWithoutReinvest.length > 0
            ? portfolioHistoryWithoutReinvest[
                  portfolioHistoryWithoutReinvest.length - 1
              ][1]
            : 0;
    const totalCashCollected =
        portfolioCashHistory.length > 0
            ? portfolioCashHistory[portfolioCashHistory.length - 1][1]
            : 0;

    // 수익률 계산
    const totalReturnWithReinvest =
        initialInvestmentUSD > 0
            ? totalEndingWithReinvest / initialInvestmentUSD - 1
            : 0;
    const totalReturnWithoutReinvest =
        initialInvestmentUSD > 0
            ? (totalEndingWithoutReinvest + totalCashCollected) /
                  initialInvestmentUSD -
              1
            : 0;

    // 요약 통계
    finalResult.withReinvest.summary = {
        totalReturn: totalReturnWithReinvest,
        cagr: calculateCAGR(totalReturnWithReinvest, years),
        endingInvestment: totalEndingWithReinvest,
    };
    finalResult.withoutReinvest.summary = {
        totalReturn: totalReturnWithoutReinvest,
        cagr: calculateCAGR(totalReturnWithoutReinvest, years),
        endingInvestment: totalEndingWithoutReinvest,
        dividendsCollected: totalCashCollected,
    };

    finalResult.initialInvestment = initialInvestmentUSD;
    finalResult.years = years;

    // 배당 내역 집계
    finalResult.cashDividends = validPortfolioSymbols.flatMap(
        (s) => results[s].dividendPayouts || []
    );
    finalResult.dripDividends = validPortfolioSymbols.flatMap(
        (s) => results[s].dividendPayoutsWithReinvest || []
    );

    finalResult.symbols = portfolio.map((p) => p.symbol);
    finalResult.comparisonSymbol = comparisonSymbol;
    finalResult.individualResults = individualResults;
    finalResult.comparisonResult = comparisonDataResult;

    console.log(
        '[Aggregator] Finished aggregation. Final Result:',
        finalResult
    );
    return finalResult;
}
