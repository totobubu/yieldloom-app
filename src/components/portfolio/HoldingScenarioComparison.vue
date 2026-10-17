<script setup>
    import { computed, reactive, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Checkbox from 'primevue/checkbox';
    import Select from 'primevue/select';
    import InputNumber from 'primevue/inputnumber';
    import Message from 'primevue/message';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import { firebaseUser } from '@/services/firebaseClient';
    import {
        holdingSimulationBaseline,
        estimateHoldingDividend,
        simulateHeldPortfolio,
    } from '@/services/holdingSimulation.js';
    const props = defineProps({
        positions: { type: Array, default: () => [] },
        entries: { type: Array, default: () => [] },
        currency: { type: String, required: true },
        month: { type: String, required: true },
    });
    const opened = ref(false),
        models = ref([]),
        result = ref(null),
        error = ref(''),
        confirmed = ref(false);
    const setup = reactive({
        contribution: 0,
        reduction: 20,
        months: 12,
        taxRate: 15,
        fee: 0,
        annualPriceChange: 0,
    });
    const frequencies = [
        { label: '매주', value: 'weekly' },
        { label: '매월', value: 'monthly' },
        { label: '분기', value: 'quarterly' },
        { label: '반기', value: 'semiannual' },
        { label: '매년', value: 'annual' },
    ];
    const baseline = computed(() => {
        try {
            return holdingSimulationBaseline(
                props.positions,
                props.entries,
                props.currency,
                props.month
            );
        } catch {
            return null;
        }
    });
    const fields = [
        { key: 'contribution', label: '전체 월 추가 투자금', min: 0, max: 1e7 },
        { key: 'months', label: '기간 (개월)', min: 0, max: 360 },
        { key: 'taxRate', label: '원천징수율 가정 (%)', min: 0, max: 100 },
        { key: 'fee', label: '매수 건당 수수료', min: 0, max: 10000 },
        {
            key: 'annualPriceChange',
            label: '연간 주가 변화율 (%)',
            min: -95,
            max: 100,
        },
        { key: 'reduction', label: '배당 감소율 (%)', min: 0, max: 100 },
    ];
    function reset() {
        models.value = (baseline.value?.rows || []).map((row, i) => ({
            ...row,
            enabled: i < 30,
            annualDividend: null,
            frequency: 'monthly',
        }));
        result.value = null;
        error.value = '';
        confirmed.value = false;
    }
    watch(
        [
            () => props.positions,
            () => props.entries,
            () => props.currency,
            () => props.month,
            firebaseUser,
        ],
        reset,
        { immediate: true }
    );
    function estimate() {
        for (const row of models.value)
            row.annualDividend = estimateHoldingDividend(
                row,
                setup.taxRate,
                confirmed.value
            );
        result.value = null;
    }
    function run() {
        result.value = null;
        error.value = '';
        try {
            result.value = simulateHeldPortfolio(
                models.value.filter((row) => row.enabled),
                { ...setup, currency: props.currency }
            );
        } catch (reason) {
            error.value = reason.message;
        }
    }
    watch(
        [setup, models],
        () => {
            result.value = null;
        },
        { deep: true }
    );
    const amount = (value) =>
        `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 })} ${props.currency}`;
    const table = computed(
        () =>
            result.value?.scenarios[0].rows.map((row, i) => ({
                month: row.month,
                cash: row.wealth,
                reinvest: result.value.scenarios[1].rows[i].wealth,
                reduced: result.value.scenarios[2].rows[i].wealth,
            })) || []
    );
</script>
<template>
    <details class="holding-scenarios" @toggle="opened = $event.target.open">
        <summary>보유 종목별 납입·재투자·배당 감소 비교</summary>
        <template v-if="opened"
            ><p>
                현재 선택한 계좌·통화의 서류 평가액과 보유 수량을 사용합니다.
                추가 계좌·거래 조회 없이 이미 받은 자료를 재사용합니다.
            </p>
            <Message severity="info"
                >평가액은 원래 투자 원금이나 최신 시세가 아닙니다. 월 납입액은
                선택 종목의 시작 평가액 비중으로 나누며, 월초 매수·주기별 지급
                시 재투자합니다. 배당락·환전·실제 세법과 배당 성장은 반영하지
                않습니다.</Message
            >
            <p v-if="baseline">
                기록 기간 {{ baseline.from }} ~ {{ baseline.to }} ·
                수량·평가액·기준일 미확인 {{ baseline.excluded }}건 제외
            </p>
            <p v-if="!models.length">
                비교할 수 있는 보유 수량과 평가액이 없습니다.
            </p>
            <template v-else
                ><form @submit.prevent="run">
                    <div class="scenario-settings">
                        <label
                            v-for="field in fields"
                            :key="field.key"
                            :for="`holding-${field.key}`"
                            >{{ field.label
                            }}<InputNumber
                                v-model="setup[field.key]"
                                :input-id="`holding-${field.key}`"
                                :min="field.min"
                                :max="field.max"
                                :max-fraction-digits="
                                    field.key === 'months' ? 0 : 4
                                "
                        /></label>
                    </div>
                    <label for="holding-confirm" class="confirm-records"
                        ><Checkbox
                            v-model="confirmed"
                            input-id="holding-confirm"
                            binary />
                        선택 기간의 배당 기록이 완전하며 세후 금액임을
                        확인했습니다.</label
                    ><Button
                        label="확인한 기록으로 연간 주당 배당 추정"
                        type="button"
                        severity="secondary"
                        :disabled="!confirmed"
                        @click="estimate" />
                    <p>
                        확인 전에는 배당금을 자동 입력하지 않습니다. 과거 수량
                        변동 때문에 현재 수량으로 나눈 값은 추정치입니다. 배당이
                        없다고 확인한 종목은 직접 0을 입력하세요.
                    </p>
                    <div class="holding-grid">
                        <article v-for="row in models" :key="row.symbol">
                            <label :for="`holding-select-${row.symbol}`"
                                ><Checkbox
                                    v-model="row.enabled"
                                    :input-id="`holding-select-${row.symbol}`"
                                    binary />
                                <strong>{{ row.symbol }}</strong></label
                            >
                            <p>
                                {{ row.quantity }}주 · {{ amount(row.initial) }}
                            </p>
                            <small>서류 기준 {{ row.dates.join(' · ') }}</small
                            ><label :for="`holding-dividend-${row.symbol}`"
                                >연간 주당 배당금 가정 (세전)<InputNumber
                                    v-model="row.annualDividend"
                                    :input-id="`holding-dividend-${row.symbol}`"
                                    :min="0"
                                    :max="1e7"
                                    :max-fraction-digits="6" /></label
                            ><label
                                :id="`holding-frequency-label-${row.symbol}`"
                                :for="`holding-frequency-${row.symbol}`"
                                >배당 주기 가정<Select
                                    v-model="row.frequency"
                                    :input-id="`holding-frequency-${row.symbol}`"
                                    :aria-labelledby="`holding-frequency-label-${row.symbol}`"
                                    :options="frequencies"
                                    option-label="label"
                                    option-value="value"
                            /></label>
                        </article>
                    </div>
                    <p>
                        한 번에 최대 30개 종목을 비교합니다. 처음 30개가
                        선택되며, 소수주 매수를 가정합니다. 보유 주식에는 시작
                        매수 수수료를 부과하지 않고 이후 매수에만 입력한
                        수수료를 적용합니다.
                    </p>
                    <Button
                        label="선택 종목 가정 비교"
                        type="submit"
                        icon="pi pi-calculator" />
                </form>
                <Message v-if="error" severity="error" role="alert">{{
                    error
                }}</Message>
                <section v-if="result" aria-label="보유 종목 시뮬레이션 결과">
                    <h3>기간 말 가정 자산</h3>
                    <div class="holding-grid">
                        <article
                            v-for="scenario in result.scenarios"
                            :key="scenario.key">
                            <h4>{{ scenario.label }}</h4>
                            <strong>{{
                                amount(scenario.summary.wealth)
                            }}</strong>
                            <p>
                                누적 세후 배당
                                {{ amount(scenario.summary.netTotal) }}
                            </p>
                            <p>
                                매수 수수료 {{ amount(scenario.summary.fees) }}
                            </p>
                            <p>
                                시작 평가액·추가 납입 대비 증감
                                {{ amount(scenario.summary.gain) }}
                            </p>
                        </article>
                    </div>
                    <DataTable :value="table" paginator :rows="12"
                        ><Column field="month" header="개월" /><Column
                            header="현금 보관"
                            ><template #body="{ data }">{{
                                amount(data.cash)
                            }}</template></Column
                        ><Column header="재투자"
                            ><template #body="{ data }">{{
                                amount(data.reinvest)
                            }}</template></Column
                        ><Column header="배당 감소"
                            ><template #body="{ data }">{{
                                amount(data.reduced)
                            }}</template></Column
                        ></DataTable
                    >
                </section></template
            ></template
        >
    </details>
</template>
<style scoped>
    .holding-scenarios {
        margin: 20px 0;
        padding: 18px;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
        min-width: 0;
    }
    summary {
        font-size: 18px;
        font-weight: 700;
        cursor: pointer;
    }
    .scenario-settings,
    .holding-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
        gap: 14px;
        margin: 16px 0;
    }
    label {
        display: grid;
        gap: 8px;
        margin: 10px 0;
    }
    .confirm-records {
        display: flex;
        gap: 10px;
        align-items: center;
    }
    .holding-grid article {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 14px;
        min-width: 0;
    }
    .holding-grid article > label:first-child {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    small {
        overflow-wrap: anywhere;
    }
    @media (max-width: 400px) {
        .holding-grid,
        .scenario-settings {
            grid-template-columns: 1fr;
        }
        .holding-scenarios {
            padding: 12px;
        }
    }
</style>
