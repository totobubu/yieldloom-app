import { ref } from 'vue';
import { getDataUrl } from '@/utils/dataUrl';

// Types
export interface TickerInfo {
    symbol: string;
    longName?: string;
    currency?: string;
    market?: string;
    regularMarketPrice?: number;
    price?: number;
    upcoming?: boolean;
    yfSymbol?: string | null;
    koName?: string;
    englishName?: string;
    [key: string]: any;
}

export interface SplitAdjustment {
    date: string;
    ratio: string;
    factor: number;
    amountAfterSplit: number;
}

export interface DividendHistoryItem {
    배당락: string;
    배당금: string | number;
    amountOriginal?: number;
    amountFixed?: number;
    amount?: number;  // Now always a number (final split-adjusted value)
    amountSplitAdjustments?: SplitAdjustment[];
    배당률?: number;
    전일종가?: number | null;
    당일시가?: number | null;
    당일종가?: number | null;
    익일종가?: number | null;
    index?: number;
}

export interface BacktestDataItem {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

interface NavItem {
    symbol: string;
    yfSymbol?: string;
    currency?: string;
    market?: string;
    upcoming?: boolean;
    aliases?: string[];
    dataPaths?: string[];
    [key: string]: any;
}

interface NavData {
    nav: NavItem[];
}

// State
const tickerInfo = ref<TickerInfo | null>(null);
const dividendHistory = ref<DividendHistoryItem[]>([]);
const backtestData = ref<BacktestDataItem[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
const isUpcoming = ref(false);
let navDataCache: NavData | null = null;

const loadNavData = async (): Promise<NavData> => {
    if (navDataCache) return navDataCache;
    try {
        const navUrl = getDataUrl('nav.json');
        const navResponse = await fetch(navUrl);
        if (!navResponse.ok) throw new Error('nav.json not found');
        navDataCache = await navResponse.json();
        return navDataCache as NavData;
    } catch (e) {
        console.error('Failed to load nav.json', e);
        return { nav: [] };
    }
};

const sanitizeTickerForFilename = (ticker?: string): string =>
    ticker ? ticker.replace(/\./g, '-').toLowerCase() : '';

const MARKET_SUFFIX_REGEX = /-(ks|kq|kn|ko)$/i;

const stripMarketSuffix = (sanitizedTicker?: string): string =>
    sanitizedTicker ? sanitizedTicker.replace(MARKET_SUFFIX_REGEX, '') : '';

const marketNameMap: Record<string, string> = {
    NMS: 'NASDAQ',
    NYQ: 'NYSE',
    NCM: 'NASDAQ',
    NGM: 'NASDAQ',
    ASE: 'NYSE',
};

const truncateDecimals = (value: any, digits = 2): number | any => {
    if (typeof value !== 'number') return value;
    const factor = 10 ** digits;
    const scaled = value * factor;
    return (scaled >= 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor;
};

const isUsdUsMarket = (currency?: string | null, market?: string | null): boolean => {
    if (currency !== 'USD') return false;
    const normalizedMarket = (market || '').toUpperCase();
    return ['NASDAQ', 'NYSE', 'AMEX'].some((keyword) =>
        normalizedMarket.includes(keyword)
    );
};

const uniqueArray = <T>(items: T[] = []): T[] => {
    const seen = new Set<T>();
    const result: T[] = [];
    items.forEach((item) => {
        if (!item) return;
        if (seen.has(item)) return;
        seen.add(item);
        result.push(item);
    });
    return result;
};

const buildStaticDataCandidates = (navInfo?: NavItem): string[] => {
    if (!navInfo) return [];
    const candidates: string[] = [];
    if (Array.isArray(navInfo.dataPaths)) {
        candidates.push(...navInfo.dataPaths);
    }
    // fallback 경로 제거: /data/{{market}}/{{ticker}}.json만 사용
    return uniqueArray(candidates);
};

const fetchStaticData = async (paths: string[] = []): Promise<{ data: any; path: string | null }> => {
    for (const relativePath of paths) {
        try {
            const response = await fetch(getDataUrl(relativePath));
            if (response.ok) {
                const json = await response.json();
                return { data: json, path: relativePath };
            }
        } catch (error) {
            console.warn(
                `[useStockData] Failed to load ${relativePath}`,
                error
            );
        }
    }
    return { data: null, path: null };
};

export function useStockData() {
    const loadData = async (sanitizedTicker?: string) => {
        if (!sanitizedTicker) {
            error.value = '티커 정보가 없습니다.';
            return;
        }

        isLoading.value = true;
        error.value = null;
        isUpcoming.value = false;
        tickerInfo.value = null;
        dividendHistory.value = [];
        backtestData.value = [];

        try {
            const navData = await loadNavData();
            const normalizedTicker = stripMarketSuffix(sanitizedTicker);
            let navInfo =
                navData.nav.find(
                    (item) =>
                        sanitizeTickerForFilename(item.symbol) ===
                        normalizedTicker
                ) ||
                navData.nav.find(
                    (item) =>
                        sanitizeTickerForFilename(item.yfSymbol || '') ===
                        sanitizedTicker
                ) ||
                navData.nav.find(
                    (item) =>
                        item.aliases && item.aliases.includes(sanitizedTicker.toUpperCase())
                );

            let staticData = null;
            let originalTickerSymbol = '';

            if (navInfo) {
                if (navInfo.upcoming) {
                    isUpcoming.value = true;
                    tickerInfo.value = navInfo;
                    isLoading.value = false;
                    return;
                }
                originalTickerSymbol = navInfo.yfSymbol || navInfo.symbol;
                const staticDataCandidates = buildStaticDataCandidates(navInfo);
                const result = await fetchStaticData(staticDataCandidates);
                staticData = result.data;
            } else {
                // FALLBACK: 사전 등록되지 않은 티커는 실시간 동적 조회 API를 통해 가져옵니다.
                originalTickerSymbol = sanitizedTicker.toUpperCase();
                console.log(`[useStockData] Fetching dynamic data for ${originalTickerSymbol}`);
                try {
                    const response = await fetch(`/api/getDynamicStockData?ticker=${originalTickerSymbol}`);
                    if (!response.ok) throw new Error('Failed to fetch dynamic data');
                    staticData = await response.json();
                } catch (e) {
                    const displayLabel = normalizedTicker ? normalizedTicker.toUpperCase() : sanitizedTicker.toUpperCase();
                    throw new Error(`'${displayLabel}'에 대한 종목 정보를 찾을 수 없습니다. (동적 조회 실패)`);
                }
            }

            if (staticData) {
                const fullBacktestData: any[] = staticData.backtestData || [];

                const inferredCurrency =
                    staticData.tickerInfo?.currency || navInfo?.currency || null;
                const inferredMarket =
                    staticData.tickerInfo?.market || navInfo?.market || null;
                const applyUsdPriceTruncation = isUsdUsMarket(
                    inferredCurrency,
                    inferredMarket
                );
                const formatPriceField = (value: any) => {
                    if (value == null) return null;
                    return applyUsdPriceTruncation
                        ? truncateDecimals(value, 2)
                        : value;
                };

                const pricesWithIndex = fullBacktestData.map((p, i) => ({
                    ...p,
                    index: i,
                }));

                dividendHistory.value = pricesWithIndex
                    .filter(
                        (item: any) =>
                            item.amount !== undefined ||
                            item.amountFixed !== undefined
                    )
                    .map((item: any) => {
                        const prevDayData = pricesWithIndex[item.index - 1];
                        const nextDayData = pricesWithIndex[item.index + 1];

                        // 배당금 표시 로직:
                        // - amount: 최신 split 기준 조정된 값 (차트 비교용, 추세 분석)
                        // - amountFixed: 실제 받은 금액 (참고용)

                        // 배당금 표시값: amount 우선 (split 조정된 값, 추세 비교 가능)
                        // amount가 없으면 amountFixed 사용
                        const 배당금값 = item.amount !== undefined && item.amount !== null
                            ? item.amount
                            : (item.amountFixed !== undefined && item.amountFixed !== null ? item.amountFixed : 0);

                        return {
                            배당락: new Date(item.date)
                                .toLocaleDateString('ko-KR', {
                                    year: '2-digit',
                                    month: '2-digit',
                                    day: '2-digit',
                                })
                                .replace(/\. /g, '.')
                                .slice(0, -1),
                            배당금: 배당금값,
                            // 분할 전 원금 및 조정내역을 표기용으로 전달
                            amountOriginal: item.amountOriginal,
                            amountFixed: item.amountFixed,
                            amount: item.amount,
                            amountSplitAdjustments: item.amountSplitAdjustments,
                            배당률: item.yield,
                            전일종가: formatPriceField(prevDayData?.close),
                            당일시가: formatPriceField(item.open),
                            당일종가: formatPriceField(item.close),
                            익일종가: formatPriceField(nextDayData?.close),
                        };
                    })
                    .reverse();

                const cleanedBacktestData = fullBacktestData
                    .filter((d: any) => d.close != null)
                    .map(({ date, open, high, low, close, volume }: any) => ({
                        date,
                        open,
                        high,
                        low,
                        close,
                        volume,
                    }));

                backtestData.value = cleanedBacktestData;
                const latestClose =
                    cleanedBacktestData.length > 0
                        ? cleanedBacktestData[cleanedBacktestData.length - 1]
                            .close
                        : null;

                tickerInfo.value = {
                    ...navInfo,
                    ...staticData.tickerInfo,
                };
                if (tickerInfo.value) {
                    tickerInfo.value.yfSymbol = originalTickerSymbol
                        ? originalTickerSymbol.toUpperCase()
                        : null;
                    if (latestClose) {
                        if (
                            !tickerInfo.value.regularMarketPrice ||
                            tickerInfo.value.regularMarketPrice <= 0
                        ) {
                            tickerInfo.value.regularMarketPrice = latestClose;
                        }
                        if (
                            !tickerInfo.value.price ||
                            tickerInfo.value.price <= 0
                        ) {
                            tickerInfo.value.price = latestClose;
                        }
                    }
                }
            }

            const liveSymbolParam = (originalTickerSymbol || '')
                .toString()
                .toUpperCase();
            const liveDataResponse = await fetch(
                `/api/getStockData?tickers=${liveSymbolParam}`
            );
            if (liveDataResponse.ok) {
                const liveDataArray = await liveDataResponse.json();
                const liveData = liveDataArray[0];
                if (liveData && tickerInfo.value) {
                    tickerInfo.value = { ...tickerInfo.value, ...liveData };
                    if (liveData.exchange && tickerInfo.value) {
                        tickerInfo.value.market =
                            marketNameMap[liveData.exchange] ||
                            liveData.exchange;
                    }
                }
            } else {
                console.warn(
                    `Could not fetch live data for ${originalTickerSymbol}`
                );
            }
        } catch (err: any) {
            console.error(`Failed to load data for ${sanitizedTicker}:`, err);

            // [핵심 수정] 에러 메시지를 분기 처리
            if (err.message.includes('500')) {
                // API 서버 에러인 경우
                error.value = `${sanitizedTicker?.toUpperCase()}의 실시간 시세 정보를 가져오는 데 실패했습니다. 잠시 후 다시 시도해주세요.`;
            } else {
                // 그 외 다른 에러 (nav.json에 없는 티커 등)
                error.value =
                    err.message ||
                    `${sanitizedTicker?.toUpperCase()}의 데이터를 불러오는 데 실패했습니다.`;
            }
        } finally {
            isLoading.value = false;
        }
    };
    return {
        tickerInfo,
        dividendHistory,
        backtestData,
        isLoading,
        error,
        loadData,
        isUpcoming,
    };
}
