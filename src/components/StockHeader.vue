<!-- src/components/StockHeader.vue -->
<script setup>
    import { computed } from 'vue';
    import {
        formatCurrency,
        formatLargeNumber,
        formatPercent,
    } from '@/utils/formatters.js';
    import Card from 'primevue/card';
    import Tag from 'primevue/tag';

    const props = defineProps({
        info: Object,
    });

    const stockDetails = computed(() => {
        if (!props.info) return [];
        const { currency = 'USD' } = props.info;

        const detailMapping = [
            { key: 'market', label: '시장' },
            {
                key: 'marketCap',
                label: '시가총액',
                formatter: (val) => formatLargeNumber(val, currency),
            },
            {
                key: 'enterpriseValue',
                label: '기업가치',
                formatter: (val) => formatLargeNumber(val, currency),
            },
            { key: 'earningsDate', label: '실적발표일' },
            {
                key: 'Volume',
                label: '거래량',
                formatter: (val) => formatLargeNumber(val, currency),
            },
            {
                key: 'AvgVolume',
                label: '평균거래량',
                formatter: (val) => formatLargeNumber(val, currency),
            },
            {
                key: 'sharesOutstanding',
                label: '유통 주식 수',
                formatter: (val) => formatLargeNumber(val, currency),
            },
            {
                key: 'Yield',
                label: '연간 배당률',
                formatter: formatPercent,
            },
            {
                key: 'dividendRate',
                label: '연간 배당금',
                formatter: (val) => formatCurrency(val, currency),
            },
            {
                key: 'payoutRatio',
                label: '배당 성향',
                formatter: formatPercent,
            },
        ];

        return detailMapping
            .map((item) => {
                const rawValue = props.info[item.key];
                const displayValue = item.formatter
                    ? item.formatter(rawValue)
                    : rawValue;

                return {
                    key: item.key,
                    label: item.label,
                    value: displayValue,
                    rawValue,
                    changeInfo: props.info.changes?.[item.key],
                };
            })
            .filter((item) => {
                if (
                    item.rawValue === null ||
                    item.rawValue === undefined ||
                    item.rawValue === 'N/A' ||
                    item.value === 'N/A'
                ) {
                    return false;
                }

                if (
                    item.key === 'sharesOutstanding' &&
                    Number(item.rawValue) === 0
                ) {
                    return false;
                }

                return true;
            });
    });

    const getChangeIcon = (change) =>
        ({ up: 'pi pi-arrow-up', down: 'pi pi-arrow-down' })[change] ||
        'pi pi-equals';
    const getChangeSeverity = (change) =>
        ({ up: 'success', down: 'danger' })[change] || 'contrast';
</script>

<template>
    <div v-if="info" id="t-stock-header">
        <Card class="status" v-for="detail in stockDetails" :key="detail.label">
            <template #title
                ><span>{{ detail.label }}</span></template
            >
            <template #content>
                <Tag
                    v-if="detail.label === '시장'"
                    :value="detail.value.toUpperCase()"
                    severity="contrast"
                    class="font-bold" />
                <p v-else>{{ detail.value }}</p>
            </template>
            <template #footer>
                <div v-if="detail.changeInfo" class="absolute top-2 right-2">
                    <Tag
                        class="stats-badge"
                        :severity="getChangeSeverity(detail.changeInfo.change)">
                        <i :class="getChangeIcon(detail.changeInfo.change)" />
                    </Tag>
                </div>
            </template>
        </Card>
    </div>
</template>
