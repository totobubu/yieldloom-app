// src/composables/portfolio/useSidebar.ts

import {
    ref,
    onMounted,
    computed,
    watch,
    type Ref,
    type ComputedRef,
} from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useFilterState } from '@/composables/portfolio/useFilterState';
import { getDataUrl } from '@/utils/dataUrl';
import { user } from '@/store/auth';
import { db } from '@/firebase';
import { doc, setDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { useToast } from 'primevue/usetoast';
import {
    ensureInstrumentDirectory,
    registerInstruments,
    resolveInstrument,
    resolveInstrumentByIsin,
    resolveInstrumentBySymbol,
    type Instrument,
} from '@/store/instruments';
import {
    getRouteParamsFromSymbol,
    stripTickerSuffix,
} from '@/utils/tickerRoute';
import type { Currency, DividendFrequency } from '@/types/common';

/**
 * 사이드바 티커 정보
 */
export interface SidebarTicker {
    isin: string;
    symbol: string;
    currency: Currency;
    market?: string;
    isEtf: boolean;
    koName?: string;
    longName?: string;
    company?: string;
    logo?: string;
    frequency?: DividendFrequency;
    group?: string;
    groupOrder?: number;
    underlying?: string;
    popularity?: number;
}

/**
 * Nav 데이터 항목
 */
interface NavDataItem {
    symbol: string;
    currency: Currency;
    market?: string;
    isin?: string;
    koName?: string;
    longName?: string;
    company?: string;
    logo?: string;
    frequency?: DividendFrequency;
    group?: string;
    underlying?: string;
    upcoming?: boolean;
}

/**
 * Nav 데이터
 */
interface NavData {
    nav: NavDataItem[];
}

type MarketKey = 'us-stocks' | 'us-etfs';



/**
 * 요일 순서
 */
const DAY_ORDER: Record<string, number> = { 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 };

/**
 * 시장별 파일 매핑
 */
const MARKET_FILE_MAP: Record<MarketKey, string> = {
    'us-stocks': 'sidebar/sidebar-tickers-us-stocks.json',
    'us-etfs': 'sidebar/sidebar-tickers-us-etfs.json',
};

/**
 * Nav 데이터 항목을 티커로 변환
 */
function convertNavItemToTicker(item: NavDataItem): SidebarTicker | null {
    let isEtf = !!(item.company || item.underlying);

    const symbol = item.symbol;
    if (!symbol) return null;
    const normalizedSymbol = symbol.toUpperCase();
    const storeInstrument = resolveInstrumentBySymbol(normalizedSymbol);
    const isin = item.isin || storeInstrument?.isin || null;
    if (!isin) return null;

    const ticker: SidebarTicker = {
        isin,
        symbol: normalizedSymbol,
        currency: item.currency || 'USD',
        market: item.market || storeInstrument?.market,
        isEtf,
    };

    if (item.koName) ticker.koName = item.koName;
    if (item.longName) ticker.longName = item.longName;
    if (item.company) ticker.company = item.company;
    if (item.logo) ticker.logo = item.logo;
    if (item.frequency) ticker.frequency = item.frequency;
    if (item.group) {
        ticker.group = item.group;
        ticker.groupOrder = DAY_ORDER[item.group] ?? 999;
    } else {
        ticker.groupOrder = 999;
    }
    if (item.underlying) ticker.underlying = item.underlying;

    return ticker;
}

/**
 * 티커 검색 매칭
 */
function matchesSearchQuery(item: SidebarTicker, query: string): boolean {
    const symbolLower = (item.symbol || '').toLowerCase();
    const matchIndex = symbolLower.indexOf(query);
    const dotIndex = symbolLower.indexOf('.');
    const matchesSymbol =
        query.includes('.') ||
        (matchIndex !== -1 && (dotIndex === -1 || matchIndex < dotIndex));

    const matchesKoName =
        item.koName && item.koName.toLowerCase().includes(query);
    const matchesLongName =
        (item.longName && item.longName.toLowerCase().includes(query)) || false;

    return matchesSymbol || matchesKoName || matchesLongName;
}

export interface UseSidebarReturn {
    isLoading: Ref<boolean>;
    hasInitialLoadCompleted: Ref<boolean>;
    error: Ref<string | null>;
    selectedTicker: Ref<SidebarTicker | null>;
    globalSearchQuery: Ref<string | null>;
    isSearchActive: ComputedRef<boolean>;
    isSearchLoading: ComputedRef<boolean>;
    mainFilterTab: Ref<string>;
    subFilterTab: Ref<string>;
    myBookmarks: Ref<any>;
    filteredTickers: ComputedRef<SidebarTicker[]>;
    isTickerBookmarked: (ticker: SidebarTicker) => boolean;
    handleStockBookmarkClick: (ticker: SidebarTicker | string) => void;
    onRowSelect: (event: { data: SidebarTicker }) => void;
    handleTickerRequest: (tickerSymbol: string) => Promise<void>;
}

export function useSidebar(): UseSidebarReturn {
    const router = useRouter();
    const route = useRoute();
    const toast = useToast();

    const allTickers = ref<SidebarTicker[]>([]);
    const allTickersForSearch = ref<SidebarTicker[]>([]);
    const isLoadingAllTickers = ref(false);
    const loadedMarkets = ref<Set<MarketKey>>(new Set());
    const isLoading = ref(true);
    const hasInitialLoadCompleted = ref(false);
    const error = ref<string | null>(null);
    const selectedTicker = ref<SidebarTicker | null>(null);

    const {
        globalSearchQuery,
        mainFilterTab,
        subFilterTab,
        myBookmarks,
        toggleMyStock,
    } = useFilterState();

    // 전체 티커 로드 (nav.json에서 - 검색용)
    const loadAllTickersForSearch = async (): Promise<void> => {
        if (allTickersForSearch.value.length > 0 || isLoadingAllTickers.value)
            return;

        isLoadingAllTickers.value = true;

        try {
            await ensureInstrumentDirectory();
            const response = await fetch(getDataUrl('nav.json'));
            if (!response.ok) throw new Error('nav.json could not be loaded.');
            const navData: NavData = await response.json();

            allTickersForSearch.value = (navData.nav || [])
                .filter((item) => !item.upcoming)
                .map(convertNavItemToTicker)
                .filter(
                    (ticker): ticker is SidebarTicker =>
                        ticker !== null && !!ticker.isin
                );

            registerInstruments(allTickersForSearch.value as any[], {
                markInitialized: true,
            });
        } catch (err) {
            console.error('Failed to load all tickers for search:', err);
        } finally {
            isLoadingAllTickers.value = false;
        }
    };

    const ensureAllTickersForSearchLoaded = async (): Promise<void> => {
        if (allTickersForSearch.value.length === 0) {
            await loadAllTickersForSearch();
        }
    };

    const fallbackTickersByMarket = async (
        marketKey: MarketKey
    ): Promise<SidebarTicker[]> => {
        await ensureAllTickersForSearchLoaded();

        const filterMap: Record<MarketKey, (item: SidebarTicker) => boolean> = {
            'us-stocks': (item) => item.currency === 'USD' && !item.isEtf,
            'us-etfs': (item) => item.currency === 'USD' && item.isEtf,
        };

        const filterFn = filterMap[marketKey];
        if (!filterFn) return [];

        return allTickersForSearch.value.filter(
            (item) => item && item.isin && filterFn(item)
        );
    };

    // 북마크 관련 computed
    const bookmarkEntries = computed(() =>
        Object.values(myBookmarks.value || {})
    );

    const bookmarkedIsins = computed(() => {
        const set = new Set<string>();
        bookmarkEntries.value.forEach((entry: any) => {
            if (entry?.isin) set.add(entry.isin);
        });
        return set;
    });

    const bookmarkedSymbols = computed(() => {
        const set = new Set<string>();
        bookmarkEntries.value.forEach((entry: any) => {
            if (entry?.symbol) {
                const normalized = entry.symbol.toUpperCase();
                set.add(normalized);
                set.add(stripTickerSuffix(normalized));
            }
        });
        return set;
    });

    const isInBookmarks = (ticker: SidebarTicker): boolean => {
        if (!ticker) return false;
        if (ticker.isin && bookmarkedIsins.value.has(ticker.isin)) return true;
        if (ticker.symbol) {
            return bookmarkedSymbols.value.has(ticker.symbol.toUpperCase());
        }
        return false;
    };

    // 필터링된 티커 목록
    const filteredTickers = computed((): SidebarTicker[] => {
        const query = globalSearchQuery.value?.toLowerCase().trim();
        const mainTab = mainFilterTab.value;
        const subTab = subFilterTab.value;

        let baseList: SidebarTicker[] = [];

        // 1. 검색어가 있는 경우: 전체 티커에서 검색
        if (query) {
            if (allTickersForSearch.value.length === 0) {
                return [];
            }

            return allTickersForSearch.value.filter((item) =>
                matchesSearchQuery(item, query)
            );
        }

        // 2. 검색어가 없는 경우: 현재 탭에 따라 기본 목록 결정
        if (mainTab === '북마크') {
            const matched = allTickers.value.filter((item) =>
                isInBookmarks(item)
            );
            const missing: SidebarTicker[] = [];
            bookmarkedIsins.value.forEach((isin) => {
                const exists = matched.find((item) => item.isin === isin);
                if (!exists) {
                    const bookmark = myBookmarks.value[isin];
                    if (bookmark) {
                        missing.push({
                            isin,
                            symbol: bookmark.symbol || '',
                            currency: bookmark.currency,
                            market: bookmark.market,
                            isEtf: bookmark.isEtf ?? false,
                            koName: undefined,
                            longName: undefined,
                            popularity: 0,
                        });
                    }
                }
            });
            return [...matched, ...missing];
        } else if (mainTab === '미국') {
            baseList = allTickers.value.filter(
                (item) => item.currency === 'USD'
            );
        }

        // 3. 서브 탭 필터링
        let list: SidebarTicker[] = [];
        if (subTab === 'ETF') {
            list = baseList.filter((item) => item.company || item.underlying);
        } else {
            list = baseList.filter((item) => !item.company && !item.underlying);
        }

        list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
        return list.slice(0, 50);
    });

    const isSearchActive = computed(
        () => !!(globalSearchQuery.value && globalSearchQuery.value.trim())
    );

    const isSearchLoading = computed(
        () => isSearchActive.value && isLoadingAllTickers.value
    );

    // 시장별 데이터 lazy loading
    const loadMarketData = async (marketKey: MarketKey): Promise<void> => {
        if (loadedMarkets.value.has(marketKey)) return;

        const fileName = MARKET_FILE_MAP[marketKey];
        if (!fileName) return;

        try {
            const response = await fetch(getDataUrl(fileName));
            if (!response.ok)
                throw new Error(`${fileName} could not be loaded.`);

            const data = await response.json();

            let marketTickers: SidebarTicker[] = Array.isArray(data)
                ? data
                : [];
            marketTickers = marketTickers
                .map((item: any) => {
                    if (!item) return null;
                    const normalizedSymbol = item.symbol
                        ? item.symbol.toUpperCase()
                        : null;
                    const instrument =
                        (item.isin && resolveInstrumentByIsin(item.isin)) ||
                        (normalizedSymbol &&
                            resolveInstrumentBySymbol(normalizedSymbol)) ||
                        null;
                    const isin = item.isin || instrument?.isin || null;
                    if (!isin) return null;
                    return {
                        ...item,
                        symbol: normalizedSymbol || instrument?.symbol,
                        isin,
                        market: item.market || instrument?.market || null,
                        currency: item.currency || instrument?.currency || null,
                    } as SidebarTicker;
                })
                .filter(
                    (item): item is SidebarTicker =>
                        item !== null && !!item.isin
                );

            if (marketTickers.length === 0) {
                marketTickers = await fallbackTickersByMarket(marketKey);
            }

            if (marketTickers.length > 0) {
                const existingIsins = new Set(
                    allTickers.value.map((item) => item.isin)
                );
                const deduped = marketTickers.filter(
                    (item) => item.isin && !existingIsins.has(item.isin)
                );
                allTickers.value = [...allTickers.value, ...deduped];
                registerInstruments(deduped as any[]);
            } else {
                console.warn(
                    `[Sidebar] No tickers available for market '${marketKey}'.`
                );
            }

            loadedMarkets.value.add(marketKey);
        } catch (err) {
            console.error(`Failed to load ${fileName}:`, err);
            const fallback = await fallbackTickersByMarket(marketKey);
            if (fallback.length > 0) {
                const existingIsins = new Set(
                    allTickers.value.map((item) => item.isin)
                );
                const deduped = fallback.filter(
                    (item) => item.isin && !existingIsins.has(item.isin)
                );
                allTickers.value = [...allTickers.value, ...deduped];
                registerInstruments(deduped as any[]);
                loadedMarkets.value.add(marketKey);
            } else {
                throw err;
            }
        }
    };

    const loadSidebarData = async (): Promise<void> => {
        isLoading.value = true;
        error.value = null;
        try {
            const mainTab = mainFilterTab.value;
            const subTab = subFilterTab.value;

            const marketsToLoad: MarketKey[] = [];
            if (mainTab === '미국') {
                marketsToLoad.push(subTab === 'ETF' ? 'us-etfs' : 'us-stocks');
            } else if (mainTab === '북마크') {
                marketsToLoad.push('us-stocks', 'us-etfs');
            }

            await Promise.all(marketsToLoad.map((m) => loadMarketData(m)));

            const currentTickerSymbol = route.params.ticker
                ?.toString()
                .toUpperCase()
                .replace(/-/g, '.');
            if (currentTickerSymbol) {
                selectedTicker.value =
                    allTickers.value.find(
                        (t) => t.symbol === currentTickerSymbol
                    ) || null;
            }
        } catch (err) {
            error.value = '사이드바 데이터를 불러오는 데 실패했습니다.';
            console.error(err);
        } finally {
            isLoading.value = false;
            hasInitialLoadCompleted.value = true;
        }
    };

    // 탭 변경 시 필요한 데이터를 추가로 로드
    const loadAdditionalData = async (): Promise<void> => {
        const mainTab = mainFilterTab.value;
        const subTab = subFilterTab.value;

        const marketsToLoad: MarketKey[] = [];
        if (mainTab === '미국') {
            const market: MarketKey =
                subTab === 'ETF' ? 'us-etfs' : 'us-stocks';
            if (!loadedMarkets.value.has(market)) {
                marketsToLoad.push(market);
            }
        } else if (mainTab === '북마크') {
            const bookmarkMarkets: MarketKey[] = ['us-stocks', 'us-etfs'];
            bookmarkMarkets.forEach((market) => {
                if (!loadedMarkets.value.has(market)) {
                    marketsToLoad.push(market);
                }
            });
        }

        if (marketsToLoad.length > 0) {
            isLoading.value = true;
            try {
                await Promise.all(marketsToLoad.map((m) => loadMarketData(m)));
            } catch (err) {
                console.error('Failed to load additional data:', err);
            } finally {
                isLoading.value = false;
            }
        }
    };

    const handleTickerRequest = async (tickerSymbol: string): Promise<void> => {
        if (!user.value) {
            toast.add({
                severity: 'warn',
                summary: '로그인 필요',
                detail: '종목 추가 요청은 로그인 후 가능합니다.',
                life: 3000,
            });
            return;
        }
        if (!tickerSymbol || tickerSymbol.trim().length < 1) return;

        const symbol = tickerSymbol.trim().toUpperCase();
        const requestRef = doc(db, 'tickerRequests', symbol);

        const docSnap = await getDoc(requestRef);
        if (docSnap.exists()) {
            toast.add({
                severity: 'info',
                summary: '알림',
                detail: `'${symbol}'은(는) 이미 추가 요청된 종목입니다.`,
                life: 3000,
            });
            return;
        }

        try {
            await setDoc(requestRef, {
                requestedBy: (user.value as any).uid,
                requestedAt: serverTimestamp(),
                status: 'pending',
            });
            toast.add({
                severity: 'success',
                summary: '요청 완료',
                detail: `'${symbol}' 추가 요청이 정상적으로 접수되었습니다.`,
                life: 3000,
            });
        } catch (error) {
            console.error('Error adding ticker request: ', error);
            toast.add({
                severity: 'error',
                summary: '요청 실패',
                detail: '요청 처리 중 오류가 발생했습니다.',
                life: 3000,
            });
        }
    };

    const handleStockBookmarkClick = (ticker: SidebarTicker | string): void => {
        if (!ticker) return;

        const instrument =
            typeof ticker === 'string'
                ? resolveInstrumentBySymbol(ticker)
                : resolveInstrument({
                      symbol: ticker.symbol,
                      isin: ticker.isin,
                      market: ticker.market,
                      currency: ticker.currency,
                  } as Instrument) || resolveInstrumentBySymbol(ticker.symbol);

        const payload =
            instrument ||
            (typeof ticker === 'object' && ticker.isin
                ? {
                      ...ticker,
                      symbol: ticker.symbol?.toUpperCase() || null,
                      isin: ticker.isin?.toUpperCase(),
                  }
                : null);

        if (!payload) return;

        if (!user.value) {
            toast.add({
                severity: 'warn',
                summary: '로그인 필요',
                detail: '북마크를 사용하려면 로그인해 주세요.',
                life: 2500,
            });
            router.push('/login');
            return;
        }

        const result = toggleMyStock(payload as any);
        const displaySymbol =
            (payload as any).symbol ||
            (payload as any).koName ||
            (payload as any).isin ||
            '알 수 없음';

        if (result === 'added') {
            toast.add({
                severity: 'success',
                summary: '북마크 추가',
                detail: `'${displaySymbol}'을(를) 북마크에 추가했습니다.`,
                life: 2000,
            });
        } else if (result === 'removed') {
            toast.add({
                severity: 'info',
                summary: '북마크 해제',
                detail: `'${displaySymbol}' 북마크를 해제했습니다.`,
                life: 2000,
            });
        }
    };

    const onRowSelect = (event: { data: SidebarTicker }): void => {
        const ticker = event.data?.symbol;
        if (!ticker) return;
        const params = getRouteParamsFromSymbol(ticker, event.data.market);
        if (params)
            router.push({ name: 'stock-detail', params: params as any });
    };

    onMounted(loadSidebarData);

    watch(globalSearchQuery, (newQuery) => {
        if (newQuery && newQuery.trim()) {
            loadAllTickersForSearch();
        }
    });

    watch(mainFilterTab, () => {
        globalSearchQuery.value = null;
        loadAdditionalData();
    });

    watch(subFilterTab, () => {
        globalSearchQuery.value = null;
        loadAdditionalData();
    });

    const isTickerBookmarked = (ticker: SidebarTicker): boolean =>
        isInBookmarks(ticker);

    return {
        isLoading,
        hasInitialLoadCompleted,
        error,
        selectedTicker,
        globalSearchQuery,
        isSearchActive,
        isSearchLoading,
        mainFilterTab,
        subFilterTab,
        myBookmarks,
        filteredTickers,
        isTickerBookmarked,
        handleStockBookmarkClick,
        onRowSelect,
        handleTickerRequest,
    };
}
