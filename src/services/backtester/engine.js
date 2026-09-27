// src\services\backtester\engine.js
import { runSimulation } from './simulator.js';
import { aggregateResults } from './aggregator.js';
import { processSymbolData } from './dataProcessor.js';

export function runBacktest(options) {
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

    const exchangeRateMap = new Map(
        apiData.exchangeRates.map((r) => [r.date, r.rate])
    );
    let currentDateForStartRate = new Date(`${initialStartDate}T00:00:00Z`);
    let startRate = null;
    let actualStartDateStr = '';
    for (let i = 0; i < 7; i++) {
        const dateStr = currentDateForStartRate.toISOString().split('T')[0];
        if (exchangeRateMap.has(dateStr)) {
            startRate = exchangeRateMap.get(dateStr);
            actualStartDateStr = dateStr;
            break;
        }
        currentDateForStartRate.setUTCDate(
            currentDateForStartRate.getUTCDate() + 1
        );
    }
    if (!startRate)
        throw new Error(
            `시작일(${initialStartDate}) 근처의 환율 정보를 찾을 수 없습니다.`
        );

    const initialInvestmentUSD = initialInvestmentKRW / startRate;
    const commissionRate = commission / 100;
    const taxRate = applyTax ? 0.85 : 1.0;
    const results = {};
    const allSymbols = [
        ...new Set(
            [
                ...portfolio.map((p) => p.symbol.toUpperCase()),
                comparisonSymbol.toUpperCase(),
            ].filter((s) => s && s !== 'NONE')
        ),
    ];

    allSymbols.forEach((symbol) => {
        try {
            const symbolData = apiData.tickerData.find(
                (d) => d.symbol.toUpperCase() === symbol
            );
            if (!symbolData || symbolData.error)
                throw new Error(
                    symbolData?.error ||
                        `[${symbol}] 과거 데이터를 찾을 수 없습니다.`
                );

            const { priceMap, dividendMap } = processSymbolData(symbolData);

            let effectiveStartDate = new Date(actualStartDateStr);
            if (symbolData.prices.length > 0) {
                const dataStartDate = new Date(symbolData.prices[0].date);
                if (dataStartDate > effectiveStartDate) {
                    effectiveStartDate = dataStartDate;
                }
            }

            const portfolioItem = portfolio.find(
                (p) => p.symbol.toUpperCase() === symbol
            );
            const weight = portfolioItem ? portfolioItem.value / 100 : 1.0;
            const investmentPerTicker =
                symbol === comparisonSymbol.toUpperCase()
                    ? initialInvestmentUSD
                    : initialInvestmentUSD * weight;

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

            const years =
                (new Date(endDate) - new Date(initialStartDate)) /
                    (365.25 * 24 * 60 * 60 * 1000) || 1;

            const endingInvestmentWithReinvest =
                simulationResult.endPrice * simulationResult.sharesWithReinvest;
            const totalReturnWithReinvest =
                investmentPerTicker > 0
                    ? endingInvestmentWithReinvest / investmentPerTicker - 1
                    : 0;

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
            results[symbol] = { error: error.message };
        }
    });

    return aggregateResults({
        portfolio,
        comparisonSymbol,
        results,
        initialInvestmentUSD,
        initialStartDate,
        endDate,
    });
}
