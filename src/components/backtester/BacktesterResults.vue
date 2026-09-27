<script setup>
    import { computed } from 'vue';
    import VChart from 'vue-echarts';
    import Button from 'primevue/button';
    import Skeleton from 'primevue/skeleton';
    // [핵심 수정] 경로를 './'로 변경합니다.
    import BacktesterSummaryTable from './BacktesterSummaryTable.vue';
    import BacktesterResultDetails from './BacktesterResultDetails.vue';
    import { getBacktesterChartPalette } from '@/utils/chartColors.js';
    import { exportResultsAsImage } from '@/services/backtester/imageExporter.js';
    import { useLayout } from '@/composables/shared/useLayout';

    // ECharts 모듈은 main.js에서 전역으로 등록했으므로 여기서는 제거합니다.

    const props = defineProps({
        result: Object,
        isLoading: Boolean,
    });

    const { isDarkMode } = useLayout();

    // ... (나머지 스크립트 코드는 이전과 동일하게 유지)
    const formatCurrency = (val) =>
        new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(val || 0);

    const createChartOption = (title, seriesData, legendData, palette) => {
        return {
            backgroundColor: palette.background,
            title: {
                text: title,
                left: 'center',
                textStyle: { color: palette.textColor, fontSize: 16 },
            },
            tooltip: {
                trigger: 'axis',
                formatter: (params) => {
                    if (!params || params.length === 0) return '';
                    let tooltipHtml = `${params[0].axisValueLabel}<br/>`;
                    params.forEach((param) => {
                        let marker = `<span style="display:inline-block;margin-right:5px;border-radius:2px;width:10px;height:4px;background-color:${param.color};vertical-align:middle;"></span>`;
                        tooltipHtml += `${marker} ${param.seriesName}: <strong>${formatCurrency(param.value[1])}</strong><br/>`;
                    });
                    return tooltipHtml;
                },
            },
            legend: {
                top: 30,
                left: 'center',
                data: legendData,
                textStyle: { color: palette.textColorSecondary },
            },
            grid: {
                top: 80,
                left: '3%',
                right: '4%',
                bottom: '15%',
                containLabel: true,
            },
            xAxis: {
                type: 'time',
                axisLabel: { color: palette.textColorSecondary },
                splitLine: {
                    show: true,
                    lineStyle: { color: palette.gridColor, type: 'dashed' },
                },
            },
            yAxis: {
                type: 'value',
                scale: true,
                axisLabel: {
                    formatter: '${value}',
                    color: palette.textColorSecondary,
                },
                splitLine: {
                    show: true,
                    lineStyle: { color: palette.gridColor, type: 'dashed' },
                },
            },
            dataZoom: [{ type: 'inside' }, { type: 'slider' }],
            series: seriesData,
        };
    };

    const chartTitle = computed(() => {
        if (!props.result) return 'DivGrow Backtester';
        const portfolioName = props.result.symbols.join(', ');
        const comparisonName =
            props.result.comparisonSymbol !== 'None'
                ? props.result.comparisonSymbol
                : null;
        return comparisonName
            ? `${portfolioName} vs ${comparisonName}`
            : portfolioName;
    });

    const combinedChartOption = computed(() => {
        if (!props.result) return {};
        const themeMode = isDarkMode.value ? 'dark' : 'light';
        const palette = getBacktesterChartPalette(themeMode);

        const seriesData = [];
        const legendData = [];

        const portfolioDrip = props.result.withReinvest?.series.find(
            (s) => s.name === 'Portfolio'
        );
        const portfolioNoDrip_Stock = props.result.withoutReinvest?.series.find(
            (s) => s.name === 'Portfolio (주가)'
        );
        const portfolioNoDrip_Cash = props.result.withoutReinvest?.series.find(
            (s) => s.name === 'Portfolio (현금 배당)'
        );
        const comparisonDrip = props.result.withReinvest?.series.find(
            (s) => s.name !== 'Portfolio'
        );

        if (portfolioNoDrip_Stock) {
            legendData.push('Portfolio (주가)');
            seriesData.push({
                name: 'Portfolio (주가)',
                type: 'line',
                smooth: true,
                stack: 'PortfolioNoDrip',
                areaStyle: { color: palette.portfolioStock },
                symbol: 'none',
                lineStyle: { width: 0 },
                emphasis: { focus: 'series' },
                data: portfolioNoDrip_Stock.data,
            });
        }
        if (portfolioNoDrip_Cash) {
            legendData.push('Portfolio (현금)');
            seriesData.push({
                name: 'Portfolio (현금)',
                type: 'line',
                smooth: true,
                stack: 'PortfolioNoDrip',
                areaStyle: { color: palette.portfolioCash },
                symbol: 'none',
                lineStyle: { width: 0 },
                emphasis: { focus: 'series' },
                data: portfolioNoDrip_Cash.data,
            });
        }
        if (portfolioDrip) {
            legendData.push('Portfolio (DRIP)');
            seriesData.push({
                name: 'Portfolio (DRIP)',
                type: 'line',
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 2.5, color: palette.portfolioDripLine },
                emphasis: { focus: 'series' },
                data: portfolioDrip.data,
                z: 10,
                markPoint: {
                    ...palette.markPoint,
                    data: [
                        {
                            type: 'max',
                            name: '최고점',
                            label: { formatter: 'H' },
                        },
                        {
                            type: 'min',
                            name: '최저점',
                            label: { formatter: 'L' },
                        },
                    ],
                },
            });
        }
        if (comparisonDrip) {
            legendData.push(comparisonDrip.name);
            seriesData.push({
                name: comparisonDrip.name,
                type: 'line',
                smooth: true,
                symbol: 'none',
                lineStyle: { width: 2, opacity: 0.8 },
                itemStyle: { color: palette.comparisonLine },
                emphasis: { focus: 'series' },
                data: comparisonDrip.data,
                z: 8,
                markPoint: {
                    ...palette.markPoint,
                    itemStyle: { color: palette.comparisonLine, opacity: 0.8 },
                    data: [
                        {
                            type: 'max',
                            name: '최고점',
                            label: { formatter: 'H' },
                        },
                        {
                            type: 'min',
                            name: '최저점',
                            label: { formatter: 'L' },
                        },
                    ],
                },
            });
        }
        return createChartOption(
            chartTitle.value,
            seriesData,
            legendData,
            palette
        );
    });

    const downloadResultsAsImage = async () => {
        try {
            await exportResultsAsImage(
                props.result,
                combinedChartOption.value,
                chartTitle.value
            );
        } catch (error) {
            console.error(error);
        }
    };
</script>

<template>
    <div v-if="isLoading" class="mt-4">
        <div class="surface-card border-round p-4">
            <div class="flex justify-content-end mb-3">
                <Skeleton width="12rem" height="2.5rem" />
            </div>
            <Skeleton height="500px" class="mb-4 border-round" />
            <div class="grid">
                <div class="col-12">
                    <Skeleton height="220px" class="border-round" />
                </div>
                <div class="col-12">
                    <Skeleton height="260px" class="border-round" />
                </div>
            </div>
        </div>
    </div>
    <div v-else-if="result && !result.error" class="mt-4">
        <div class="surface-card border-round">
            <div class="grid">
                <div class="col-12">
                    <div
                        class="flex justify-content-end align-items-center mb-2">
                        <Button
                            label="이미지로 다운로드"
                            icon="pi pi-download"
                            text
                            @click="downloadResultsAsImage" />
                    </div>
                    <v-chart
                        :option="combinedChartOption"
                        autoresize
                        style="height: 500px" />
                </div>
                <div class="col-12">
                    <BacktesterSummaryTable :result="result" />
                </div>
                <div class="col-12">
                    <BacktesterResultDetails :result="result" />
                </div>
            </div>
        </div>
    </div>
    <div v-else-if="result && result.error" class="mt-4 text-center">
        <p class="text-red-500">{{ result.error }}</p>
    </div>
    <div v-else></div>
</template>
