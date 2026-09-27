<!-- src\components\backtester\BacktesterSummaryTable.vue -->
<script setup>
    import { computed } from 'vue';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';

    const props = defineProps({
        result: {
            type: Object,
            default: () => ({}),
        },
    });

    // --- [신규] 배당금이 있는지 확인하는 computed 속성 ---
    const hasPortfolioDividends = computed(() => {
        // withoutReinvest 객체가 존재하고, dividendsCollected 값이 0보다 큰지 확인
        return props.result?.withoutReinvest?.summary?.dividendsCollected > 0;
    });

    const formatCurrency = (val) =>
        new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
        }).format(val || 0);
    const formatPercent = (val) => `${((val || 0) * 100).toFixed(2)}%`;

    const resultTableData = computed(() => {
        if (!props.result || !props.result.initialInvestment) return [];

        const r = props.result;
        const comp = r.comparisonResult;
        return [
            {
                label: '초기 투자금',
                drip: r.initialInvestment,
                noDrip: r.initialInvestment,
                comp: comp ? r.initialInvestment : undefined,
            },
            {
                label: '최종 평가액',
                drip: r.withReinvest.summary.endingInvestment,
                noDrip: r.withoutReinvest.summary.endingInvestment,
                comp: comp?.withReinvest.endingInvestment,
            },
            {
                label: '누적 현금',
                drip: '-',
                noDrip: r.withoutReinvest.summary.dividendsCollected,
                comp: comp?.withoutReinvest.dividendsCollected,
            },
            {
                label: '총 수익률',
                drip: r.withReinvest.summary.totalReturn,
                noDrip: r.withoutReinvest.summary.totalReturn,
                comp: comp?.withReinvest.totalReturn,
            },
            {
                label: '연평균 수익률',
                drip: r.withReinvest.summary.cagr,
                noDrip: r.withoutReinvest.summary.cagr,
                comp: comp?.withReinvest.cagr,
            },
            {
                label: '기간',
                drip: `${(r.years || 0).toFixed(2)} 년`,
                noDrip: `${(r.years || 0).toFixed(2)} 년`,
                comp: comp ? `${(r.years || 0).toFixed(2)} 년` : undefined,
            },
        ];
    });
</script>

<template>
    <DataTable
        id="t-backtester-summary"
        :value="resultTableData"
        showGridlines
        stripedRows
        class="p-datatable-sm summary-table">
        <Column
            field="label"
            header="항목"
            frozen
            class="font-bold text-center" />
        <Column
            :header="hasPortfolioDividends ? '배당 재투자 O' : 'Portfolio DRIP'"
            class="text-right">
            <template #body="{ data }">
                <span
                    v-if="typeof data.drip === 'number'"
                    :class="{
                        'text-red-500':
                            data.drip < 0 && data.label !== '초기 투자금',
                        'text-green-500':
                            data.drip > 0 && data.label !== '초기 투자금',
                    }">
                    {{
                        ['총 수익률', '연평균 수익률'].includes(data.label)
                            ? formatPercent(data.drip)
                            : formatCurrency(data.drip)
                    }}
                </span>
                <span v-else>{{ data.drip }}</span>
            </template>
        </Column>
        <!-- [핵심 수정] v-if를 사용하여 조건부 렌더링 -->
        <Column
            v-if="hasPortfolioDividends"
            header="배당 재투자 X"
            class="text-right">
            <template #body="{ data }">
                <span
                    v-if="typeof data.noDrip === 'number'"
                    :class="{
                        'text-red-500':
                            data.noDrip < 0 && data.label !== '초기 투자금',
                        'text-green-500':
                            data.noDrip > 0 && data.label !== '초기 투자금',
                    }">
                    {{
                        ['총 수익률', '연평균 수익률'].includes(data.label)
                            ? formatPercent(data.noDrip)
                            : formatCurrency(data.noDrip)
                    }}
                </span>
                <span v-else>{{ data.noDrip }}</span>
            </template>
        </Column>
        <Column
            v-if="result.comparisonResult"
            :header="result.comparisonSymbol"
            class="text-right">
            <template #body="{ data }">
                <span v-if="data.comp === undefined || data.comp === null"
                    >-</span
                >
                <span
                    v-else-if="typeof data.comp === 'number'"
                    :class="{
                        'text-red-500':
                            data.comp < 0 && data.label !== '초기 투자금',
                        'text-green-500':
                            data.comp > 0 && data.label !== '초기 투자금',
                    }">
                    {{
                        ['총 수익률', '연평균 수익률'].includes(data.label)
                            ? formatPercent(data.comp)
                            : formatCurrency(data.comp)
                    }}
                </span>
                <span v-else>{{ data.comp }}</span>
            </template>
        </Column>
    </DataTable>
</template>
