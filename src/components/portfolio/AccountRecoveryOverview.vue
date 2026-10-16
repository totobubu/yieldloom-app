<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import {
        capitalRecovery,
        capitalSummary,
        combineCapitalStates,
    } from '../../../lib/portfolio-capital.js';
    import StockRecoveryPanel from './StockRecoveryPanel.vue';
    const props = defineProps({
        user: Object,
        accounts: Array,
        refreshState: Object,
    });
    const states = ref([]),
        loading = ref(false),
        error = ref('');
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
            if (request === generation) states.value = results;
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
            () => props.refreshState?.version,
        ],
        refresh,
        { immediate: true }
    );
    const combined = computed(() => combineCapitalStates(states.value));
    const recovery = computed(() =>
        capitalRecovery(combined.value.entries, combined.value.classifications)
    );
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
        <h2>전체 계좌 · 내 돈을 얼마나 회수했나요?</h2>
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
                    <small>실제 출금 기준 회수율 · {{ item.currency }}</small>
                    <strong>{{
                        item.rate === null
                            ? '원금 확인 필요'
                            : `${item.rate.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`
                    }}</strong>
                    <progress
                        v-if="item.rate !== null"
                        :value="Math.min(item.rate, 100)"
                        max="100"
                        :aria-label="`${item.currency} 전체 계좌 원금 회수율`" />
                    <dl>
                        <div>
                            <dt>누적 외부 입금</dt>
                            <dd>{{ money(item.principal, item.currency) }}</dd>
                        </div>
                        <div>
                            <dt>실제 외부 출금</dt>
                            <dd>{{ money(item.recovered, item.currency) }}</dd>
                        </div>
                        <div>
                            <dt>입금 대비 미출금액</dt>
                            <dd>
                                {{
                                    item.rate === null
                                        ? '—'
                                        : money(item.remaining, item.currency)
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
                회수율 = 외부 출금 ÷ 외부 입금. 배당·매도금 재투자와 계좌 간
                이동은 원금·회수금에 더하지 않습니다. 계좌 간 이체는 양쪽 내역을
                ‘계좌 내 이동’으로 분류해 주세요. 통화 간 환산은 하지 않습니다.
            </p>
            <p>
                현재 평가액은 아래 가족 합산 잔고에서 확인하세요. 현금 잔액과
                전체 기초 자료가 확인되지 않아 전체 자산·손익으로 단정하지
                않습니다.
            </p>
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
