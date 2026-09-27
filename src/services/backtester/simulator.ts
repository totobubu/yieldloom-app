// src/services/backtester/simulator.ts

import { addBusinessDays } from './utils';
import type { PriceData } from '@/types';

/**
 * 배당 지급 정보
 */
export interface DividendPayout {
    date: string;
    amount: number;
    preTaxAmount: number;
    shares: number;
    perShare: number;
    ticker: string;
}

/**
 * 시뮬레이션 옵션
 */
export interface SimulationOptions {
    symbol: string;
    effectiveStartDateStr: string;
    endDate: string;
    investmentPerTicker: number;
    commissionRate: number;
    taxRate: number;
    priceMap: Map<string, PriceData>;
    dividendMap: Map<string, number>;
    holidays: (string | { date: string })[];
}

/**
 * 시뮬레이션 결과
 */
export interface SimulationResult {
    initialShares: number;
    sharesWithReinvest: number;
    sharesWithoutReinvest: number;
    historyWithReinvest: Array<[string, number]>;
    historyWithoutReinvest: Array<[string, number]>;
    historyCash: Array<[string, number]>;
    dividendPayouts: DividendPayout[];
    dividendPayoutsWithReinvest: DividendPayout[];
    endPrice: number;
    finalCashCollected: number;
}

/**
 * 백테스팅 시뮬레이션 실행
 * @param options - 시뮬레이션 옵션
 * @returns 시뮬레이션 결과
 */
export function runSimulation(options: SimulationOptions): SimulationResult {
    const {
        symbol,
        effectiveStartDateStr,
        endDate,
        investmentPerTicker,
        commissionRate,
        taxRate,
        priceMap,
        dividendMap,
        holidays,
    } = options;

    const startPriceData = priceMap.get(effectiveStartDateStr);
    if (!startPriceData || !startPriceData.close) {
        throw new Error(
            `[${symbol}] 시작일(${effectiveStartDateStr})의 주가 정보가 없습니다.`
        );
    }

    const startPrice = startPriceData.close;
    let sharesWithReinvest =
        (investmentPerTicker * (1 - commissionRate)) / startPrice;
    let sharesWithoutReinvest = sharesWithReinvest;
    const initialShares = sharesWithoutReinvest;

    let currentDate = new Date(`${effectiveStartDateStr}T12:00:00Z`);
    const finalDate = new Date(`${endDate}T12:00:00Z`);
    const historyWithReinvest: Array<[string, number]> = [];
    const historyWithoutReinvest: Array<[string, number]> = [];
    const dividendPayouts: DividendPayout[] = [];
    const dividendPayoutsWithReinvest: DividendPayout[] = [];

    while (currentDate.getTime() <= finalDate.getTime()) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const currentPriceData = priceMap.get(dateStr);

        if (currentPriceData) {
            if (dividendMap.has(dateStr)) {
                const dividendPerShare = dividendMap.get(dateStr)!;

                // 1. 현금 배당 (재투자 X) 기록
                const cashDividendPreTax =
                    sharesWithoutReinvest * dividendPerShare;
                dividendPayouts.push({
                    date: dateStr,
                    amount: cashDividendPreTax * taxRate,
                    preTaxAmount: cashDividendPreTax,
                    shares: sharesWithoutReinvest,
                    perShare: dividendPerShare,
                    ticker: symbol,
                });

                // 2. 재투자 배당 (DRIP) 기록
                const reinvestDividendPreTax =
                    sharesWithReinvest * dividendPerShare;
                const reinvestDividendPostTax =
                    reinvestDividendPreTax * taxRate;
                dividendPayoutsWithReinvest.push({
                    date: dateStr,
                    amount: reinvestDividendPostTax,
                    preTaxAmount: reinvestDividendPreTax,
                    shares: sharesWithReinvest,
                    perShare: dividendPerShare,
                    ticker: symbol,
                });

                // 3. 재투자 실행 (주식 수 업데이트)
                const reinvestmentDate = addBusinessDays(
                    currentDate,
                    2,
                    holidays
                );
                const reinvestmentPriceData = priceMap.get(
                    reinvestmentDate.toISOString().split('T')[0]
                );
                if (reinvestmentPriceData?.open && reinvestmentPriceData.open > 0) {
                    sharesWithReinvest +=
                        (reinvestDividendPostTax * (1 - commissionRate)) /
                        reinvestmentPriceData.open;
                }
            }
            historyWithReinvest.push([
                dateStr,
                sharesWithReinvest * currentPriceData.close,
            ]);
            historyWithoutReinvest.push([
                dateStr,
                sharesWithoutReinvest * currentPriceData.close,
            ]);
        }
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    if (historyWithReinvest.length === 0) {
        throw new Error(`[${symbol}] 선택된 기간에 유효한 데이터가 없습니다.`);
    }

    // 누적 현금 배당 계산
    let cashCollected = 0;
    const historyCash = historyWithoutReinvest.map(([date]) => {
        const payoutToday = dividendPayouts.find((p) => p.date === date);
        if (payoutToday) {
            cashCollected += payoutToday.amount;
        }
        return [date, cashCollected] as [string, number];
    });

    const endPrice =
        historyWithReinvest[historyWithReinvest.length - 1][1] /
        sharesWithReinvest;

    return {
        initialShares,
        sharesWithReinvest,
        sharesWithoutReinvest,
        historyWithReinvest,
        historyWithoutReinvest,
        historyCash,
        dividendPayouts,
        dividendPayoutsWithReinvest,
        endPrice,
        finalCashCollected: cashCollected,
    };
}
