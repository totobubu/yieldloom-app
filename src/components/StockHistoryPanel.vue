<!-- src/components/StockHistoryPanel.vue -->
<script setup>
    import { computed } from 'vue';
    import { formatCurrency, formatPercent } from '@/utils/formatters.js';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';

    const props = defineProps({
        history: Array,
        isDesktop: Boolean,
        currency: String,
    });

    const formattedHistory = computed(() => {
        if (!props.history) return [];
        return props.history.map((item) => {
            // 배당금이 이미 문자열인 경우 (useStockData.ts에서 변환된 경우) 그대로 사용
            // 숫자인 경우에만 포맷팅
            let dividendDisplay = typeof item.배당금 === 'string'
                ? item.배당금
                : formatCurrency(item.배당금, props.currency);

            // NEW STRUCTURE: amountFixed (실제 받은 금액)와 amountSplitAdjustments가 있는 경우
            // Split history 표시: amountSplitAdjustments[].amountAfterSplit를 사용
            if (
                typeof item.배당금 !== 'string' &&
                item.amountFixed != null &&
                Array.isArray(item.amountSplitAdjustments) &&
                item.amountSplitAdjustments.length > 0
            ) {
                const ratios = item.amountSplitAdjustments
                    .map((adj) => adj.ratio)
                    .join(' → ');
                const originalDisplay = formatCurrency(
                    item.amountFixed,
                    props.currency
                );
                dividendDisplay = `${dividendDisplay} (${ratios} == ${originalDisplay})`;
            }

            return {
                ...item,
                배당금: dividendDisplay,
                배당률: formatPercent(item.배당률),
                전일종가: formatCurrency(item.전일종가, props.currency),
                당일시가: formatCurrency(item.당일시가, props.currency),
                당일종가: formatCurrency(item.당일종가, props.currency),
                익일종가: formatCurrency(item.익일종가, props.currency),
            };
        });
    });

    const columns = computed(() => {
        if (!props.history || props.history.length === 0) return [];
        const desiredOrder = [
            '배당락',
            '배당금',
            '배당률',
            '전일종가',
            '당일시가',
            '당일종가',
            '익일종가',
        ];
        const keys = Object.keys(props.history[0]);
        return desiredOrder
            .filter((key) => keys.includes(key))
            .map((key) => ({
                field: key,
                header: key,
                sortable: ['배당락', '배당금', '배당률'].includes(key),
            }));
    });
</script>

<template>
    <div class="t-history">
        <DataTable :value="formattedHistory" stripedRows scrollable>
            <Column
                v-for="col in columns"
                :key="col.field"
                :field="col.field"
                :header="col.header"
                :sortable="col.sortable" />
        </DataTable>
    </div>
</template>
