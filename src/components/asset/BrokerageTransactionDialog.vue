<!-- src/components/asset/BrokerageTransactionDialog.vue -->
<template>
    <Drawer v-model:visible="isVisible" :header="title" position="full">
        <div v-if="isLoading" class="flex justify-content-center p-4">
            <ProgressSpinner />
        </div>

        <div v-else-if="transactions.length === 0" class="text-center p-4">
            <p class="text-color-secondary">거래 내역이 없습니다.</p>
        </div>

        <TabView v-else>
            <!-- 탭 1: 거래내역 -->
            <TabPanel header="거래내역">
                <div class="flex flex-column gap-3">
                    <!-- Info message -->
                    <Message severity="info" :closable="false">
                        <small>
                            {{ filterInfoMessage }}
                        </small>
                    </Message>
                    <!-- 필터들 -->
                    <div class="flex flex-column gap-2">
                        <!-- 유형 필터 -->
                        <div class="flex align-items-center gap-2">
                            <label class="font-semibold" style="min-width: 80px"
                                >유형 필터:</label
                            >
                            <div class="flex gap-2 flex-wrap">
                                <Button
                                    label="전체"
                                    :outlined="selectedTypeFilter !== null"
                                    size="small"
                                    @click="selectedTypeFilter = null" />
                                <Button
                                    v-for="type in uniqueTypes"
                                    :key="type.value"
                                    :label="type.label"
                                    :outlined="
                                        selectedTypeFilter !== type.value
                                    "
                                    size="small"
                                    @click="selectedTypeFilter = type.value" />
                            </div>
                        </div>

                        <!-- 계좌 필터 -->
                        <div
                            v-if="uniqueAccounts.length > 1"
                            class="flex align-items-center gap-2">
                            <label class="font-semibold" style="min-width: 80px"
                                >계좌 필터:</label
                            >
                            <div class="flex gap-2 flex-wrap">
                                <Button
                                    label="전체"
                                    :outlined="selectedAccountFilter !== null"
                                    size="small"
                                    @click="selectedAccountFilter = null" />
                                <Button
                                    v-for="account in uniqueAccounts"
                                    :key="account.id"
                                    :label="account.name"
                                    :outlined="
                                        selectedAccountFilter !== account.id
                                    "
                                    size="small"
                                    @click="
                                        selectedAccountFilter = account.id
                                    " />
                            </div>
                        </div>
                    </div>

                    <!-- 기간 필터 -->
                    <div class="flex align-items-center gap-2">
                        <label>기간 필터:</label>
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
                                label="2년"
                                :outlined="selectedPeriod !== 24"
                                size="small"
                                @click="selectedPeriod = 24" />
                            <Button
                                label="3년"
                                :outlined="selectedPeriod !== 36"
                                size="small"
                                @click="selectedPeriod = 36" />
                            <Button
                                label="5년"
                                :outlined="selectedPeriod !== 60"
                                size="small"
                                @click="selectedPeriod = 60" />
                            <Button
                                label="전체"
                                :outlined="selectedPeriod !== null"
                                size="small"
                                @click="selectedPeriod = null" />
                        </div>
                    </div>

                    <!-- 거래내역 테이블 -->
                    <DataTable
                        :value="filteredTransactions"
                        stripedRows
                        class="p-datatable-sm"
                        sortField="date"
                        :sortOrder="-1">
                        <Column
                            field="date"
                            header="날짜"
                            sortable
                            style="width: 120px">
                            <template #body="slotProps">
                                {{ formatDate(slotProps.data.date) }}
                            </template>
                        </Column>

                        <!-- 계좌명 -->
                        <Column
                            field="accountName"
                            header="계좌"
                            style="min-width: 120px">
                            <template #body="slotProps">
                                {{ slotProps.data.accountName || '-' }}
                            </template>
                        </Column>

                        <!-- 종목명 -->
                        <Column
                            field="assetName"
                            header="종목"
                            style="min-width: 150px">
                            <template #body="slotProps">
                                <div class="flex flex-column">
                                    <span class="font-bold">{{
                                        getAssetDisplayName(slotProps.data)
                                    }}</span>
                                </div>
                            </template>
                        </Column>

                        <Column field="type" header="유형" style="width: 100px">
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
                        <Column
                            field="quantity"
                            header="수량"
                            style="width: 100px">
                            <template #body="slotProps">
                                {{ formatNumber(slotProps.data.quantity) }}
                            </template>
                        </Column>

                        <!-- 컬럼 그룹 헤더 -->
                        <ColumnGroup type="header">
                            <Row>
                                <Column header="날짜" :rowspan="2" />
                                <Column header="계좌" :rowspan="2" />
                                <Column header="종목" :rowspan="2" />
                                <Column header="유형" :rowspan="2" />
                                <Column header="수량" :rowspan="2" />
                                <Column
                                    v-if="hasUSDTransactions"
                                    header="USD"
                                    :colspan="2" />
                                <Column header="KRW" :colspan="4" />
                            </Row>
                            <Row>
                                <Column
                                    v-if="hasUSDTransactions"
                                    header="단가"
                                    field="priceUSD" />
                                <Column
                                    v-if="hasUSDTransactions"
                                    header="금액"
                                    field="amountUSD" />
                                <Column header="단가" field="price" />
                                <Column header="금액" field="amount" />
                                <Column header="환율" field="exchangeRate" />
                                <Column header="제세금" field="tax" />
                            </Row>
                        </ColumnGroup>

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
                                <span
                                    :class="
                                        getAmountColorClass(
                                            slotProps.data.type,
                                            slotProps.data.amountUSD
                                        )
                                    ">
                                    {{
                                        slotProps.data.amountUSD
                                            ? formatCurrency(
                                                  slotProps.data.amountUSD,
                                                  'USD'
                                              )
                                            : '-'
                                    }}
                                </span>
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

                        <!-- 환율 -->
                        <Column field="exchangeRate" style="width: 100px">
                            <template #body="slotProps">
                                {{
                                    slotProps.data.exchangeRate
                                        ? formatNumber(
                                              slotProps.data.exchangeRate
                                          )
                                        : '-'
                                }}
                            </template>
                        </Column>

                        <!-- 제세금 -->
                        <Column field="tax" style="width: 100px">
                            <template #body="slotProps">
                                {{
                                    slotProps.data.tax
                                        ? formatCurrency(
                                              slotProps.data.tax,
                                              'KRW'
                                          )
                                        : '-'
                                }}
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
            </TabPanel>

            <!-- 탭 2: 배당내역 (증권사의 모든 배당) -->
            <TabPanel header="배당내역">
                <div class="flex flex-column gap-3">
                    <DataTable
                        :value="dividendTransactions"
                        stripedRows
                        class="p-datatable-sm"
                        sortField="exDividendDate"
                        :sortOrder="-1">
                        <Column
                            field="exDividendDate"
                            header="배당락"
                            sortable
                            style="width: 120px">
                            <template #body="slotProps">
                                {{ formatDate(slotProps.data.exDividendDate) }}
                            </template>
                        </Column>
                        <Column
                            field="paymentDate"
                            header="배당입금"
                            sortable
                            style="width: 120px">
                            <template #body="slotProps">
                                {{ formatDate(slotProps.data.paymentDate) }}
                            </template>
                        </Column>
                        <Column
                            field="currentPrice"
                            header="당일종가"
                            style="width: 110px">
                            <template #body="slotProps">
                                {{
                                    slotProps.data.currentPrice
                                        ? formatCurrency(
                                              slotProps.data.currentPrice,
                                              'USD'
                                          )
                                        : '-'
                                }}
                            </template>
                        </Column>
                        <Column
                            field="shares"
                            header="보유기준수"
                            style="width: 110px">
                            <template #body="slotProps">
                                {{ formatNumber(slotProps.data.shares) }}
                            </template>
                        </Column>
                        <Column
                            field="dividendPerShare"
                            header="주당지급"
                            style="width: 110px">
                            <template #body="slotProps">
                                {{
                                    slotProps.data.dividendPerShare
                                        ? formatCurrency(
                                              slotProps.data.dividendPerShare,
                                              'USD'
                                          )
                                        : '-'
                                }}
                            </template>
                        </Column>
                        <Column
                            field="grossDividend"
                            header="외화과표(세전)"
                            style="width: 130px">
                            <template #body="slotProps">
                                {{
                                    slotProps.data.grossDividend
                                        ? formatCurrency(
                                              slotProps.data.grossDividend,
                                              'USD'
                                          )
                                        : '-'
                                }}
                            </template>
                        </Column>
                        <Column
                            field="netDividendUSD"
                            header="세후배당금(USD)"
                            style="width: 140px">
                            <template #body="slotProps">
                                <span class="text-green-600 font-bold">
                                    {{
                                        slotProps.data.netDividendUSD
                                            ? formatCurrency(
                                                  slotProps.data.netDividendUSD,
                                                  'USD'
                                              )
                                            : '-'
                                    }}
                                </span>
                            </template>
                        </Column>
                        <Column
                            field="krwTaxBase"
                            header="원화과표"
                            style="width: 130px">
                            <template #body="slotProps">
                                {{
                                    slotProps.data.krwTaxBase
                                        ? formatCurrency(
                                              slotProps.data.krwTaxBase,
                                              'KRW'
                                          )
                                        : '-'
                                }}
                            </template>
                        </Column>
                        <Column
                            field="netDividendKRW"
                            header="세후배당금(KRW)"
                            style="width: 140px">
                            <template #body="slotProps">
                                <span class="text-green-600 font-bold">
                                    {{
                                        slotProps.data.netDividendKRW
                                            ? formatCurrency(
                                                  slotProps.data.netDividendKRW,
                                                  'KRW'
                                              )
                                            : '-'
                                    }}
                                </span>
                            </template>
                        </Column>
                        <Column
                            field="cumulativeDividend"
                            header="누적배당"
                            style="width: 130px">
                            <template #body="slotProps">
                                {{
                                    slotProps.data.cumulativeDividend
                                        ? formatCurrency(
                                              slotProps.data.cumulativeDividend,
                                              'USD'
                                          )
                                        : '-'
                                }}
                            </template>
                        </Column>
                        <template #empty>
                            <div class="text-center p-4">
                                <p class="text-color-secondary">
                                    배당 내역이 없습니다.
                                </p>
                            </div>
                        </template>
                    </DataTable>
                </div>
            </TabPanel>
        </TabView>
    </Drawer>
</template>

<script setup>
    import { ref, computed } from 'vue';
    import Drawer from 'primevue/drawer';
    import TabView from 'primevue/tabview';
    import TabPanel from 'primevue/tabpanel';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import ColumnGroup from 'primevue/columngroup';
    import Row from 'primevue/row';
    import Tag from 'primevue/tag';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import ProgressSpinner from 'primevue/progressspinner';
    import { getTransactionTypeLabel } from '@/utils/transactionTypeMapper';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        title: {
            type: String,
            default: '증권사별 거래 내역',
        },
        transactions: {
            type: Array,
            default: () => [],
        },
        isLoading: {
            type: Boolean,
            default: false,
        },
    });

    const emit = defineEmits(['update:visible']);

    const isVisible = computed({
        get: () => props.visible,
        set: (value) => emit('update:visible', value),
    });

    // 유형 필터
    const selectedTypeFilter = ref(null);

    // 계좌 필터
    const selectedAccountFilter = ref(null);

    // 기간 필터 (개월 단위)
    const selectedPeriod = ref(3); // 기본 3개월

    // USD 거래 여부 확인
    const hasUSDTransactions = computed(() => {
        return props.transactions.some(
            (t) =>
                t.priceUSD !== undefined ||
                t.amountUSD !== undefined ||
                t.exchangeRate !== undefined
        );
    });

    // 유니크한 거래 유형 목록
    const uniqueTypes = computed(() => {
        const typeMap = new Map();

        props.transactions.forEach((t) => {
            if (t.type) {
                const label = getTransactionTypeLabel(t.type, t.rawType);
                if (!typeMap.has(t.type)) {
                    typeMap.set(t.type, label);
                }
            }
        });

        return Array.from(typeMap.entries())
            .map(([value, label]) => ({ value, label }))
            .sort((a, b) => a.label.localeCompare(b.label));
    });

    // 유니크한 계좌 목록
    const uniqueAccounts = computed(() => {
        const accountMap = new Map();

        props.transactions.forEach((t) => {
            if (t.accountId && t.accountName) {
                if (!accountMap.has(t.accountId)) {
                    accountMap.set(t.accountId, {
                        id: t.accountId,
                        name: t.accountName,
                    });
                }
            }
        });

        return Array.from(accountMap.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    });

    // 필터링된 거래내역
    const filteredTransactions = computed(() => {
        let filtered = props.transactions;

        // 유형 필터
        if (selectedTypeFilter.value) {
            filtered = filtered.filter(
                (t) => t.type === selectedTypeFilter.value
            );
        }

        // 계좌 필터
        if (selectedAccountFilter.value) {
            filtered = filtered.filter(
                (t) => t.accountId === selectedAccountFilter.value
            );
        }

        // 기간 필터
        if (selectedPeriod.value !== null) {
            const cutoffDate = new Date();
            cutoffDate.setMonth(cutoffDate.getMonth() - selectedPeriod.value);

            filtered = filtered.filter((t) => {
                if (!t.date) return true;

                let transactionDate;
                if (t.date.toDate) {
                    transactionDate = t.date.toDate();
                } else if (typeof t.date === 'string' && t.date.length === 8) {
                    const year = parseInt(t.date.substring(0, 4));
                    const month = parseInt(t.date.substring(4, 6)) - 1;
                    const day = parseInt(t.date.substring(6, 8));
                    transactionDate = new Date(year, month, day);
                } else if (t.date instanceof Date) {
                    transactionDate = t.date;
                } else {
                    return true;
                }

                return transactionDate >= cutoffDate;
            });
        }

        return filtered;
    });

    // 배당 거래만 필터링
    const dividendTransactions = computed(() => {
        return props.transactions
            .filter((t) => t.type === '배당' || t.rawType === 'dividend')
            .map((t) => ({
                exDividendDate: t.exDividendDate || t.date,
                paymentDate: t.paymentDate || t.date,
                currentPrice: t.currentPrice || t.price,
                shares: t.shares || t.quantity,
                dividendPerShare: t.dividendPerShare || t.price,
                grossDividend: t.grossDividend || t.amountUSD,
                netDividendUSD: t.netDividendUSD || t.amountUSD,
                krwTaxBase: t.krwTaxBase || t.amount,
                netDividendKRW: t.netDividendKRW || t.amount,
                cumulativeDividend: t.cumulativeDividend,
            }));
    });

    // 필터 정보 메시지
    const filterInfoMessage = computed(() => {
        if (selectedPeriod.value === null) {
            return `전체 기간 데이터를 표시합니다. (총 ${filteredTransactions.value.length}건)`;
        }
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - selectedPeriod.value);
        const cutoffStr = cutoffDate.toLocaleDateString('ko-KR');
        const todayStr = new Date().toLocaleDateString('ko-KR');
        return `${cutoffStr} ~ ${todayStr} (${selectedPeriod.value}개월, 총 ${filteredTransactions.value.length}건)`;
    });

    const formatDate = (date) => {
        if (!date) return '-';
        if (date.toDate) {
            return date.toDate().toLocaleDateString('ko-KR');
        }
        if (typeof date === 'string' && date.length === 8) {
            return `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
        }
        if (date instanceof Date) {
            return date.toLocaleDateString('ko-KR');
        }
        return date;
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
        let validCurrency = 'KRW';
        if (currency) {
            const validCurrencies = [
                'KRW',
                'USD',
                'EUR',
                'JPY',
                'CNY',
                'GBP',
                'AUD',
                'CAD',
                'CHF',
                'HKD',
                'SGD',
            ];
            validCurrency = validCurrencies.includes(currency.toUpperCase())
                ? currency.toUpperCase()
                : 'KRW';
        }
        try {
            return new Intl.NumberFormat('ko-KR', {
                style: 'currency',
                currency: validCurrency,
                minimumFractionDigits:
                    validCurrency === 'KRW' || validCurrency === 'JPY' ? 0 : 2,
                maximumFractionDigits:
                    validCurrency === 'KRW' || validCurrency === 'JPY' ? 0 : 2,
            }).format(value);
        } catch (error) {
            return new Intl.NumberFormat('ko-KR', {
                minimumFractionDigits: 0,
                maximumFractionDigits: 2,
            }).format(value);
        }
    };

    const getTransactionTypeSeverity = (type) => {
        switch (type) {
            case '매수':
            case '입금':
                return 'success';
            case '매도':
            case '출금':
                return 'danger';
            case '배당':
            case '이자':
                return 'info';
            default:
                return 'secondary';
        }
    };

    const getAmountColorClass = (type, amount) => {
        if (type === 'buy' || type === 'deposit') {
            return 'text-green-600';
        } else if (type === 'sell' || type === 'withdrawal') {
            return 'text-red-600';
        }
        return '';
    };

    const getAssetDisplayName = (transaction) => {
        if (!transaction) return '-';
        if (transaction.assetSymbol && transaction.currency !== 'KRW') {
            return transaction.assetSymbol;
        }
        return transaction.assetName || transaction.assetSymbol || '-';
    };
</script>
