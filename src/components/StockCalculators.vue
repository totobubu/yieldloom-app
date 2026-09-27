<!-- Components/StockCaculators.vue -->
<script setup>
    import { ref } from 'vue';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';
    import Button from 'primevue/button';
    import Drawer from 'primevue/drawer';
    import SelectButton from 'primevue/selectbutton'; // SelectButton import
    import Dropdown from 'primevue/dropdown'; // Dropdown import
    import ProgressSpinner from 'primevue/progressspinner'; // 로딩 스피너 import
    import StockCalculatorsUnified from './calculators/StockCalculatorsUnified.vue';
    import { user } from '@/store/auth'; // [핵심 수정] 이 한 줄이 빠져있었습니다!

    const { isDesktop, isMobile } = useBreakpoint();

    defineProps({
        dividendHistory: Array,
        tickerInfo: Object,
        userBookmark: Object,
    });

    const isDrawerVisible = ref(false);

    // --- [핵심 수정] 계산기 선택 상태를 부모로 이동 ---
    const activeCalculator = ref('recovery');
    const calculatorOptions = ref([
        { label: '원금 회수', value: 'recovery' },
        { label: '목표 달성', value: 'reinvestment' },
        { label: '예상 배당', value: 'yield' },
    ]);

    const headerInfo = ref({
        currentPrice: 0,
        exchangeRate: 0,
        isUSD: true,
        currency: 'USD',
        currencyLocale: 'en-US',
    });

    const handleHeaderInfoUpdate = (info) => {
        headerInfo.value = info;
    };

    // [핵심 수정 1] 자식 컴포넌트의 함수를 호출하기 위한 ref 생성
    const unifiedComponentRef = ref(null);
</script>

<template>
    <div id="t-calculator-button">
        <Button
            icon="pi pi-calculator"
            @click="isDrawerVisible = true"
            severity="secondary"
            text
            aria-label="Calculators" />

        <Drawer
            id="t-stock-calculator"
            v-model:visible="isDrawerVisible"
            position="bottom"
            style="height: auto"
            modal>
            <template #header>
                <div class="flex flex-column gap-2 w-full">
                    <div
                        class="flex justify-content-between align-items-center w-full">
                        <!-- [핵심 수정 2] 모바일/데스크탑에 따라 다른 컴포넌트 표시 -->
                        <SelectButton
                            v-if="!isMobile"
                            v-model="activeCalculator"
                            :options="calculatorOptions"
                            optionLabel="label"
                            optionValue="value" />
                        <Dropdown
                            v-else
                            v-model="activeCalculator"
                            :options="calculatorOptions"
                            optionLabel="label"
                            optionValue="value"
                            class="flex-grow-1" />

                        <div
                            v-if="headerInfo.currentPrice > 0"
                            class="flex align-items-center justify-content-end gap-2 text-sm">
                            <Tag v-if="!headerInfo.isUSD" severity="contrast">
                                환율 :
                                {{
                                    headerInfo.exchangeRate?.toLocaleString(
                                        'ko-KR'
                                    )
                                }}원
                            </Tag>
                            <Tag severity="contrast">
                                현재 주가 :
                                {{
                                    headerInfo.currentPrice?.toLocaleString(
                                        headerInfo.currencyLocale,
                                        {
                                            style: 'currency',
                                            currency: headerInfo.currency,
                                        }
                                    )
                                }}
                            </Tag>
                        </div>
                        <!-- [핵심 수정 3] 헤더 오른쪽에 버튼 그룹 추가 -->
                        <div v-if="user" class="flex ml-4">
                            <Button
                                icon="pi pi-save"
                                @click="unifiedComponentRef?.saveToBookmark()"
                                severity="success"
                                text
                                rounded
                                aria-label="Save" />
                            <Button
                                icon="pi pi-folder-open"
                                @click="unifiedComponentRef?.loadFromBookmark()"
                                severity="info"
                                text
                                rounded
                                aria-label="Load" />
                            <Button
                                icon="pi pi-refresh"
                                @click="
                                    unifiedComponentRef?.resetToCurrentPrice()
                                "
                                severity="secondary"
                                text
                                rounded
                                aria-label="Reset" />
                        </div>
                    </div>
                </div>
            </template>

            <div
                v-if="
                    isDrawerVisible &&
                    dividendHistory &&
                    dividendHistory.length > 0
                ">
                <!-- [핵심 수정 4] 자식 컴포넌트에 ref 연결 -->
                <StockCalculatorsUnified
                    ref="unifiedComponentRef"
                    :active-calculator="activeCalculator"
                    :dividendHistory="dividendHistory"
                    :tickerInfo="tickerInfo"
                    :userBookmark="userBookmark"
                    @update-header-info="handleHeaderInfoUpdate" />
            </div>
            <div
                v-else
                class="flex justify-content-center align-items-center"
                style="min-height: 300px">
                <ProgressSpinner />
            </div>
        </Drawer>
    </div>
</template>
