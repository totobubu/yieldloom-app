// src\composables\ui\calculators\useRecoveryCalc.js
import { ref, computed } from 'vue';
import { useRecoveryChart } from '@/composables/ui/charts/useRecoveryChart.js';

export function useRecoveryCalc(dependencies) {
    const {
        avgPrice,
        quantity,
        dividendStats,
        payoutsPerYear,
        applyTax,
        currentPrice,
        currency,
        chartTheme,
        userBookmark,
        investmentPrincipal,
    } = dependencies;

    const accumulatedDividend = ref(
        userBookmark.value?.accumulatedDividend || 0
    );
    const recoveryCalcMode = ref('amount');

    const recoveryRate = computed({
        get: () =>
            investmentPrincipal.value === 0
                ? 0
                : (accumulatedDividend.value / investmentPrincipal.value) * 100,
        set: (val) => {
            accumulatedDividend.value = investmentPrincipal.value * (val / 100);
        },
    });

    const { recoveryTimes, chartOptions } = useRecoveryChart({
        avgPrice,
        quantity,
        accumulatedDividend,
        dividendStats,
        payoutsPerYear,
        applyTax,
        currentPrice,
        currency,
        theme: chartTheme,
    });

    return {
        accumulatedDividend,
        recoveryCalcMode,
        recoveryRate,
        recoveryTimes,
        recoveryChartOptions: chartOptions,
    };
}
