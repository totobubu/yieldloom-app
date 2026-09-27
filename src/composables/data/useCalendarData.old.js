// src\composables\data\useCalendarData.js
import { ref, computed } from 'vue';
import { joinURL } from 'ufo';
import { useFilterState } from '@/composables/portfolio/useFilterState';
import { getDataUrl } from '@/utils/dataUrl';
import { stripTickerSuffix } from '@/utils/tickerRoute';

const allDividendData = ref([]);
const allTickerProperties = ref(new Map());
const isLoading = ref(false);
const error = ref(null);
let isDataLoaded = false;
let isLoadingPromise = null;

const loadAllData = async () => {
    if (isLoadingPromise) return isLoadingPromise;
    if (isDataLoaded) return Promise.resolve();

    isLoadingPromise = new Promise(async (resolve, reject) => {
        isLoading.value = true;
        error.value = null;
        try {
            // 달력 이벤트 파일만 로드 (sidebar 파일은 불필요 - 모든 티커 표시해야 함)
            const [
                krStocksEventsResponse,
                krEtfsEventsResponse,
                usStocksEventsResponse,
                usEtfsEventsResponse,
            ] = await Promise.all([
                fetch(getDataUrl('calendar/calendar-events-kr-stocks.json')),
                fetch(getDataUrl('calendar/calendar-events-kr-etfs.json')),
                fetch(getDataUrl('calendar/calendar-events-us-stocks.json')),
                fetch(getDataUrl('calendar/calendar-events-us-etfs.json')),
            ]);

            if (!krStocksEventsResponse.ok)
                throw new Error(
                    'calendar-events-kr-stocks.json could not be loaded.'
                );
            if (!krEtfsEventsResponse.ok)
                throw new Error(
                    'calendar-events-kr-etfs.json could not be loaded.'
                );
            if (!usStocksEventsResponse.ok)
                throw new Error(
                    'calendar-events-us-stocks.json could not be loaded.'
                );
            if (!usEtfsEventsResponse.ok)
                throw new Error(
                    'calendar-events-us-etfs.json could not be loaded.'
                );

            const [krStocksEvents, krEtfsEvents, usStocksEvents, usEtfsEvents] =
                await Promise.all([
                    krStocksEventsResponse.json(),
                    krEtfsEventsResponse.json(),
                    usStocksEventsResponse.json(),
                    usEtfsEventsResponse.json(),
                ]);

            // 분할된 이벤트 파일들을 하나로 합치고, 동시에 티커 속성 정보 수집
            const flatEvents = [];
            const tickerPropertiesMap = new Map();

            // KR Stocks (currency: KRW, isEtf: false)
            for (const date in krStocksEvents) {
                krStocksEvents[date].forEach((event) => {
                    flatEvents.push({
                        ...event,
                        date,
                        currency: 'KRW',
                        isEtf: false,
                    });
                    // 티커 속성 정보 저장
                    if (!tickerPropertiesMap.has(event.ticker)) {
                        tickerPropertiesMap.set(event.ticker, {
                            currency: 'KRW',
                            isEtf: false,
                            koName: event.koName,
                        });
                    }
                });
            }

            // KR ETFs (currency: KRW, isEtf: true)
            for (const date in krEtfsEvents) {
                krEtfsEvents[date].forEach((event) => {
                    flatEvents.push({
                        ...event,
                        date,
                        currency: 'KRW',
                        isEtf: true,
                    });
                    if (!tickerPropertiesMap.has(event.ticker)) {
                        tickerPropertiesMap.set(event.ticker, {
                            currency: 'KRW',
                            isEtf: true,
                            koName: event.koName,
                        });
                    }
                });
            }

            // US Stocks (currency: USD, isEtf: false)
            for (const date in usStocksEvents) {
                usStocksEvents[date].forEach((event) => {
                    flatEvents.push({
                        ...event,
                        date,
                        currency: 'USD',
                        isEtf: false,
                    });
                    if (!tickerPropertiesMap.has(event.ticker)) {
                        tickerPropertiesMap.set(event.ticker, {
                            currency: 'USD',
                            isEtf: false,
                            koName: event.koName,
                        });
                    }
                });
            }

            // US ETFs (currency: USD, isEtf: true)
            for (const date in usEtfsEvents) {
                usEtfsEvents[date].forEach((event) => {
                    flatEvents.push({
                        ...event,
                        date,
                        currency: 'USD',
                        isEtf: true,
                    });
                    if (!tickerPropertiesMap.has(event.ticker)) {
                        tickerPropertiesMap.set(event.ticker, {
                            currency: 'USD',
                            isEtf: true,
                            koName: event.koName,
                        });
                    }
                });
            }

            allDividendData.value = flatEvents;
            allTickerProperties.value = tickerPropertiesMap;
            isDataLoaded = true;
            resolve();
        } catch (err) {
            console.error('캘린더 데이터 로딩 중 오류 발생:', err);
            error.value = '달력 데이터를 불러오지 못했습니다.';
            reject(err);
        } finally {
            isLoading.value = false;
            isLoadingPromise = null;
        }
    });

    return isLoadingPromise;
};

export function useCalendarData() {
    const { mainFilterTab, subFilterTab, myBookmarks } = useFilterState();

    const buildBookmarkSets = () => {
        const symbolSet = new Set();
        const isinSet = new Set();

        Object.values(myBookmarks.value || {}).forEach((entry) => {
            if (!entry) return;
            if (entry.isin) {
                isinSet.add(entry.isin.toUpperCase());
            }
            if (entry.symbol) {
                const upper = entry.symbol.toUpperCase();
                const base = stripTickerSuffix(upper);
                symbolSet.add(base);
                symbolSet.add(upper);
            }
        });

        return { symbolSet, isinSet };
    };

    const matchesBookmark = (event, symbolSet, isinSet) => {
        const eventTicker = event.ticker
            ? stripTickerSuffix(event.ticker.toUpperCase())
            : null;
        const eventIsin = event.isin ? event.isin.toUpperCase() : null;

        if (eventTicker && symbolSet.has(eventTicker)) return true;
        if (eventIsin && isinSet.has(eventIsin)) return true;
        return false;
    };

    const dividendsByDate = computed(() => {
        const mainTab = mainFilterTab.value;
        const subTab = subFilterTab.value;
        const { symbolSet: bookmarkSymbols, isinSet: bookmarkIsins } =
            buildBookmarkSets();

        let filteredEvents = [...allDividendData.value];

        if (mainTab === '북마크') {
            filteredEvents = filteredEvents.filter((event) =>
                matchesBookmark(event, bookmarkSymbols, bookmarkIsins)
            );
        } else {
            // 북마크가 아닌 탭에서는 북마크된 항목 제외
            filteredEvents = filteredEvents.filter(
                (event) =>
                    !matchesBookmark(event, bookmarkSymbols, bookmarkIsins)
            );

            // [핵심 수정] 국가 필터링 (event에 이미 currency 정보가 있음)
            if (mainTab === '미국') {
                filteredEvents = filteredEvents.filter(
                    (event) => event.currency === 'USD'
                );
            } else if (mainTab === '한국') {
                filteredEvents = filteredEvents.filter(
                    (event) => event.currency === 'KRW'
                );
            }

            // [핵심 수정] 소분류 필터링 (event에 이미 isEtf 정보가 있음)
            if (subTab === 'ETF') {
                filteredEvents = filteredEvents.filter(
                    (event) => event.isEtf === true
                );
            } else if (subTab === '주식') {
                filteredEvents = filteredEvents.filter(
                    (event) => event.isEtf === false
                );
            }
        }

        const grouped = {};
        for (const div of filteredEvents) {
            // koName은 이미 event에 포함되어 있음
            if (!grouped[div.date]) grouped[div.date] = [];
            grouped[div.date].push(div);
        }
        return grouped;
    });

    return {
        dividendsByDate,
        isLoading,
        error,
        ensureDataLoaded: () => {
            if (!isDataLoaded && !isLoadingPromise) {
                loadAllData();
            }
        },
    };
}
