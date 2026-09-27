// src/services/backtester/engine.ts

import { runSimulation } from './simulator';
import { aggregateResults } from './aggregator';
import { processSymbolData } from './dataProcessor';
import type { SymbolData } from './dataProcessor';
import type { AggregatedResult, PortfolioItem } from './aggregator';
import type { SimulationResult } from './simulator';

/**
 * 환율 정보
 */
export interface ExchangeRate {
    date: string;
    rate: number;
}

/**
 * API 데이터
 */
export interface ApiData {
    exchangeRates: ExchangeRate[];
    tickerData: (SymbolData & { error?: string })[];
}

/**
 * 백테스팅 옵션
 */
export interface BacktestOptions {
    portfolio: PortfolioItem[];
    comparisonSymbol: string;
    startDate: string;
    endDate: Date;
    initialInvestmentKRW: number;
    commission: number;
    applyTax: boolean;
    apiData: ApiData;
    holidays: (string | { date: string })[];
}

/**
 * 개별 심볼 결과 (확장)
 */
export interface SymbolBacktestResult extends SimulationResult {
    years: number;
    withReinvest: {
        history: Array<[string, number]>;
        endingInvestment: number;
        totalReturn: number;
    };
    withoutReinvest: {
        history: Array<[string, number]>;
        cashHistory: Array<[string, number]>;
        endingInvestment: number;
        dividendsCollected: number;
        totalReturn: number;
    };
    error?: string;
}

/**
 * 백테스팅 실행
 * @param options - 백테스팅 옵션
 * @returns 집계된 백테스팅 결과
 */
export function runBacktest(options: BacktestOptions): AggregatedResult {
    const {
        portfolio,
        comparisonSymbol,
        startDate: initialStartDate,
        endDate,
        initialInvestmentKRW,
        commission,
        applyTax,
        apiData,
        holidays,
    } = options;

    // 환율 맵 생성
    const exchangeRateMap = new Map<string, number>(
        apiData.exchangeRates.map((r) => [r.date, r.rate])
    );

    // 시작일 환율 찾기 (최대 7일 검색)
    let currentDateForStartRate = new Date(`${initialStartDate}T00:00:00Z`);
    let startRate: number | null = null;
    let actualStartDateStr = '';

    for (let i = 0; i < 7; i++) {
        const dateStr = currentDateForStartRate.toISOString().split('T')[0];
        if (exchangeRateMap.has(dateStr)) {
            startRate = exchangeRateMap.get(dateStr)!;
            actualStartDateStr = dateStr;
            break;
        }
        currentDateForStartRate.setUTCDate(
            currentDateForStartRate.getUTCDate() + 1
        );
    }

    if (!startRate) {
        throw new Error(
            `시작일(${initialStartDate}) 근처의 환율 정보를 찾을 수 없습니다.`
        );
    }

    // 초기 투자금 USD 변환
    const initialInvestmentUSD = initialInvestmentKRW / startRate;
    const commissionRate = commission / 100;
    const taxRate = applyTax ? 0.85 : 1.0;

    // 모든 심볼 수집 (포트폴리오 + 비교 심볼)
    const results: Record<string, SymbolBacktestResult> = {};
    const allSymbols = [
        ...new Set(
            [
                ...portfolio.map((p) => p.symbol.toUpperCase()),
                comparisonSymbol.toUpperCase(),
            ].filter((s) => s && s !== 'NONE')
        ),
    ];

    // 각 심볼별 시뮬레이션 실행
    allSymbols.forEach((symbol) => {
        try {
            // API 데이터에서 심볼 데이터 찾기
            const symbolData = apiData.tickerData.find(
                (d) => d.symbol.toUpperCase() === symbol
            );

            if (!symbolData || symbolData.error) {
                throw new Error(
                    symbolData?.error ||
                        `[${symbol}] 과거 데이터를 찾을 수 없습니다.`
                );
            }

            // 가격 및 배당 데이터 처리
            const { priceMap, dividendMap } = processSymbolData(symbolData);

            // 실제 시작일 결정 (데이터 시작일과 비교)
            let effectiveStartDate = new Date(actualStartDateStr);
            if (symbolData.prices && symbolData.prices.length > 0) {
                const dataStartDate = new Date(symbolData.prices[0].date);
                if (dataStartDate > effectiveStartDate) {
                    effectiveStartDate = dataStartDate;
                }
            }

            // 포트폴리오 가중치 계산
            const portfolioItem = portfolio.find(
                (p) => p.symbol.toUpperCase() === symbol
            );
            const weight = portfolioItem ? portfolioItem.weight / 100 : 1.0;
            const investmentPerTicker =
                symbol === comparisonSymbol.toUpperCase()
                    ? initialInvestmentUSD
                    : initialInvestmentUSD * weight;

            // 시뮬레이션 실행
            const simulationResult = runSimulation({
                symbol,
                effectiveStartDateStr: effectiveStartDate
                    .toISOString()
                    .split('T')[0],
                endDate: endDate.toISOString().split('T')[0],
                investmentPerTicker,
                commissionRate,
                taxRate,
                priceMap,
                dividendMap,
                holidays,
            });

            // 기간 계산 (년 단위)
            const years =
                (new Date(endDate).getTime() -
                    new Date(initialStartDate).getTime()) /
                    (365.25 * 24 * 60 * 60 * 1000) || 1;

            // 재투자 시나리오 계산
            const endingInvestmentWithReinvest =
                simulationResult.endPrice * simulationResult.sharesWithReinvest;
            const totalReturnWithReinvest =
                investmentPerTicker > 0
                    ? endingInvestmentWithReinvest / investmentPerTicker - 1
                    : 0;

            // 재투자 없는 시나리오 계산
            const endingInvestmentWithoutReinvest =
                simulationResult.endPrice *
                simulationResult.sharesWithoutReinvest;
            const finalCashCollected = simulationResult.finalCashCollected;
            const totalReturnWithoutReinvest =
                investmentPerTicker > 0
                    ? (endingInvestmentWithoutReinvest + finalCashCollected) /
                          investmentPerTicker -
                      1
                    : 0;

            // 결과 저장
            results[symbol] = {
                ...simulationResult,
                years,
                withReinvest: {
                    history: simulationResult.historyWithReinvest,
                    endingInvestment: endingInvestmentWithReinvest,
                    totalReturn: totalReturnWithReinvest,
                },
                withoutReinvest: {
                    history: simulationResult.historyWithoutReinvest,
                    cashHistory: simulationResult.historyCash,
                    endingInvestment: endingInvestmentWithoutReinvest,
                    dividendsCollected: finalCashCollected,
                    totalReturn: totalReturnWithoutReinvest,
                },
            };
        } catch (error) {
            results[symbol] = {
                error: (error as Error).message,
            } as SymbolBacktestResult;
        }
    });

    // 결과 집계
    return aggregateResults({
        portfolio,
        comparisonSymbol,
        results,
        initialInvestmentUSD,
        initialStartDate,
        endDate: endDate.toISOString().split('T')[0],
    });
}
