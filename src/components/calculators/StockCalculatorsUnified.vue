<!-- src/components/calculators/StockCalculatorsUnified.vue -->
<script setup>
    import { ref, computed, watch, onMounted } from 'vue';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';
    import { useDividendStats } from '@/composables/data/useDividendStats';
    import { useRecoveryChart } from '@/composables/ui/charts/useRecoveryChart.js';
    import { useReinvestmentChart } from '@/composables/ui/charts/useReinvestmentChart.js';
    import { useFilterState } from '@/composables/portfolio/useFilterState';
    import { user } from '@/store/auth';
    import { formatMonthsToYears } from '@/utils/date.js';
    import VChart from 'vue-echarts';

    // PrimeVue Imports
    import CalculatorLayout from './CalculatorLayout.vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';
    import InputNumber from 'primevue/inputnumber';
    import RadioButton from 'primevue/radiobutton';
    import SelectButton from 'primevue/selectbutton';
    import Tag from 'primevue/tag';
    import IftaLabel from 'primevue/iftalabel';
    import ProgressSpinner from 'primevue/progressspinner';

    const props = defineProps({
        activeCalculator: String,
        dividendHistory: Array,
        tickerInfo: Object,
        userBookmark: Object,
    });

    const { isMobile } = useBreakpoint();

    const emit = defineEmits(['update-header-info']);

    const tickerInfo = computed(() => props.tickerInfo);
    const dividendHistory = computed(() => props.dividendHistory);
    const userBookmark = computed(() => props.userBookmark || {});
    const currency = computed(() => props.tickerInfo?.currency || 'USD');
    const isUSD = computed(() => currency.value === 'USD');
    const currencyLocale = computed(() => (isUSD.value ? 'en-US' : 'ko-KR'));
    const currentPrice = computed(
        () => props.tickerInfo?.regularMarketPrice || 0
    );

    const avgPrice = ref(0);
    const quantity = ref(100);
    const period = ref('5');
    const periodOptions = ref([
        { label: '최근 5회', value: '5' },
        { label: '최근 10회', value: '10' },
        { label: '최근 20회', value: '20' },
    ]);
    const applyTax = ref(true);
    const taxOptions = ref([
        { label: '세전', value: false },
        { label: '세후 (15%)', value: true },
    ]);

    const { dividendStats, payoutsPerYear } = useDividendStats(
        dividendHistory,
        tickerInfo,
        period
    );

    // Recovery Calculator state
    const accumulatedDividend = ref(
        userBookmark.value?.accumulatedDividend || 0
    );
    const recoveryCalcMode = ref('amount');
    const investmentPrincipal = computed(
        () => (quantity.value || 0) * (avgPrice.value || 0)
    );
    const recoveryRate = computed({
        get: () =>
            investmentPrincipal.value === 0
                ? 0
                : (accumulatedDividend.value / investmentPrincipal.value) * 100,
        set: (val) => {
            accumulatedDividend.value = investmentPrincipal.value * (val / 100);
        },
    });

    // Reinvestment Calculator state
    const targetAsset = ref(
        userBookmark.value?.targetAsset || (isUSD.value ? 100000 : 100000000)
    );

    // [핵심 수정 1] X축으로 사용할 주가 성장률 옵션 정의
    const allAnnualGrowthRateOptions = ref([
        { label: '-5%', value: -5 },
        { label: '-3%', value: -3 },
        { label: '0%', value: 0 },
        { label: '3%', value: 3 },
        { label: '5%', value: 5 },
        { label: '10%', value: 10 },
    ]);
    // 기존 annualGrowthRate ref는 더 이상 UI와 연결되지 않으므로 제거하거나 유지해도 무방
    const annualGrowthRate = ref(0);

    const currentValue = computed(
        () => (quantity.value || 0) * currentPrice.value
    );
    const profitLossRate = computed(() =>
        investmentPrincipal.value === 0
            ? 0
            : ((currentValue.value - investmentPrincipal.value) /
                  investmentPrincipal.value) *
              100
    );

    // Yield Calculator state
    const yieldCalcMode = ref('quantity');
    const inputAmount = ref(isUSD.value ? 10000 : 10000000);
    const exchangeRate = ref(1380);

    watch(inputAmount, (newAmount) => {
        if (yieldCalcMode.value === 'amount' && currentPrice.value > 0) {
            quantity.value = Math.floor(newAmount / currentPrice.value);
        }
    });
    watch(quantity, (newQuantity) => {
        if (yieldCalcMode.value === 'quantity' && currentPrice.value > 0) {
            inputAmount.value = newQuantity * currentPrice.value;
        }
    });

    const documentStyle = getComputedStyle(document.documentElement);
    const chartTheme = computed(() => ({
        textColor: documentStyle.getPropertyValue('--p-text-color'),
        textColorSecondary: documentStyle.getPropertyValue(
            '--p-text-muted-color'
        ),
        surfaceBorder: documentStyle.getPropertyValue(
            '--p-content-border-color'
        ),
    }));

    const { recoveryTimes, chartOptions: recoveryChartOptions } =
        useRecoveryChart({
            avgPrice,
            quantity,
            accumulatedDividend,
            dividendStats,
            payoutsPerYear,
            applyTax,
            currentPrice,
            currency,
            theme: chartTheme,
        });

    // [핵심 수정 2] useReinvestmentChart에 allAnnualGrowthRateOptions 전달
    const { goalAchievementTimes, chartOptions: reinvestmentChartOptions } =
        useReinvestmentChart({
            currentAssets: currentValue,
            targetAmount: targetAsset,
            payoutsPerYear,
            dividendStats,
            allAnnualGrowthRateOptions, // 새로운 옵션 배열 전달
            applyTax,
            currentPrice,
            currency,
            theme: chartTheme,
        });

    const expectedDividends = computed(() => {
        const calculate = (dividendPerShare, taxRate) => {
            if (!quantity.value || !dividendPerShare || !payoutsPerYear.value)
                return { perPayout: 0, monthly: 0, annual: 0 };
            const total = quantity.value * dividendPerShare * taxRate;
            const annual = total * payoutsPerYear.value;
            return { perPayout: total, monthly: annual / 12, annual };
        };
        const scenarios = (tax) => ({
            hope: calculate(dividendStats.value.max, tax),
            avg: calculate(dividendStats.value.avg, tax),
            despair: calculate(dividendStats.value.min, tax),
        });
        return { preTax: scenarios(1.0), postTax: scenarios(0.85) };
    });

    const isReady = computed(
        () =>
            dividendStats.value &&
            recoveryTimes.value &&
            goalAchievementTimes.value &&
            expectedDividends.value
    );

    const { updateBookmarkDetails } = useFilterState();
    const getDefaultQuantity = () => {
        if (!currentPrice.value) return 100;
        if (isUSD.value) {
            if (currentPrice.value >= 1000) return 10;
            if (currentPrice.value >= 100) return 100;
            if (currentPrice.value >= 10) return 1000;
        } else {
            if (currentPrice.value >= 1000000) return 10;
            if (currentPrice.value >= 100000) return 100;
            if (currentPrice.value >= 10000) return 1000;
        }
        return 10000;
    };

    const setInputValues = (source = {}) => {
        avgPrice.value = source.avgPrice || currentPrice.value || 0;
        quantity.value = source.quantity || getDefaultQuantity();
        accumulatedDividend.value = source.accumulatedDividend || 0;
        targetAsset.value =
            source.targetAsset || (isUSD.value ? 100000 : 100000000);
    };
    const saveToBookmark = () => {
        if (
            user.value &&
            (props.tickerInfo?.isin || props.tickerInfo?.symbol)
        ) {
            updateBookmarkDetails(
                props.tickerInfo.isin || props.tickerInfo.symbol,
                {
                    avgPrice: avgPrice.value,
                    quantity: quantity.value,
                    accumulatedDividend: accumulatedDividend.value,
                    targetAsset: targetAsset.value,
                }
            );
        }
    };

    const loadFromBookmark = () =>
        props.userBookmark && setInputValues(props.userBookmark);
    const resetToCurrentPrice = () => setInputValues();
    defineExpose({ saveToBookmark, loadFromBookmark, resetToCurrentPrice });

    watch(
        () => currentPrice.value,
        (newPrice) => {
            if (newPrice > 0) setInputValues(userBookmark.value || {});
        },
        { immediate: true }
    );

    const formatKRW = (amount) =>
        (amount * exchangeRate.value).toLocaleString('ko-KR', {
            maximumFractionDigits: 0,
        }) + '원';

    watch(
        [() => currentPrice.value, exchangeRate, () => isUSD.value],
        () => {
            emit('update-header-info', {
                currentPrice: currentPrice.value,
                exchangeRate: exchangeRate.value,
                isUSD: isUSD.value,
                currency: currency.value,
                currencyLocale: currencyLocale.value,
            });
        },
        { immediate: true, deep: true }
    );

    onMounted(async () => {
        if (!isUSD.value) return;
        try {
            const res = await fetch('/api/getExchangeRate');
            if (res.ok) exchangeRate.value = (await res.json()).price;
        } catch (e) {
            console.error(e);
        }
    });
</script>

<template>
    <div v-if="isReady" :class="isMobile ? 'p-2' : ''">
        <CalculatorLayout>
            <template #avgPriceAndQuantity>
                <div class="flex flex-col gap-3">
                    <InputGroup v-if="activeCalculator !== 'yield'">
                        <IftaLabel>
                            <InputNumber
                                v-model="avgPrice"
                                :mode="isUSD ? 'currency' : 'decimal'"
                                :currency="currency"
                                :locale="currencyLocale"
                                inputId="avgPrice" />
                            <label for="avgPrice">평단</label>
                        </IftaLabel>
                    </InputGroup>
                    <InputGroup v-else>
                        <InputGroupAddon>
                            <RadioButton
                                v-model="yieldCalcMode"
                                value="amount" />
                        </InputGroupAddon>
                        <IftaLabel>
                            <InputNumber
                                v-model="inputAmount"
                                :mode="isUSD ? 'currency' : 'decimal'"
                                :currency="currency"
                                :locale="currencyLocale"
                                :disabled="yieldCalcMode !== 'amount'" />
                            <label>매수금</label>
                        </IftaLabel>
                    </InputGroup>
                    <InputGroup v-if="activeCalculator !== 'yield'">
                        <IftaLabel>
                            <InputNumber
                                v-model="quantity"
                                suffix=" 주"
                                min="1"
                                inputId="quantity" />
                            <label for="quantity">수량</label>
                        </IftaLabel>
                    </InputGroup>
                    <InputGroup v-else>
                        <InputGroupAddon>
                            <RadioButton
                                v-model="yieldCalcMode"
                                value="quantity" />
                        </InputGroupAddon>
                        <IftaLabel>
                            <InputNumber
                                v-model="quantity"
                                suffix=" 주"
                                min="1"
                                :disabled="yieldCalcMode !== 'quantity'" />
                            <label>수량</label>
                        </IftaLabel>
                    </InputGroup>
                    <InputGroup v-if="activeCalculator == 'reinvestment'">
                        <IftaLabel>
                            <InputNumber
                                v-model="targetAsset"
                                :mode="isUSD ? 'currency' : 'decimal'"
                                :currency="currency"
                                :locale="currencyLocale"
                                :disabled="
                                    activeCalculator !== 'reinvestment'
                                " />
                            <label>목표 자산</label>
                        </IftaLabel>
                    </InputGroup>
                </div>
            </template>

            <template #investmentPrincipalAndCurrentValue>
                <InputGroup v-if="activeCalculator !== 'yield'">
                    <IftaLabel>
                        <InputNumber
                            :modelValue="investmentPrincipal"
                            :mode="isUSD ? 'currency' : 'decimal'"
                            :currency="currency"
                            :locale="currencyLocale"
                            disabled />
                        <label>투자원금</label>
                    </IftaLabel>
                    <IftaLabel>
                        <InputNumber
                            :modelValue="currentValue"
                            :mode="isUSD ? 'currency' : 'decimal'"
                            :currency="currency"
                            :locale="currencyLocale"
                            disabled />
                        <label>현재가치</label>
                    </IftaLabel>
                    <Tag
                        :severity="profitLossRate >= 0 ? 'success' : 'danger'"
                        :value="`${profitLossRate.toFixed(2)}%`" />
                </InputGroup>
            </template>

            <template #accumulatedDividend>
                <div
                    v-if="activeCalculator == 'recovery'"
                    class="flex flex-coln gap-3">
                    <InputGroup>
                        <InputGroupAddon>
                            <RadioButton
                                v-model="recoveryCalcMode"
                                value="amount"
                                :disabled="activeCalculator !== 'recovery'" />
                        </InputGroupAddon>
                        <IftaLabel>
                            <InputNumber
                                v-model="accumulatedDividend"
                                :mode="isUSD ? 'currency' : 'decimal'"
                                :currency="currency"
                                :locale="currencyLocale"
                                :disabled="
                                    recoveryCalcMode !== 'amount' ||
                                    activeCalculator !== 'recovery'
                                " />
                            <label
                                >누적 배당금
                                <span v-if="isUSD">$</span>
                                <span v-else>won</span>
                            </label>
                        </IftaLabel>
                    </InputGroup>
                    <InputGroup>
                        <InputGroupAddon
                            ><RadioButton
                                v-model="recoveryCalcMode"
                                value="rate"
                                :disabled="activeCalculator !== 'recovery'"
                        /></InputGroupAddon>
                        <IftaLabel>
                            <InputNumber
                                v-model="recoveryRate"
                                suffix=" %"
                                :disabled="
                                    recoveryCalcMode !== 'rate' ||
                                    activeCalculator !== 'recovery'
                                " />
                            <label>원금 회수율</label>
                        </IftaLabel>
                    </InputGroup>
                </div>
            </template>

            <template #periodSelect>
                <div class="p-inputgroup">
                    <span class="p-iftalabel">
                        <span
                            class="p-inputnumber p-component p-inputwrapper p-inputwrapper-filled">
                            <span
                                class="p-inputtext p-component p-filled p-inputnumber-input">
                                <SelectButton
                                    v-model="period"
                                    :options="periodOptions"
                                    optionLabel="label"
                                    optionValue="value"
                                    size="small"
                                    fluid />
                            </span>
                        </span>
                        <label>前 배당금 참고 기간</label>
                    </span>
                </div>
            </template>

            <template #taxSelect>
                <div class="p-inputgroup">
                    <span class="p-iftalabel">
                        <span
                            class="p-inputnumber p-component p-inputwrapper p-inputwrapper-filled">
                            <span
                                class="p-inputtext p-component p-filled p-inputnumber-input">
                                <SelectButton
                                    v-model="applyTax"
                                    :options="taxOptions"
                                    optionValue="value"
                                    size="small"
                                    dataKey="value"
                                    fluid>
                                    <template #option="slotProps">
                                        <span>{{
                                            slotProps.option.label
                                        }}</span>
                                    </template>
                                </SelectButton>
                            </span>
                        </span>
                        <label>세금 적용</label>
                    </span>
                </div>
            </template>

            <template #resultsDividend>
                <div
                    class="p-datatable p-component p-datatable-gridlines p-datatable-sm">
                    <div class="p-datatable-table-container">
                        <table class="p-datatable-table">
                            <thead class="p-datatable-thead">
                                <tr>
                                    <th class="text-center">세금</th>
                                    <th class="text-center">희망</th>
                                    <th class="text-center">평균</th>
                                    <th class="text-center">절망</th>
                                </tr>
                            </thead>
                            <tbody class="p-datatable-tbody">
                                <tr>
                                    <th class="text-center">0 %</th>
                                    <td class="text-center">
                                        <span class="text-green-500">
                                            {{
                                                (
                                                    dividendStats.max || 0
                                                ).toLocaleString(
                                                    currencyLocale,
                                                    {
                                                        style: 'currency',
                                                        currency: currency,
                                                        maximumFractionDigits: 4,
                                                    }
                                                )
                                            }}
                                        </span>
                                    </td>
                                    <td class="text-center">
                                        <span class="text-yellow-500">
                                            {{
                                                (
                                                    dividendStats.avg || 0
                                                ).toLocaleString(
                                                    currencyLocale,
                                                    {
                                                        style: 'currency',
                                                        currency: currency,
                                                        maximumFractionDigits: 4,
                                                    }
                                                )
                                            }}
                                        </span>
                                    </td>
                                    <td class="text-center">
                                        <span class="text-red-500">
                                            {{
                                                (
                                                    dividendStats.min || 0
                                                ).toLocaleString(
                                                    currencyLocale,
                                                    {
                                                        style: 'currency',
                                                        currency: currency,
                                                        maximumFractionDigits: 4,
                                                    }
                                                )
                                            }}
                                        </span>
                                    </td>
                                </tr>
                                <tr>
                                    <th class="text-center">15 %</th>
                                    <td class="text-center">
                                        <span class="text-green-500">
                                            {{
                                                (
                                                    (dividendStats.max || 0) *
                                                    0.85
                                                ).toLocaleString(
                                                    currencyLocale,
                                                    {
                                                        style: 'currency',
                                                        currency: currency,
                                                        maximumFractionDigits: 4,
                                                    }
                                                )
                                            }}
                                        </span>
                                    </td>
                                    <td class="text-center">
                                        <span class="text-yellow-500">
                                            {{
                                                (
                                                    (dividendStats.avg || 0) *
                                                    0.85
                                                ).toLocaleString(
                                                    currencyLocale,
                                                    {
                                                        style: 'currency',
                                                        currency: currency,
                                                        maximumFractionDigits: 4,
                                                    }
                                                )
                                            }}
                                        </span>
                                    </td>
                                    <td class="text-center">
                                        <span class="text-red-500">
                                            {{
                                                (
                                                    (dividendStats.min || 0) *
                                                    0.85
                                                ).toLocaleString(
                                                    currencyLocale,
                                                    {
                                                        style: 'currency',
                                                        currency: currency,
                                                        maximumFractionDigits: 4,
                                                    }
                                                )
                                            }}
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>
            <template #resultsRecovery>
                <div
                    class="p-datatable p-component p-datatable-gridlines p-datatable-sm"
                    v-if="activeCalculator === 'recovery'">
                    <div class="p-datatable-table-container">
                        <table class="p-datatable-table">
                            <tbody class="p-datatable-tbody">
                                <tr>
                                    <th class="text-center">
                                        재투자 <i class="pi pi-circle"></i>
                                    </th>
                                    <td class="text-center">
                                        <div
                                            class="flex flex-column align-items-center">
                                            <span class="text-green-500">{{
                                                formatMonthsToYears(
                                                    recoveryTimes?.hope_reinvest,
                                                    true
                                                ).duration
                                            }}</span>
                                            <span
                                                v-if="
                                                    formatMonthsToYears(
                                                        recoveryTimes?.hope_reinvest,
                                                        true
                                                    ).date
                                                "
                                                class="text-surface-500 dark:text-surface-400"
                                                >{{
                                                    formatMonthsToYears(
                                                        recoveryTimes?.hope_reinvest,
                                                        true
                                                    ).date
                                                }}</span
                                            >
                                        </div>
                                    </td>
                                    <td class="text-center">
                                        <div
                                            class="flex flex-column align-items-center">
                                            <span class="text-yellow-500">
                                                {{
                                                    formatMonthsToYears(
                                                        recoveryTimes?.avg_reinvest,
                                                        true
                                                    ).duration
                                                }}</span
                                            >
                                            <span
                                                v-if="
                                                    formatMonthsToYears(
                                                        recoveryTimes?.avg_reinvest,
                                                        true
                                                    ).date
                                                "
                                                class="text-surface-500 dark:text-surface-400"
                                                >{{
                                                    formatMonthsToYears(
                                                        recoveryTimes?.avg_reinvest,
                                                        true
                                                    ).date
                                                }}</span
                                            >
                                        </div>
                                    </td>
                                    <td class="text-center">
                                        <div
                                            class="flex flex-column align-items-center">
                                            <span class="text-red-500">{{
                                                formatMonthsToYears(
                                                    recoveryTimes?.despair_reinvest,
                                                    true
                                                ).duration
                                            }}</span>
                                            <span
                                                v-if="
                                                    formatMonthsToYears(
                                                        recoveryTimes?.despair_reinvest,
                                                        true
                                                    ).date
                                                "
                                                class="text-surface-500 dark:text-surface-400"
                                                >{{
                                                    formatMonthsToYears(
                                                        recoveryTimes?.despair_reinvest,
                                                        true
                                                    ).date
                                                }}</span
                                            >
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <th class="text-center">
                                        재투자 <i class="pi pi-times"></i>
                                    </th>
                                    <td class="text-center">
                                        <div
                                            class="flex flex-column align-items-center">
                                            <span class="text-green-500">{{
                                                formatMonthsToYears(
                                                    recoveryTimes?.hope_no_reinvest,
                                                    true
                                                ).duration
                                            }}</span>
                                            <span
                                                v-if="
                                                    formatMonthsToYears(
                                                        recoveryTimes?.hope_no_reinvest,
                                                        true
                                                    ).date
                                                "
                                                class="text-surface-500 dark:text-surface-400"
                                                >{{
                                                    formatMonthsToYears(
                                                        recoveryTimes?.hope_no_reinvest,
                                                        true
                                                    ).date
                                                }}</span
                                            >
                                        </div>
                                    </td>
                                    <td class="text-center">
                                        <div
                                            class="flex flex-column align-items-center">
                                            <span class="text-yellow-500">{{
                                                formatMonthsToYears(
                                                    recoveryTimes?.avg_no_reinvest,
                                                    true
                                                ).duration
                                            }}</span>
                                            <span
                                                v-if="
                                                    formatMonthsToYears(
                                                        recoveryTimes?.avg_no_reinvest,
                                                        true
                                                    ).date
                                                "
                                                class="text-surface-500 dark:text-surface-400"
                                                >{{
                                                    formatMonthsToYears(
                                                        recoveryTimes?.avg_no_reinvest,
                                                        true
                                                    ).date
                                                }}</span
                                            >
                                        </div>
                                    </td>
                                    <td class="text-center">
                                        <div
                                            class="flex flex-column align-items-center">
                                            <span class="text-red-500">{{
                                                formatMonthsToYears(
                                                    recoveryTimes?.despair_no_reinvest,
                                                    true
                                                ).duration
                                            }}</span>
                                            <span
                                                v-if="
                                                    formatMonthsToYears(
                                                        recoveryTimes?.despair_no_reinvest,
                                                        true
                                                    ).date
                                                "
                                                class="text-surface-500 dark:text-surface-400"
                                                >{{
                                                    formatMonthsToYears(
                                                        recoveryTimes?.despair_no_reinvest,
                                                        true
                                                    ).date
                                                }}</span
                                            >
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>

            <template #resultsReinvestment>
                <div
                    class="p-datatable p-component p-datatable-gridlines"
                    v-if="activeCalculator === 'reinvestment'">
                    <div class="p-datatable-table-container">
                        <table class="p-datatable-table">
                            <tbody class="p-datatable-tbody">
                                <tr>
                                    <th class="text-center">기간</th>
                                    <td class="text-center">
                                        <span class="text-green-500">{{
                                            formatMonthsToYears(
                                                goalAchievementTimes?.hope
                                            )?.duration
                                        }}</span>
                                    </td>
                                    <td class="text-center">
                                        <span class="text-yellow-500">{{
                                            formatMonthsToYears(
                                                goalAchievementTimes?.avg
                                            )?.duration
                                        }}</span>
                                    </td>
                                    <td class="text-center">
                                        <span class="text-red-500">{{
                                            formatMonthsToYears(
                                                goalAchievementTimes?.despair
                                            )?.duration
                                        }}</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>

            <template #resultsYield>
                <div
                    class="p-datatable p-component p-datatable-gridlines"
                    v-if="activeCalculator === 'yield'">
                    <div class="p-datatable-table-container">
                        <table class="p-datatable-table">
                            <tbody class="p-datatable-tbody">
                                <tr>
                                    <td rowspan="2" class="text-center">
                                        1회당
                                    </td>
                                    <th class="text-center">
                                        <i class="pi pi-lock-open" /> 세전
                                    </th>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.hope.perPayout.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax
                                                        .hope.perPayout
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.avg.perPayout.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax.avg
                                                        .perPayout
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.despair.perPayout.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax
                                                        .despair.perPayout
                                                )
                                            }}</small
                                        >
                                    </td>
                                </tr>
                                <tr
                                    class="border-b border-surface-300 dark:border-surface-600">
                                    <th class="text-center">
                                        <i class="pi pi-lock" /> 세후
                                    </th>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.hope.perPayout.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .hope.perPayout
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.avg.perPayout.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .avg.perPayout
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.despair.perPayout.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .despair.perPayout
                                                )
                                            }}</small
                                        >
                                    </td>
                                </tr>
                                <tr>
                                    <td rowspan="2" class="text-center">
                                        월간
                                    </td>
                                    <th class="text-center">
                                        <i class="pi pi-lock-open" /> 세전
                                    </th>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.hope.monthly.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax
                                                        .hope.monthly
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.avg.monthly.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax.avg
                                                        .monthly
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.despair.monthly.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax
                                                        .despair.monthly
                                                )
                                            }}</small
                                        >
                                    </td>
                                </tr>
                                <tr
                                    class="border-b border-surface-300 dark:border-surface-600">
                                    <th class="text-center">
                                        <i class="pi pi-lock" /> 세후
                                    </th>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.hope.monthly.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .hope.monthly
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.avg.monthly.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .avg.monthly
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.despair.monthly.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .despair.monthly
                                                )
                                            }}</small
                                        >
                                    </td>
                                </tr>
                                <tr>
                                    <td rowspan="2" class="text-center">
                                        연간
                                    </td>
                                    <th class="text-center">
                                        <i class="pi pi-lock-open" /> 세전
                                    </th>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.hope.annual.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax
                                                        .hope.annual
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.avg.annual.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax.avg
                                                        .annual
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.preTax.despair.annual.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.preTax
                                                        .despair.annual
                                                )
                                            }}</small
                                        >
                                    </td>
                                </tr>
                                <tr>
                                    <th class="text-center">
                                        <i class="pi pi-lock" /> 세후
                                    </th>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.hope.annual.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .hope.annual
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.avg.annual.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .avg.annual
                                                )
                                            }}</small
                                        >
                                    </td>
                                    <td class="text-center">
                                        {{
                                            expectedDividends.postTax.despair.annual.toLocaleString(
                                                currencyLocale,
                                                {
                                                    style: 'currency',
                                                    currency: currency,
                                                    maximumFractionDigits: 2,
                                                }
                                            )
                                        }}<br v-if="isUSD" /><small
                                            v-if="isUSD"
                                            >{{
                                                formatKRW(
                                                    expectedDividends.postTax
                                                        .despair.annual
                                                )
                                            }}</small
                                        >
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>

            <template #resultsChart>
                <Card v-if="activeCalculator === 'recovery'">
                    <template #content>
                        <v-chart
                            :option="recoveryChartOptions"
                            autoresize
                            style="height: 300px" />
                    </template>
                </Card>
                <Card v-if="activeCalculator === 'reinvestment'">
                    <template #content>
                        <!-- [핵심 수정 4] 차트 높이 450px로 변경 -->
                        <v-chart
                            :option="reinvestmentChartOptions"
                            autoresize
                            style="height: 450px" />
                    </template>
                </Card>
            </template>
        </CalculatorLayout>
    </div>
    <div
        v-else
        class="flex justify-content-center align-items-center"
        style="min-height: 400px">
        <ProgressSpinner />
    </div>
</template>
