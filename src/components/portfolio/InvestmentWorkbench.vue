<script setup>
    import { computed, reactive, ref, watch, onScopeDispose } from 'vue';
    import Button from 'primevue/button';
    import InputNumber from 'primevue/inputnumber';
    import SelectButton from 'primevue/selectbutton';
    import Message from 'primevue/message';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import InvestorExam from './InvestorExam.vue';
    import IncomeProjectionChart from './IncomeProjectionChart.vue';
    import InvestmentBlog from './InvestmentBlog.vue';
    import {
        planningBaseline,
        fireScenarios,
        projectIncome,
        recoveryMetrics,
        incomeStress,
        compareReinvestment,
    } from '@/services/investmentPlanning.js';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import { tracePortfolioFunding } from '@/services/portfolioFundingTrace.js';
    import { firebaseUser } from '@/services/firebaseClient';
    import { familyRequest } from '@/services/familyPortfolio';

    const props = defineProps({
        entries: { type: Array, default: () => [] },
        positions: { type: Array, default: () => [] },
        accounts: { type: Array, default: () => [] },
        currency: { type: String, required: true },
        month: { type: String, required: true },
        familyId: { type: String, default: '' },
        largestShare: { type: Number, default: null },
    });
    const baseline = computed(() =>
        planningBaseline(
            props.entries,
            props.positions,
            props.currency,
            props.month
        )
    );
    const mode = ref('effect');
    const modes = [
        { label: '배당 효과', value: 'effect' },
        { label: 'FIRE 전망', value: 'fire' },
        { label: '회수·재투자', value: 'reinvest' },
        { label: '안정성', value: 'stress' },
        { label: '성향 모의고사', value: 'exam' },
        { label: '블로그 5종', value: 'blog' },
    ];
    const setup = reactive({
        initial: null,
        contribution: 0,
        yieldRate: null,
        tax: 15,
        growth: 0,
        priceGrowth: 0,
        inflation: 2,
        reinvest: 100,
        target: null,
        years: 30,
        currency: props.currency,
        targetCurrency: props.currency,
        exchangeRate: 1400,
        fxGrowth: 0,
    });
    const fields = [
        { key: 'initial', label: '시작 증권 평가액', min: 0, max: 1e12 },
        { key: 'contribution', label: '월 추가 투자금', min: 0, max: 1e9 },
        {
            key: 'yieldRate',
            label: '시작 세전 연 배당률 (%)',
            min: 0,
            max: 100,
        },
        { key: 'tax', label: '원천징수율 가정 (%)', min: 0, max: 100 },
        {
            key: 'growth',
            label: '연간 주당 배당 변화율 (%)',
            min: -95,
            max: 50,
        },
        {
            key: 'priceGrowth',
            label: '연간 주가 변화율 (%)',
            min: -95,
            max: 50,
        },
        { key: 'inflation', label: '연간 물가 상승률 (%)', min: -5, max: 30 },
        { key: 'reinvest', label: '배당 재투자 비율 (%)', min: 0, max: 100 },
        {
            key: 'target',
            label: '현재 가치 월 목표 세후 배당 (목표 통화)',
            min: 0.01,
            max: 1e10,
        },
        { key: 'years', label: '분석 기간 (년)', min: 1, max: 60 },
    ];
    const netConfirmed = ref(false),
        importStatus = ref(''),
        attempted = ref(false);
    function importBaseline() {
        if (baseline.value?.assets == null) {
            importStatus.value = '확인된 증권 평가액이 없습니다.';
            return;
        }
        setup.initial = baseline.value.assets;
        if (
            netConfirmed.value &&
            baseline.value.annualRecorded != null &&
            baseline.value.annualRecorded >= 0 &&
            setup.initial > 0 &&
            setup.tax < 100
        ) {
            setup.yieldRate =
                (baseline.value.annualRecorded /
                    setup.initial /
                    (1 - setup.tax / 100)) *
                100;
            importStatus.value =
                '최근 12개월 기록을 확인한 세후 배당으로 간주하고 원천징수율을 역산해 시작 세전 배당률에 반영했습니다.';
        } else {
            importStatus.value =
                '자료상 증권 평가액만 반영했습니다. 배당률은 직접 입력하거나 세후·기록 완전성을 확인해 주세요.';
        }
    }
    const analysis = computed(() => {
        if (!attempted.value) return null;
        try {
            const scenarios = fireScenarios(setup),
                base = scenarios[1].result;
            const without = projectIncome({ ...setup, reinvest: 0 });
            const extra = projectIncome({
                ...setup,
                contribution:
                    Number(setup.contribution) +
                    Number(extraContribution.value),
            });
            const lower = projectIncome({
                ...setup,
                target:
                    Number(setup.target) *
                    (1 - Number(targetReduction.value) / 100),
            });
            return { scenarios, base, without, extra, lower };
        } catch (error) {
            return { error: error.message };
        }
    });
    const extraContribution = ref(0),
        targetReduction = ref(10);
    const recoveryInput = reactive({
        principal: null,
        withdrawn: null,
        dividends: null,
        monthlyNet: null,
        withdrawalPercent: 100,
        currentWealth: null,
    });
    const recoveryAttempt = ref(false),
        fundingLoading = ref(false),
        fundingIssue = ref(''),
        fundingFailed = ref(false),
        fundingWarnings = ref([]),
        fundingStocks = ref([]);
    let generation = 0;
    onScopeDispose(() => {
        generation++;
    });
    async function loadFunding() {
        const user = firebaseUser.value,
            request = ++generation;
        if (!user) return;
        fundingLoading.value = true;
        fundingIssue.value = '';
        fundingFailed.value = false;
        fundingWarnings.value = [];
        fundingStocks.value = [];
        try {
            const before = await familyRequest('', undefined, {
                familyId: props.familyId,
            });
            const states = [];
            for (const account of props.accounts) {
                if (request !== generation || firebaseUser.value !== user)
                    return;
                if (!before.accounts.some((a) => a.id === account.id))
                    throw new Error(
                        '계좌 조회 권한이 변경되었습니다. 다시 조회해 주세요.'
                    );
                states.push({
                    id: account.id,
                    state: await portfolioCapitalRequest(
                        user,
                        undefined,
                        account.id,
                        { force: true }
                    ),
                });
            }
            const after = await familyRequest('', undefined, {
                familyId: props.familyId,
            });
            if (request !== generation || firebaseUser.value !== user) return;
            if (
                props.accounts.some((a) => {
                    const old = before.accounts.find((r) => r.id === a.id),
                        latest = after.accounts.find((r) => r.id === a.id);
                    return (
                        !latest ||
                        (old.entriesRevision ?? 0) !==
                            (latest.entriesRevision ?? 0)
                    );
                })
            )
                throw new Error(
                    '조회 중 권한 또는 원장이 변경됐습니다. 다시 조회해 주세요.'
                );
            const combined = Object.fromEntries(
                ['entries', 'classifications', 'trades', 'allocations'].map(
                    (key) => [
                        key,
                        states.flatMap(({ id, state }) =>
                            (state[key] || []).map((r) => ({
                                ...r,
                                accountId: id,
                            }))
                        ),
                    ]
                )
            );
            const result = tracePortfolioFunding(combined),
                metric = result.currencies.find(
                    (r) => r.currency === props.currency
                );
            recoveryInput.principal = metric.deposits || null;
            recoveryInput.withdrawn = metric.recovered;
            fundingWarnings.value = result.warnings;
            fundingStocks.value = result.stocks.filter(
                (r) => r.currency === props.currency
            );
            fundingIssue.value =
                '분류된 외부 입출금을 반영했습니다. 누락된 기초 자료와 배당 세후 금액은 직접 확인하세요.';
        } catch (error) {
            if (request === generation) {
                fundingIssue.value = error.message;
                fundingFailed.value = true;
            }
        } finally {
            if (request === generation) fundingLoading.value = false;
        }
    }
    const recovery = computed(() => {
        if (!recoveryAttempt.value) return null;
        try {
            return recoveryMetrics(recoveryInput);
        } catch (error) {
            return { error: error.message };
        }
    });
    const economicGain = computed(() =>
        recovery.value &&
        !recovery.value.error &&
        recoveryInput.currentWealth != null &&
        Number.isFinite(Number(recoveryInput.currentWealth))
            ? Number(recoveryInput.currentWealth) +
              Number(recoveryInput.withdrawn) -
              Number(recoveryInput.principal)
            : null
    );
    const recoveryFields = [
        { key: 'principal', label: '누적 외부 납입금', min: 0.01 },
        { key: 'withdrawn', label: '누적 외부 인출금', min: 0 },
        {
            key: 'dividends',
            label: '누적 확인 세후 배당금 (재투자분 포함)',
            min: 0,
        },
        { key: 'monthlyNet', label: '향후 월 세후 배당 가정', min: 0 },
        {
            key: 'withdrawalPercent',
            label: '향후 배당 인출 비율 (%)',
            min: 0,
            max: 100,
        },
        {
            key: 'currentWealth',
            label: '현재 전체 자산 (증권+계좌 현금, 선택)',
            min: 0,
        },
    ];
    const comparisonInput = reactive({
        amount: null,
        years: 10,
        cost: 0,
        a: { yieldRate: null, tax: 15, growth: 0, priceGrowth: 0 },
        b: { yieldRate: null, tax: 15, growth: 0, priceGrowth: 0 },
    });
    const compared = ref(false);
    const comparison = computed(() => {
        if (!compared.value) return null;
        try {
            return {
                rows: compareReinvestment({
                    amount: comparisonInput.amount,
                    months: comparisonInput.years * 12,
                    a: comparisonInput.a,
                    b: comparisonInput.b,
                    saleCost: comparisonInput.cost,
                }),
            };
        } catch (error) {
            return { error: error.message };
        }
    });
    const candidateFields = [
        { key: 'yieldRate', label: '세전 배당률 (%)', min: 0, max: 100 },
        { key: 'tax', label: '원천징수율 (%)', min: 0, max: 100 },
        { key: 'growth', label: '주당 배당 연 변화율 (%)', min: -95, max: 50 },
        { key: 'priceGrowth', label: '주가 연 변화율 (%)', min: -95, max: 50 },
    ];
    const stressInput = reactive({
        monthlyNet: null,
        target: null,
        topShare: null,
        foreignShare: 0,
        fxShock: -20,
        payoutChange: -20,
        priceChange: -30,
    });
    const stressed = ref(false);
    const stress = computed(() => {
        if (!stressed.value) return null;
        try {
            return incomeStress(stressInput);
        } catch (error) {
            return { error: error.message };
        }
    });
    const stressFields = [
        {
            key: 'monthlyNet',
            label: '스트레스 기준 월 세후 배당',
            min: 0,
            max: 1e12,
        },
        { key: 'target', label: '월 생활비 (같은 통화)', min: 0.01, max: 1e12 },
        {
            key: 'topShare',
            label: '최대 종목 배당 기여도 (%)',
            min: 0,
            max: 100,
        },
        {
            key: 'foreignShare',
            label: '환율 영향 배당 비중 (%)',
            min: 0,
            max: 100,
        },
        {
            key: 'fxShock',
            label: '원화 환산 환율 충격 (%)',
            min: -95,
            max: 100,
        },
        {
            key: 'payoutChange',
            label: '전체 배당금 변화 (%)',
            min: -100,
            max: 100,
        },
        { key: 'priceChange', label: '주가 변화 (%)', min: -95, max: 100 },
    ];
    function importStress() {
        const base = analysis.value?.base;
        if (base && setup.currency === setup.targetCurrency) {
            stressInput.monthlyNet = base.initialMonthly;
            stressInput.target = setup.target;
        }
        const amounts =
                baseline.value?.symbols.filter((r) => r.amount > 0) || [],
            total = amounts.reduce((s, r) => s + r.amount, 0);
        stressInput.topShare =
            total > 0 ? (amounts[0].amount / total) * 100 : null;
    }
    const assessment = ref(null);
    const fmt = (n) =>
        n == null
            ? '확인 필요'
            : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    const duration = (m) =>
        m == null
            ? '기간 내 미달성'
            : m === 0
              ? '현재 충족'
              : `${Math.floor(m / 12)}년 ${m % 12}개월 후`;
    const projectionDate = (m) => {
        if (m == null) return '';
        const d = new Date(`${props.month}-01T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + m);
        return d.toISOString().slice(0, 7);
    };
    const blogContext = computed(() => ({
        baseline: baseline.value,
        currency: props.currency,
        month: props.month,
        fireCurrency: setup.targetCurrency,
        fire: analysis.value?.base,
        recovery: recovery.value?.error ? null : recovery.value,
        comparison: comparison.value?.rows,
        assessment: assessment.value,
        assumptions: `FIRE 목표 통화 ${setup.targetCurrency}; 투자 통화 ${setup.currency}. ${Object.entries(
            setup
        )
            .filter(
                ([k]) =>
                    ![
                        'currency',
                        'targetCurrency',
                        'initial',
                        'contribution',
                        'target',
                    ].includes(k)
            )
            .map(
                ([k, v]) =>
                    `${{ yieldRate: '시작 세전 배당률 %', tax: '원천징수율 %', growth: '주당 배당 연 변화 %', priceGrowth: '주가 연 변화 %', inflation: '물가 %', reinvest: '재투자 %', years: '기간 년', exchangeRate: 'USD/KRW 환율', fxGrowth: '환율 연 변화 %' }[k]}: ${v ?? '미입력'}`
            )
            .join(
                '; '
            )}. 매월 균등 배당·월초 납입·월말 재투자, 소수주·수수료 0 가정. FIRE 금액은 목표 통화 기준입니다.`,
    }));
    // Recreate this component whenever account/currency/month changes (owned by PortfolioInsights).
    watch(
        () => [props.entries, props.positions],
        () => {
            assessment.value = null;
        },
        { flush: 'sync' }
    );
</script>

<template>
    <section class="workbench" aria-labelledby="workbench-title">
        <h2 id="workbench-title">배당 투자 설계실</h2>
        <p>
            현재 포트폴리오를 바탕으로 목표·선택·위험을 함께 점검합니다. 입력과
            결과는 화면을 떠나면 삭제됩니다.
        </p>
        <SelectButton
            v-model="mode"
            :options="modes"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            aria-label="투자 설계 메뉴" />
        <section v-show="mode === 'effect'" aria-labelledby="effect-title">
            <h3 id="effect-title">배당 투자의 효과</h3>
            <template v-if="baseline">
                <div class="metric-grid">
                    <article>
                        <h4>최근 12개월 저장 배당</h4>
                        <strong
                            >{{ fmt(baseline.annualRecorded) }}
                            {{ currency }}</strong
                        >
                        <p>
                            {{ baseline.from }} ~ {{ baseline.to }} · 기록 있는
                            달 {{ baseline.observedMonths }}/12
                        </p>
                    </article>
                    <article>
                        <h4>자료상 증권 평가액</h4>
                        <strong
                            >{{ fmt(baseline.assets) }} {{ currency }}</strong
                        >
                        <p>
                            현금 제외 · 누락 {{ baseline.excluded }}개 · 기준일
                            {{ baseline.dates.join(' / ') || '미확인' }}
                        </p>
                    </article>
                </div>
                <p>
                    최근 12개월 저장액을 1년 기록으로 표시합니다. 누락된 달을
                    0원으로 확정하거나 짧은 기간을 연환산하지 않습니다. 추가
                    매수·주당 배당 증가·환율의 기여는 거래별 수량과 환율이
                    확인돼야 분해할 수 있습니다.
                </p>
            </template>
            <p>
                아래 FIRE 전망에서 재투자 효과와 생활비 충당률을,
                회수·재투자에서 납입·인출·전체 자산 기준 손익을 확인할 수
                있습니다.
            </p>
            <Button label="FIRE·재투자 효과 계산하기" @click="mode = 'fire'" />
        </section>
        <section v-show="mode === 'fire'" aria-labelledby="fire-title">
            <h3 id="fire-title">목표 배당과 FIRE 전망</h3>
            <label class="check"
                ><input v-model="netConfirmed" type="checkbox" /> 최근 12개월
                배당 기록의 누락 여부와 세후 금액임을 확인했습니다.</label
            >
            <Button
                label="현 포트폴리오 가정 가져오기"
                outlined
                @click="importBaseline" />
            <Message v-if="importStatus" severity="info" :closable="false">{{
                importStatus
            }}</Message>
            <form @submit.prevent="attempted = true">
                <div class="field-grid">
                    <label
                        v-for="field in fields"
                        :key="field.key"
                        :for="`plan-${field.key}`"
                        >{{ field.label
                        }}<InputNumber
                            :input-id="`plan-${field.key}`"
                            v-model="setup[field.key]"
                            :min="field.min"
                            :max="field.max"
                            :max-fraction-digits="field.key === 'years' ? 0 : 4"
                            fluid
                    /></label>
                </div>
                <template v-if="currency === 'USD'"
                    ><label for="fire-target-currency">목표·생활비 통화</label
                    ><select
                        id="fire-target-currency"
                        v-model="setup.targetCurrency">
                        <option>USD</option>
                        <option>KRW</option>
                    </select>
                    <div
                        v-if="setup.targetCurrency === 'KRW'"
                        class="field-grid">
                        <label for="plan-fx"
                            >시작 USD/KRW 환율<InputNumber
                                input-id="plan-fx"
                                v-model="setup.exchangeRate"
                                :min="1"
                                :max="100000"
                                :max-fraction-digits="2" /></label
                        ><label for="plan-fx-growth"
                            >연간 환율 변화율 (%)<InputNumber
                                input-id="plan-fx-growth"
                                v-model="setup.fxGrowth"
                                :min="-50"
                                :max="50"
                                :max-fraction-digits="2"
                        /></label></div
                ></template>
                <p>
                    투입 금액은 {{ currency }}, 목표와 결과는
                    {{ setup.targetCurrency }}입니다. 월별 배당을 균등 가정하며
                    매월 초 추가 납입·월말 세후 재투자합니다. 주가와 주당 배당을
                    별도로 변화시켜 미래 배당률을 계산합니다. 소수주·매매수수료
                    0 가정, 종합과세·건강보험료·계좌별 세제·배당락 조정은
                    미반영입니다.
                </p>
                <div class="field-grid">
                    <label for="extra-contribution"
                        >보강할 월 추가 투자금 ({{ currency }})<InputNumber
                            input-id="extra-contribution"
                            v-model="extraContribution"
                            :min="0"
                            :max="100000000" /></label
                    ><label for="target-reduction"
                        >목표 생활비 축소율 (%)<InputNumber
                            input-id="target-reduction"
                            v-model="targetReduction"
                            :min="0"
                            :max="90"
                    /></label>
                </div>
                <Button type="submit" label="FIRE 시나리오 분석" />
            </form>
            <Message
                v-if="analysis?.error"
                severity="error"
                :closable="false"
                >{{ analysis.error }}</Message
            >
            <template v-if="analysis?.base">
                <div class="metric-grid">
                    <article v-for="s in analysis.scenarios" :key="s.label">
                        <h4>{{ s.label }}</h4>
                        <strong>{{ duration(s.result.firstMonth) }}</strong>
                        <p>
                            {{ projectionDate(s.result.firstMonth) }} · 기간 말
                            충당률 {{ fmt(s.result.final.coverage) }}%
                        </p>
                    </article>
                </div>
                <p>
                    보수적: 시작 배당 20% 삭감·배당/주가 연 변화 -2%p. 낙관적:
                    배당/주가 연 변화 +2%p (입력 상하한 적용). 확률 예측이
                    아닙니다. 최초 충족 이후에도 배당 삭감·환율·물가로 미달할 수
                    있습니다.
                </p>
                <p>
                    보강 투자 시 {{ duration(analysis.extra.firstMonth) }} ·
                    목표 생활비 조정 시
                    {{ duration(analysis.lower.firstMonth) }}
                </p>
                <p>
                    기간 말 자산: 재투자 {{ fmt(analysis.base.final.wealth) }} /
                    배당 현금 보유 {{ fmt(analysis.without.final.wealth) }}
                    {{ setup.targetCurrency }}. 두 경우 모두 미재투자 배당은
                    현금 자산에 포함합니다.
                </p>
                <IncomeProjectionChart
                    :rows="analysis.base.rows"
                    :currency="setup.targetCurrency" />
                <DataTable
                    :value="analysis.base.rows"
                    :table-props="{ 'aria-label': '연도별 FIRE 전망' }"
                    paginator
                    :rows="6"
                    scrollable
                    ><Column header="경과 연수"
                        ><template #body="{ data }">{{
                            data.month / 12
                        }}</template></Column
                    ><Column header="월 세후 배당"
                        ><template #body="{ data }">{{
                            fmt(data.income)
                        }}</template></Column
                    ><Column header="물가 반영 월 목표"
                        ><template #body="{ data }">{{
                            fmt(data.goal)
                        }}</template></Column
                    ><Column header="생활비 충당률"
                        ><template #body="{ data }"
                            >{{ fmt(data.coverage) }}%</template
                        ></Column
                    ><Column header="그 시점 세전 배당률"
                        ><template #body="{ data }"
                            >{{ fmt(data.currentYield) }}%</template
                        ></Column
                    ></DataTable
                >
                <p>
                    연평균 배당 기준 FIRE입니다. 월별 지급 공백은 배당
                    캘린더에서 확인하고 별도 생활비 현금을 확보하세요.
                </p>
            </template>
        </section>
        <section v-show="mode === 'reinvest'" aria-labelledby="recovery-title">
            <h3 id="recovery-title">원금 회수와 재투자 비교</h3>
            <Button
                label="분류된 원금·현금 회수 가져오기"
                :loading="fundingLoading"
                :disabled="fundingLoading"
                outlined
                @click="loadFunding" />
            <Message
                v-if="fundingIssue"
                :severity="fundingFailed ? 'error' : 'info'"
                :closable="false"
                >{{ fundingIssue }}</Message
            >
            <Message
                v-for="warning in fundingWarnings"
                :key="warning"
                severity="warn"
                :closable="false"
                >{{ warning }}</Message
            >
            <form @submit.prevent="recoveryAttempt = true">
                <div class="field-grid">
                    <label
                        v-for="field in recoveryFields"
                        :key="field.key"
                        :for="`recover-${field.key}`"
                        >{{ field.label
                        }}<InputNumber
                            :input-id="`recover-${field.key}`"
                            v-model="recoveryInput[field.key]"
                            :min="field.min"
                            :max="field.max || 1e12"
                            :max-fraction-digits="2"
                            fluid
                    /></label>
                </div>
                <Button type="submit" label="남은 회수 기간 계산" />
            </form>
            <Message
                v-if="recovery?.error"
                severity="error"
                :closable="false"
                >{{ recovery.error }}</Message
            >
            <template v-if="recovery && !recovery.error"
                ><p>
                    현금 회수율 {{ fmt(recovery.cashRate) }}% · 남은 회수액
                    {{ fmt(recovery.remaining) }} {{ currency }} · 배당
                    인출만으로 회수
                    {{
                        recovery.cashMonths == null
                            ? '현재 가정에서 회수 불가'
                            : `${recovery.cashMonths}개월`
                    }}
                </p>
                <p>
                    배당 수령 회수율 {{ fmt(recovery.dividendRate) }}% · 배당
                    수령액으로 원금 충당까지
                    {{
                        recovery.dividendMonths == null
                            ? '현재 가정에서 충당 불가'
                            : `${recovery.dividendMonths}개월`
                    }}
                    (재투자분 포함, 실제 인출과 구분)
                </p>
                <p v-if="economicGain != null">
                    입력한 현재 전체 자산 + 누적 외부 인출 − 누적 외부 납입 =
                    손익 {{ fmt(economicGain) }} {{ currency }}. 납입
                    시점·환율을 반영한 수익률은 아닙니다.
                </p></template
            >
            <p>
                배당은 일정하고 추가 납입·별도 매도·인출은 없다는 단순 회수
                가정입니다. 원금을 회수해도 남은 주식의 손실 위험은 유지됩니다.
                다른 통화의 회수액을 합산하지 않습니다.
            </p>
            <DataTable
                v-if="fundingStocks.length"
                :value="fundingStocks"
                :table-props="{ 'aria-label': '종목별 회수와 재투자' }"
                scrollable
                paginator
                :rows="5"
                ><Column field="symbol" header="종목" /><Column
                    header="직접 원금 출처"
                    ><template #body="{ data }">{{
                        fmt(data.direct)
                    }}</template></Column
                ><Column header="배분된 현금 회수"
                    ><template #body="{ data }">{{
                        fmt(data.recovered)
                    }}</template></Column
                ><Column header="누적 재투자"
                    ><template #body="{ data }">{{
                        fmt(data.reinvested)
                    }}</template></Column
                ></DataTable
            >
            <h4>같은 돈을 어디에 투자할까?</h4>
            <form @submit.prevent="compared = true">
                <div class="field-grid">
                    <label for="compare-amount"
                        >비교할 재투자 금액 ({{ currency }})<InputNumber
                            input-id="compare-amount"
                            v-model="comparisonInput.amount"
                            :min="0.01"
                            :max="1e10"
                            :max-fraction-digits="2" /></label
                    ><label for="compare-years"
                        >비교 기간 (년)<InputNumber
                            input-id="compare-years"
                            v-model="comparisonInput.years"
                            :min="1"
                            :max="60" /></label
                    ><label for="compare-cost"
                        >매도 후 교체 총 세금·비용 ({{ currency }})<InputNumber
                            input-id="compare-cost"
                            v-model="comparisonInput.cost"
                            :min="0"
                            :max-fraction-digits="2"
                    /></label>
                </div>
                <div class="metric-grid">
                    <fieldset v-for="side in ['a', 'b']" :key="side">
                        <legend>
                            {{ side === 'a' ? '동일 종목' : '다른 종목' }} 가정
                        </legend>
                        <label
                            v-for="f in candidateFields"
                            :key="f.key"
                            :for="`compare-${side}-${f.key}`"
                            >{{ f.label
                            }}<InputNumber
                                :input-id="`compare-${side}-${f.key}`"
                                v-model="comparisonInput[side][f.key]"
                                :min="f.min"
                                :max="f.max"
                                :max-fraction-digits="2"
                                fluid
                        /></label>
                    </fieldset>
                </div>
                <Button type="submit" label="3가지 재투자 경로 비교" />
            </form>
            <Message
                v-if="comparison?.error"
                severity="error"
                :closable="false"
                >{{ comparison.error }}</Message
            >
            <DataTable
                v-if="comparison?.rows"
                :value="comparison.rows"
                :table-props="{ 'aria-label': '재투자 경로 비교' }"
                scrollable
                ><Column field="label" header="선택" /><Column
                    header="기간 말 전체 자산"
                    ><template #body="{ data }"
                        >{{ fmt(data.result.final.wealth) }}
                        {{ currency }}</template
                    ></Column
                ><Column header="기간 말 월 세후 배당"
                    ><template #body="{ data }"
                        >{{ fmt(data.result.final.income) }}
                        {{ currency }}</template
                    ></Column
                ></DataTable
            >
            <p>
                세후 배당 전액 재투자·월 균등 배당 가정입니다. 신규 투자에는
                매도비용이 없고 교체는 입력 비용을 차감합니다. 배당 확대는 월
                배당, 총수익은 전체 자산을 비교하세요. 지급 여력·종목/기초자산
                편중·공식 공시 확인을 함께 해야 하며 특정 종목 매수 추천은
                아닙니다.
            </p>
        </section>
        <section v-show="mode === 'stress'" aria-labelledby="stability-title">
            <h3 id="stability-title">배당률 변화와 포트폴리오 안정성</h3>
            <Button
                label="배당 기여도·계산 가정 가져오기"
                outlined
                @click="importStress" />
            <form @submit.prevent="stressed = true">
                <div class="field-grid">
                    <label
                        v-for="f in stressFields"
                        :key="f.key"
                        :for="`stress-plan-${f.key}`"
                        >{{ f.label
                        }}<InputNumber
                            :input-id="`stress-plan-${f.key}`"
                            v-model="stressInput[f.key]"
                            :min="f.min"
                            :max="f.max"
                            :max-fraction-digits="2"
                            fluid
                    /></label>
                </div>
                <Button type="submit" label="배당 스트레스 분석" />
            </form>
            <Message v-if="stress?.error" severity="error" :closable="false">{{
                stress.error
            }}</Message>
            <template v-if="stress?.rows"
                ><DataTable
                    :value="stress.rows"
                    :table-props="{ 'aria-label': '배당 스트레스 결과' }"
                    scrollable
                    ><Column field="label" header="상황" /><Column
                        header="월 세후 배당"
                        ><template #body="{ data }">{{
                            fmt(data.income)
                        }}</template></Column
                    ><Column header="생활비 충당률"
                        ><template #body="{ data }"
                            >{{ fmt(data.coverage) }}%</template
                        ></Column
                    ><Column header="월 부족액"
                        ><template #body="{ data }">{{
                            fmt(data.shortage)
                        }}</template></Column
                    ></DataTable
                >
                <p>
                    입력한 배당금·주가 변화 후 배당률은 기존의
                    {{ fmt(stress.yieldMultiplier) }}배입니다. 배당률 상승만으로
                    배당금 증가나 안정성 개선을 판단할 수 없습니다.
                </p></template
            >
            <p>
                월 배당과 생활비는 같은 통화 기준입니다. 환율 충격은 원화 환산
                생활비 관점으로 입력하세요. 통화 환산 없이 USD 생활비를 비교할
                때 환율 영향 비중은 0%로 둡니다. 종목 배당 기여도는 과거 기록
                기준이며 미래 지급 비중을 보장하지 않습니다.
            </p>
            <p>
                자산·운용사·기초자산 집중도는 아래 기존 분석과 함께 확인하세요.
                기업은 현금흐름·배당성향·부채, 리츠는 배당 재원, ETF는 분배
                재원·원금 환급 성격 등을 공식 자료로 점검해야 합니다.
            </p>
        </section>
        <InvestorExam
            v-show="mode === 'exam'"
            :largest-share="largestShare"
            @result="assessment = $event" />
        <InvestmentBlog v-show="mode === 'blog'" :context="blogContext" />
    </section>
</template>

<style scoped>
    .workbench {
        border: 1px solid var(--p-content-border-color);
        border-radius: 1rem;
        background: var(--p-content-background);
        padding: clamp(0.75rem, 2vw, 1.5rem);
        margin-block: 1.5rem;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .field-grid,
    .metric-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
        gap: 1rem;
        margin-block: 1rem;
    }
    label {
        display: grid;
        gap: 0.5rem;
        margin-block: 0.6rem;
    }
    .check {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
    }
    article,
    fieldset {
        border: 1px solid var(--p-content-border-color);
        border-radius: 0.75rem;
        padding: 1rem;
        min-width: 0;
    }
    article h4 {
        margin-top: 0;
    }
    strong {
        font-size: 1.25rem;
    }
    select {
        background: var(--p-inputtext-background);
        color: var(--p-inputtext-color);
        padding: 0.65rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: 0.5rem;
    }
    p {
        line-height: 1.65;
    }
    .workbench :deep(.p-selectbutton) {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
    }
    .workbench :deep(.p-inputnumber),
    .workbench :deep(.p-inputnumber-input) {
        width: 100%;
        min-width: 0;
    }
    .workbench :deep(.p-datatable) {
        max-width: 100%;
    }
</style>
