<!-- src\components\backtester\controls\DateAndInvestment.vue -->
<script setup>
    import { ref, watch, onMounted, computed } from 'vue';
    import Calendar from 'primevue/calendar';
    import InputNumber from 'primevue/inputnumber';
    import RadioButton from 'primevue/radiobutton';
    import SelectButton from 'primevue/selectbutton';
    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';
    import FloatLabel from 'primevue/floatlabel';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import { useExchangeRates } from '@/composables/data/useExchangeRates';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';

    const { deviceType } = useBreakpoint();

    const emit = defineEmits(['run-backtest']);

    const { findRateForDate } = useExchangeRates();
    const startDate = ref(
        new Date(new Date().setFullYear(new Date().getFullYear() - 1))
    );
    const endDate = ref(new Date());
    const investmentKRW = ref(10000000);
    const investmentUSD = ref(0);
    const commission = ref(0.1);
    const comparison = ref('SPY');
    const customComparison = ref('');
    // exchangeRate 변수는 더 이상 필요 없으므로 삭제해도 무방합니다.
    // const exchangeRate = ref(null);
    const periodOptions = ref(['1M', '3M', '6M', '1Y', '2Y', '3Y']);
    const selectedPeriod = ref('1Y');
    const applyTax = ref(true);
    const taxOptions = ref([
        { label: '세후', value: true },
        { label: '세전', value: false },
    ]);
    const startDateRate = ref(0);
    const endDateRate = ref(0);

    const underlyingSymbol = computed(() => {
        const firstItem = props.portfolio?.find((p) => p.symbol);
        return firstItem?.underlying || null;
    });

    watch(startDate, (newDate) =>
        fetchExchangeRateForDate(ref(newDate), startDateRate)
    );
    watch(endDate, (newDate) => {
        if (newDate < startDate.value) {
            startDate.value = newDate;
        }
        fetchExchangeRateForDate(ref(newDate), endDateRate);
    });

    onMounted(() => {
        fetchExchangeRateForDate(startDate, startDateRate);
        fetchExchangeRateForDate(endDate, endDateRate);
    });

    const fetchExchangeRateForDate = async (dateRef, rateRef) => {
        const rate = await findRateForDate(dateRef.value);
        if (rate) {
            rateRef.value = rate;
        } else {
            rateRef.value = 1380;
        }
        if (dateRef === startDate) updateUSD();
    };

    const updateDates = (period) => {
        selectedPeriod.value = period;
        const newEndDate = new Date();
        let newStartDate = new Date();
        const value = parseInt(period);
        const unit = period.slice(-1);
        if (unit === 'M') {
            newStartDate.setMonth(newEndDate.getMonth() - value);
        } else if (unit === 'Y') {
            newStartDate.setFullYear(newEndDate.getFullYear() - value);
        }
        startDate.value = newStartDate;
        endDate.value = newEndDate;
    };

    const handleRunClick = () => {
        emit('run-backtest', {
            startDate: startDate.value,
            endDate: endDate.value,
            initialInvestmentKRW: investmentKRW.value,
            commission: commission.value,
            applyTax: applyTax.value,
            comparisonSymbol:
                comparison.value === 'Other'
                    ? customComparison.value.toUpperCase()
                    : comparison.value === 'Underlying'
                      ? underlyingSymbol.value
                      : comparison.value,
        });
    };

    // --- [수정된 부분] ---
    const updateKRW = () => {
        // exchangeRate.value 대신 startDateRate.value 사용
        if (
            document.activeElement?.id === 'investmentUSD' &&
            startDateRate.value > 0
        ) {
            investmentKRW.value = investmentUSD.value * startDateRate.value;
        }
    };
    const updateUSD = () => {
        // exchangeRate.value 대신 startDateRate.value 사용
        if (
            document.activeElement?.id !== 'investmentUSD' &&
            startDateRate.value > 0
        ) {
            investmentUSD.value = investmentKRW.value / startDateRate.value;
        }
    };
</script>

<template>
    <div class="grid formgrid p-fluid align-items-end gap-2">
        <Form class="flex flex-column gap-3 col-12">
            <Fieldset legend="비교 대상">
                <div class="flex flex-wrap gap-2">
                    <div class="flex align-items-center">
                        <RadioButton
                            v-model="comparison"
                            inputId="compSPY"
                            name="comparison"
                            value="SPY" /><label for="compSPY" class="ml-2"
                            >S&P 500 (SPY)</label
                        >
                    </div>
                    <div class="flex align-items-center">
                        <RadioButton
                            v-model="comparison"
                            inputId="compQQQ"
                            name="comparison"
                            value="QQQ" /><label for="compQQQ" class="ml-2"
                            >Nasdaq 100 (QQQ)</label
                        >
                    </div>
                    <div class="flex align-items-center">
                        <RadioButton
                            v-model="comparison"
                            inputId="compDIA"
                            name="comparison"
                            value="DIA" /><label for="compDIA" class="ml-2"
                            >Dow 30 (DIA)</label
                        >
                    </div>
                    <div class="flex align-items-center">
                        <RadioButton
                            v-model="comparison"
                            inputId="compNone"
                            name="comparison"
                            value="None" /><label for="compNone" class="ml-2"
                            >없음</label
                        >
                    </div>

                    <div
                        v-if="underlyingSymbol"
                        class="flex align-items-center">
                        <RadioButton
                            v-model="comparison"
                            inputId="compUnderlying"
                            name="comparison"
                            value="Underlying" />
                        <label for="compUnderlying" class="ml-2"
                            >기초자산 ({{ underlyingSymbol }})</label
                        >
                    </div>
                    <div class="flex align-items-center">
                        <RadioButton
                            v-model="comparison"
                            inputId="compOther"
                            name="comparison"
                            value="Other" />
                        <InputText
                            v-model="customComparison"
                            class="ml-2 p-inputtext-sm"
                            :disabled="comparison !== 'Other'"
                            placeholder="직접 입력" />
                    </div>
                </div>
            </Fieldset>
            <Fieldset
                legend="옵션"
                :toggleable="true"
                id="t-backtester-controls-options">
                <div class="flex flex-column gap-2">
                    <FormField>
                        <SelectButton
                            v-model="selectedPeriod"
                            :options="periodOptions"
                            @update:modelValue="updateDates"
                            size="small"
                            aria-labelledby="period-selection" />
                    </FormField>
                    <FormField>
                        <InputGroup>
                            <FloatLabel variant="in">
                                <Calendar
                                    v-model="startDate"
                                    id="startDate"
                                    dateFormat="yy-mm-dd" />
                                <label for="in_label"
                                    >시작일 ($1 ≈ ₩{{
                                        startDateRate.toFixed(2)
                                    }})</label
                                >
                            </FloatLabel>
                            <FloatLabel variant="in">
                                <Calendar
                                    v-model="endDate"
                                    id="endDate"
                                    dateFormat="yy-mm-dd" />
                                <label for="in_label"
                                    >종료일 ($1 ≈ ₩{{
                                        endDateRate.toFixed(2)
                                    }})</label
                                >
                            </FloatLabel>
                        </InputGroup>
                    </FormField>
                        <FormField>
                                <InputGroup>
                                    <FloatLabel variant="in">
                                        <InputNumber
                                            v-model="investmentKRW"
                                            inputId="investmentKRW"
                                            mode="currency"
                                            currency="KRW"
                                            locale="ko-KR"
                                            @input="updateUSD" />
                                        <label for="in_label">KRW</label>
                                    </FloatLabel>
                                    <InputGroupAddon>≈</InputGroupAddon>
                                    <FloatLabel variant="in">
                                        <InputNumber
                                            v-model="investmentUSD"
                                            inputId="investmentUSD"
                                            mode="currency"
                                            currency="USD"
                                            locale="en-US"
                                            @input="updateKRW" />
                                        <label for="in_label"
                                            >USD (₩{{
                                                startDateRate.toFixed(2)
                                            }})</label
                                        >
                                    </FloatLabel>
                                </InputGroup>
                        </FormField>
                        <FormField>
                            <InputGroup>
                                <FloatLabel variant="in">
                                    <InputNumber
                                        v-model="commission"
                                        inputId="commission"
                                        :minFractionDigits="2"
                                        suffix=" %" />
                                    <label for="commission">거래 수수료</label>
                                </FloatLabel>
                            </InputGroup>
                        </FormField>
                        <FormField>
                            <InputGroup>
                                <FloatLabel variant="in">
                                    <span
                                        class="p-inputnumber p-component p-inputwrapper p-inputwrapper-filled">
                                        <span
                                            class="p-inputtext p-component p-filled p-inputnumber-input">
                                            <SelectButton
                                                v-model="applyTax"
                                                :options="taxOptions"
                                                size="small"
                                                optionLabel="label"
                                                optionValue="value" />
                                        </span>
                                    </span>
                                    <label for="applyTax">배당 소득세</label>
                                </FloatLabel>
                            </InputGroup>
                        </FormField>
                </div>
            </Fieldset>
            <Button
                severity="secondary"
                label="백테스팅 실행"
                icon="pi pi-chart-line"
                @click="handleRunClick"
                :loading="isLoading"
                class="w-full" />
        </Form>
    </div>
</template>
