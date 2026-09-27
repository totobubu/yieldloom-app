// src/composables/portfolio/useFilterState.ts
import { ref, watch, type Ref } from 'vue';
import { db } from '@/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
    ensureInstrumentDirectory,
    resolveInstrumentByIsin,
    resolveInstrumentBySymbol,
    type Instrument,
} from '@/store/instruments';
import type { Bookmark, BookmarksMap } from '@/types/asset';

const globalSearchQuery = ref<string | null>(null);

// localStorage에서 필터 상태 복원
const savedMainFilterTab = localStorage.getItem('mainFilterTab');
const savedSubFilterTab = localStorage.getItem('subFilterTab');

let initialMainFilterTab = savedMainFilterTab || '미국';
if (initialMainFilterTab === '한국') {
    initialMainFilterTab = '미국';
}

const mainFilterTab = ref<string>(initialMainFilterTab);
const subFilterTab = ref<string>(savedSubFilterTab || 'ETF');
const myBookmarks = ref<BookmarksMap>({});

const isProbableIsin = (value: string | null | undefined): boolean => {
    if (typeof value !== 'string') return false;
    const token = value.trim().toUpperCase();
    return token.length === 12 && /^[A-Z]{2}[A-Z0-9]{10}$/.test(token);
};

const resolveCandidateToIsin = (
    candidate: string | null | undefined
): string | null => {
    if (!candidate) return null;
    if (typeof candidate === 'string') {
        const normalized = candidate.trim().toUpperCase();
        if (isProbableIsin(normalized)) return normalized;
        const instrument = resolveInstrumentBySymbol(normalized);
        return instrument?.isin || null;
    }
    return null;
};

const createBookmarkPayload = (
    instrument: Partial<Instrument> = {},
    overrides: Partial<Bookmark> = {}
): Bookmark => {
    const symbol = instrument.symbol || overrides.symbol;
    const isin =
        (overrides.isin && overrides.isin.toUpperCase()) ||
        (instrument.isin && instrument.isin.toUpperCase()) ||
        null;
    return {
        symbol: symbol ? symbol.toUpperCase() : ('' as any),
        isin: isin as string,
        market: (overrides.market ?? instrument.market ?? null) as any,
        currency: (overrides.currency ?? instrument.currency ?? 'USD') as any,
        avgPrice: overrides.avgPrice ?? 0,
        quantity: overrides.quantity ?? 0,
        accumulatedDividend: overrides.accumulatedDividend ?? 0,
        targetAsset: overrides.targetAsset ?? 0,
    };
};

const serializeBookmarks = (
    bookmarks: BookmarksMap | null | undefined
): BookmarksMap => {
    const serialized: BookmarksMap = {};
    Object.values(bookmarks || {}).forEach((value) => {
        if (!value) return;
        const payload = createBookmarkPayload(value, value);
        const { symbol, isin } = payload;
        if (!symbol || !isin) return;
        serialized[symbol] = {
            ...payload,
            symbol,
            isin,
        };
    });
    return serialized;
};

// 필터 상태를 localStorage에 저장
watch(mainFilterTab, (newValue) => {
    localStorage.setItem('mainFilterTab', newValue);
});

watch(subFilterTab, (newValue) => {
    localStorage.setItem('subFilterTab', newValue);
});

export const saveMyBookmarksToFirestore = async (
    userId: string,
    bookmarks: BookmarksMap
): Promise<void> => {
    if (!userId) return;
    try {
        const userDocRef = doc(db, 'userBookmarks', userId);
        await setDoc(userDocRef, { bookmarks: serializeBookmarks(bookmarks) });
    } catch (error) {
        console.error('Firestore에 북마크 저장 실패:', error);
    }
};

const normalizeBookmarks = (rawBookmarks: BookmarksMap = {}): BookmarksMap => {
    const normalized: BookmarksMap = {};
    Object.entries(rawBookmarks).forEach(([key, value]) => {
        const isin =
            (value?.isin && value.isin.toUpperCase()) ||
            resolveCandidateToIsin(key);
        if (!isin) return;

        const instrument =
            resolveInstrumentByIsin(isin) ||
            resolveInstrumentBySymbol(value?.symbol || key);

        const payload = createBookmarkPayload(instrument || {}, {
            ...value,
            isin,
        });

        normalized[isin] = payload;
    });
    return normalized;
};

const isBookmarksLoading = ref(false);

export const loadMyBookmarksFromFirestore = async (
    userId: string
): Promise<BookmarksMap> => {
    if (!userId) return {};
    isBookmarksLoading.value = true;
    try {
        await ensureInstrumentDirectory();
        const userDocRef = doc(db, 'userBookmarks', userId);
        const docSnap = await getDoc(userDocRef);
        if (!docSnap.exists()) return {};
        const rawBookmarks = docSnap.data().bookmarks || {};
        return normalizeBookmarks(rawBookmarks);
    } catch (error) {
        console.error('Firestore에서 북마크 로드 실패:', error);
        return {};
    } finally {
        isBookmarksLoading.value = false;
    }
};

const toggleMyStock = (
    ticker: string | Partial<Bookmark> | null
): 'added' | 'removed' | null => {
    if (!ticker) return null;

    const candidate =
        typeof ticker === 'string' ? { symbol: ticker } : { ...ticker };

    const normalizedSymbol = candidate.symbol
        ? candidate.symbol.toUpperCase()
        : null;

    const instrument =
        (candidate.isin && resolveInstrumentByIsin(candidate.isin)) ||
        (normalizedSymbol && resolveInstrumentBySymbol(normalizedSymbol)) ||
        (candidate.isin
            ? { ...candidate, isin: candidate.isin.toUpperCase() }
            : null);

    const isin =
        (candidate.isin && candidate.isin.toUpperCase()) ||
        instrument?.isin ||
        resolveCandidateToIsin(normalizedSymbol);

    if (!isin) return null;

    if (myBookmarks.value[isin]) {
        delete myBookmarks.value[isin];
        return 'removed';
    }

    const payload = createBookmarkPayload(instrument || {}, {
        ...candidate,
        symbol: normalizedSymbol as any,
        isin,
    });
    myBookmarks.value[isin] = payload;
    return 'added';
};

const updateBookmarkDetails = (
    identifier: string,
    details: Partial<Bookmark>
): void => {
    if (!identifier || !details) return;

    const identifierIsin = isProbableIsin(identifier)
        ? identifier.toUpperCase()
        : null;

    const instrument =
        (identifierIsin && resolveInstrumentByIsin(identifierIsin)) ||
        resolveInstrumentBySymbol(identifier);

    const isin =
        identifierIsin ||
        instrument?.isin ||
        resolveCandidateToIsin(identifier) ||
        Object.keys(myBookmarks.value).find((key) => {
            const entry = myBookmarks.value[key];
            return entry?.symbol === identifier.toUpperCase();
        });

    if (!isin) return;

    const existing =
        myBookmarks.value[isin] ||
        createBookmarkPayload(instrument || {}, { isin });

    myBookmarks.value[isin] = {
        ...existing,
        ...details,
        isin,
        symbol:
            existing.symbol || instrument?.symbol || identifier.toUpperCase(),
    };
};

export interface UseFilterStateReturn {
    globalSearchQuery: Ref<string | null>;
    mainFilterTab: Ref<string>;
    subFilterTab: Ref<string>;
    myBookmarks: Ref<BookmarksMap>;
    isBookmarksLoading: Ref<boolean>;
    toggleMyStock: (
        ticker: string | Partial<Bookmark> | null
    ) => 'added' | 'removed' | null;
    updateBookmarkDetails: (
        identifier: string,
        details: Partial<Bookmark>
    ) => void;
}

export function useFilterState(): UseFilterStateReturn {
    return {
        globalSearchQuery,
        mainFilterTab,
        subFilterTab,
        myBookmarks,
        isBookmarksLoading,
        toggleMyStock,
        updateBookmarkDetails,
    };
}
