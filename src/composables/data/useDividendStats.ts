// src/composables/data/useDividendStats.ts

import { computed, type Ref, type ComputedRef } from 'vue';
import { parseYYMMDD } from '@/utils/date';
import { parseDividendAmount } from '@/utils/dividendParser.js';
import type { DividendFrequency } from '@/types/common';

/**
 * 배당 내역 항목
 */
export interface DividendHistoryItem {
    배당락: string;
    배당금: string | number;
    [key: string]: any;
}

/**
 * 티커 정보
 */
export interface TickerInfo {
    frequency: DividendFrequency;
    [key: string]: any;
}

/**
 * 배당 통계
 */
export interface DividendStats {
    min: number;
    max: number;
    avg: number;
}

/**
 * 배당 통계 반환 타입
 */
export interface UseDividendStatsReturn {
    dividendStats: ComputedRef<DividendStats>;
    payoutsPerYear: ComputedRef<number>;
}

/**
 * 배당 내역을 기반으로 배당 통계(min, max, avg)와 연간 배당 횟수를 계산하는 컴포저블
 */
export function useDividendStats(
    dividendHistory: Ref<DividendHistoryItem[]>,
    tickerInfo: Ref<TickerInfo | null>,
    periodRef: Ref<string>
): UseDividendStatsReturn {
    const payoutsPerYear = computed(() => {
        if (!dividendHistory.value || dividendHistory.value.length === 0)
            return 0;

        const freq = tickerInfo.value?.frequency;

        const getWeeklyPayouts = (
            freqValue: DividendFrequency | undefined
        ): number | null => {
            if (!freqValue || typeof freqValue !== 'string') return null;
            const normalized = freqValue.replace(/\s+/g, '');
            if (normalized === '매주') return 52;
            const weeklyMatch = normalized.match(/^주(\d+)회$/);
            if (weeklyMatch) {
                const occurrences = Number(weeklyMatch[1]);
                if (!Number.isNaN(occurrences) && occurrences > 0) {
                    return 52 * occurrences;
                }
            }
            if (normalized.includes('주')) return 52;
            return null;
        };

        const weeklyPayouts = getWeeklyPayouts(freq);
        if (weeklyPayouts) return weeklyPayouts;
        if (freq === '매월') return 12;

        // 분기/연배당의 경우 과거 1년간 실제 배당 횟수 계산
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        if (!dividendHistory.value) return 0;

        const pastYearDividends = dividendHistory.value.filter((d) => {
            const date = parseYYMMDD(d['배당락']);
            return date ? date > oneYearAgo : false;
        });

        if (pastYearDividends.length > 0) return pastYearDividends.length;

        // fallback: frequency 정보 사용
        if (freq === '분기') return 4;
        return 12;
    });

    const dividendStats = computed((): DividendStats => {
        const history = dividendHistory.value;
        if (!history || history.length === 0) {
            return { min: 0, max: 0, avg: 0 };
        }

        const period = periodRef.value;
        let filteredHistory: DividendHistoryItem[] = [];

        // 1. 기간 타입(횟수 vs 시간)을 감지하여 분기 처리
        if (!isNaN(parseInt(period))) {
            // '5', '10', '20' 과 같은 숫자 형식일 경우
            const count = parseInt(period, 10);
            // dividendHistory는 최신순으로 정렬되어 있으므로 slice로 간단히 처리
            filteredHistory = history.slice(0, count);
        } else if (period === 'ALL') {
            // 'ALL'일 경우 전체 기록 사용
            filteredHistory = history;
        } else {
            // '3M', '6M', '1Y' 와 같은 기존 시간 형식일 경우 (하위 호환성)
            const now = new Date();
            let cutoffDate = new Date();
            const rangeValue = parseInt(period);
            const rangeUnit = period.slice(-1);

            if (rangeUnit === 'M') {
                cutoffDate.setMonth(now.getMonth() - rangeValue);
            } else if (rangeUnit === 'Y') {
                cutoffDate.setFullYear(now.getFullYear() - rangeValue);
            }

            filteredHistory = history.filter((item) => {
                const date = parseYYMMDD(item['배당락']);
                return date ? date >= cutoffDate : false;
            });
        }

        // 2. 필터링된 기록으로 통계 계산 (최종 계산값 사용)
        const validAmounts = filteredHistory
            .map((h) => {
                const parsed = parseDividendAmount(h['배당금']);
                return parsed.finalAmount;
            })
            .filter((a) => !isNaN(a) && a > 0);

        if (validAmounts.length === 0) {
            return { min: 0, max: 0, avg: 0 };
        }

        return {
            min: Math.min(...validAmounts),
            max: Math.max(...validAmounts),
            avg: validAmounts.reduce((s, a) => s + a, 0) / validAmounts.length,
        };
    });

    return { dividendStats, payoutsPerYear };
}
