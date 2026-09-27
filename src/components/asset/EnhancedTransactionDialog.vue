<!-- src/components/asset/EnhancedTransactionDialog.vue -->
<template>
    <Dialog
        v-model:visible="isVisible"
        modal
        :header="title"
        :style="{ width: '95vw', maxWidth: '1400px', maxHeight: '90vh' }"
        :closable="true">
        <div class="flex flex-column gap-4">
            <div v-if="isLoading" class="flex justify-content-center p-4">
                <ProgressSpinner />
            </div>

            <div v-else-if="transactions.length === 0" class="text-center p-4">
                <p class="text-color-secondary">거래 내역이 없습니다.</p>
            </div>

            <div v-else class="flex flex-column gap-3">
                <!-- 요약 정보 -->
                <Card>
                    <template #content>
                        <div class="grid">
                            <div class="col-12 md:col-3">
                                <div class="text-sm text-color-secondary mb-1">
                                    총 투자금 (KRW)
                                </div>
                                <div class="text-2xl font-bold">
                                    {{
                                        formatCurrency(
                                            summary.totalInvested,
                                            'KRW'
                                        )
                                    }}
                                </div>
                            </div>
                            <div class="col-12 md:col-3">
                                <div class="text-sm text-color-secondary mb-1">
                                    현재 평가금
                                </div>
                                <div class="text-2xl font-bold">
                                    {{
                                        formatCurrency(
                                            summary.currentValue,
                                            'KRW'
                                        )
                                    }}
                                </div>
                            </div>
                            <div class="col-12 md:col-3">
                                <div class="text-sm text-color-secondary mb-1">
                                    총 수익금
                                </div>
                                <div
                                    class="text-2xl font-bold"
                                    :class="
                                        getProfitColorClass(summary.totalProfit)
                                    ">
                                    {{
                                        formatCurrency(
                                            summary.totalProfit,
                                            'KRW'
                                        )
                                    }}
                                </div>
                            </div>
                            <div class="col-12 md:col-3">
                                <div class="text-sm text-color-secondary mb-1">
                                    수익률
                                </div>
                                <div
                                    class="text-2xl font-bold"
                                    :class="
                                        getProfitColorClass(summary.returnRate)
                                    ">
                                    {{ formatPercent(summary.returnRate) }}
                                </div>
                            </div>
                        </div>
                    </template>
                </Card>

                <!-- 차트 섹션 -->
                <Card>
                    <template #content>
                        <TabView>
                            <TabPanel header="수익률 추이">
                                <v-chart
                                    :option="profitChartOption"
                                    style="height: 300px"
                                    autoresize />
                            </TabPanel>
                            <TabPanel header="누적 투자금">
                                <v-chart
                                    :option="investmentChartOption"
                                    style="height: 300px"
                                    autoresize />
                            </TabPanel>
                            <TabPanel header="평단가 변화">
                                <v-chart
                                    :option="avgPriceChartOption"
                                    style="height: 300px"
                                    autoresize />
                            </TabPanel>
                        </TabView>
                    </template>
                </Card>

                <!-- Info message -->
                <Message severity="info" :closable="false">
                    <small
                        >기본적으로 최근 3개월 데이터만 로드됩니다. 더 많은
                        데이터를 보려면 기간 필터를 조정하세요.</small
                    >
                </Message>

                <!-- 필터 -->
                <div class="flex flex-wrap gap-3">
                    <!-- 유형 필터 -->
                    <div class="flex align-items-center gap-2">
                        <label>유형:</label>
                        <div class="flex gap-2">
                            <Button
                                label="전체"
                                :outlined="selectedTypeFilter !== null"
                                size="small"
                                @click="selectedTypeFilter = null" />
                            <Button
                                v-for="type in uniqueTypes"
                                :key="type"
                                :label="type"
                                :outlined="selectedTypeFilter !== type"
                                size="small"
                                @click="selectedTypeFilter = type" />
                        </div>
                    </div>

                    <!-- 기간 필터 -->
                    <div class="flex align-items-center gap-2">
                        <label>기간:</label>
                        <div class="flex gap-2">
                            <Button
                                label="3개월"
                                :outlined="selectedPeriod !== 3"
                                size="small"
                                @click="selectedPeriod = 3" />
                            <Button
                                label="6개월"
                                :outlined="selectedPeriod !== 6"
                                size="small"
                                @click="selectedPeriod = 6" />
                            <Button
                                label="1년"
                                :outlined="selectedPeriod !== 12"
                                size="small"
                                @click="selectedPeriod = 12" />
                            <Button
                                label="전체"
                                :outlined="selectedPeriod !== null"
                                size="small"
                                @click="selectedPeriod = null" />
                        </div>
                    </div>
                </div>

                <!-- 거래내역 테이블 -->
                <DataTable
                    :value="enrichedTransactions"
                    stripedRows
                    class="p-datatable-sm"
                    sortField="date"
                    :sortOrder="-1"
                    scrollable
                    scrollHeight="400px">
                    <!-- 컬럼 그룹 헤더 -->
                    <ColumnGroup type="header">
                        <Row>
                            <Column header="날짜" :rowspan="2" frozen />
                            <Column header="유형" :rowspan="2" />
                            <Column header="수량" :rowspan="2" />
                            <Column
                                v-if="hasUSDTransactions"
                                header="USD"
                                :colspan="3" />
                            <Column header="KRW" :colspan="3" />
                            <Column header="누적" :colspan="2" />
                            <Column header="수익" :colspan="3" />
                        </Row>
                        <Row>
                            <!-- USD 컬럼 -->
                            <Column
                                v-if="hasUSDTransactions"
                                header="단가"
                                field="priceUSD" />
                            <Column
                                v-if="hasUSDTransactions"
                                header="금액"
                                field="amountUSD" />
                            <Column
                                v-if="hasUSDTransactions"
                                header="환율"
                                field="exchangeRate" />
                            <!-- KRW 컬럼 -->
                            <Column header="단가" field="price" />
                            <Column header="금액" field="amount" />
                            <Column header="수수료" field="commission" />
                            <!-- 누적 컬럼 -->
                            <Column
                                header="누적수량"
                                field="cumulativeQuantity" />
                            <Column header="평단가" field="avgPrice" />
                            <!-- 수익 컬럼 -->
                            <Column header="보유기간" field="holdingPeriod" />
                            <Column header="수익률" field="returnRate" />
                            <Column header="수익금" field="profit" />
                        </Row>
                    </ColumnGroup>

                    <!-- 날짜 -->
                    <Column field="date" frozen style="width: 120px">
                        <template #body="slotProps">
                            {{ formatDate(slotProps.data.date) }}
                        </template>
                    </Column>

                    <!-- 유형 -->
                    <Column field="type" style="width: 100px">
                        <template #body="slotProps">
                            <Tag
                                :value="
                                    getTransactionTypeLabel(
                                        slotProps.data.type,
                                        slotProps.data.rawType
                                    )
                                "
                                :severity="
                                    getTransactionTypeSeverity(
                                        slotProps.data.type
                                    )
                                "
                                size="small" />
                        </template>
                    </Column>

                    <!-- 수량 -->
                    <Column field="quantity" style="width: 100px">
                        <template #body="slotProps">
                            {{ formatNumber(slotProps.data.quantity) }}
                        </template>
                    </Column>

                    <!-- USD 단가 -->
                    <Column
                        v-if="hasUSDTransactions"
                        field="priceUSD"
                        style="width: 110px">
                        <template #body="slotProps">
                            {{
                                slotProps.data.priceUSD
                                    ? formatCurrency(
                                          slotProps.data.priceUSD,
                                          'USD'
                                      )
                                    : '-'
                            }}
                        </template>
                    </Column>

                    <!-- USD 금액 -->
                    <Column
                        v-if="hasUSDTransactions"
                        field="amountUSD"
                        style="width: 120px">
                        <template #body="slotProps">
                            {{
                                slotProps.data.amountUSD
                                    ? formatCurrency(
                                          slotProps.data.amountUSD,
                                          'USD'
                                      )
                                    : '-'
                            }}
                        </template>
                    </Column>

                    <!-- 환율 -->
                    <Column
                        v-if="hasUSDTransactions"
                        field="exchangeRate"
                        style="width: 90px">
                        <template #body="slotProps">
                            {{
                                slotProps.data.exchangeRate
                                    ? formatNumber(slotProps.data.exchangeRate)
                                    : '-'
                            }}
                        </template>
                    </Column>

                    <!-- KRW 단가 -->
                    <Column field="price" style="width: 110px">
                        <template #body="slotProps">
                            {{
                                slotProps.data.price
                                    ? formatCurrency(
                                          slotProps.data.price,
                                          'KRW'
                                      )
                                    : '-'
                            }}
                        </template>
                    </Column>

                    <!-- KRW 금액 -->
                    <Column field="amount" style="width: 120px">
                        <template #body="slotProps">
                            <span
                                :class="
                                    getAmountColorClass(
                                        slotProps.data.type,
                                        slotProps.data.amount
                                    )
                                ">
                                {{
                                    slotProps.data.amount
                                        ? formatCurrency(
                                              slotProps.data.amount,
                                              'KRW'
                                          )
                                        : '-'
                                }}
                            </span>
                        </template>
                    </Column>

                    <!-- KRW 수수료 -->
                    <Column field="commission" style="width: 100px">
                        <template #body="slotProps">
                            {{
                                slotProps.data.commission
                                    ? formatCurrency(
                                          slotProps.data.commission,
                                          'KRW'
                                      )
                                    : '-'
                            }}
                        </template>
                    </Column>

                    <!-- 누적 수량 -->
                    <Column field="cumulativeQuantity" style="width: 100px">
                        <template #body="slotProps">
                            {{
                                formatNumber(slotProps.data.cumulativeQuantity)
                            }}
                        </template>
                    </Column>

                    <!-- 평단가 -->
                    <Column field="avgPrice" style="width: 110px">
                        <template #body="slotProps">
                            {{
                                slotProps.data.avgPrice
                                    ? formatCurrency(
                                          slotProps.data.avgPrice,
                                          'KRW'
                                      )
                                    : '-'
                            }}
                        </template>
                    </Column>

                    <!-- 보유기간 -->
                    <Column field="holdingPeriod" style="width: 100px">
                        <template #body="slotProps">
                            {{ slotProps.data.holdingPeriod || '-' }}
                        </template>
                    </Column>

                    <!-- 수익률 -->
                    <Column field="returnRate" style="width: 100px">
                        <template #body="slotProps">
                            <span
                                :class="
                                    getProfitColorClass(
                                        slotProps.data.returnRate
                                    )
                                ">
                                {{
                                    slotProps.data.returnRate !== null
                                        ? formatPercent(
                                              slotProps.data.returnRate
                                          )
                                        : '-'
                                }}
                            </span>
                        </template>
                    </Column>

                    <!-- 수익금 -->
                    <Column field="profit" style="width: 120px">
                        <template #body="slotProps">
                            <span
                                :class="
                                    getProfitColorClass(slotProps.data.profit)
                                ">
                                {{
                                    slotProps.data.profit !== null
                                        ? formatCurrency(
                                              slotProps.data.profit,
                                              'KRW'
                                          )
                                        : '-'
                                }}
                            </span>
                        </template>
                    </Column>

                    <template #empty>
                        <div class="text-center p-4">
                            <p class="text-color-secondary">
                                필터 조건에 맞는 거래 내역이 없습니다.
                            </p>
                        </div>
                    </template>
                </DataTable>
            </div>
        </div>
    </Dialog>
</template>

<script setup>
    import { ref, computed } from 'vue';
    import Dialog from 'primevue/dialog';
    import Card from 'primevue/card';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import ColumnGroup from 'primevue/columngroup';
    import Row from 'primevue/row';
    import Tag from 'primevue/tag';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import TabView from 'primevue/tabview';
    import TabPanel from 'primevue/tabpanel';
    import ProgressSpinner from 'primevue/progressspinner';
    import { use } from 'echarts/core';
    import { CanvasRenderer } from 'echarts/renderers';
    import { LineChart } from 'echarts/charts';
    import {
        TitleComponent,
        TooltipComponent,
        LegendComponent,
        GridComponent,
    } from 'echarts/components';
    import VChart from 'vue-echarts';
    import { getTransactionTypeLabel } from '@/utils/transactionTypeMapper';
    import { useLayout } from '@/composables/shared/useLayout';

    use([
        CanvasRenderer,
        LineChart,
        TitleComponent,
        TooltipComponent,
        LegendComponent,
        GridComponent,
    ]);

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        title: {
            type: String,
            default: '거래 내역',
        },
        transactions: {
            type: Array,
            default: () => [],
        },
        currentPrice: {
            type: Number,
            default: 0,
        },
        isLoading: {
            type: Boolean,
            default: false,
        },
    });

    const emit = defineEmits(['update:visible']);

    const { isDarkMode } = useLayout();

    const isVisible = computed({
        get: () => props.visible,
        set: (value) => emit('update:visible', value),
    });

    // 필터
    const selectedTypeFilter = ref(null);
    const selectedPeriod = ref(3);

    // USD 거래 여부
    const hasUSDTransactions = computed(() => {
        return props.transactions.some(
            (t) =>
                t.priceUSD !== undefined ||
                t.amountUSD !== undefined ||
                t.exchangeRate !== undefined
        );
    });

    // 유니크한 거래 유형
    const uniqueTypes = computed(() => {
        const types = new Set(
            props.transactions
                .map((t) => getTransactionTypeLabel(t.type, t.rawType))
                .filter(Boolean)
        );
        return Array.from(types).sort();
    });

    // 필터링된 거래내역
    const filteredTransactions = computed(() => {
        let filtered = props.transactions;

        // 유형 필터
        if (selectedTypeFilter.value) {
            filtered = filtered.filter(
                (t) =>
                    getTransactionTypeLabel(t.type, t.rawType) ===
                    selectedTypeFilter.value
            );
        }

        // 기간 필터
        if (selectedPeriod.value !== null) {
            const cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - selectedPeriod.value);

            filtered = filtered.filter((t) => {
                if (!t.date) return true;
                const transactionDate = parseDate(t.date);
                return transactionDate >= cutoffDate;
            });
        }

        return filtered;
    });

    // 거래내역 계산 (누적, 평단가, 수익 등)
    const enrichedTransactions = computed(() => {
        let cumulativeQuantity = 0;
        let cumulativeInvested = 0;
        const transactions = [];

        // 날짜순 정렬
        const sorted = [...filteredTransactions.value].sort((a, b) => {
            const dateA = parseDate(a.date);
            const dateB = parseDate(b.date);
            return dateA - dateB;
        });

        sorted.forEach((tx) => {
            const isBuy = tx.type === 'buy';
            const isSell = tx.type === 'sell';
            const quantity = tx.quantity || 0;
            const amount = tx.amount || 0;

            if (isBuy) {
                cumulativeQuantity += quantity;
                cumulativeInvested += amount;
            } else if (isSell) {
                cumulativeQuantity -= quantity;
                // 매도 시 투자금 감소 (평단가 기준)
                const avgPrice =
                    cumulativeQuantity > 0
                        ? cumulativeInvested / (cumulativeQuantity + quantity)
                        : 0;
                cumulativeInvested -= avgPrice * quantity;
            }

            const avgPrice =
                cumulativeQuantity > 0
                    ? cumulativeInvested / cumulativeQuantity
                    : 0;

            // 보유기간 계산
            const holdingPeriod = calculateHoldingPeriod(tx.date);

            // 수익률 및 수익금 계산 (매도 시에만)
            let returnRate = null;
            let profit = null;
            if (isSell && avgPrice > 0) {
                const sellPrice = tx.price || 0;
                returnRate = ((sellPrice - avgPrice) / avgPrice) * 100;
                profit = (sellPrice - avgPrice) * quantity;
            }

            transactions.push({
                ...tx,
                cumulativeQuantity,
                avgPrice,
                holdingPeriod,
                returnRate,
                profit,
            });
        });

        return transactions;
    });

    // 요약 정보
    const summary = computed(() => {
        const transactions = enrichedTransactions.value;
        let totalInvested = 0;
        let totalQuantity = 0;

        transactions.forEach((tx) => {
            if (tx.type === 'buy') {
                totalInvested += tx.amount || 0;
                totalQuantity += tx.quantity || 0;
            } else if (tx.type === 'sell') {
                totalQuantity -= tx.quantity || 0;
            }
        });

        const avgPrice = totalQuantity > 0 ? totalInvested / totalQuantity : 0;
        const currentValue = totalQuantity * props.currentPrice;
        const totalProfit = currentValue - totalInvested;
        const returnRate =
            totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0;

        return {
            totalInvested,
            currentValue,
            totalProfit,
            returnRate,
            totalQuantity,
            avgPrice,
        };
    });

    // 차트 옵션
    const profitChartOption = computed(() => {
        const dates = enrichedTransactions.value.map((t) => formatDate(t.date));
        const profits = enrichedTransactions.value.map((t) => t.profit || 0);
        const returnRates = enrichedTransactions.value.map(
            (t) => t.returnRate || 0
        );

        const isDark = isDarkMode.value;
        const textColor = isDark ? '#f8fafc' : '#1f2937';
        const axisColor = isDark ? '#e2e8f0' : '#4b5563';

        return {
            tooltip: {
                trigger: 'axis',
            },
            legend: {
                data: ['수익금', '수익률'],
                textStyle: { color: textColor },
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { color: axisColor },
            },
            yAxis: [
                {
                    type: 'value',
                    name: '수익금 (KRW)',
                    nameTextStyle: { color: textColor },
                    axisLabel: { color: axisColor },
                    splitLine: {
                        lineStyle: {
                            color: isDark
                                ? 'rgba(255,255,255,0.1)'
                                : 'rgba(0,0,0,0.1)',
                        },
                    },
                },
                {
                    type: 'value',
                    name: '수익률 (%)',
                    nameTextStyle: { color: textColor },
                    axisLabel: { color: axisColor },
                    splitLine: { show: false },
                },
            ],
            series: [
                {
                    name: '수익금',
                    type: 'line',
                    data: profits,
                    smooth: true,
                    itemStyle: { color: '#ef4444' },
                },
                {
                    name: '수익률',
                    type: 'line',
                    yAxisIndex: 1,
                    data: returnRates,
                    smooth: true,
                    itemStyle: { color: '#3b82f6' },
                },
            ],
        };
    });

    const investmentChartOption = computed(() => {
        const dates = enrichedTransactions.value.map((t) => formatDate(t.date));
        const cumulativeInvestments = [];
        let cumulative = 0;

        enrichedTransactions.value.forEach((t) => {
            if (t.type === 'buy') {
                cumulative += t.amount || 0;
            }
            cumulativeInvestments.push(cumulative);
        });

        const isDark = isDarkMode.value;
        const textColor = isDark ? '#f8fafc' : '#1f2937';
        const axisColor = isDark ? '#e2e8f0' : '#4b5563';

        return {
            tooltip: {
                trigger: 'axis',
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { color: axisColor },
            },
            yAxis: {
                type: 'value',
                name: '누적 투자금 (KRW)',
                nameTextStyle: { color: textColor },
                axisLabel: { color: axisColor },
                splitLine: {
                    lineStyle: {
                        color: isDark
                            ? 'rgba(255,255,255,0.1)'
                            : 'rgba(0,0,0,0.1)',
                    },
                },
            },
            series: [
                {
                    name: '누적 투자금',
                    type: 'line',
                    data: cumulativeInvestments,
                    smooth: true,
                    areaStyle: {},
                    itemStyle: { color: '#10b981' },
                },
            ],
        };
    });

    const avgPriceChartOption = computed(() => {
        const dates = enrichedTransactions.value.map((t) => formatDate(t.date));
        const avgPrices = enrichedTransactions.value.map(
            (t) => t.avgPrice || 0
        );

        const isDark = isDarkMode.value;
        const textColor = isDark ? '#f8fafc' : '#1f2937';
        const axisColor = isDark ? '#e2e8f0' : '#4b5563';

        return {
            tooltip: {
                trigger: 'axis',
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                data: dates,
                axisLabel: { color: axisColor },
            },
            yAxis: {
                type: 'value',
                name: '평단가 (KRW)',
                nameTextStyle: { color: textColor },
                axisLabel: { color: axisColor },
                splitLine: {
                    lineStyle: {
                        color: isDark
                            ? 'rgba(255,255,255,0.1)'
                            : 'rgba(0,0,0,0.1)',
                    },
                },
            },
            series: [
                {
                    name: '평단가',
                    type: 'line',
                    data: avgPrices,
                    smooth: true,
                    itemStyle: { color: '#f59e0b' },
                },
            ],
        };
    });

    // Helper functions
    const parseDate = (date) => {
        if (!date) return new Date(0);
        if (date.toDate) return date.toDate();
        if (typeof date === 'string' && date.length === 8) {
            const year = parseInt(date.substring(0, 4));
            const month = parseInt(date.substring(4, 6)) - 1;
            const day = parseInt(date.substring(6, 8));
            return new Date(year, month, day);
        }
        if (date instanceof Date) return date;
        return new Date(0);
    };

    const calculateHoldingPeriod = (startDate) => {
        const start = parseDate(startDate);
        const now = new Date();
        const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));
        if (days < 30) return `${days}일`;
        if (days < 365) return `${Math.floor(days / 30)}개월`;
        return `${Math.floor(days / 365)}년`;
    };

    const formatDate = (date) => {
        if (!date) return '-';
        const d = parseDate(date);
        return d.toLocaleDateString('ko-KR');
    };

    const formatNumber = (value) => {
        if (value === undefined || value === null) return '-';
        return new Intl.NumberFormat('ko-KR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 4,
        }).format(value);
    };

    const formatCurrency = (value, currency) => {
        if (value === undefined || value === null) return '-';
        const validCurrency = ['KRW', 'USD'].includes(currency)
            ? currency
            : 'KRW';
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: validCurrency,
            minimumFractionDigits: validCurrency === 'KRW' ? 0 : 2,
            maximumFractionDigits: validCurrency === 'KRW' ? 0 : 2,
        }).format(value);
    };

    const formatPercent = (value) => {
        if (value === undefined || value === null) return '-';
        return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
    };

    const getTransactionTypeSeverity = (type) => {
        switch (type) {
            case 'buy':
                return 'success';
            case 'sell':
                return 'danger';
            case 'dividend':
                return 'info';
            default:
                return 'secondary';
        }
    };

    const getAmountColorClass = (type, amount) => {
        if (type === 'buy' || type === 'deposit') return 'text-green-600';
        if (type === 'sell' || type === 'withdrawal') return 'text-red-600';
        return '';
    };

    const getProfitColorClass = (value) => {
        if (!value || value === 0) return '';
        return value > 0 ? 'text-red-500' : 'text-blue-500';
    };
</script>
