<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import { tracePortfolioFunding } from '@/services/portfolioFundingTrace.js';
    import {
        capitalSummary,
        combineCapitalStates,
    } from '../../../lib/portfolio-capital.js';
    import StockRecoveryPanel from './StockRecoveryPanel.vue';
    import FundingTracePanel from './FundingTracePanel.vue';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    const props = defineProps({
        user: Object,
        accounts: Array,
        refreshState: Object,
        refreshAccountId: String,
    });
    const traceAccount = ref('');
    const traceCurrency = ref('USD');
    const savingOpening = ref(false);
    function focusTrace(item) {
        traceAccount.value = item.accountId;
        traceCurrency.value = item.currency;
    }
    const states = ref([]),
        loading = ref(false),
        error = ref('');
    useFullscreenLoading(loading, '전체 계좌 회수 현황을 불러오고 있습니다.');
    let generation = 0;
    onScopeDispose(() => {
        generation++;
    });
    async function refresh() {
        const request = ++generation;
        const user = props.user,
            accounts = [...(props.accounts || [])];
        states.value = [];
        error.value = '';
        if (!user || !accounts.length) {
            loading.value = false;
            return;
        }
        loading.value = true;
        try {
            const results = [];
            for (const account of accounts) {
                if (request !== generation) return;
                results.push({
                    accountId: account.id,
                    state: await portfolioCapitalRequest(
                        user,
                        undefined,
                        account.id
                    ),
                });
            }
            if (request === generation)
                states.value = withSelectedState(results);
        } catch (reason) {
            if (request === generation) error.value = reason.message;
        } finally {
            if (request === generation) loading.value = false;
        }
    }
    watch(
        [
            () => props.user?.uid,
            () =>
                JSON.stringify(
                    (props.accounts || []).map((a) => [
                        a.id,
                        a.entriesRevision,
                        a.capitalRevision,
                    ])
                ),
        ],
        refresh,
        { immediate: true }
    );
    // The selected-account panel already loaded edits. Copy its result locally
    // instead of revalidating all other accounts after every annotation save.
    const withSelectedState = (rows) =>
        rows.map((entry) =>
            entry.accountId === props.refreshAccountId && props.refreshState
                ? { ...entry, state: props.refreshState }
                : entry
        );
    watch(
        () => [props.refreshAccountId, props.refreshState],
        () => {
            states.value = withSelectedState(states.value);
        }
    );
    const combined = computed(() => combineCapitalStates(states.value));
    const traceState = computed(() =>
        Object.fromEntries(
            ['entries', 'classifications', 'openingLots'].map((kind) => [
                kind,
                states.value.flatMap(({ accountId, state }) =>
                    (state[kind] || []).map((row) => ({ ...row, accountId }))
                ),
            ])
        )
    );
    const selectedTraceState = computed(
        () =>
            states.value.find((row) => row.accountId === traceAccount.value)
                ?.state || {}
    );
    const selectedCanEdit = computed(() => {
        const account = props.accounts?.find(
            (row) => row.id === traceAccount.value
        );
        return ['owner', 'editor'].includes(
            account?.permissions?.[props.user?.uid]
        );
    });
    async function saveOpening(input) {
        if (!props.user || !traceAccount.value || savingOpening.value) return;
        savingOpening.value = true;
        error.value = '';
        try {
            await portfolioCapitalRequest(
                props.user,
                input,
                traceAccount.value
            );
            const state = await portfolioCapitalRequest(
                props.user,
                undefined,
                traceAccount.value,
                { force: true }
            );
            states.value = states.value.map((row) =>
                row.accountId === traceAccount.value ? { ...row, state } : row
            );
        } catch (reason) {
            error.value = reason.message;
        } finally {
            savingOpening.value = false;
        }
    }
    const recovery = computed(
        () =>
            tracePortfolioFunding({
                ...traceState.value,
                trades: trades.value,
                allocations: allocations.value,
            }).currencies
    );
    const accountRecovery = computed(() =>
        states.value.flatMap(({ accountId, state }) => {
            const pending = capitalSummary(
                state.entries || [],
                state.classifications || []
            ).pending;
            return tracePortfolioFunding({
                entries: (state.entries || []).map((row) => ({
                    ...row,
                    accountId,
                })),
                classifications: (state.classifications || []).map((row) => ({
                    ...row,
                    accountId,
                })),
                trades: state.trades || [],
                allocations: (state.allocations || []).map((row) => ({
                    ...row,
                    accountId,
                })),
                openingLots: (state.openingLots || []).map((row) => ({
                    ...row,
                    accountId,
                })),
            }).currencies.map((row) => ({
                ...row,
                accountId,
                pending,
                alias:
                    props.accounts?.find((a) => a.id === accountId)?.alias ||
                    accountId,
            }));
        })
    );
    const percent = (value) =>
        value == null
            ? '원금 확인 필요'
            : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    const pending = computed(
        () =>
            capitalSummary(
                combined.value.entries,
                combined.value.classifications
            ).pending
    );
    const trades = computed(() =>
        states.value.flatMap(({ state }) => state.trades || [])
    );
    const allocations = computed(() =>
        states.value.flatMap(({ accountId, state }) =>
            (state.allocations || []).map((row) => ({ ...row, accountId }))
        )
    );
    const money = (v, c) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: c,
            maximumFractionDigits: c === 'KRW' ? 0 : 6,
        }).format(v);
</script>
<template>
    <section class="account-overview" aria-label="전체 계좌 원금 회수 현황">
        <h2>전체 계좌 원금 회수율</h2>
        <p>
            선택한 범위에서 접근 가능한 {{ accounts?.length || 0 }}개 계좌의
            전체 저장 내역입니다.
        </p>
        <p v-if="loading" role="status">
            전체 계좌 회수 현황을 불러오는 중입니다.
        </p>
        <p v-else-if="error" role="alert">
            {{ error }}
            <button type="button" @click="refresh">다시 시도</button>
        </p>
        <template v-else>
            <div class="metrics">
                <article v-for="item in recovery" :key="item.currency">
                    <small>원금 계보 기준 회수율 · {{ item.currency }}</small>
                    <strong>{{
                        item.principalRate === null
                            ? '원금 확인 필요'
                            : `${item.principalRate.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`
                    }}</strong>
                    <progress
                        v-if="item.principalRate !== null"
                        :value="Math.min(item.principalRate, 100)"
                        max="100"
                        :aria-label="`${item.currency} 전체 계좌 원금 회수율`" />
                    <dl>
                        <div>
                            <dt>누적 투자 원금</dt>
                            <dd>{{ money(item.deposits, item.currency) }}</dd>
                        </div>
                        <div>
                            <dt>원금 회수</dt>
                            <dd>
                                {{
                                    money(
                                        item.principalRecovered +
                                            item.estimatedPrincipalRecovered,
                                        item.currency
                                    )
                                }}
                                <small v-if="item.estimatedPrincipalRecovered">
                                    추정
                                    {{
                                        money(
                                            item.estimatedPrincipalRecovered,
                                            item.currency
                                        )
                                    }}
                                    포함
                                </small>
                            </dd>
                        </div>
                        <div>
                            <dt>미회수 원금</dt>
                            <dd>
                                {{
                                    item.principalRate === null
                                        ? '—'
                                        : money(
                                              item.remainingPrincipal,
                                              item.currency
                                          )
                                }}
                            </dd>
                        </div>
                    </dl>
                </article>
            </div>
            <p v-if="pending" role="status">
                미분류 {{ pending }}건을 제외한 잠정 수치입니다.
            </p>
            <p>
                원금 회수율 = 원금으로 귀속된 외부 출금 ÷ 누적 투자 원금.
                배당·수익 출금은 총 현금 회수에만 포함합니다. 배당·매도금
                재투자와 계좌 간 이동은 새 원금으로 더하지 않습니다.
            </p>
            <p>
                현재 평가액은 아래 가족 합산 잔고에서 확인하세요. 현금 잔액과
                전체 기초 자료가 확인되지 않아 전체 자산·손익으로 단정하지
                않습니다.
            </p>
            <section aria-label="계좌별 원금 회수율">
                <h3>계좌별 원금 회수율</h3>
                <p>
                    전체 회수율은 계좌별 비율의 평균이 아니라, 같은 통화의 출금
                    합계 ÷ 입금 합계입니다.
                </p>
                <div class="account-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>계좌</th>
                                <th>통화</th>
                                <th>누적 투자 원금</th>
                                <th>원금 회수</th>
                                <th>미회수 원금</th>
                                <th>회수율</th>
                                <th>자료 상태</th>
                                <th>상세</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="item in accountRecovery"
                                :key="`${item.accountId}:${item.currency}`">
                                <th scope="row">{{ item.alias }}</th>
                                <td>{{ item.currency }}</td>
                                <td>
                                    {{ money(item.deposits, item.currency) }}
                                </td>
                                <td>
                                    {{
                                        money(
                                            item.principalRecovered +
                                                item.estimatedPrincipalRecovered,
                                            item.currency
                                        )
                                    }}
                                    <small
                                        v-if="item.estimatedPrincipalRecovered">
                                        추정 포함
                                    </small>
                                </td>
                                <td>
                                    {{
                                        item.principalRate == null
                                            ? '—'
                                            : money(
                                                  item.remainingPrincipal,
                                                  item.currency
                                              )
                                    }}
                                </td>
                                <td>{{ percent(item.principalRate) }}</td>
                                <td>
                                    {{
                                        item.pending
                                            ? `분류 확인 ${item.pending}건 · 잠정`
                                            : '저장된 분류 기준'
                                    }}
                                </td>
                                <td>
                                    <button
                                        type="button"
                                        :aria-label="`${item.alias} ${item.currency} 자금 추적 보기`"
                                        @click="focusTrace(item)">
                                        자금 추적
                                    </button>
                                </td>
                            </tr>
                            <tr v-if="!accountRecovery.length">
                                <td colspan="8">조회할 계좌가 없습니다.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
            <FundingTracePanel
                v-model:account-id="traceAccount"
                v-model:currency="traceCurrency"
                :entries="traceState.entries"
                :classifications="traceState.classifications"
                :trades="trades"
                :allocations="allocations"
                :opening-lots="traceState.openingLots"
                :opening-revision="selectedTraceState.openingRevision || 0"
                :can-edit-opening="selectedCanEdit"
                :saving-opening="savingOpening"
                :accounts="accounts"
                @save-opening="saveOpening" />
            <StockRecoveryPanel
                :trades="trades"
                :allocations="allocations"
                :accounts="accounts" />
        </template>
    </section>
</template>
<style scoped>
    .account-overview {
        padding: 24px;
        margin: 20px 0;
        border: 1px solid var(--app-border);
        border-radius: 16px;
        background: var(--app-surface);
    }
    h2 {
        margin: 0;
        font-size: 1.3rem;
    }
    p,
    small,
    dt {
        color: var(--app-muted);
    }
    p {
        font-size: 0.88rem;
    }
    .metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
    .account-scroll {
        overflow-x: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.88rem;
    }
    th,
    td {
        min-width: 100px;
        text-align: left;
        padding: 10px;
        border-bottom: 1px solid var(--app-border);
    }
    article {
        padding: 20px;
        min-width: 0;
        background: var(--app-surface-muted);
        border-radius: 12px;
    }
    strong {
        display: block;
        font-size: 2rem;
        color: var(--app-accent);
        overflow-wrap: anywhere;
    }
    progress {
        width: 100%;
        accent-color: var(--app-accent);
    }
    dl > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
    }
    dd {
        margin: 0;
        text-align: right;
        overflow-wrap: anywhere;
    }
    @media (max-width: 640px) {
        .metrics {
            grid-template-columns: 1fr;
        }
        .account-overview {
            padding: 14px;
        }
    }
</style>
