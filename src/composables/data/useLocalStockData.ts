// src/composables/data/useLocalStockData.ts
import { ref, type Ref } from 'vue';

/**
 * 로컬 주식 데이터 항목
 */
export interface LocalStockItem {
    isin: string;
    symbol?: string;
    koName?: string;
    enName?: string;
    market?: string;
    [key: string]: any;
}

/**
 * 로컬 주식 데이터 반환 타입
 */
export interface UseLocalStockDataReturn {
    localStockData: Ref<Map<string, LocalStockItem>>;
    isLoaded: Ref<boolean>;
    isLoading: Ref<boolean>;
    fetchAllStockData: () => Promise<void>;
    findStockByIsin: (isin: string) => LocalStockItem | null;
}

const localStockData = ref<Map<string, LocalStockItem>>(new Map());
const isLoaded = ref(false);
const isLoading = ref(false);

export function useLocalStockData(): UseLocalStockDataReturn {
    const fetchAllStockData = async (): Promise<void> => {
        if (isLoaded.value || isLoading.value) return;

        isLoading.value = true;
        const markets = ['NASDAQ', 'NYSE', 'AMEX', 'bats'];
        const chars = [
            ...Array.from({ length: 10 }, (_, i) => i.toString()),
            ...Array.from({ length: 26 }, (_, i) =>
                String.fromCharCode(97 + i)
            ),
        ];

        const promises: Promise<void>[] = [];
        for (const market of markets) {
            for (const char of chars) {
                promises.push(
                    fetch(`/nav/${market}/${char}.json`)
                        .then((res) => {
                            if (!res.ok) return [];
                            return res.json() as Promise<LocalStockItem[]>;
                        })
                        .then((data: LocalStockItem[]) => {
                            data.forEach((item) => {
                                if (item.isin) {
                                    // ISIN을 키로 저장 (중복 시 덮어쓰기 - 보통 동일함)
                                    localStockData.value.set(item.isin, item);
                                }
                            });
                        })
                        .catch(() => {
                            // 404 등 무시
                        })
                );
            }
        }

        await Promise.all(promises);
        isLoaded.value = true;
        isLoading.value = false;
    };

    const findStockByIsin = (isin: string): LocalStockItem | null => {
        if (!isin) return null;
        return localStockData.value.get(isin) || null;
    };

    return {
        localStockData,
        isLoaded,
        isLoading,
        fetchAllStockData,
        findStockByIsin,
    };
}
