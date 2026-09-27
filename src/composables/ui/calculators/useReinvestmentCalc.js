// src\composables\ui\calculators\useReinvestmentCalc.js
import { ref, computed } from 'vue';
import { useReinvestmentChart } from '@/composables/ui/charts/useReinvestmentChart.js';

export function useReinvestmentCalc(dependencies) {
    const {
        currentAssets,
        dividendStats,
        payoutsPerYear,
        applyTax,
        currentPrice,
        isUSD,
        currency,
        chartTheme,
        userBookmark,
    } = dependencies;

    const targetAsset = ref(
        userBookmark.value?.targetAsset || (isUSD.value ? 100000 : 100000000)
    );
    const annualGrowthRate = ref(0);
    const growthRateForCalc = computed(() => annualGrowthRate.value / 100);

    const { goalAchievementTimes, chartOptions } = useReinvestmentChart({
        currentAssets,
        targetAmount: targetAsset,
        payoutsPerYear,
        dividendStats,
        annualGrowthRateScenario: growthRateForCalc,
        applyTax,
        currentPrice,
        currency,
        theme: chartTheme,
    });

    return {
        targetAsset,
        annualGrowthRate,
        goalAchievementTimes,
        reinvestmentChartOptions: chartOptions,
    };
}
