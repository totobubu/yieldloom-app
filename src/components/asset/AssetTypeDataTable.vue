<!-- src/components/asset/AssetTypeDataTable.vue -->
<template>
    <div class="flex flex-column gap-4">
        <!-- 자산 타입별 탭 -->
        <TabView v-model:activeIndex="activeTabIndex" class="asset-type-tabs">
            <TabPanel v-for="tab in assetTabs" :key="tab.key">
                <template #header>
                    <div class="flex align-items-center gap-2">
                        <i :class="tab.icon"></i>
                        <span>{{ tab.label }}</span>
                        <Tag :value="tab.count" severity="info" size="small" />
                    </div>
                </template>

                <DataTable
                    :value="tab.assets"
                    stripedRows
                    class="p-datatable-sm"
                    sortMode="single"
                    sortField="name"
                    :sortOrder="1">
                    <template #empty>
                        <div class="text-center p-4">
                            <p class="text-color-secondary">
                                등록된 자산이 없습니다.
                            </p>
                        </div>
                    </template>

                    <Column
                        field="name"
                        header="종목명"
                        style="min-width: 200px">
                        <template #body="slotProps">
                            <div class="flex align-items-center gap-2">
                                <div class="flex flex-column">
                                    <span class="font-bold">{{
                                        slotProps.data.name
                                    }}</span>
                                    <span
                                        class="text-sm text-color-secondary"
                                        >{{ slotProps.data.symbol }}</span
                                    >
                                </div>
                            </div>
                        </template>
                    </Column>

                    <Column field="profitRate" header="총 수익률" sortable>
                        <template #body="slotProps">
                            <span
                                :class="
                                    getProfitColorClass(
                                        slotProps.data.profitRate
                                    )
                                ">
                                {{ formatPercent(slotProps.data.profitRate) }}
                            </span>
                        </template>
                    </Column>

                    <Column field="profitAmount" header="총 수익금" sortable>
                        <template #body="slotProps">
                            <span
                                :class="
                                    getProfitColorClass(
                                        slotProps.data.profitAmount
                                    )
                                ">
                                {{
                                    formatCurrency(
                                        slotProps.data.profitAmount,
                                        slotProps.data.currency
                                    )
                                }}
                            </span>
                        </template>
                    </Column>

                    <Column field="avgPrice" header="평단가">
                        <template #body="slotProps">
                            {{
                                formatCurrency(
                                    slotProps.data.avgPrice,
                                    slotProps.data.currency
                                )
                            }}
                        </template>
                    </Column>

                    <Column field="currentPrice" header="현재가">
                        <template #body="slotProps">
                            {{
                                formatCurrency(
                                    slotProps.data.currentPrice,
                                    slotProps.data.currency
                                )
                            }}
                        </template>
                    </Column>

                    <Column field="amount" header="보유 수량">
                        <template #body="slotProps">
                            {{ formatNumber(slotProps.data.amount) }}
                        </template>
                    </Column>

                    <Column field="valuation" header="평가금" sortable>
                        <template #body="slotProps">
                            {{
                                formatCurrency(
                                    slotProps.data.valuation,
                                    slotProps.data.currency
                                )
                            }}
                        </template>
                    </Column>

                    <Column field="principal" header="원금">
                        <template #body="slotProps">
                            {{
                                formatCurrency(
                                    slotProps.data.principal,
                                    slotProps.data.currency
                                )
                            }}
                        </template>
                    </Column>

                    <Column header="내역" style="width: 80px">
                        <template #body="slotProps">
                            <Button
                                icon="pi pi-list"
                                text
                                rounded
                                severity="secondary"
                                @click="openHistory(slotProps.data)"
                                v-tooltip="'거래 내역'" />
                        </template>
                    </Column>
                </DataTable>
            </TabPanel>
        </TabView>
    </div>
</template>

<script setup>
    import { ref, computed } from 'vue';
    import TabView from 'primevue/tabview';
    import TabPanel from 'primevue/tabpanel';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Button from 'primevue/button';
    import Tag from 'primevue/tag';

    const props = defineProps({
        assets: {
            type: Array,
            required: true,
            default: () => [],
        },
    });

    const emit = defineEmits(['view-transactions']);

    const activeTabIndex = ref(0);

    // 자산을 타입별로 그룹화
    const assetTabs = computed(() => {
        const krwAssets = props.assets.filter((a) => a.groupKey === 'krw');
        const foreignAssets = props.assets.filter(
            (a) => a.groupKey === 'foreign'
        );
        const domesticStocks = props.assets.filter(
            (a) => a.groupKey === 'domesticStock'
        );
        const overseasStocks = props.assets.filter(
            (a) => a.groupKey === 'overseasStock'
        );
        const coins = props.assets.filter((a) => a.groupKey === 'coin');

        return [
            {
                key: 'krw',
                label: '예수금 (원화)',
                icon: 'pi pi-money-bill',
                count: krwAssets.length,
                assets: krwAssets,
            },
            {
                key: 'domesticStock',
                label: '국내주식',
                icon: 'pi pi-chart-line',
                count: domesticStocks.length,
                assets: domesticStocks,
            },
            {
                key: 'overseasStock',
                label: '해외주식',
                icon: 'pi pi-globe',
                count: overseasStocks.length,
                assets: overseasStocks,
            },
            {
                key: 'coin',
                label: '코인',
                icon: 'pi pi-bitcoin',
                count: coins.length,
                assets: coins,
            },
            {
                key: 'foreign',
                label: '예수금 (외화)',
                icon: 'pi pi-dollar',
                count: foreignAssets.length,
                assets: foreignAssets,
            },
        ].filter((tab) => tab.count > 0); // 자산이 있는 탭만 표시
    });

    const openHistory = (asset) => {
        emit('view-transactions', asset);
    };

    const formatNumber = (value) => {
        if (value === undefined || value === null) return '-';
        return new Intl.NumberFormat('ko-KR').format(value);
    };

    const formatCurrency = (value, currency) => {
        if (value === undefined || value === null) return '-';
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: currency || 'KRW',
        }).format(value);
    };

    const formatPercent = (value) => {
        if (value === undefined || value === null) return '-';
        return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
    };

    const getProfitColorClass = (value) => {
        if (!value) return '';
        return value > 0 ? 'text-red-500' : value < 0 ? 'text-blue-500' : '';
    };
</script>
