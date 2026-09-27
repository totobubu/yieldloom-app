// src/composables/data/useStockMapping.ts
/**
 * 증권사별 종목명 매핑 관리
 *
 * Firestore 구조:
 * stockMappings/{ISIN}/
 *   - koName: string (한국어 종목명)
 *   - isin: string (ISIN 코드)
 *   - symbol: string (시스템 티커, 예: AAPL)
 *   - market: string (시장, 예: NASDAQ, NYSE)
 *   - longName: string (긴 종목명, optional)
 *   - enName: string (영문 종목명, optional)
 *   - yfSymbol: string (Yahoo Finance 티커, optional)
 *   - ipoDate: string (상장일, optional)
 *   - currency: string (통화, 예: USD, KRW, optional)
 *   - company: string (회사명, optional)
 */

import {
    collection,
    doc,
    getDoc,
    setDoc,
    deleteDoc,
    query,
    where,
    getDocs,
} from 'firebase/firestore';
import { db } from '@/firebase';
import axios from 'axios';

/**
 * 주식 매핑 데이터
 */
export interface StockMappingData {
    koName: string;
    isin: string;
    symbol: string;
    market?: string | null;
    longName?: string | null;
    enName?: string | null;
    yfSymbol?: string | null;
    ipoDate?: string | null;
    currency?: string | null;
    company?: string | null;
    brokerage?: string;
}

/**
 * 티커 검색 결과
 */
export interface SymbolSearchResult {
    symbol: string;
    name: string;
    market?: string;
    [key: string]: any;
}

/**
 * 매핑 정보 조회 (ISIN 기반)
 */
export const getStockMapping = async (
    isin: string
): Promise<StockMappingData | null> => {
    try {
        const mappingRef = doc(db, 'stockMappings', isin);
        const mappingDoc = await getDoc(mappingRef);

        if (mappingDoc.exists()) {
            return mappingDoc.data() as StockMappingData;
        }
        return null;
    } catch (error) {
        console.error('매핑 정보 조회 실패:', error);
        return null;
    }
};

/**
 * 매핑 정보 저장 (ISIN 기반)
 */
export const saveStockMapping = async (
    isin: string,
    mappingData: Partial<StockMappingData>,
    _userId?: string
): Promise<boolean> => {
    try {
        if (!isin) {
            throw new Error('ISIN is required');
        }

        const mappingRef = doc(db, 'stockMappings', isin);

        // 기존 매핑 확인
        const existingDoc = await getDoc(mappingRef);

        const data: Partial<StockMappingData> = {
            koName: mappingData.koName,
            isin: isin,
            symbol: mappingData.symbol,
            market: mappingData.market || null,
            longName: mappingData.longName || null,
            enName: mappingData.enName || null,
            yfSymbol: mappingData.yfSymbol || mappingData.symbol || null,
            ipoDate: mappingData.ipoDate || null,
            currency: mappingData.currency || null,
            company: mappingData.company || null,
        };

        // Remove null and undefined values
        Object.keys(data).forEach((key) => {
            const value = data[key as keyof StockMappingData];
            if (value === null || value === undefined) {
                delete data[key as keyof StockMappingData];
            }
        });

        if (existingDoc.exists()) {
            // 업데이트
            await setDoc(mappingRef, data, { merge: true });
        } else {
            // 신규 생성
            await setDoc(mappingRef, data);
        }

        console.log(
            `매핑 저장 성공: ${mappingData.koName} -> ${mappingData.symbol} (ISIN: ${isin})`
        );
        return true;
    } catch (error) {
        console.error('매핑 정보 저장 실패:', error);
        throw error;
    }
};

/**
 * 매핑 정보 삭제 (ISIN 기반)
 */
export const deleteStockMapping = async (isin: string): Promise<boolean> => {
    try {
        const mappingRef = doc(db, 'stockMappings', isin);
        await deleteDoc(mappingRef);
        return true;
    } catch (error) {
        console.error('매핑 정보 삭제 실패:', error);
        throw error;
    }
};

/**
 * 증권사별 모든 매핑 조회
 */
export const getAllMappings = async (
    brokerage: string
): Promise<(StockMappingData & { id: string })[]> => {
    try {
        const mappingsRef = collection(db, 'stockMappings');
        const q = query(mappingsRef, where('brokerage', '==', brokerage));
        const snapshot = await getDocs(q);

        const mappings: (StockMappingData & { id: string })[] = [];
        snapshot.forEach((doc) => {
            mappings.push({
                id: doc.id,
                ...(doc.data() as StockMappingData),
            });
        });

        return mappings;
    } catch (error) {
        console.error('매핑 목록 조회 실패:', error);
        return [];
    }
};

/**
 * 티커 검색 (우리 시스템)
 */
export const searchSymbol = async (
    searchQuery: string
): Promise<SymbolSearchResult[]> => {
    try {
        const response = await axios.get<SymbolSearchResult[]>(
            '/api/searchSymbol.js',
            {
                params: {
                    query: searchQuery,
                },
            }
        );
        return response.data || [];
    } catch (error) {
        console.error('티커 검색 실패:', error);
        return [];
    }
};

/**
 * 여러 ISIN을 한 번에 조회 (배치)
 */
export const batchGetStockMappings = async (
    isins: string[]
): Promise<Map<string, StockMappingData>> => {
    const mappings = new Map<string, StockMappingData>();

    try {
        // Firestore in 쿼리는 최대 10개까지만 가능하므로 청크로 나눔
        const chunkSize = 10;
        for (let i = 0; i < isins.length; i += chunkSize) {
            const chunk = isins.slice(i, i + chunkSize);

            const promises = chunk.map((isin) => {
                const mappingRef = doc(db, 'stockMappings', isin);
                return getDoc(mappingRef);
            });

            const docs = await Promise.all(promises);
            docs.forEach((doc, index) => {
                if (doc.exists()) {
                    mappings.set(chunk[index], doc.data() as StockMappingData);
                }
            });
        }

        return mappings;
    } catch (error) {
        console.error('배치 매핑 조회 실패:', error);
        return mappings;
    }
};
