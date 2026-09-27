<!-- src/components/charts/StockPriceCandlestickChart.vue -->
<script setup>
    import { computed } from 'vue';
    import VChart from 'vue-echarts';

    // --- [핵심 수정] 아래 use() 관련 import 및 호출 코드 전체 삭제 ---
    /*
    import { use } from 'echarts/core';
    import { CanvasRenderer } from 'echarts/renderers';
    import { CandlestickChart, BarChart } from 'echarts/charts';
    import {
        TooltipComponent,
        GridComponent,
        DataZoomComponent,
        LegendComponent,
        VisualMapComponent,
    } from 'echarts/components';

    use([
        CanvasRenderer,
        CandlestickChart,
        BarChart,
        TooltipComponent,
        GridComponent,
        DataZoomComponent,
        LegendComponent,
        VisualMapComponent,
    ]);
    */
    // --- // ---

    const props = defineProps({
        priceData: {
            type: Array,
            default: () => [],
        },
    });

    const chartData = computed(() => {
        // ... (나머지 코드는 그대로 유지)
        if (!props.priceData || props.priceData.length === 0) {
            return { dates: [], ohlc: [], volumes: [] };
        }
        const dates = [];
        const ohlc = [];
        const volumes = [];
        for (let i = 0; i < props.priceData.length; i++) {
            const item = props.priceData[i];
            dates.push(item.date);
            ohlc.push([item.open, item.close, item.low, item.high]);
            volumes.push(item.volume);
        }
        return { dates, ohlc, volumes };
    });

    const chartOption = computed(() => {
        // ... (나머지 코드는 그대로 유지)
        const upColor = '#ef4444'; // Red for up
        const downColor = '#3b82f6'; // Blue for down

        return {
            animation: false,
            legend: {
                bottom: 10,
                left: 'center',
                data: ['주가', '거래량'],
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: {
                    type: 'cross',
                },
                borderWidth: 1,
                borderColor: '#ccc',
                padding: 10,
                textStyle: {
                    color: '#000',
                },
            },
            axisPointer: {
                link: [{ xAxisIndex: 'all' }],
                label: {
                    backgroundColor: '#777',
                },
            },
            grid: [
                {
                    left: '10%',
                    right: '8%',
                    height: '50%',
                },
                {
                    left: '10%',
                    right: '8%',
                    top: '68%',
                    height: '16%',
                },
            ],
            xAxis: [
                {
                    type: 'category',
                    data: chartData.value.dates,
                    boundaryGap: false,
                    axisLine: { onZero: false },
                    splitLine: { show: false },
                    min: 'dataMin',
                    max: 'dataMax',
                    axisPointer: {
                        z: 100,
                    },
                },
                {
                    type: 'category',
                    gridIndex: 1,
                    data: chartData.value.dates,
                    boundaryGap: false,
                    axisLine: { onZero: false },
                    axisTick: { show: false },
                    splitLine: { show: false },
                    axisLabel: { show: false },
                    min: 'dataMin',
                    max: 'dataMax',
                },
            ],
            yAxis: [
                {
                    scale: true,
                    splitArea: {
                        show: true,
                    },
                },
                {
                    scale: true,
                    gridIndex: 1,
                    splitNumber: 2,
                    axisLabel: { show: false },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitLine: { show: false },
                },
            ],
            dataZoom: [
                {
                    type: 'inside',
                    xAxisIndex: [0, 1],
                    start: 80,
                    end: 100,
                },
                {
                    show: true,
                    xAxisIndex: [0, 1],
                    type: 'slider',
                    top: '90%',
                    start: 80,
                    end: 100,
                },
            ],
            series: [
                {
                    name: '주가',
                    type: 'candlestick',
                    data: chartData.value.ohlc,
                    itemStyle: {
                        color: upColor,
                        color0: downColor,
                        borderColor: upColor,
                        borderColor0: downColor,
                    },
                },
                {
                    name: '거래량',
                    type: 'bar',
                    xAxisIndex: 1,
                    yAxisIndex: 1,
                    data: chartData.value.volumes,
                    itemStyle: {
                        color: (params) => {
                            // 거래량 바 색상을 캔들스틱과 일치
                            const ohlc = chartData.value.ohlc[params.dataIndex];
                            return ohlc[1] > ohlc[0] ? upColor : downColor;
                        },
                    },
                },
            ],
        };
    });
</script>

<template>
    <Card class="t-chart t-candlestick-chart">
        <template #content>
            <div class="chart-wrapper">
                <div class="chart-container" style="height: 500px">
                    <v-chart
                        v-if="priceData && priceData.length > 0"
                        :option="chartOption"
                        autoresize />
                    <div v-else class="flex justify-center items-center h-full">
                        <p>주가 데이터가 없습니다.</p>
                    </div>
                </div>
            </div>
        </template>
    </Card>
</template>
