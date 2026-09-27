// src/composables/data/useBacktestData.ts
import { ref, type Ref } from 'vue';
import { joinURL } from 'ufo';
import { getDataUrl } from '@/utils/dataUrl';
import { addBusinessDays } from '@/services/backtester/utils';
import type { PortfolioItem } from '@/services/backtester/aggregator';

/**
 * 백테스트 데이터 가격 정보
 */
interface BacktestPrice {
    date: string;
    open: number;
    close: number;
}

/**
 * 백테스트 데이터 배당 정보
 */
interface BacktestDividend {
    date: string;
    amount: number;
}

/**
 * 백테스트 데이터 (심볼별)
 */
export interface BacktestSymbolData {
    symbol: string;
    prices: BacktestPrice[];
    dividends: BacktestDividend[];
    splits: any[];
    firstTradeDate?: string | null;
    error?: string;
}

/**
 * 환율 데이터
 */
interface ExchangeRate {
    date: string;
    rate: number;
}

/**
 * API 응답 데이터
 */
interface BacktestApiData {
    tickerData: BacktestSymbolData[];
    exchangeRates: ExchangeRate[];
}

/**
 * 백테스트 데이터 fetching 결과
 */
export interface BacktestDataResult {
    effectiveStartDate: string;
    apiData: BacktestApiData;
    holidays: (string | { date: string })[];
}

/**
 * Nav 정보
 */
interface NavInfo {
    symbol: string;
    yfSymbol?: string;
    dataPaths?: string[];
}

/**
 * Nav 데이터
 */
interface NavData {
    nav: NavInfo[];
}

/**
 * 로컬 백테스트 데이터 항목
 */
interface LocalBacktestDataItem {
    date: string;
    open: number;
    close: number;
    amount?: number;
    amountFixed?: number;
}

/**
 * 로컬 데이터 응답
 */
interface LocalDataResponse {
    backtestData?: LocalBacktestDataItem[];
    tickerInfo?: {
        ipoDate?: string;
    };
}

/**
 * 백테스트 데이터 반환 타입
 */
export interface UseBacktestDataReturn {
    fetchDataForBacktest: (
        portfolio: PortfolioItem[],
        comparisonSymbol: string,
        startDate: Date,
        endDate: Date
    ) => Promise<BacktestDataResult>;
    adjustedDateMessage: Ref<string>;
}

export function useBacktestData(): UseBacktestDataReturn {
    const adjustedDateMessage = ref('');

    const fetchDataForBacktest = async (
        portfolio: PortfolioItem[],
        comparisonSymbol: string,
        startDate: Date,
        endDate: Date
    ): Promise<BacktestDataResult> => {
        const portfolioSymbols = portfolio
            .map((p) => p.symbol.toUpperCase())
            .filter(Boolean);
        if (portfolioSymbols.length === 0) {
            throw new Error('백테스팅할 종목을 입력해주세요.');
        }

        const symbolsToFetch = [
            ...new Set(
                [...portfolioSymbols, comparisonSymbol.toUpperCase()].filter(
                    (s) => s && s !== 'NONE'
                )
            ),
        ];

        // nav.json 로드하여 dataPath 매핑 생성
        let navData: NavData | null = null;
        const symbolToDataPathMap = new Map<string, string>();
        try {
            const navUrl = getDataUrl('nav.json');
            const navResponse = await fetch(navUrl);
            if (navResponse.ok) {
                navData = await navResponse.json();
                const sanitizeTicker = (ticker: string | undefined): string =>
                    ticker ? ticker.replace(/\./g, '-').toLowerCase() : '';

                symbolsToFetch.forEach((symbol) => {
                    const sanitizedSymbol = sanitizeTicker(symbol);
                    const navInfo = navData?.nav?.find(
                        (item) =>
                            sanitizeTicker(item.symbol) === sanitizedSymbol ||
                            sanitizeTicker(item.yfSymbol || '') === sanitizedSymbol
                    );
                    if (navInfo) {
                        const dataPath = navInfo.dataPaths?.[0];
                        if (dataPath) {
                            symbolToDataPathMap.set(symbol, dataPath);
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('Failed to load nav.json, falling back to direct path', e);
        }

        const fetchStaticData = async (symbol: string): Promise<BacktestSymbolData | null> => {
            try {
                // nav.json의 dataPath 사용, 없으면 fallback
                const dataPath =
                    symbolToDataPathMap.get(symbol) ||
                    `data/${symbol.toLowerCase().replace(/\./g, '-')}.json`;

                const response = await fetch(getDataUrl(dataPath));
                if (response.ok) {
                    const data: LocalDataResponse = await response.json();
                    // 로컬 데이터를 백테스팅 엔진 형식으로 변환합니다.
                    if (data.backtestData) {
                        const prices: BacktestPrice[] = [];
                        const dividends: BacktestDividend[] = [];

                        data.backtestData.forEach((item) => {
                            // 가격 정보 추가
                            if (
                                item.close !== null &&
                                typeof item.close !== 'undefined'
                            ) {
                                prices.push({
                                    date: item.date,
                                    open: item.open,
                                    close: item.close,
                                });
                            }
                            // 배당 정보 추가
                            // NEW STRUCTURE: Use amountFixed as primary value (actual received amount)
                            // For backtesting, we want the actual received amount, not split-adjusted
                            const amount =
                                item.amountFixed !== undefined
                                    ? item.amountFixed
                                    : item.amount;
                            if (amount !== undefined && amount !== null) {
                                dividends.push({
                                    date: item.date,
                                    amount: amount,
                                });
                            }
                        });

                        return {
                            symbol,
                            prices,
                            dividends,
                            splits: [] as any[], // 로컬 데이터는 액면분할 정보를 포함하지 않음
                            firstTradeDate: data.tickerInfo?.ipoDate || null,
                        };
                    }
                }
                return null;
            } catch (error) {
                return null;
            }
        };

        const tickerDataPromises = symbolsToFetch.map(fetchStaticData);

        const initialResults = await Promise.all(tickerDataPromises);
        const foundSymbols = new Set(
            initialResults.filter(Boolean).map((r) => r!.symbol)
        );
        const symbolsToFetchFromApi = symbolsToFetch.filter(
            (s) => !foundSymbols.has(s)
        );

        let apiResults: BacktestSymbolData[] = [];
        if (symbolsToFetchFromApi.length > 0) {
            console.log(
                'Fetching from API for:',
                symbolsToFetchFromApi.join(',')
            );
            const from = startDate.toISOString().split('T')[0];
            const to = endDate.toISOString().split('T')[0];
            try {
                const apiUrl = `/api/getBacktestData?symbols=${symbolsToFetchFromApi.join(',')}&from=${from}&to=${to}`;
                const apiResponse = await fetch(apiUrl);
                if (!apiResponse.ok) {
                    throw new Error(
                        '실시간 백테스팅 데이터 API 호출에 실패했습니다.'
                    );
                }
                // API 응답이 HTML일 경우를 대비하여 예외 처리 추가
                const textResponse = await apiResponse.text();
                try {
                    const apiData = JSON.parse(textResponse);
                    apiResults = apiData.tickerData || [];
                    const apiErrors = apiResults.filter((r) => r.error);
                    if (apiErrors.length > 0) {
                        throw new Error(
                            apiErrors.map((e) => e.error).join(', ')
                        );
                    }
                } catch (_jsonError) {
                    throw new Error(
                        `API 응답이 올바른 JSON 형식이 아닙니다. 서버 오류일 수 있습니다.`
                    );
                }
            } catch (e) {
                throw new Error(
                    `[${symbolsToFetchFromApi.join(',')}] 실시간 데이터 조회 중 오류가 발생했습니다: ${(e as Error).message}`
                );
            }
        }

        const tickerData: BacktestSymbolData[] = initialResults
            .filter((r): r is BacktestSymbolData => r !== null)
            .concat(apiResults);

        // holidays.json은 us_holidays.json과 kr_holidays.json을 합친 파일이므로 더 이상 존재하지 않습니다.
        // 시뮬레이터에서 개별 휴일 데이터를 사용하므로 이 부분은 수정/제거가 필요합니다.
        // 우선은 빈 배열로 처리하여 오류를 막습니다.
        const holidays: (string | { date: string })[] = [];

        const [exchangeResponse] = await Promise.all([
            fetch(joinURL(import.meta.env.BASE_URL, 'exchange-rates.json')),
        ]);

        if (!exchangeResponse.ok)
            throw new Error('환율 데이터를 불러올 수 없습니다.');

        const exchangeRates: ExchangeRate[] = await exchangeResponse.json();
        const apiData: BacktestApiData = { tickerData, exchangeRates };

        const dataStartDates = tickerData
            .filter(
                (d): d is BacktestSymbolData =>
                    !!d && portfolioSymbols.includes(d.symbol) && (d.prices?.length ?? 0) > 0
            )
            .map((d) => new Date(d.prices[0].date));

        if (dataStartDates.length < portfolioSymbols.length) {
            const failedSymbols = portfolioSymbols.filter(
                (s) =>
                    !tickerData.find(
                        (d) => d && d.symbol === s && (d.prices?.length ?? 0) > 0
                    )
            );
            const errorTicker = tickerData.find(
                (t) => t && failedSymbols.includes(t.symbol) && t.error
            );
            if (errorTicker) {
                throw new Error(errorTicker.error);
            }

            throw new Error(
                `[${failedSymbols.join(', ')}] 종목의 가격 데이터가 없습니다. 다른 종목을 선택해주세요.`
            );
        }

        const latestIpoDate = new Date(Math.max(...dataStartDates.map(d => d.getTime())));
        let effectiveStartDate = new Date(startDate);

        const originalStartDateStr = effectiveStartDate
            .toISOString()
            .split('T')[0];

        if (effectiveStartDate < latestIpoDate) {
            effectiveStartDate = latestIpoDate;
        }

        // addBusinessDays는 휴일 데이터가 필요하므로, 로직을 잠시 비활성화하거나 수정해야 합니다.
        // 우선은 그대로 두고, 이후 휴일 데이터 로딩 방식을 변경해야 합니다.
        const businessStartDate = addBusinessDays(
            effectiveStartDate,
            0,
            holidays
        );

        const adjustedStartDateStr = businessStartDate
            .toISOString()
            .split('T')[0];

        if (originalStartDateStr !== adjustedStartDateStr) {
            adjustedDateMessage.value = `시작일이 ${adjustedStartDateStr}로 자동 조정되었습니다. (영업일 기준)`;
        } else {
            adjustedDateMessage.value = '';
        }

        return {
            effectiveStartDate: adjustedStartDateStr,
            apiData,
            // holidays를 반환하여 engine에서 사용할 수 있도록 함
            holidays,
        };
    };

    return { fetchDataForBacktest, adjustedDateMessage };
}
