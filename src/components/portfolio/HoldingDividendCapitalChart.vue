<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import { firebaseUser } from '@/services/firebaseClient';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import { holdingDividendCapital } from '@/services/holdingDividendCapital.js';

    const props = defineProps({
        accounts: { type: Array, default: () => [] },
        positions: { type: Array, default: () => [] },
        currency: { type: String, required: true },
        today: { type: String, required: true },
    });
    const states = ref([]);
    const loading = ref(false);
    const error = ref('');
    let generation = 0;
    onScopeDispose(() => generation++);

    async function load(force = false) {
        const user = firebaseUser.value;
        const request = ++generation;
        states.value = [];
        error.value = '';
        if (!user || !props.accounts.length) return;
        loading.value = true;
        try {
            const loaded = await Promise.all(
                props.accounts.map(async (account) => ({
                    accountId: account.id,
                    state: await portfolioCapitalRequest(
                        user,
                        undefined,
                        account.id,
                        { force }
                    ),
                }))
            );
            if (request === generation && firebaseUser.value === user)
                states.value = loaded;
        } catch (reason) {
            if (request === generation)
                error.value =
                    reason?.message ||
                    '원금·재투자 자료를 불러오지 못했습니다.';
        } finally {
            if (request === generation) loading.value = false;
        }
    }
    watch(
        () => [
            firebaseUser.value?.uid,
            ...props.accounts.flatMap((account) => [
                account.id,
                account.entriesRevision ?? 0,
                account.capitalRevision ?? 0,
            ]),
        ],
        () => load(),
        { immediate: true }
    );

    const report = computed(() =>
        holdingDividendCapital(states.value, props.positions, {
            currency: props.currency,
            today: props.today,
        })
    );
    const maximum = computed(() =>
        Math.max(1, ...report.value.rows.map((row) => row.totalCost))
    );
    const money = (value) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: props.currency,
            maximumFractionDigits: props.currency === 'KRW' ? 0 : 2,
        }).format(value);
    const percent = (value) =>
        value == null
            ? '확인 필요'
            : `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    const width = (value) => `${(value / maximum.value) * 100}%`;
    const share = (value, total) => `${total > 0 ? (value / total) * 100 : 0}%`;
</script>

<template>
    <section class="capital-chart" aria-labelledby="capital-chart-title">
        <div class="chart-heading">
            <div>
                <h3 id="capital-chart-title">보유 종목 원금·배당 재투자</h3>
                <p>
                    현재 보유분 취득원가의 출처와 최초 원금 대비 누적 세후
                    배당을 비교합니다.
                </p>
            </div>
            <Button
                label="원금 자료 다시 조회"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                size="small"
                :loading="loading"
                :disabled="loading || !accounts.length"
                @click="load(true)" />
        </div>
        <p v-if="loading" role="status">
            원금과 재투자 내역을 확인하고 있습니다.
        </p>
        <Message v-else-if="error" severity="error" :closable="false">
            {{ error }}
        </Message>
        <template v-else-if="states.length">
            <div class="capital-summary">
                <article>
                    <small>최초 투입 원금</small>
                    <strong>{{ money(report.initialPrincipal) }}</strong>
                </article>
                <article>
                    <small>보유분 누적 투자금</small>
                    <strong>{{ money(report.investedCost) }}</strong>
                </article>
                <article>
                    <small>누적 세후 배당</small>
                    <strong>{{ money(report.dividends) }}</strong>
                </article>
                <article>
                    <small>원금 대비 누적 배당</small>
                    <strong>{{ percent(report.dividendRate) }}</strong>
                </article>
            </div>
            <Message
                v-if="!report.complete || report.unavailable"
                severity="warn"
                :closable="false">
                세후 정산액이나 자금 출처가 누락된 종목은 배당률을 확정하지
                않았습니다. 확인된 금액만 표시합니다.
            </Message>
            <div v-if="report.rows.length" class="bars" role="list">
                <article
                    v-for="row in report.rows"
                    :key="row.symbol"
                    class="bar-row"
                    role="listitem">
                    <div class="bar-label">
                        <strong>{{ row.symbol }}</strong>
                        <span
                            >원금 대비 배당
                            {{ percent(row.dividendRate) }}</span
                        >
                    </div>
                    <div
                        class="bar-track"
                        role="img"
                        :aria-label="`${row.symbol}: 보유분 원금 ${money(row.principalHeld)}, 배당·수익 재투자 ${money(row.reinvestedHeld)}, 출처 미확인 ${money(row.unknownHeld)}`">
                        <div
                            class="bar-total"
                            :style="{ width: width(row.totalCost) }">
                            <span
                                class="principal"
                                :style="{
                                    width: share(
                                        row.principalHeld,
                                        row.totalCost
                                    ),
                                }" />
                            <span
                                class="reinvested"
                                :style="{
                                    width: share(
                                        row.reinvestedHeld,
                                        row.totalCost
                                    ),
                                }" />
                            <span
                                class="unknown"
                                :style="{
                                    width: share(
                                        row.unknownHeld,
                                        row.totalCost
                                    ),
                                }" />
                        </div>
                    </div>
                    <small>
                        누적 투자금 {{ money(row.totalCost) }} · 재투자
                        {{ percent(row.reinvestmentRate) }} · 누적 세후 배당
                        {{ money(row.dividends) }}
                    </small>
                </article>
            </div>
            <p v-else>선택한 통화에 현재 보유 중인 종목이 없습니다.</p>
            <ul class="legend" aria-label="원금 구성 범례">
                <li><span class="principal" />직접 투입 원금</li>
                <li><span class="reinvested" />배당·수익 재투자</li>
                <li><span class="unknown" />출처 미확인</li>
            </ul>
            <div v-if="report.rows.length" class="table-scroll">
                <table aria-label="보유 종목 원금과 누적 배당">
                    <thead>
                        <tr>
                            <th>종목</th>
                            <th>보유분 원금</th>
                            <th>재투자금</th>
                            <th>누적 투자금</th>
                            <th>재투자 비율</th>
                            <th>최초 원금</th>
                            <th>누적 세후 배당</th>
                            <th>원금 대비 배당</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in report.rows" :key="row.symbol">
                            <th scope="row">{{ row.symbol }}</th>
                            <td>{{ money(row.principalHeld) }}</td>
                            <td>{{ money(row.reinvestedHeld) }}</td>
                            <td>{{ money(row.totalCost) }}</td>
                            <td>{{ percent(row.reinvestmentRate) }}</td>
                            <td>{{ money(row.initialPrincipal) }}</td>
                            <td>{{ money(row.dividends) }}</td>
                            <td>{{ percent(row.dividendRate) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="note">
                재투자 비율은 출처가 확인된 현재 보유분 취득원가 기준입니다.
                원금 대비 배당은 누적 세후 배당 ÷ 최초 투입 원금이며 통화 환산과
                현재 평가손익은 포함하지 않습니다.
            </p>
        </template>
        <p v-else-if="!accounts.length">분석할 계좌가 없습니다.</p>
    </section>
</template>

<style scoped>
    .capital-chart {
        margin-block: 1.5rem;
        padding: 1rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: 0.75rem;
        background: var(--p-content-background);
        min-width: 0;
    }
    .chart-heading,
    .bar-label,
    .capital-summary,
    .legend {
        display: flex;
        gap: 1rem;
    }
    .chart-heading,
    .bar-label {
        justify-content: space-between;
        align-items: flex-start;
    }
    h3 {
        margin: 0;
    }
    p,
    small {
        color: var(--p-text-muted-color);
    }
    .capital-summary {
        flex-wrap: wrap;
        margin-block: 1rem;
    }
    .capital-summary article {
        display: grid;
        gap: 0.35rem;
        flex: 1 1 12rem;
        padding: 0.85rem;
        border-radius: 0.6rem;
        background: var(--p-content-hover-background);
    }
    .capital-summary strong {
        font-size: 1.25rem;
    }
    .bars {
        display: grid;
        gap: 1rem;
        margin-block: 1rem;
    }
    .bar-row {
        min-width: 0;
    }
    .bar-track {
        height: 1.1rem;
        margin-block: 0.4rem;
        overflow: hidden;
        border-radius: 999px;
        background: var(--p-content-hover-background);
    }
    .bar-total {
        display: flex;
        height: 100%;
    }
    .principal {
        background: #2563eb;
    }
    .reinvested {
        background: #16a34a;
    }
    .unknown {
        background: #94a3b8;
    }
    .legend {
        flex-wrap: wrap;
        padding: 0;
        list-style: none;
    }
    .legend li {
        display: flex;
        align-items: center;
        gap: 0.4rem;
    }
    .legend span {
        width: 0.8rem;
        height: 0.8rem;
        border-radius: 0.2rem;
    }
    .table-scroll {
        overflow-x: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.88rem;
    }
    th,
    td {
        min-width: 7rem;
        padding: 0.65rem;
        text-align: left;
        border-bottom: 1px solid var(--p-content-border-color);
    }
    .note {
        font-size: 0.85rem;
    }
    @media (max-width: 640px) {
        .chart-heading,
        .bar-label {
            align-items: stretch;
            flex-direction: column;
        }
    }
</style>
