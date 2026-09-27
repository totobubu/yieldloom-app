// src/utils/isinMapping.js
// ISIN을 SYMBOL로 매핑하는 유틸리티

let isinToSymbolMap = null;
let isLoading = false;
let loadPromise = null;

/**
 * ISIN 매핑 데이터를 로드합니다.
 * @returns {Promise<Map<string, string>>} ISIN -> SYMBOL 매핑 맵
 */
async function loadIsinMapping() {
    if (isinToSymbolMap) return isinToSymbolMap;
    if (isLoading && loadPromise) return loadPromise;

    isLoading = true;
    loadPromise = (async () => {
        try {
            const map = new Map();

            // 미국 주식 데이터 로드
            try {
                const usStocksResponse = await fetch(
                    '/sidebar/sidebar-tickers-us-stocks.json'
                );
                if (usStocksResponse.ok) {
                    const usStocks = await usStocksResponse.json();
                    usStocks.forEach((item) => {
                        if (item.isin && item.symbol) {
                            map.set(item.isin.toUpperCase(), item.symbol);
                        }
                    });
                }
            } catch (error) {
                console.warn('미국 주식 ISIN 매핑 로드 실패:', error);
            }

            // 미국 ETF 데이터 로드
            try {
                const usEtfsResponse = await fetch(
                    '/sidebar/sidebar-tickers-us-etfs.json'
                );
                if (usEtfsResponse.ok) {
                    const usEtfs = await usEtfsResponse.json();
                    usEtfs.forEach((item) => {
                        if (item.isin && item.symbol) {
                            map.set(item.isin.toUpperCase(), item.symbol);
                        }
                    });
                }
            } catch (error) {
                console.warn('미국 ETF ISIN 매핑 로드 실패:', error);
            }

            isinToSymbolMap = map;
            return map;
        } catch (error) {
            console.error('ISIN 매핑 로드 실패:', error);
            return new Map();
        } finally {
            isLoading = false;
        }
    })();

    return loadPromise;
}

/**
 * ISIN을 SYMBOL로 변환합니다.
 * @param {string} isin - ISIN 코드
 * @returns {Promise<string|null>} SYMBOL 또는 null (매핑이 없는 경우)
 */
export async function isinToSymbol(isin) {
    if (!isin) return null;

    const normalizedIsin = isin.trim().toUpperCase();
    const map = await loadIsinMapping();
    return map.get(normalizedIsin) || null;
}

/**
 * 여러 ISIN을 한 번에 SYMBOL로 변환합니다.
 * @param {string[]} isins - ISIN 코드 배열
 * @returns {Promise<Map<string, string>>} ISIN -> SYMBOL 매핑 맵
 */
export async function isinsToSymbols(isins) {
    if (!Array.isArray(isins) || isins.length === 0) {
        return new Map();
    }

    const map = await loadIsinMapping();
    const result = new Map();

    isins.forEach((isin) => {
        if (!isin) return;
        const normalizedIsin = isin.trim().toUpperCase();
        const symbol = map.get(normalizedIsin);
        if (symbol) {
            result.set(normalizedIsin, symbol);
        }
    });

    return result;
}

/**
 * ISIN 매핑 캐시를 초기화합니다 (테스트 또는 재로드용).
 */
export function clearIsinMappingCache() {
    isinToSymbolMap = null;
    isLoading = false;
    loadPromise = null;
}

