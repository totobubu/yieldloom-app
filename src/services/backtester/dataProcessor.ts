// src/services/backtester/dataProcessor.ts

import type { PriceData } from '@/types';

/**
 * 심볼 데이터 (API 응답)
 */
export interface SymbolData {
    symbol: string;
    priceBasis?: 'raw' | 'split_adjusted';
    dividendBasis?: 'raw' | 'split_adjusted';
    prices?: Array<{
        date: string | Date;
        open: number;
        close: number;
        high?: number;
        low?: number;
        volume?: number;
    }>;
    dividends?: Array<{
        date: string | Date;
        amount: number;
    }>;
    splits?: Array<{
        date: string | Date;
        ratio: string; // "2:1" 형식
    }>;
}

/**
 * 처리된 데이터
 */
export interface ProcessedData {
    priceMap: Map<string, PriceData>;
    dividendMap: Map<string, number>;
}

/**
 * 심볼 데이터 처리 (주식 분할 조정 포함)
 * @param symbolData - 원본 심볼 데이터
 * @returns 처리된 가격 및 배당 맵
 */
export function processSymbolData(symbolData: SymbolData): ProcessedData {
    console.log(`[Processor] Processing data for ${symbolData.symbol}`, {
        symbolData,
    });

    let prices = (symbolData.prices || []).map((p) => ({
        ...p,
        date: new Date(p.date).toISOString().split('T')[0],
    }));
    let dividends = (symbolData.dividends || []).map((d) => ({
        ...d,
        date: new Date(d.date).toISOString().split('T')[0],
    }));

    // 주식 분할 조정
    if (symbolData.splits && symbolData.splits.length > 0) {
        symbolData.splits.forEach((split) => {
            const splitDate = new Date(split.date);
            const [numerator, denominator] = split.ratio.split(':').map(Number);
            if (!(numerator > 0) || !(denominator > 0) || !Number.isFinite(numerator / denominator)) return;
            const ratio = numerator / denominator;

            // 분할 이전 가격 조정
            prices.forEach((price) => {
                if (symbolData.priceBasis !== 'split_adjusted' && new Date(price.date) < splitDate) {
                    price.open /= ratio;
                    price.close /= ratio;
                }
            });

            // 분할 이전 배당 조정
            dividends.forEach((div) => {
                if (symbolData.dividendBasis !== 'split_adjusted' && new Date(div.date) < splitDate) {
                    div.amount /= ratio;
                }
            });
        });
    }

    const priceMap = new Map(prices.map((p) => [p.date, p as PriceData]));
    const dividendMap = new Map(dividends.map((d) => [d.date, d.amount]));

    console.log(
        `[Processor] Finished for ${symbolData.symbol}. Price Map Size: ${priceMap.size}, Dividend Map Size: ${dividendMap.size}`
    );
    return { priceMap, dividendMap };
}
