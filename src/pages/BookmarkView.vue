<!-- src\pages\BookmarkView.vue -->
<script setup>
    import { ref, onMounted, computed } from 'vue';
    import { useHead } from '@vueuse/head';
    import { useFilterState } from '@/composables/portfolio/useFilterState';
    import { joinURL } from 'ufo';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import InputNumber from 'primevue/inputnumber';
    import Button from 'primevue/button';
    import Skeleton from 'primevue/skeleton';
    import Card from 'primevue/card'; // Card import 추가
    import CompanyLogo from '@/components/CompanyLogo.vue';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';

    useHead({ title: '북마크 관리' });

    const { isMobile } = useBreakpoint();
    const { myBookmarks } = useFilterState();
    const isLoading = ref(true);
    const allStockInfo = ref(new Map());
    const editingRows = ref([]);

    const bookmarkedStocks = computed(() => {
        return Object.entries(myBookmarks.value).map(([isin, userData]) => {
            const stockInfo = allStockInfo.value.get(isin);
            const symbol = userData?.symbol || stockInfo?.symbol || isin;
            return {
                isin,
                symbol,
                displayName:
                    stockInfo?.koName || stockInfo?.longName || symbol || isin,
                currency: userData?.currency || stockInfo?.currency || 'USD',
                logo: stockInfo?.logo,
                company: stockInfo?.company,
                ...userData,
            };
        });
    });

    onMounted(async () => {
        const url = joinURL(import.meta.env.BASE_URL, 'nav.json');
        const response = await fetch(url);
        const allStockData = (await response.json()).nav || [];
        allStockInfo.value = new Map(
            allStockData
                .filter((stock) => stock?.isin)
                .map((stock) => [stock.isin.toUpperCase(), stock])
        );
        isLoading.value = false;
    });

    const onRowEditSave = (event) => {
        let { newData } = event;
        const ain = newData.isin;
        if (!ain) return;
        const isin = ain.toUpperCase();
        if (myBookmarks.value[isin]) {
            myBookmarks.value[isin] = {
                ...myBookmarks.value[isin],
                avgPrice: newData.avgPrice || 0,
                quantity: newData.quantity || 0,
                accumulatedDividend: newData.accumulatedDividend || 0,
                targetAsset: newData.targetAsset || 0,
            };
        }
    };

    const deleteBookmark = (entryIsin) => {
        if (!entryIsin) return;
        const isin = entryIsin.toUpperCase();
        if (myBookmarks.value[isin]) {
            delete myBookmarks.value[isin];
        }
    };

    const formatCurrency = (value, currency = 'USD') => {
        if (value === null || value === undefined || isNaN(value)) value = 0;
        return new Intl.NumberFormat(currency === 'KRW' ? 'ko-KR' : 'en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: currency === 'KRW' ? 0 : 2,
            maximumFractionDigits: currency === 'KRW' ? 0 : 2,
        }).format(value);
    };

    const formatNumber = (value) => {
        if (value === null || value === undefined || isNaN(value)) return '0';
        return new Intl.NumberFormat().format(value);
    };
</script>

<template>
    <div id="t-bookmark">
        <DataTable
            :value="bookmarkedStocks"
            editMode="row"
            dataKey="isin"
            v-model:editingRows="editingRows"
            @row-edit-save="onRowEditSave"
            class="p-datatable-sm"
            :loading="isLoading"
            scrollable
            scrollHeight="calc(100vh - 6rem)">
            <Column
                v-if="!isMobile"
                field="company"
                sortable
                class="t-column-company">
                <template #header><span>회사</span></template>
                <template #body="{ data }">
                    <Skeleton
                        v-if="isLoading"
                        width="3rem"
                        height="3rem"></Skeleton>
                    <CompanyLogo
                        v-else
                        :logo-src="data.logo"
                        :company-name="data.company" />
                </template>
            </Column>

            <Column
                field="displayName"
                header="종목명"
                sortable
                style="width: 25%"></Column>

            <Column field="avgPrice" header="평단가" style="width: 15%">
                <template #body="{ data }">
                    {{ formatCurrency(data.avgPrice, data.currency) }}
                </template>
                <template #editor="{ data }">
                    <InputNumber
                        v-model="data.avgPrice"
                        :mode="data.currency === 'KRW' ? 'decimal' : 'currency'"
                        :currency="data.currency"
                        :locale="data.currency === 'KRW' ? 'ko-KR' : 'en-US'" />
                </template>
            </Column>

            <Column field="quantity" header="수량" style="width: 15%">
                <template #body="{ data }">
                    {{ formatNumber(data.quantity) }} 주
                </template>
                <template #editor="{ data }">
                    <InputNumber v-model="data.quantity" suffix=" 주" />
                </template>
            </Column>

            <Column
                field="accumulatedDividend"
                header="누적배당금"
                style="width: 15%">
                <template #body="{ data }">
                    {{
                        formatCurrency(data.accumulatedDividend, data.currency)
                    }}
                </template>
                <template #editor="{ data }">
                    <InputNumber
                        v-model="data.accumulatedDividend"
                        :mode="data.currency === 'KRW' ? 'decimal' : 'currency'"
                        :currency="data.currency"
                        :locale="data.currency === 'KRW' ? 'ko-KR' : 'en-US'" />
                </template>
            </Column>

            <Column field="targetAsset" header="목표 자산" style="width: 15%">
                <template #body="{ data }">
                    {{ formatCurrency(data.targetAsset, data.currency) }}
                </template>
                <template #editor="{ data }">
                    <InputNumber
                        v-model="data.targetAsset"
                        :mode="data.currency === 'KRW' ? 'decimal' : 'currency'"
                        :currency="data.currency"
                        :locale="data.currency === 'KRW' ? 'ko-KR' : 'en-US'" />
                </template>
            </Column>

            <Column
                :rowEditor="true"
                style="width: 5rem"
                bodyStyle="text-align:center"></Column>

            <Column bodyStyle="text-align:center" style="width: 5%">
                <template #body="slotProps">
                    <Button
                        icon="pi pi-trash"
                        severity="danger"
                        text
                        @click="deleteBookmark(slotProps.data.isin)" />
                </template>
            </Column>
        </DataTable>
    </div>
</template>

<style lang="scss" scoped>
    @use '@/styles/functions/breakpoints' as bp;

    :deep(.t-column-company) {
        width: 2rem;

        @include bp.media-breakpoint-down('md') {
            width: 2.25rem;
        }
    }
</style>
