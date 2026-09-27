// src/composables/shared/useStockCharts.ts

import { computed, type Ref, type ComputedRef } from 'vue';
import {
    useWeeklyChart,
    useQuarterlyChart,
    useMonthlyChart,
    useAnnualChart,
} from '@/composables/ui/charts';
import { monthColors } from '@/utils/chartUtils.js';
import type { DividendFrequency, Currency } from '@/types/common';
import type { DeviceType } from './useBreakpoint';

/**
 * 티커 정보
 */
export interface TickerInfo {
    group?: string;
    currency: Currency;
    frequency: DividendFrequency;
}

/**
 * 표시 데이터 (배당 데이터)
 */
export interface DisplayDataItem {
    date: string;
    amount: number;
    [key: string]: any;
}

/**
 * 테마 옵션
 */
interface ThemeOptions {
    textColor: string;
    textColorSecondary: string;
    surfaceBorder: string;
}

/**
 * 차트 옵션 입력
 */
export interface UseStockChartsOptions {
    tickerInfo: Ref<TickerInfo | null>;
    displayData: Ref<DisplayDataItem[]>;
    currentView: Ref<string>;
    deviceType: Ref<DeviceType>;
}

/**
 * 차트 옵션 반환
 */
export interface UseStockChartsReturn {
    chartOptions: ComputedRef<any>;
    chartContainerHeight: ComputedRef<string | undefined>;
}

export function useStockCharts(
    options: UseStockChartsOptions
): UseStockChartsReturn {
    const { tickerInfo, displayData, currentView, deviceType } = options;

    const documentStyle = computed(() =>
        getComputedStyle(document.documentElement)
    );

    const chartComposableResult = computed(() => {
        if (
            !tickerInfo.value ||
            !displayData.value ||
            displayData.value.length === 0
        ) {
            return { chartOptions: undefined, chartContainerHeight: undefined };
        }

        const themeOptions: ThemeOptions = {
            textColor: documentStyle.value.getPropertyValue('--p-text-color'),
            textColorSecondary: documentStyle.value.getPropertyValue(
                '--p-text-muted-color'
            ),
            surfaceBorder: documentStyle.value.getPropertyValue(
                '--p-content-border-color'
            ),
        };

        const sharedOptions = {
            data: displayData.value,
            deviceType: deviceType.value,
            group: tickerInfo.value?.group,
            theme: themeOptions,
            currency: tickerInfo.value.currency,
        };

        // '주가' 뷰일 때 빈 객체를 반환하여 오류를 막습니다.
        if (currentView.value === '주가') {
            return { chartOptions: undefined, chartContainerHeight: undefined };
        }

        if (currentView.value === '배당') {
            const freq = tickerInfo.value.frequency;
            if (freq === '매년') return useAnnualChart(sharedOptions);
            if (typeof freq === 'string' && freq.includes('주'))
                return useWeeklyChart(sharedOptions);
            if (freq === '분기')
                return useQuarterlyChart({
                    ...sharedOptions,
                    aggregation: 'quarter',
                });
            if (freq === '매월' && displayData.value.length > 59) {
                return useQuarterlyChart({
                    ...sharedOptions,
                    aggregation: 'month',
                    colorMap: monthColors,
                } as any);
            }
            if (freq === '매월') return useMonthlyChart(sharedOptions);
        }
        return { chartOptions: undefined, chartContainerHeight: undefined };
    });

    const chartOptions = computed(
        () => chartComposableResult.value.chartOptions
    );
    const chartContainerHeight = computed(
        () => chartComposableResult.value.chartContainerHeight
    );

    return { chartOptions, chartContainerHeight };
}
