/**
 * useCalendarData V2 - 월별 로딩 + IndexedDB 캐싱
 *
 * 개선사항:
 * 1. 월별 데이터 분할 로딩 (필요한 월만 로드)
 * 2. IndexedDB 캐싱으로 재방문 시 빠른 로딩
 * 3. 점진적 로딩으로 초기 로딩 속도 개선
 * 4. 스마트 캐싱 (서버의 데이터 버전과 비교하여 자동 갱신)
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { useFilterState } from '@/composables/portfolio/useFilterState';
import { getDataUrl } from '@/utils/dataUrl';
import { stripTickerSuffix } from '@/utils/tickerRoute';
import dbCache from '@/utils/indexedDB';
import { get } from '@/utils/http';
import type {
    CalendarEvent,
    DividendsByDate,
    MonthlyData,
    TickerProperties,
    CalendarCacheData,
} from '@/types/calendar';
import type { Currency } from '@/types/common';

// 메타데이터 타입 정의
interface CalendarMetadata {
    version: number;
    totalMonths: number;
    totalDates: number;
    dateRange: {
        start: string;
        end: string;
    };
    months: string[];
}

// 전역 상태
const monthlyData = ref<MonthlyData>(new Map());
const allTickerProperties = ref<Map<string, TickerProperties>>(new Map());
const isLoading = ref(false);
const loadingMonths = ref<Set<string>>(new Set());
const error = ref<Error | null>(null);
const serverVersion = ref<number | null>(null); // 서버 데이터 버전

/**
 * 서버 메타데이터 로드 및 버전 확인
 */
async function loadMetadata() {
    if (serverVersion.value !== null) return; // 이미 로드됨

    try {
        const url = getDataUrl('calendar/monthly/metadata.json');
        const { data } = await get<CalendarMetadata>(url);
        if (data && data.version) {
            serverVersion.value = data.version;
            console.log(
                `📅 [useCalendarData] 서버 데이터 버전: ${data.version}`
            );
        }
    } catch (e) {
        console.warn('📅 [useCalendarData] 메타데이터 로드 실패', e);
    }
}

/**
 * 연-월 범위 생성
 */
function generateMonthRange(
    startYear: number,
    startMonth: number,
    endYear: number,
    endMonth: number
): string[] {
    const months: string[] = [];
    let year = startYear;
    let month = startMonth;

    while (year < endYear || (year === endYear && month <= endMonth)) {
        const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
        months.push(yearMonth);

        month++;
        if (month > 12) {
            month = 1;
            year++;
        }
    }

    return months;
}

/**
 * 특정 월의 데이터 로드 (스마트 캐싱 적용)
 */
async function loadMonth(yearMonth: string): Promise<void> {
    if (loadingMonths.value.has(yearMonth)) return;
    if (monthlyData.value.has(yearMonth)) return;

    loadingMonths.value.add(yearMonth);

    // 메타데이터가 아직 없으면 로드 시도
    if (serverVersion.value === null) {
        await loadMetadata();
    }

    try {
        const cacheKey = `calendar-${yearMonth}`;

        // 1. IndexedDB 캐시 확인
        const cached = await dbCache.get<
            CalendarCacheData & { version?: number }
        >(cacheKey);

        let useCustomCache = false;
        if (cached) {
            // 버전 확인: 서버 버전이 있고, 캐시된 버전과 다르면 캐시 무효화
            if (serverVersion.value && cached.version !== serverVersion.value) {
                console.log(
                    `📅 [useCalendarData] 🔄 캐시 만료: ${yearMonth} (Server: ${serverVersion.value}, Cache: ${cached.version})`
                );
                useCustomCache = false;
            } else {
                // 기존 유효성 검사
                const isValid =
                    cached.events.length === 0 ||
                    (cached.events[0] as any).currency !== undefined || // currency 체크는 하위 호환성을 위해 유지하거나 제거 가능
                    (cached.events[0] as any).isEtf !== undefined; // isEtf는 필수

                if (isValid) {
                    useCustomCache = true;
                }
            }
        }

        if (useCustomCache && cached) {
            console.log(`📅 [useCalendarData] ✓ 캐시에서 로드: ${yearMonth}`);
            monthlyData.value.set(yearMonth, cached.events);
            cached.tickerProperties.forEach(([key, value]) => {
                if (!allTickerProperties.value.has(key)) {
                    allTickerProperties.value.set(key, value);
                }
            });
            loadingMonths.value.delete(yearMonth);
            return;
        }

        // 2. 네트워크 Fetch
        const [year, month] = yearMonth.split('-');
        const url = getDataUrl(`calendar/monthly/${year}/${month}.json`);
        console.log(`📅 [useCalendarData] ⬇️  네트워크에서 로드: ${url}`);

        const response = await get<{
            UsStock?: Record<string, any[]>;
            UsEtf?: Record<string, any[]>;
            KrStock?: Record<string, any[]>;
            KrEtf?: Record<string, any[]>;
        }>(url, { __maxRetries: 3 } as any);

        const monthEvents = response.data;
        const flatEvents: CalendarEvent[] = [];
        const tickerPropertiesMap = new Map<string, TickerProperties>();

        const categories = [
            {
                key: 'UsStock' as const,
                currency: 'USD' as Currency,
                isEtf: false,
            },
            { key: 'UsEtf' as const, currency: 'USD' as Currency, isEtf: true },
            {
                key: 'KrStock' as const,
                currency: 'KRW' as Currency,
                isEtf: false,
            },
            { key: 'KrEtf' as const, currency: 'KRW' as Currency, isEtf: true },
        ];

        categories.forEach(({ key, currency, isEtf }) => {
            const categoryData = monthEvents[key];
            if (!categoryData) return;

            Object.entries(categoryData).forEach(([dateStr, events]) => {
                events.forEach((event: any) => {
                    flatEvents.push({
                        ...event,
                        date: dateStr,
                        currency: currency,
                        isEtf: isEtf,
                    });

                    if (!tickerPropertiesMap.has(event.ticker)) {
                        tickerPropertiesMap.set(event.ticker, {
                            currency: currency,
                            isEtf: isEtf,
                            koName: event.koName,
                        });
                    }
                });
            });
        });

        // 3. 상태 업데이트
        monthlyData.value.set(yearMonth, flatEvents);
        tickerPropertiesMap.forEach((value, key) => {
            if (!allTickerProperties.value.has(key)) {
                allTickerProperties.value.set(key, value);
            }
        });

        // 4. 캐시 저장 (버전 정보 포함)
        await dbCache.set(cacheKey, {
            events: flatEvents,
            tickerProperties: Array.from(tickerPropertiesMap.entries()),
            version: serverVersion.value || 0,
        });

        console.log(
            `📅 [useCalendarData] ✓ 데이터 로드 및 캐싱 완료 (Ver: ${serverVersion.value})`
        );
    } catch (err) {
        console.error(`❌ ${yearMonth} 로드 실패:`, err);
        error.value = err as Error;
    } finally {
        loadingMonths.value.delete(yearMonth);
    }
}

/**
 * 특정 기간 데이터 로드
 */
async function loadDateRange(
    startDate: string,
    endDate: string
): Promise<void> {
    isLoading.value = true;
    error.value = null;
    try {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const months = generateMonthRange(
            start.getFullYear(),
            start.getMonth() + 1,
            end.getFullYear(),
            end.getMonth() + 1
        );
        await Promise.all(months.map((month) => loadMonth(month)));
    } catch (err) {
        error.value = err as Error;
    } finally {
        isLoading.value = false;
    }
}

async function loadVisibleMonth(year: number, month: number): Promise<void> {
    const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
    await loadMonth(yearMonth);
}

async function loadCurrentMonth(): Promise<void> {
    const now = new Date();
    await loadVisibleMonth(now.getFullYear(), now.getMonth() + 1);
}

const dividendsByDate = computed<DividendsByDate>(() => {
    const result: DividendsByDate = {};
    monthlyData.value.forEach((events) => {
        events.forEach((event) => {
            if (!result[event.date]) {
                result[event.date] = [];
            }
            result[event.date].push(event);
        });
    });
    return result;
});

const { mainFilterTab, subFilterTab, myBookmarks } = useFilterState();

const filteredDividends = computed<DividendsByDate>(() => {
    const result: DividendsByDate = {};
    Object.entries(dividendsByDate.value).forEach(([date, events]) => {
        const filtered = events.filter((event) => {
            // 북마크 필터
            if (mainFilterTab.value === '북마크') {
                const bookmarks = myBookmarks.value || {};
                const bookmarkValues = Object.values(bookmarks);
                if (bookmarkValues.length > 0) {
                    const bookmarkedSymbols = new Set(
                        bookmarkValues
                            .map((b) => b?.symbol?.toUpperCase())
                            .filter(Boolean)
                    );
                    const ticker = event.ticker?.toUpperCase();
                    const symbol = stripTickerSuffix(
                        event.ticker
                    )?.toUpperCase();
                    if (
                        !bookmarkedSymbols.has(ticker) &&
                        !bookmarkedSymbols.has(symbol)
                    ) {
                        return false;
                    }
                } else {
                    return false;
                }
            }

            // 시장 필터
            if (mainFilterTab.value === '미국' && event.currency !== 'USD')
                return false;
            if (mainFilterTab.value === '한국' && event.currency !== 'KRW')
                return false;

            // 유형 필터
            if (subFilterTab.value === 'ETF' && !event.isEtf) return false;
            if (subFilterTab.value === '주식' && event.isEtf) return false;

            return true;
        });

        if (filtered.length > 0) {
            result[date] = filtered;
        }
    });
    return result;
});

async function getCacheStats() {
    return await dbCache.getStats();
}

async function clearCache(): Promise<void> {
    await dbCache.clear();
    monthlyData.value.clear();
    allTickerProperties.value.clear();
}

export interface UseCalendarDataReturn {
    dividendsByDate: ComputedRef<DividendsByDate>;
    isLoading: Ref<boolean>;
    error: Ref<Error | null>;
    allTickerProperties: Ref<Map<string, TickerProperties>>;
    loadVisibleMonth: (year: number, month: number) => Promise<void>;
    loadDateRange: (startDate: string, endDate: string) => Promise<void>;
    loadMonth: (yearMonth: string) => Promise<void>;
    getCacheStats: () => Promise<any>;
    clearCache: () => Promise<void>;
    ensureDataLoaded: () => Promise<void>;
}

export function useCalendarData(): UseCalendarDataReturn {
    return {
        dividendsByDate: filteredDividends,
        isLoading,
        error,
        allTickerProperties,
        loadVisibleMonth,
        loadDateRange,
        loadMonth,
        getCacheStats,
        clearCache,
        ensureDataLoaded: loadCurrentMonth,
    };
}
