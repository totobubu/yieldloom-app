<!-- src\components\backtester\BacktesterResultDetails.vue -->
<script setup>
    import { ref, computed } from 'vue';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import SelectButton from 'primevue/selectbutton';

    const props = defineProps({
        result: {
            type: Object,
            default: () => ({}),
        },
    });

    const { isMobile, isDesktop } = useBreakpoint();
    const selectedTicker = ref('전체');

    const filterOptions = computed(() => {
        if (!props.result || !props.result.cashDividends) return [];

        const tickersWithDividends = new Set(
            props.result.cashDividends.map((d) => d.ticker)
        );

        const sortedTickers = Array.from(tickersWithDividends).sort();

        return ['전체', ...sortedTickers];
    });

    const formatCurrency = (val, fractionDigits = 2) =>
        new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits,
        }).format(val || 0);

    const combinedDividendHistory = computed(() => {
        if (
            !props.result ||
            !props.result.cashDividends ||
            !props.result.dripDividends
        ) {
            return [];
        }

        const combinedMap = new Map();

        props.result.cashDividends.forEach((item) => {
            const key = `${item.date}-${item.ticker}`;
            combinedMap.set(key, {
                date: item.date,
                ticker: item.ticker,
                perShare: item.perShare,
                cash: {
                    shares: item.shares,
                    preTaxAmount: item.preTaxAmount,
                    postTaxAmount: item.amount,
                },
                drip: null,
            });
        });

        props.result.dripDividends.forEach((item) => {
            const key = `${item.date}-${item.ticker}`;
            const existing = combinedMap.get(key);
            const dripData = {
                shares: item.shares,
                preTaxAmount: item.preTaxAmount,
                postTaxAmount: item.amount,
            };

            if (existing) {
                existing.drip = dripData;
            } else {
                combinedMap.set(key, {
                    date: item.date,
                    ticker: item.ticker,
                    perShare: item.perShare,
                    cash: null,
                    drip: dripData,
                });
            }
        });

        const allDividends = Array.from(combinedMap.values());

        if (selectedTicker.value === '전체') {
            return allDividends;
        }
        return allDividends.filter(
            (item) => item.ticker === selectedTicker.value
        );
    });
</script>

<template>
    <div
        v-if="combinedDividendHistory && combinedDividendHistory.length > 0"
        class="col-12">
        <div
            class="flex mb-2 flex-wrap gap-3"
            :class="
                isMobile
                    ? 'flex-column align-items-start'
                    : 'justify-content-between align-items-center'
            ">
            <h4>배당금 수령 내역</h4>
            <SelectButton
                v-if="filterOptions.length > 1"
                v-model="selectedTicker"
                :options="filterOptions"
                aria-labelledby="basic"
                class="p-button-sm"
                :class="isMobile ? 'p-0' : ''" />
        </div>
        <DataTable
            :value="combinedDividendHistory"
            :size="isMobile ? 'small' : ''"
            sortField="date"
            :sortOrder="-1">
            <template v-if="isMobile">
                <Column header="지급일/종목/배당금">
                    <template #body="{ data }">
                        {{ data.date }}
                        <br />
                        {{ data.ticker }}
                        <br />
                        {{ formatCurrency(data.perShare, 4) }}
                    </template>
                </Column>
            </template>
            <template v-else>
                <Column field="date" header="지급일" sortable></Column>
                <Column field="ticker" header="종목"></Column>
                <Column header="주당 배당금" field="perShare">
                    <template #body="{ data }">
                        {{ formatCurrency(data.perShare, 4) }}
                    </template>
                </Column>
            </template>
            <template>
                <Column :header="isMobile ? '재투자X' : '재투자X = 현금'">
                    <template #body="{ data }">
                        <div v-if="data.cash">
                            <span>{{ data.cash.shares.toFixed(2) }}주 = </span>
                            <template v-if="isMobile">
                                <strong
                                    v-if="!result.applyTax"
                                    class="text-green-400"
                                    >{{
                                        formatCurrency(data.cash.preTaxAmount)
                                    }}</strong
                                >
                                <strong v-else class="text-green-400">{{
                                    formatCurrency(data.cash.postTaxAmount)
                                }}</strong>
                            </template>
                            <template v-else>
                                <strong class="text-green-400"
                                    >세전
                                    {{
                                        formatCurrency(data.cash.preTaxAmount)
                                    }}</strong
                                >
                                <span class="text-sm">
                                    | 세후
                                    {{
                                        formatCurrency(data.cash.postTaxAmount)
                                    }}</span
                                >
                            </template>
                        </div>
                        <span v-else>-</span>
                    </template>
                </Column>
                <Column :header="isMobile ? '재투자O' : '재투자O = DRIP'">
                    <template #body="{ data }">
                        <div v-if="data.drip">
                            <span>{{ data.drip.shares.toFixed(2) }}주 = </span>
                            <template v-if="isMobile">
                                <strong
                                    v-if="!result.applyTax"
                                    class="text-green-400"
                                    >{{
                                        formatCurrency(data.drip.preTaxAmount)
                                    }}</strong
                                >
                                <strong v-else class="text-green-400">{{
                                    formatCurrency(data.drip.postTaxAmount)
                                }}</strong>
                            </template>
                            <template v-else>
                                <strong class="text-green-400"
                                    >세전
                                    {{
                                        formatCurrency(data.drip.preTaxAmount)
                                    }}</strong
                                >
                                <span class="text-sm">
                                    | 세후
                                    {{
                                        formatCurrency(data.drip.postTaxAmount)
                                    }}</span
                                >
                            </template>
                        </div>
                        <span v-else>-</span>
                    </template>
                </Column>
            </template>
        </DataTable>
    </div>
</template>
