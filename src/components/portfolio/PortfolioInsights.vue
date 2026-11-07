<script setup>
    import { computed, ref, watch } from 'vue';
    import InvestmentWorkbench from './InvestmentWorkbench.vue';
    import HoldingScenarioComparison from './HoldingScenarioComparison.vue';
    import MonthlyStatement from './MonthlyStatement.vue';
    import AdvancedPortfolioInsights from './AdvancedPortfolioInsights.vue';
    import HoldingDividendCapitalChart from './HoldingDividendCapitalChart.vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import DatePicker from 'primevue/datepicker';
    import SelectButton from 'primevue/selectbutton';
    import InputNumber from 'primevue/inputnumber';
    import Message from 'primevue/message';
    import ProgressBar from 'primevue/progressbar';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import { firebaseUser } from '@/services/firebaseClient';
    import { loadFamilyLedger } from '@/services/familyPortfolio';
    import {
        calendarToday,
        validCalendarDate,
    } from '@/services/portfolioCalendar.js';
    import {
        dividendInsights,
        assetConcentration,
        dividendGoal,
        dividendReduction,
    } from '@/services/portfolioInsights.js';
    import { getAssetUrl } from '@/utils/dataUrl.js';
    import { readPublicJson } from '@/services/publicJson.js';
    import { useRequestCooldown } from '@/composables/useRequestCooldown.js';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';

    const props = defineProps({
        accounts: { type: Array, default: () => [] },
        positions: { type: Array, default: () => [] },
        familyId: { type: String, default: '' },
    });
    const today = ref(calendarToday());
    const month = ref(today.value.slice(0, 7)),
        accountId = ref(''),
        currency = ref('USD');
    // DatePicker uses local calendar fields; ledger periods remain YYYY-MM.
    const analysisMonthDate = computed({
        get: () =>
            validCalendarDate(`${month.value}-01`)
                ? new Date(
                      Number(month.value.slice(0, 4)),
                      Number(month.value.slice(5, 7)) - 1,
                      1
                  )
                : null,
        set: (value) => {
            month.value =
                value instanceof Date && Number.isFinite(value.getTime())
                    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
                    : '';
        },
    });
    const minimumAnalysisMonth = new Date(1900, 0, 1);
    const maximumAnalysisMonth = computed(
        () =>
            new Date(
                Number(today.value.slice(0, 4)),
                Number(today.value.slice(5, 7)) - 1,
                1
            )
    );

    const entries = ref([]),
        loading = ref(false),
        issue = ref(null),
        refresh = ref(0);
    useFullscreenLoading(
        loading,
        '포트폴리오 분석 데이터를 불러오고 있습니다.'
    );
    const classifications = ref({}),
        metadataError = ref('');
    const goal = ref(null),
        reduction = ref(20),
        stressSymbol = ref(''),
        assetDimension = ref('symbols');
    const { coolingDown, remainingSeconds } = useRequestCooldown(issue);
    const selectedAccounts = computed(() =>
        props.accounts.filter(
            (a) => !accountId.value || a.id === accountId.value
        )
    );
    const selectedPositions = computed(() =>
        props.positions.filter((p) =>
            selectedAccounts.value.some((a) => a.id === p.accountId)
        )
    );
    const report = computed(() =>
        dividendInsights(entries.value, {
            month: month.value,
            today: today.value,
        })
    );
    const assets = computed(() =>
        assetConcentration(selectedPositions.value, classifications.value)
    );
    const accountOptions = computed(() => [
        { label: '모든 계좌', value: '' },
        ...props.accounts.map((a) => ({ label: a.alias, value: a.id })),
    ]);
    const currencyOptions = computed(() =>
        [
            ...new Set(
                [...report.value.currencies, ...assets.value].map(
                    (group) => group.currency
                )
            ),
        ]
            .sort()
            .map((value) => ({
                label: value === 'UNKNOWN' ? '통화 미확인' : value,
                value,
            }))
    );
    const selectedCurrency = computed({
        get: () =>
            currencyOptions.value.some((o) => o.value === currency.value)
                ? currency.value
                : currencyOptions.value[0]?.value,
        set: (value) => {
            currency.value = value;
        },
    });
    const dividends = computed(() =>
        report.value.currencies.find(
            (group) => group.currency === selectedCurrency.value
        )
    );
    const asset = computed(() =>
        assets.value.find((group) => group.currency === selectedCurrency.value)
    );
    const goalPercent = computed(() =>
        dividendGoal(dividends.value, goal.value)
    );
    const stressOptions = computed(() =>
        (dividends.value?.monthContributions.rows || [])
            .filter((row) => row.amount > 0)
            .map((row) => row.label)
    );
    const selectedStress = computed({
        get: () =>
            stressOptions.value.includes(stressSymbol.value)
                ? stressSymbol.value
                : stressOptions.value[0],
        set: (value) => {
            stressSymbol.value = value;
        },
    });
    const stress = computed(() =>
        dividendReduction(
            dividends.value,
            selectedStress.value,
            reduction.value
        )
    );
    const missingAccounts = computed(
        () => selectedAccounts.value.filter((a) => !a.snapshot).length
    );
    const money = (value, hasRecords = true) =>
        value == null
            ? hasRecords
                ? '금액 미확인'
                : '기록 없음'
            : Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: 2,
              });
    const percent = (value) =>
        value == null
            ? '확인 불가'
            : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    const assetOptions = [
        { label: '종목', value: 'symbols' },
        { label: '운용사', value: 'providers' },
        { label: '연결 기초자산', value: 'underlyings' },
        { label: '업종', value: 'sectors' },
        { label: '국가', value: 'countries' },
    ];
    watch(
        month,
        (value) => {
            if (
                !validCalendarDate(`${value}-01`) ||
                value > today.value.slice(0, 7)
            )
                month.value = today.value.slice(0, 7);
        },
        { flush: 'sync' }
    );
    watch(
        () => props.accounts,
        (accounts) => {
            if (
                accountId.value &&
                !accounts.some((a) => a.id === accountId.value)
            )
                accountId.value = '';
        }
    );
    // Goals are temporary, and reset when the account/currency/month context changes.
    watch([selectedCurrency, accountId, month], () => {
        goal.value = null;
        stressSymbol.value = '';
    });
    watch(
        [
            selectedAccounts,
            () => props.familyId,
            () => firebaseUser.value?.uid,
            refresh,
        ],
        async ([accounts, familyId, uid], previous, onCleanup) => {
            const controller = new AbortController();
            onCleanup(() => controller.abort());
            entries.value = [];
            loading.value = false;
            today.value = calendarToday();
            if (!uid || !accounts.length || coolingDown.value) return;
            issue.value = null;
            loading.value = true;
            const [ledger, metadata] = await Promise.allSettled([
                loadFamilyLedger({
                    force:
                        previous?.[3] !== undefined &&
                        previous[3] !== refresh.value,
                    familyId,
                    accounts,
                    signal: controller.signal,
                    isCurrent: () =>
                        !controller.signal.aborted &&
                        firebaseUser.value?.uid === uid,
                }),
                (async () => {
                    const payload = await readPublicJson(
                        getAssetUrl('portfolio-classifications.json'),
                        {
                            force:
                                previous?.[3] !== undefined &&
                                previous[3] !== refresh.value,
                            ttlMs: 180_000,
                            signal: AbortSignal.any([
                                controller.signal,
                                AbortSignal.timeout(8000),
                            ]),
                            validate: (value) =>
                                value?.schemaVersion === 1 &&
                                value.securities &&
                                typeof value.securities === 'object' &&
                                !Array.isArray(value.securities),
                        }
                    );
                    if (
                        payload.schemaVersion !== 1 ||
                        !payload.securities ||
                        typeof payload.securities !== 'object' ||
                        Array.isArray(payload.securities)
                    )
                        throw new Error('분류 자료 확인 필요');
                    return payload.securities;
                })(),
            ]);
            if (controller.signal.aborted) return;
            if (ledger.status === 'fulfilled') entries.value = ledger.value;
            else issue.value = ledger.reason;
            classifications.value =
                metadata.status === 'fulfilled' ? metadata.value : {};
            metadataError.value =
                metadata.status === 'rejected'
                    ? '분류 자료를 불러오지 못했습니다. 운용사·기초자산은 미분류로 표시합니다.'
                    : '';
            loading.value = false;
        },
        { immediate: true, flush: 'sync' }
    );
    // Pixel scaling only; values, cancellation handling and missing-data states come from dividendInsights.
    const monthlyChartScale = computed(() =>
        Math.max(
            1,
            ...(dividends.value?.months || [])
                .filter(
                    (row) =>
                        !row.afterRange &&
                        row.count > 0 &&
                        Number.isFinite(row.amount)
                )
                .map((row) => Math.abs(row.amount))
        )
    );
    const moduleContents = ref(null);
    const analysisModules = [
        {
            key: 'ledger',
            target: 'insights-module-ledger',
            title: '원장 품질·청산 손익',
            description: '원장 품질과 청산 손익 내역 점검',
            action: '원장 바로가기',
        },
        {
            key: 'capital',
            target: 'insights-module-capital',
            title: '보유 종목 자금·배당',
            description: '보유 종목 원금과 배당 재투자 내역',
            action: '자금 조회',
        },
        {
            key: 'monthly',
            target: 'insights-module-monthly',
            title: '월간 배당 기록',
            description: '월별 저장 배당과 결산 기록 대조',
            action: '월간 기록',
        },
        {
            key: 'scenario',
            target: 'insights-module-scenario',
            title: '보유 종목 시나리오',
            description: '보유 종목의 배당·납입 가정 비교',
            action: '시나리오',
        },
        {
            key: 'workbench',
            target: 'insights-module-workbench',
            title: '투자 설계',
            description: '목표 현금흐름과 투자 가정 설계',
            action: '설계 진입',
        },
    ];
    function moduleEnabled(key) {
        if (!selectedAccounts.value.length) return false;
        return key === 'monthly'
            ? !!dividends.value && selectedCurrency.value !== 'UNKNOWN'
            : ['USD', 'KRW'].includes(selectedCurrency.value);
    }
    function focusModule(module) {
        if (!moduleEnabled(module.key)) return;
        const root = moduleContents.value?.querySelector(`#${module.target}`);
        // Focusing the closed summary preserves the existing lazy scenario work.
        const target =
            module.key === 'scenario'
                ? root?.querySelector(':scope > summary')
                : root;
        target?.scrollIntoView({ block: 'start' });
        target?.focus({ preventScroll: true });
    }
</script>

<template>
    <section
        class="insights"
        aria-labelledby="insights-title"
        :aria-busy="loading">
        <div class="insights-heading">
            <h1 id="insights-title">배당 성과·집중도 분석</h1>
            <p>
                기준월:
                {{
                    month
                        ? `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`
                        : '미선택'
                }}
                · 취소 내역이 차감 반영된 저장 배당 자료 기준
            </p>
        </div>
        <div class="insights-filters">
            <label for="insights-account"
                >분석 대상 계좌<Select
                    input-id="insights-account"
                    aria-label="분석 대상 계좌"
                    placeholder="모든 계좌"
                    v-model="accountId"
                    :options="accountOptions"
                    option-label="label"
                    option-value="value"
            /></label>
            <label for="insights-currency"
                >기준 통화<Select
                    input-id="insights-currency"
                    aria-label="기준 통화"
                    v-model="selectedCurrency"
                    :options="currencyOptions"
                    option-label="label"
                    option-value="value"
                    placeholder="기록 없음"
            /></label>
            <label for="insights-month"
                >분석 월 선택 (현재월 이하)<DatePicker
                    v-model="analysisMonthDate"
                    input-id="insights-month"
                    view="month"
                    date-format="yy년 mm월"
                    :min-date="minimumAnalysisMonth"
                    :max-date="maximumAnalysisMonth"
                    show-icon
                    icon-display="input"
                    append-to="self"
                    :pt="{
                        panel: { style: { maxWidth: 'calc(100vw - 24px)' } },
                    }"
            /></label>
            <Button
                label="분석 다시 조회"
                :loading="loading"
                :disabled="coolingDown || !accounts.length"
                @click="refresh++" />
        </div>
        <p class="insights-note">
            배당 취소를 차감한 저장 기록입니다. 실제 지급 내역의 완전성이나
            세전·세후 수령액을 확정하지 않습니다. 공시 기반 예상은 배당
            캘린더에서 확인하세요. 통화는 환산하지 않습니다.
        </p>
        <p v-if="loading" role="status">
            권한과 전체 거래 내역을 확인하고 있습니다.
        </p>
        <Message v-else-if="issue" severity="error" :closable="false"
            >{{ issue.message
            }}<span v-if="coolingDown">
                · 권장 재시도까지 {{ remainingSeconds }}초</span
            ></Message
        >
        <template v-else>
            <Message v-if="report.rejected" severity="warn" :closable="false"
                >날짜가 없거나 유효하지 않은 날짜·미래 날짜의 배당
                {{ report.rejected }}건은 분석에서 제외했습니다.</Message
            >
            <p v-if="!accounts.length">
                분석할 계좌가 없습니다. 계좌를 등록하고 거래·잔고 자료를
                업로드해 주세요.
            </p>
            <template v-if="dividends">
                <Message
                    v-if="
                        dividends.year.unknown || selectedCurrency === 'UNKNOWN'
                    "
                    severity="warn"
                    :closable="false"
                    >금액 미확인 {{ dividends.year.unknown }}건 · 확인된 금액만
                    분석합니다. 통화 미확인 기록은 별도로 표시하며 목표·감소
                    가정에서 제외합니다.</Message
                >
                <div class="insights-summary">
                    <article>
                        <h3>{{ month }} 저장 배당</h3>
                        <strong
                            >{{
                                money(
                                    dividends.current.amount,
                                    dividends.current.count > 0
                                )
                            }}
                            {{ selectedCurrency }}</strong
                        >
                        <p>
                            {{ dividends.current.count }}건{{
                                month === today.slice(0, 7)
                                    ? ' · 진행 중인 달'
                                    : ''
                            }}
                        </p>
                    </article>
                    <article>
                        <h3>{{ month.slice(0, 4) }}년 누적 기록</h3>
                        <strong
                            >{{
                                money(
                                    dividends.year.amount,
                                    dividends.year.count > 0
                                )
                            }}
                            {{ selectedCurrency }}</strong
                        >
                        <p>
                            1월 ~ {{ Number(month.slice(5)) }}월 · 확인된 기록
                            기준
                        </p>
                    </article>
                    <article>
                        <h3>저장 기록 전년 동월 대비</h3>
                        <strong
                            :class="{
                                'insights-comparison-unavailable':
                                    dividends.yearOverYear == null,
                            }"
                            >{{ percent(dividends.yearOverYear) }}</strong
                        >
                        <p>
                            전년 동월
                            {{
                                money(
                                    dividends.previous.amount,
                                    dividends.previous.count > 0
                                )
                            }}
                            {{ selectedCurrency }}
                        </p>
                        <small
                            >진행 중인 달·기록 없음·금액 누락은 비교하지
                            않습니다.</small
                        >
                    </article>
                    <article class="insight-basis-card">
                        <h3>자료 기준 안내</h3>
                        <strong>통화별 독립 보존</strong>
                        <p>환산·합산 없음 · 저장 기록 기준</p>
                        <small
                            >선택 통화 {{ selectedCurrency }} · 취소 내역
                            차감</small
                        >
                    </article>
                </div>
            </template>
            <div v-if="accounts.length" class="insights-workspace">
                <section
                    class="insights-records"
                    aria-label="월별 배당 기록과 계산 도구">
                    <template v-if="dividends">
                        <header class="insights-records-heading">
                            <h3>
                                {{ month.slice(0, 4) }}년 월별 저장 기록
                                (12개월)
                            </h3>
                            <p>기록 없음은 배당 0원을 의미하지 않습니다.</p>
                        </header>
                        <DataTable
                            class="insights-month-table"
                            :row-class="
                                (data) =>
                                    data.month === month
                                        ? 'insights-selected-month'
                                        : ''
                            "
                            :value="dividends.months"
                            :table-props="{
                                'aria-label': '월별 저장 배당 기록',
                            }"
                            scrollable>
                            <Column field="month" header="월"
                                ><template #body="{ data }"
                                    >{{ data.month.slice(0, 4) }}년
                                    {{ data.month.slice(5, 7) }}월</template
                                ></Column
                            >
                            <Column :header="`저장 금액 (${selectedCurrency})`"
                                ><template #body="{ data }">{{
                                    data.afterRange || data.count === 0
                                        ? '-'
                                        : money(data.amount, true)
                                }}</template></Column
                            >
                            <Column header="자료 상태"
                                ><template #body="{ data }"
                                    ><span
                                        class="insights-record-status"
                                        :class="
                                            data.afterRange
                                                ? 'status-outside'
                                                : data.unknown
                                                  ? 'status-missing'
                                                  : data.count
                                                    ? 'status-recorded'
                                                    : 'status-none'
                                        "
                                        >{{
                                            data.afterRange
                                                ? '분석 범위 밖 (—)'
                                                : data.count === 0
                                                  ? '기록 없음 (0건)'
                                                  : `저장 기록 (${data.count}건)${data.unknown ? ` · 금액 미확인 ${data.unknown}건` : ''}`
                                        }}</span
                                    ></template
                                ></Column
                            >
                        </DataTable>
                        <div class="insights-tools">
                            <article>
                                <h3>월 배당 목표</h3>
                                <label for="dividend-goal"
                                    >{{ selectedCurrency }} 목표
                                    금액<InputNumber
                                        input-id="dividend-goal"
                                        v-model="goal"
                                        :min="0"
                                        :max-fraction-digits="2"
                                        :use-grouping="true"
                                        :disabled="
                                            selectedCurrency === 'UNKNOWN'
                                        "
                                /></label>
                                <p>
                                    선택 월의 기록 기준 달성률
                                    {{ percent(goalPercent) }}
                                </p>
                                <ProgressBar
                                    v-if="goalPercent != null"
                                    :value="
                                        Math.min(100, Math.max(0, goalPercent))
                                    "
                                    :show-value="false"
                                    aria-label="기록 기준 월 배당 목표 달성률" /><small
                                    >목표는 현재 화면에서만 사용합니다.</small
                                >
                            </article>
                            <article>
                                <h3>배당 감소 가정</h3>
                                <label for="stress-symbol"
                                    >대상 종목<Select
                                        input-id="stress-symbol"
                                        aria-label="대상 종목"
                                        v-model="selectedStress"
                                        :options="stressOptions"
                                        placeholder="선택 월 양수 기록 없음" /></label
                                ><label for="stress-reduction"
                                    >감소율 (%)<InputNumber
                                        input-id="stress-reduction"
                                        v-model="reduction"
                                        :min="0"
                                        :max="100"
                                        :max-fraction-digits="1"
                                /></label>
                                <p v-if="stress">
                                    감소액 {{ money(stress.decrease) }}
                                    {{ selectedCurrency }} · 적용 후
                                    {{ money(stress.after) }}
                                    {{ selectedCurrency }}
                                </p>
                                <p v-else>
                                    선택 월의 종목·금액·통화를 확인하면 비교할
                                    수 있습니다.
                                </p>
                                <small
                                    >선택 월 저장 기록에 감소율을 적용한
                                    가정이며 미래 배당 예측이 아닙니다.</small
                                >
                            </article>
                        </div>
                        <div
                            class="insights-month-chart"
                            role="group"
                            aria-label="월별 저장 배당 차트">
                            <div
                                v-for="row in dividends.months"
                                :key="row.month"
                                class="insights-month-column"
                                :aria-label="`${row.month}: ${row.afterRange ? '분석 범위 밖' : money(row.amount, row.count > 0)}`">
                                <span class="insights-month-value">{{
                                    row.afterRange
                                        ? '범위 밖'
                                        : money(row.amount, row.count > 0)
                                }}</span>
                                <div class="insights-bar-track">
                                    <i
                                        v-if="
                                            !row.afterRange &&
                                            row.count > 0 &&
                                            Number.isFinite(row.amount)
                                        "
                                        :class="{ negative: row.amount < 0 }"
                                        :style="{
                                            height: `${(Math.abs(row.amount) / monthlyChartScale) * 100}%`,
                                            minHeight:
                                                row.amount === 0 ? '0' : '2px',
                                        }" /><span v-else>—</span>
                                </div>
                                <span>{{ row.month.slice(-2) }}월</span>
                            </div>
                        </div>
                    </template>
                    <p v-else-if="accounts.length">
                        선택한 통화·연도의 저장된 배당 기록이 없습니다. 배당
                        캘린더의 공시 예상액과는 별개입니다.
                    </p>
                </section>
                <section
                    class="insights-distribution"
                    aria-label="배당 기여도와 자산 집중도">
                    <template v-if="dividends">
                        <h3>누적 배당 기여도</h3>
                        <p>
                            상위 3종목 비중
                            {{ percent(dividends.contributions.topThree) }} ·
                            취소 차감 후 양수인 종목별 금액의 합계가 기준입니다.
                        </p>
                        <Message
                            v-if="dividends.contributions.negativeGroups"
                            severity="warn"
                            :closable="false"
                            >취소가 더 큰
                            {{ dividends.contributions.negativeGroups }}개
                            종목은 금액에 표시하고 양수 합계 비중에서
                            제외했습니다.</Message
                        >
                        <DataTable
                            :value="dividends.contributions.rows"
                            paginator
                            :rows="10"
                            :table-props="{
                                'aria-label': '종목별 누적 배당 기여도',
                            }"
                            scrollable>
                            <Column field="label" header="종목" /><Column
                                :header="`누적 기록 (${selectedCurrency})`"
                                ><template #body="{ data }"
                                    >{{ money(data.amount)
                                    }}<small v-if="data.unknown">
                                        · 미확인 {{ data.unknown }}건</small
                                    ></template
                                ></Column
                            >
                            <Column header="양수 금액 기준 비중"
                                ><template #body="{ data }"
                                    ><div class="insights-share">
                                        {{ percent(data.share)
                                        }}<ProgressBar
                                            v-if="data.share != null"
                                            :value="data.share"
                                            :show-value="
                                                false
                                            " /></div></template
                            ></Column>
                        </DataTable>
                    </template>
                    <h3
                        v-if="accounts.length"
                        id="asset-concentration"
                        tabindex="-1">
                        자료 평가액 기준 자산 집중도
                    </h3>
                    <Message
                        v-if="metadataError"
                        severity="warn"
                        :closable="false"
                        >{{ metadataError }}</Message
                    >
                    <Message
                        v-if="missingAccounts"
                        severity="warn"
                        :closable="false"
                        >잔고 자료가 없는 {{ missingAccounts }}개 계좌는 자산
                        분석에서 제외했습니다.</Message
                    >
                    <template v-if="asset">
                        <p>
                            현금 제외 · 확인된 자료 평가액
                            {{ money(asset.total) }} {{ selectedCurrency }} ·
                            종목 상위 3개 비중
                            {{ percent(asset.symbols.topThree) }}
                        </p>
                        <p>
                            잔고 기준일 {{ asset.dates.join(' / ') || '미확인'
                            }}{{
                                asset.dates.length > 1
                                    ? ' · 기준일이 서로 다릅니다.'
                                    : ''
                            }}
                        </p>
                        <p v-if="asset.excluded">
                            평가액 미확인·음수 항목 {{ asset.excluded }}개 제외
                            · 일부 금액 기준입니다.
                        </p>
                        <SelectButton
                            v-model="assetDimension"
                            :options="assetOptions"
                            option-label="label"
                            option-value="value"
                            :allow-empty="false"
                            aria-label="자산 집중도 분류" />
                        <p class="insights-note">
                            운용사·기초자산·업종·국가는 앱 분류 자료 기준입니다.
                            확인된 분류가 없으면 종목별 미분류로 표시합니다.
                            기초자산 연결은 롱·인버스·레버리지 방향과 배수를
                            반영한 실질 노출도가 아닙니다. 미분류는 종목별로
                            구분합니다.
                        </p>
                        <p>
                            운용사 미분류 {{ asset.unknownProvider }}개 항목 ·
                            기초자산 미분류 {{ asset.unknownUnderlying }}개 항목
                        </p>
                        <DataTable
                            :value="asset[assetDimension].rows"
                            paginator
                            :rows="10"
                            :table-props="{ 'aria-label': '자산 집중도 내역' }"
                            scrollable>
                            <Column field="label" header="분류" /><Column
                                :header="`자료 평가액 (${selectedCurrency})`"
                                ><template #body="{ data }">{{
                                    money(data.amount)
                                }}</template></Column
                            >
                            <Column header="확인 금액 기준 비중"
                                ><template #body="{ data }"
                                    ><div class="insights-share">
                                        {{ percent(data.share)
                                        }}<ProgressBar
                                            v-if="data.share != null"
                                            :value="data.share"
                                            :show-value="
                                                false
                                            " /></div></template
                            ></Column>
                        </DataTable>
                    </template>
                    <p v-else-if="accounts.length">
                        선택한 통화의 증권 잔고 자료가 없습니다.
                    </p>
                </section>
            </div>
            <section
                class="analysis-modules"
                aria-labelledby="analysis-modules-title">
                <h3 id="analysis-modules-title">상세 분석 및 관리 연계 모듈</h3>
                <div class="analysis-module-grid">
                    <article
                        v-for="module in analysisModules"
                        :key="module.key"
                        class="analysis-module-card">
                        <div>
                            <h4>{{ module.title }}</h4>
                            <p>{{ module.description }}</p>
                        </div>
                        <Button
                            :label="module.action"
                            severity="secondary"
                            outlined
                            :disabled="!moduleEnabled(module.key)"
                            :aria-controls="
                                moduleEnabled(module.key)
                                    ? module.target
                                    : undefined
                            "
                            @click="focusModule(module)" />
                    </article>
                </div>
            </section>
            <section
                ref="moduleContents"
                class="additional-insights"
                aria-labelledby="additional-insights-title">
                <h3 id="additional-insights-title">
                    현금흐름·원금·투자 가정 상세
                </h3>
                <AdvancedPortfolioInsights
                    v-if="
                        selectedAccounts.length &&
                        ['USD', 'KRW'].includes(selectedCurrency)
                    "
                    id="insights-module-ledger"
                    :key="`advanced:${firebaseUser?.uid}:${familyId}:${accountId}:${selectedCurrency}:${month}`"
                    class="analysis-module-target"
                    tabindex="-1"
                    :entries="entries"
                    :positions="selectedPositions"
                    :accounts="selectedAccounts"
                    :month="month"
                    :currency="selectedCurrency"
                    :today="today" />
                <HoldingDividendCapitalChart
                    v-if="
                        selectedAccounts.length &&
                        ['USD', 'KRW'].includes(selectedCurrency)
                    "
                    id="insights-module-capital"
                    class="analysis-module-target"
                    tabindex="-1"
                    :accounts="selectedAccounts"
                    :positions="selectedPositions"
                    :currency="selectedCurrency"
                    :today="today" />
                <MonthlyStatement
                    v-if="
                        dividends &&
                        selectedAccounts.length &&
                        selectedCurrency !== 'UNKNOWN'
                    "
                    id="insights-module-monthly"
                    :key="`${firebaseUser?.uid}:${familyId}:${accountId}:${selectedCurrency}:${month}`"
                    class="analysis-module-target"
                    tabindex="-1"
                    :group="dividends"
                    :month="month"
                    :today="today"
                    :user-id="firebaseUser?.uid || ''"
                    :family-id="
                        selectedAccounts.length &&
                        selectedAccounts.every(
                            (a) => a.familyId === selectedAccounts[0].familyId
                        )
                            ? selectedAccounts[0].familyId || familyId
                            : familyId
                    "
                    :account-ids="selectedAccounts.map((account) => account.id)"
                    :account-revisions="
                        Object.fromEntries(
                            selectedAccounts.map((account) => [
                                account.id,
                                account.entriesRevision ?? 0,
                            ])
                        )
                    "
                    :rejected="report.rejected" />
                <HoldingScenarioComparison
                    v-if="
                        ['USD', 'KRW'].includes(selectedCurrency) &&
                        selectedAccounts.length
                    "
                    id="insights-module-scenario"
                    :key="`holding:${familyId}:${accountId}:${selectedCurrency}:${month}`"
                    class="analysis-module-target"
                    :positions="selectedPositions"
                    :entries="entries"
                    :currency="selectedCurrency"
                    :month="month" />
                <InvestmentWorkbench
                    v-if="
                        ['USD', 'KRW'].includes(selectedCurrency) &&
                        selectedAccounts.length
                    "
                    id="insights-module-workbench"
                    :key="`${familyId}:${accountId}:${selectedCurrency}:${month}`"
                    class="analysis-module-target"
                    tabindex="-1"
                    :entries="entries"
                    :positions="selectedPositions"
                    :accounts="selectedAccounts"
                    :family-id="familyId"
                    :currency="selectedCurrency"
                    :month="month"
                    :largest-share="asset?.symbols.rows[0]?.share ?? null" />
            </section>
        </template>
        <Message
            id="dividend-growth"
            severity="secondary"
            :closable="false"
            tabindex="-1">
            배당 성장률은 준비 중입니다. 아래 월별 저장 배당은 입금 기록이며
            종목의 배당 성장률과 다릅니다.
        </Message>
    </section>
</template>

<style scoped>
    .insights {
        color: var(--p-content-color);
        min-width: 0;
        line-height: 1.5;
    }
    .insights-heading {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: flex-start;
        flex-wrap: wrap;
    }
    .insights h2 {
        margin-top: 0;
    }
    .insights h3 {
        margin-top: 1.75rem;
    }
    .insights-filters,
    .insights-summary,
    .insights-tools {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
        gap: 1rem;
        margin-block: 1rem;
    }
    .insights label {
        display: grid;
        gap: 0.5rem;
        margin-block: 0.5rem;
    }
    .insights input[type='month'] {
        padding: 0.65rem;
        color: var(--p-inputtext-color);
        background: var(--p-inputtext-background);
        border: 1px solid var(--p-inputtext-border-color);
        border-radius: var(--p-inputtext-border-radius);
        font: inherit;
        width: 100%;
        min-width: 0;
        color-scheme: light;
    }
    .insights-summary article,
    .insights-tools article {
        border: 1px solid var(--p-content-border-color);
        background: var(--p-content-background);
        padding: 1rem;
        border-radius: 0.75rem;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .insights-summary h3,
    .insights-tools h3 {
        margin-top: 0;
        font-size: 1rem;
    }
    .insights-summary strong {
        font-size: 1.5rem;
    }
    .insights-note,
    .insights small {
        color: var(--p-text-muted-color);
    }
    .insights-share {
        min-width: 7rem;
    }
    .insights-share :deep(.p-progressbar) {
        height: 0.4rem;
        margin-top: 0.4rem;
    }
    .insights :deep(.p-inputnumber-input) {
        width: 100%;
        min-width: 0;
    }
    .insights :deep(.p-datatable) {
        max-width: 100%;
    }
    .insights :deep(.p-selectbutton) {
        flex-wrap: wrap;
    }
    .p-dark .insights input[type='month'] {
        color-scheme: dark;
    }

    /* CONTENT / Portfolio Analysis / Reviewed. Supplemental existing analysis tools remain below. */
    .insights {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }
    .insights-heading h2 {
        font-size: 20px;
        margin: 0 0 6px;
    }
    .insights-heading p {
        margin: 0;
        color: var(--app-muted);
        font-size: 13px;
    }
    .insights-filters {
        grid-template-columns: 2fr 1.2fr 1.2fr;
        margin: 0;
        padding: 20px;
        gap: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .insights-filters label {
        margin: 0;
        gap: 6px;
        font-size: 13px;
        color: var(--app-muted);
    }
    .insights-summary {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 20px;
        margin: 0;
    }
    .insights-summary article {
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 1px 3px rgb(0 0 0 / 2%);
    }
    .insights-summary h3 {
        font-size: 14px;
        color: var(--app-muted);
        margin-bottom: 12px;
    }
    .insights-summary strong {
        font-size: 24px;
        font-variant-numeric: tabular-nums;
    }
    .insights-summary p {
        font-size: 12px;
    }
    .insights-month-chart {
        display: flex;
        gap: 12px;
        min-width: 0;
        overflow-x: auto;
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .insights-month-column {
        display: flex;
        flex: 1;
        min-width: 52px;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        font-size: 11px;
        color: var(--app-muted);
    }
    .insights-month-value {
        white-space: nowrap;
    }
    .insights-bar-track {
        height: 160px;
        width: 28px;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        border-bottom: 1px solid var(--app-border);
    }
    .insights-bar-track i {
        display: block;
        width: 100%;
        min-height: 2px;
        background: var(--app-accent);
        border-radius: 4px 4px 0 0;
    }
    .insights-bar-track i.negative {
        background: var(--app-up);
    }
    .insights > :deep(.p-datatable) {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        overflow: hidden;
    }
    @media (max-width: 1024px) {
        .insights-filters {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 640px) {
        .insights-filters,
        .insights-summary {
            grid-template-columns: 1fr;
        }
        .insights-filters,
        .insights-summary article {
            padding: 16px;
        }
    }
    /* Reviewed 2e3c66: account/currency/month/refresh; four independent KPIs. */
    .insights-filters {
        grid-template-columns: 2fr 1.2fr 1.5fr auto;
        align-items: end;
    }
    .insights-filters > :deep(.p-button) {
        min-height: 44px;
        white-space: nowrap;
    }
    .insights-summary {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
    }
    .insights-summary article {
        padding: 16px;
    }
    .insights-summary h3 {
        font-size: 13px;
        margin-bottom: 6px;
    }
    .insights-summary strong {
        font-size: 22px;
    }
    .insight-basis-card strong {
        font-size: 15px;
        color: var(--app-accent);
    }
    @media (max-width: 1024px) {
        .insights-filters,
        .insights-summary {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 640px) {
        .insights-filters,
        .insights-summary {
            grid-template-columns: 1fr;
        }
        .insights-filters > :deep(.p-button) {
            width: 100%;
        }
    }
    /* Reviewed source 2e3c66: equal 1fr columns, 20px gap; stack at1024. */
    .insights-workspace {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 20px;
        align-items: start;
    }
    .insights-records,
    .insights-distribution {
        min-width: 0;
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .insights-workspace h3 {
        margin: 0 0 12px;
        font-size: 16px;
        line-height: 24px;
    }
    .insights-workspace p {
        font-size: 13px;
        margin: 0 0 14px;
    }
    .insights-workspace :deep(.p-select) {
        min-width: 0;
        width: 100%;
        max-width: 100%;
    }
    .insights-workspace :deep(.p-datatable) {
        margin-bottom: 20px;
    }
    .insights-records .insights-tools {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
    .insights-records .insights-tools article {
        min-width: 0;
        padding: 16px;
    }
    .insights-records .insights-tools h3 {
        font-size: 14px;
        line-height: 21px;
    }
    .insights-records .insights-month-chart {
        margin: 20px 0;
    }
    @media (max-width: 1024px) {
        .insights-workspace {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 640px) {
        .insights-records,
        .insights-distribution {
            padding: 16px;
        }
        .insights-records .insights-tools {
            grid-template-columns: 1fr;
        }
    }

    /* 2e3c66 controls: preserve the4-column tablet layout and exact source ratios. */
    .insights-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
    }
    .insights-heading h1 {
        margin: 0;
        font-size: 20px;
        line-height: 30px;
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    .insights-heading p {
        margin: 0;
        font-size: 13px;
        line-height: 19.5px;
    }
    .insights-filters {
        grid-template-columns: 2fr 1.2fr 1.2fr auto;
        gap: 16px;
    }
    .insights-filters label {
        min-width: 0;
        font-size: 13px;
        line-height: 19.5px;
        font-weight: 600;
        gap: 6px;
    }
    .insights-filters :deep(.p-select),
    .insights-filters input[type='month'] {
        min-width: 0;
        width: 100%;
        height: 44px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
    }
    .insights-filters input[type='month'] {
        box-sizing: border-box;
        padding: 0 14px;
    }
    .insights-filters > :deep(.p-button) {
        height: 44px;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
    }
    @media (max-width: 640px) {
        .insights-filters {
            grid-template-columns: 1fr;
        }
    }

    .insights-filters :deep(.p-datepicker) {
        min-width: 0;
        width: 100%;
    }
    .insights-filters :deep(.p-datepicker-input) {
        min-width: 0;
        width: 100%;
        height: 44px;
        padding: 0 32px 0 14px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
    }
    .insights-filters :deep(.p-select-label) {
        padding: 0 14px;
        line-height: 42px;
    }
    @media (max-width: 1023px) {
        .insights-filters :deep(#insights-currency) {
            display: flex;
            align-items: center;
            font-size: 12px;
            line-height: 16px;
            font-weight: 600;
        }
    }
    @media (max-width: 640px) {
        .insights-filters :deep(#insights-currency) {
            font-size: 13px;
            line-height: 18px;
        }
    }

    /* Actual 2e3c66 KPI and twelve-month table properties. Extra data notes remain visible. */
    .insights-summary article {
        display: flex;
        flex-direction: column;
        gap: 6px;
        box-shadow: none;
    }
    .insights-summary h3 {
        margin: 0;
        font-size: 13px;
        line-height: 19.5px;
        font-weight: 500;
    }
    .insights-summary strong {
        line-height: 33px;
        font-weight: 700;
    }
    .insights-summary p {
        margin: 0;
        font-size: 12px;
        line-height: 18px;
    }
    .insights-summary small {
        font-size: 11px;
        line-height: 16.5px;
    }
    .insights-summary .insights-comparison-unavailable {
        font-size: 18px;
        line-height: 27px;
        color: var(--app-muted);
    }
    .insight-basis-card strong {
        font-size: 15px;
        line-height: 22.5px;
        font-weight: 600;
    }
    .insights-records-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }
    .insights-records-heading h3 {
        margin: 0;
        font-size: 16px;
        line-height: 24px;
    }
    .insights-records-heading p {
        margin: 0;
        font-size: 12px;
        line-height: 18px;
        color: var(--app-muted);
    }
    .insights .insights-month-table {
        --p-datatable-column-title-font-weight: 600;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        overflow: hidden;
    }
    .insights .insights-records .insights-month-table :deep(th) {
        padding: 10px 12px;
        font-size: 13px;
        line-height: 19.5px;
        font-weight: 600;
    }
    .insights .insights-records .insights-month-table :deep(td) {
        padding: 9px 12px;
        font-size: 13px;
        line-height: 19.5px;
    }
    .insights
        .insights-records
        .insights-month-table
        :deep(tr:last-child > td) {
        border-bottom: 0;
    }
    .insights
        .insights-records
        .insights-month-table
        :deep(.insights-selected-month > td) {
        background: var(--app-accent-light);
    }
    .insights
        .insights-month-table
        :deep(.insights-selected-month > td:first-child),
    .insights
        .insights-month-table
        :deep(.insights-selected-month > td:nth-child(2)) {
        font-weight: 700;
    }
    .insights
        .insights-month-table
        :deep(.insights-selected-month > td:nth-child(2)) {
        color: var(--app-accent);
    }
    .insights-record-status {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 16.5px;
        font-weight: 600;
        max-width: 100%;
    }
    .status-none {
        color: var(--app-muted);
        background: var(--app-surface-muted);
    }
    .status-outside {
        color: var(--app-muted);
        background: var(--app-bg);
    }
    .status-recorded {
        color: var(--app-accent);
        background: var(--app-accent-light);
    }
    .status-missing {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .insights-records,
    .insights-distribution {
        padding: 20px;
    }
    .insights-distribution :deep(.p-togglebutton) {
        --p-togglebutton-font-weight: 600;
        font-size: 13px;
    }

    .insights-summary,
    .insights-month-table {
        font-family:
            -apple-system, BlinkMacSystemFont, 'Pretendard', 'Segoe UI', Roboto,
            'Helvetica Neue', Arial, sans-serif;
    }

    .insights .insights-records .insights-month-table :deep(th) {
        background: var(--app-bg);
        border-bottom: 1px solid var(--app-border);
        color: var(--app-muted);
    }
    .insights .insights-records .insights-month-table :deep(td) {
        border-bottom: 1px solid light-dark(#f1f5f9, var(--app-border-subtle));
    }
    .insights
        .insights-records
        .insights-month-table
        :deep(tr:last-child > td) {
        border-bottom: 0;
    }
    .insights
        .insights-records
        .insights-month-table
        :deep(.insights-selected-month > td) {
        background: light-dark(#f0fdfa, var(--app-accent-light));
    }
    .status-none {
        background: light-dark(#f1f5f9, var(--app-surface-muted));
    }
    .status-outside {
        color: light-dark(#94a3b8, var(--app-muted));
    }
    .status-recorded {
        color: light-dark(#047857, var(--app-accent));
    }
    .analysis-modules {
        margin-top: 20px;
    }
    .analysis-modules > h3 {
        margin: 0 0 12px;
        font-size: 15px;
        line-height: 22.5px;
        font-weight: 700;
    }
    .analysis-module-grid {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 12px;
    }
    .analysis-module-card {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
        padding: 14px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface);
        word-break: keep-all;
    }
    .analysis-module-card h4 {
        margin: 0;
        color: var(--app-text);
        font-size: 14px;
        line-height: 21px;
        font-weight: 700;
    }
    .analysis-module-card p {
        margin: 0;
        color: var(--app-muted);
        font-size: 12px;
        line-height: 16.8px;
    }
    .analysis-module-card :deep(.p-button) {
        flex-shrink: 0;
        height: 36px;
        min-height: 36px;
        margin-top: 8px;
        padding: 0 18px;
        border-radius: 8px;
        font-size: 13px;
        line-height: normal;
        font-weight: 600;
        white-space: nowrap;
        color: light-dark(#000, var(--app-text));
        background: light-dark(#efefef, var(--app-surface-muted));
        border-color: transparent;
    }
    .additional-insights :deep(.analysis-module-target:focus-visible),
    .additional-insights
        :deep(#insights-module-scenario > summary:focus-visible) {
        outline: 2px solid var(--app-accent);
        outline-offset: 4px;
    }
    @media (max-width: 1024px) {
        .analysis-module-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 640px) {
        .analysis-module-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }
</style>
