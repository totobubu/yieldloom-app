<script setup>
    import { computed, ref, watch } from 'vue';
    import InvestmentWorkbench from './InvestmentWorkbench.vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
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
    import { useRequestCooldown } from '@/composables/useRequestCooldown.js';

    const props = defineProps({
        accounts: { type: Array, default: () => [] },
        positions: { type: Array, default: () => [] },
        familyId: { type: String, default: '' },
    });
    const today = ref(calendarToday());
    const month = ref(today.value.slice(0, 7)),
        accountId = ref(''),
        currency = ref('USD');
    const entries = ref([]),
        loading = ref(false),
        issue = ref(null),
        refresh = ref(0);
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
                    const response = await fetch(
                        getAssetUrl('portfolio-classifications.json'),
                        {
                            signal: AbortSignal.any([
                                controller.signal,
                                AbortSignal.timeout(8000),
                            ]),
                            credentials: 'omit',
                        }
                    );
                    if (!response.ok) throw new Error('분류 자료 조회 실패');
                    const payload = await response.json();
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
</script>

<template>
    <section
        class="insights"
        aria-labelledby="insights-title"
        :aria-busy="loading">
        <div class="insights-heading">
            <div>
                <h2 id="insights-title">배당 성과·집중도 분석</h2>
                <p>
                    저장된 배당 기록과 자료 평가액으로 투자 구성을 살펴보세요.
                </p>
            </div>
            <Button
                label="분석 다시 조회"
                icon="pi pi-refresh"
                outlined
                severity="secondary"
                :loading="loading"
                :disabled="coolingDown || !accounts.length"
                @click="refresh++" />
        </div>
        <div class="insights-filters">
            <label for="insights-month"
                >분석 월<input
                    id="insights-month"
                    v-model="month"
                    type="month"
                    min="1900-01"
                    :max="today.slice(0, 7)"
            /></label>
            <label for="insights-account"
                >계좌<Select
                    input-id="insights-account"
                    aria-label="계좌"
                    placeholder="모든 계좌"
                    v-model="accountId"
                    :options="accountOptions"
                    option-label="label"
                    option-value="value"
            /></label>
            <label for="insights-currency"
                >통화<Select
                    input-id="insights-currency"
                    aria-label="통화"
                    v-model="selectedCurrency"
                    :options="currencyOptions"
                    option-label="label"
                    option-value="value"
                    placeholder="기록 없음"
            /></label>
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
            <InvestmentWorkbench
                v-if="
                    ['USD', 'KRW'].includes(selectedCurrency) &&
                    selectedAccounts.length
                "
                :key="`${familyId}:${accountId}:${selectedCurrency}:${month}`"
                :entries="entries"
                :positions="selectedPositions"
                :accounts="selectedAccounts"
                :family-id="familyId"
                :currency="selectedCurrency"
                :month="month"
                :largest-share="asset?.symbols.rows[0]?.share ?? null" />
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
                        <strong>{{ percent(dividends.yearOverYear) }}</strong>
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
                </div>
                <h3>월별 배당 기록</h3>
                <p>기록 없음은 배당 0원을 의미하지 않습니다.</p>
                <DataTable
                    :value="dividends.months"
                    :table-props="{ 'aria-label': '월별 저장 배당 기록' }"
                    scrollable>
                    <Column field="month" header="월" />
                    <Column :header="`저장 금액 (${selectedCurrency})`"
                        ><template #body="{ data }">{{
                            data.afterRange
                                ? '분석 범위 밖'
                                : money(data.amount, data.count > 0)
                        }}</template></Column
                    >
                    <Column header="자료 상태"
                        ><template #body="{ data }">{{
                            data.afterRange
                                ? '—'
                                : `${data.count}건${data.unknown ? ` · 금액 미확인 ${data.unknown}건` : ''}`
                        }}</template></Column
                    >
                </DataTable>
                <div class="insights-tools">
                    <article>
                        <h3>월 배당 목표</h3>
                        <label for="dividend-goal"
                            >{{ selectedCurrency }} 목표 금액<InputNumber
                                input-id="dividend-goal"
                                v-model="goal"
                                :min="0"
                                :max-fraction-digits="2"
                                :use-grouping="true"
                                :disabled="selectedCurrency === 'UNKNOWN'"
                        /></label>
                        <p>
                            선택 월의 기록 기준 달성률
                            {{ percent(goalPercent) }}
                        </p>
                        <ProgressBar
                            v-if="goalPercent != null"
                            :value="Math.min(100, Math.max(0, goalPercent))"
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
                            {{ money(stress.after) }} {{ selectedCurrency }}
                        </p>
                        <p v-else>
                            선택 월의 종목·금액·통화를 확인하면 비교할 수
                            있습니다.
                        </p>
                        <small
                            >선택 월 저장 기록에 감소율을 적용한 가정이며 미래
                            배당 예측이 아닙니다.</small
                        >
                    </article>
                </div>
                <h3>누적 배당 기여도</h3>
                <p>
                    상위 3종목 비중
                    {{ percent(dividends.contributions.topThree) }} · 취소 차감
                    후 양수인 종목별 금액의 합계가 기준입니다.
                </p>
                <Message
                    v-if="dividends.contributions.negativeGroups"
                    severity="warn"
                    :closable="false"
                    >취소가 더 큰 {{ dividends.contributions.negativeGroups }}개
                    종목은 금액에 표시하고 양수 합계 비중에서
                    제외했습니다.</Message
                >
                <DataTable
                    :value="dividends.contributions.rows"
                    paginator
                    :rows="10"
                    :table-props="{ 'aria-label': '종목별 누적 배당 기여도' }"
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
                                    :show-value="false" /></div></template
                    ></Column>
                </DataTable>
            </template>
            <p v-else-if="accounts.length">
                선택한 통화·연도의 저장된 배당 기록이 없습니다. 배당 캘린더의
                공시 예상액과는 별개입니다.
            </p>
            <h3 v-if="accounts.length">자료 평가액 기준 자산 집중도</h3>
            <Message v-if="metadataError" severity="warn" :closable="false">{{
                metadataError
            }}</Message>
            <Message v-if="missingAccounts" severity="warn" :closable="false"
                >잔고 자료가 없는 {{ missingAccounts }}개 계좌는 자산 분석에서
                제외했습니다.</Message
            >
            <template v-if="asset">
                <p>
                    현금 제외 · 확인된 자료 평가액 {{ money(asset.total) }}
                    {{ selectedCurrency }} · 종목 상위 3개 비중
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
                    평가액 미확인·음수 항목 {{ asset.excluded }}개 제외 · 일부
                    금액 기준입니다.
                </p>
                <SelectButton
                    v-model="assetDimension"
                    :options="assetOptions"
                    option-label="label"
                    option-value="value"
                    :allow-empty="false"
                    aria-label="자산 집중도 분류" />
                <p class="insights-note">
                    운용사·기초자산·업종·국가는 앱 분류 자료 기준입니다. 확인된
                    분류가 없으면 종목별 미분류로 표시합니다. 기초자산 연결은
                    롱·인버스·레버리지 방향과 배수를 반영한 실질 노출도가
                    아닙니다. 미분류는 종목별로 구분합니다.
                </p>
                <p>
                    운용사 미분류 {{ asset.unknownProvider }}개 항목 · 기초자산
                    미분류 {{ asset.unknownUnderlying }}개 항목
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
                                    :show-value="false" /></div></template
                    ></Column>
                </DataTable>
            </template>
            <p v-else-if="accounts.length">
                선택한 통화의 증권 잔고 자료가 없습니다.
            </p>
        </template>
    </section>
</template>

<style scoped>
    .insights {
        color: var(--p-content-color);
        min-width: 0;
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
    :global(.p-dark) .insights input[type='month'] {
        color-scheme: dark;
    }
</style>
