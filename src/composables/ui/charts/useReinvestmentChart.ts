import { computed, type Ref } from 'vue';
import { formatMonthsToYears } from '@/utils/date';

export interface ChartTheme {
    textColor: string;
    textColorSecondary: string;
    surfaceBorder: string;
}

export interface ReinvestmentChartOptions {
    currentAssets: Ref<number>;
    targetAmount: Ref<number>;
    payoutsPerYear: Ref<number>;
    dividendStats: Ref<any>;
    allAnnualGrowthRateOptions: Ref<any[]>;
    applyTax: Ref<boolean>;
    currentPrice: Ref<number>;
    theme: Ref<ChartTheme>;
    currency?: 'USD' | 'KRW';
}

export function useReinvestmentChart(options: ReinvestmentChartOptions) {
    const {
        currentAssets,
        targetAmount,
        payoutsPerYear,
        dividendStats,
        allAnnualGrowthRateOptions, // [수정 1] 새로운 props
        applyTax,
        currentPrice,
        theme,
    } = options;

    const { textColor, textColorSecondary, surfaceBorder } = theme.value;

    // [수정 2] 모든 성장률 시나리오에 대한 계산 로직
    const allGoalAchievementTimes = computed(() => {
        if (
            !allAnnualGrowthRateOptions?.value ||
            !dividendStats.value ||
            !payoutsPerYear.value ||
            currentPrice.value <= 0
        ) {
            return [];
        }

        const calculateMonths = (dividendPerShare: number, growthRate: number) => {
            if (targetAmount.value <= currentAssets.value) return 0;
            if (currentAssets.value <= 0 || dividendPerShare <= 0)
                return Infinity;

            const finalDividendPerShare = applyTax.value
                ? dividendPerShare * 0.85
                : dividendPerShare;
            if (finalDividendPerShare <= 0) return Infinity;

            let assetValue = currentAssets.value;
            let months = 0;
            const monthlyGrowthRate = (1 + growthRate) ** (1 / 12) - 1;
            const monthlyPayouts = payoutsPerYear.value / 12;

            while (assetValue < targetAmount.value) {
                if (months > 1200) return Infinity; // 100년 초과 시 무한으로 처리
                assetValue *= 1 + monthlyGrowthRate;
                const currentShares = assetValue / currentPrice.value;
                assetValue +=
                    currentShares * finalDividendPerShare * monthlyPayouts;
                months++;
            }
            return months;
        };

        return allAnnualGrowthRateOptions.value.map((option) => {
            const growthRate = option.value / 100;
            return {
                rateLabel: option.label,
                hope: calculateMonths(dividendStats.value.max, growthRate),
                avg: calculateMonths(dividendStats.value.avg, growthRate),
                despair: calculateMonths(dividendStats.value.min, growthRate),
            };
        });
    });

    // [수정 3] ECharts 옵션을 막대 차트로 재구성
    const chartOptions = computed(() => {
        if (
            !allGoalAchievementTimes.value ||
            allGoalAchievementTimes.value.length === 0
        ) {
            return {
                title: {
                    text: '계산 불가',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: textColorSecondary },
                },
            };
        }

        const finiteTimes = allGoalAchievementTimes.value
            .flatMap((item) => [item.hope, item.avg, item.despair])
            .filter((t) => isFinite(t) && t > 0);
        if (
            finiteTimes.length === 0 &&
            targetAmount.value <= currentAssets.value
        ) {
            return {
                title: {
                    text: '이미 목표를 달성했습니다.',
                    left: 'center',
                    top: 'center',
                    textStyle: { color: textColor, fontSize: 20 },
                },
            };
        }

        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: (params: any) => {
                    let tooltipHtml = `주가 성장률: <strong>${params[0].name}</strong><br/>`;
                    params.forEach((p: any) => {
                        const duration =
                            formatMonthsToYears(p.value)?.duration ||
                            '계산 불가';
                        tooltipHtml += `${p.marker} ${p.seriesName}: <strong>${duration}</strong><br/>`;
                    });
                    return tooltipHtml;
                },
            },
            legend: {
                data: ['희망', '평균', '절망'],
                textStyle: { color: textColorSecondary },
                bottom: 0,
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '10%',
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: allGoalAchievementTimes.value.map(
                    (item) => item.rateLabel
                ),
                axisLabel: { color: textColorSecondary },
            },
            yAxis: {
                type: 'value',
                axisLabel: {
                    color: textColorSecondary,
                    formatter: (value: any) => `${value}개월`,
                },
                splitLine: {
                    lineStyle: { color: surfaceBorder, type: 'dashed' },
                },
                axisBreak: {
                    // Axis Break 기능 활성화
                    enabled: true,
                    interval: 0,
                    style: {
                        color: textColorSecondary,
                        width: 1,
                        lineDash: [4, 2],
                    },
                },
            },
            series: [
                {
                    name: '희망',
                    type: 'bar',
                    barGap: 0,
                    itemStyle: { color: '#22c55e' },
                    data: allGoalAchievementTimes.value.map((item) =>
                        isFinite(item.hope) ? item.hope : null
                    ),
                },
                {
                    name: '평균',
                    type: 'bar',
                    itemStyle: { color: '#eab308' },
                    data: allGoalAchievementTimes.value.map((item) =>
                        isFinite(item.avg) ? item.avg : null
                    ),
                },
                {
                    name: '절망',
                    type: 'bar',
                    itemStyle: { color: '#ef4444' },
                    data: allGoalAchievementTimes.value.map((item) =>
                        isFinite(item.despair) ? item.despair : null
                    ),
                },
            ],
        };
    });

    // [수정 4] 요약 테이블용 데이터는 0% 성장률 기준으로 제공
    const goalAchievementTimes = computed(() => {
        if (!allGoalAchievementTimes.value)
            return { hope: Infinity, avg: Infinity, despair: Infinity };
        const zeroGrowthData = allGoalAchievementTimes.value.find(
            (item) => item.rateLabel === '0%'
        );
        if (!zeroGrowthData)
            return { hope: Infinity, avg: Infinity, despair: Infinity };
        return {
            hope: zeroGrowthData.hope,
            avg: zeroGrowthData.avg,
            despair: zeroGrowthData.despair,
        };
    });

    return { chartOptions, goalAchievementTimes };
}
