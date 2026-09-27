<template>
  <div class="dividend-chart-container p-4 surface-card border-round shadow-2">
    <h3 class="m-0 mb-3 text-xl font-bold text-900">월별 예상 배당금</h3>
    <v-chart class="chart" :option="chartOption" autoresize />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import VChart from 'vue-echarts';
import * as echarts from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  BarChart,
  CanvasRenderer,
]);

const props = defineProps({
  monthlyData: {
    type: Array,
    default: () => Array(12).fill(0), // 1월~12월 데이터
  },
  currency: {
    type: String,
    default: 'USD', // 'USD' or 'KRW'
  }
});

const chartOption = computed(() => {
  const isUSD = props.currency === 'USD';
  const symbol = isUSD ? '$' : '₩';
  
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow',
      },
      formatter: (params) => {
        const val = params[0].value;
        const formattedVal = isUSD ? val.toFixed(2) : Math.floor(val).toLocaleString();
        return `${params[0].name}<br/>예상 배당금: ${symbol}${formattedVal}`;
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: [
      {
        type: 'category',
        data: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
        axisTick: {
          alignWithLabel: true,
        },
      },
    ],
    yAxis: [
      {
        type: 'value',
        axisLabel: {
          formatter: `{value} ${symbol}`,
        },
      },
    ],
    series: [
      {
        name: '배당금',
        type: 'bar',
        barWidth: '60%',
        data: props.monthlyData,
        itemStyle: {
          color: '#4CAF50', // 초록색 계열 (DivGrow 컨셉)
          borderRadius: [4, 4, 0, 0],
        },
      },
    ],
  };
});
</script>

<style scoped>
.chart {
  height: 300px;
  width: 100%;
}
</style>
