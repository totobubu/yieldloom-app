// src\services\backtester\simulator.js
import { addBusinessDays } from './utils.js';

export function runSimulation(options) {
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
    const historyWithReinvest = [],
        historyWithoutReinvest = [],
        dividendPayouts = [],
        dividendPayoutsWithReinvest = []; // [신규] DRIP 배당 내역 배열

    while (currentDate.getTime() <= finalDate.getTime()) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const currentPriceData = priceMap.get(dateStr);

        if (currentPriceData) {
            if (dividendMap.has(dateStr)) {
                const dividendPerShare = dividendMap.get(dateStr);

                // --- 1. 현금 배당 (재투자 X) 기록 ---
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

                // --- 2. 재투자 배당 (DRIP) 기록 ---
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

                // --- 3. 재투자 실행 (주식 수 업데이트) ---
                const reinvestmentDate = addBusinessDays(
                    currentDate,
                    2,
                    holidays
                );
                const reinvestmentPriceData = priceMap.get(
                    reinvestmentDate.toISOString().split('T')[0]
                );
                if (reinvestmentPriceData?.open > 0) {
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

    let cashCollected = 0;
    const historyCash = historyWithoutReinvest.map(([date]) => {
        const payoutToday = dividendPayouts.find((p) => p.date === date);
        if (payoutToday) {
            cashCollected += payoutToday.amount;
        }
        return [date, cashCollected];
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
        dividendPayoutsWithReinvest, // [신규] 반환 객체에 추가
        endPrice,
        finalCashCollected: cashCollected,
    };
}
