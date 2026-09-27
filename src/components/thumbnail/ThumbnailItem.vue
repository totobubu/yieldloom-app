<!-- src/components/thumbnail/ThumbnailItem.vue -->
<script setup>
import { computed } from 'vue';

const props = defineProps({
    data: Object,
});

const chartData = computed(() => {
    if (!props.data.showChart || !props.data.chartDividends) return [];

    // targetDate 추출 (YYYY-MM-DD 형식)
    const targetDateStr = props.data.targetDate;
    let targetDate = null;
    let targetYearMonth = null;

    if (targetDateStr) {
        // 날짜 비교를 위해 시간을 00:00:00으로 설정
        targetDate = new Date(targetDateStr);
        targetDate.setHours(0, 0, 0, 0);
        targetYearMonth = `${targetDate.getFullYear().toString().slice(-2)}.${(targetDate.getMonth() + 1).toString().padStart(2, '0')}`;
    }

    // 월별로 그룹화
    const monthlyGroups = {};
    props.data.chartDividends.forEach((dividend) => {
        const date = new Date(dividend.date);
        // 날짜 비교를 위해 시간을 00:00:00으로 설정
        date.setHours(0, 0, 0, 0);
        const yearMonth = `${date.getFullYear().toString().slice(-2)}.${(date.getMonth() + 1).toString().padStart(2, '0')}`;

        // targetDate가 속한 월의 경우, targetDate 이후의 배당은 제외
        if (
            targetYearMonth &&
            yearMonth === targetYearMonth &&
            targetDate
        ) {
            if (date > targetDate) {
                return; // 이 배당은 제외
            }
        }

        // NEW STRUCTURE: Use amountFixed as primary value (actual received amount)
        const amount = dividend.amountFixed ?? dividend.amount;

        if (!monthlyGroups[yearMonth]) {
            monthlyGroups[yearMonth] = [];
        }
        monthlyGroups[yearMonth].push(amount);
    });

    // 오래된 월부터 최신 월순으로 정렬 (최신이 아래로)
    const sortedData = Object.keys(monthlyGroups)
        .sort((a, b) => {
            const [ya, ma] = a.split('.').map(Number);
            const [yb, mb] = b.split('.').map(Number);
            if (ya !== yb) return ya - yb;
            return ma - mb;
        })
        .slice(-4) // 최근 4개월만 표시 (뒤에서 4개)
        .map((month) => ({
            month,
            amounts: monthlyGroups[month],
            total: monthlyGroups[month].reduce((sum, amt) => sum + amt, 0),
        }));

    // 최대 total 값을 구해서 비율 계산
    const totals = sortedData.map((item) => item.total);
    const maxTotal = totals.length > 0 ? Math.max(...totals) : 1;

    return sortedData.map((item) => ({
        ...item,
        widthRatio: (item.total / maxTotal) * 100,
    }));
});

const weekColors = [
    '#4285F4',
    '#EA4335',
    '#FBBC04',
    '#34A853',
    '#FF6D01',
    '#9C27B0',
    '#00BCD4',
];
const getColor = (index) => weekColors[index % weekColors.length];

const formatAmount = (amount) => {
    return `$${Number(amount.toFixed(4))}`;
};
</script>

<template>
    <div class="thumbnail-item-wrapper" :class="{ 'with-chart': data.showChart }">
        <div class="thumbnail-container">
            <div class="thumbnail-container-inner">
                <img :src="data.backgroundImageUrl" class="bg-image" alt="" />
                <div class="header">
                    <!-- <img :src="data.logo" alt="Company Logo" class="logo" /> -->
                    <span class="date">{{ data.date }}
                        <span v-if="data.weekNo">({{ data.weekNo }})</span></span>

                </div>
                <div class="main-content">
                    <h1 class="ticker" :style="{ color: data.tickerColor }">
                        {{ data.symbol }}
                    </h1>
                    <h2 class="amount">${{ data.formattedCurrentAmount }}</h2>
                </div>
                <div class="footer">
                    <p class="comparison">{{ data.comparisonText }}</p>
                    <!-- <p class="description">
                        {{ data.descriptionLine1 }}<br />{{
                            data.descriptionLine2
                        }}
                    </p> -->
                    <p class="copyright">By 토또부부</p>
                </div>
            </div>
            <!-- 차트 영역 -->
            <div v-if="data.showChart && chartData.length > 0" class="chart-section">
                <div v-for="item in chartData" :key="item.month" class="chart-row">
                    <div class="chart-label">
                        <span class="chart-month">{{ item.month }}</span>
                        <span class="chart-total">{{
                            formatAmount(item.total)
                        }}</span>
                    </div>
                    <div class="chart-bar" :style="{ width: `${item.widthRatio}%` }">
                        <div v-for="(amount, idx) in item.amounts" :key="idx" class="chart-segment" :style="{
                            width: `${(amount / item.total) * 100}%`,
                            backgroundColor: getColor(idx),
                        }">
                            <span class="segment-label">{{
                                formatAmount(amount)
                            }}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
