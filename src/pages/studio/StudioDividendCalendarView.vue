<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import {
        annualized,
        nextExpectedDate,
        type DistributionTicker,
        useDividendPortfolio,
    } from '@/composables/studio/useDividendPortfolio';
    import {
        isEstimateEligible,
        loadMarketInputs,
        yieldPercent,
        type PriceIndex,
    } from '@/services/dividendMarketData';

    const rows = ref<DistributionTicker[]>([]);
    const prices = ref<PriceIndex>({
        generatedAt: '',
        source: 'yahoo_eod',
        prices: {},
    });
    const loading = ref(true);
    const error = ref('');
    const query = ref('');
    const scope = ref<'all' | 'portfolio' | 'watchlist'>('all');
    const status = ref<'verified' | 'review'>('verified');
    const month = ref('all');
    const priceHealth = ref<'all' | 'attention'>(
        new URLSearchParams(globalThis.location.search).get('price') ===
            'attention'
            ? 'attention'
            : 'all'
    );
    const { holdings, watchlist } = useDividendPortfolio();
    useHead({ title: '배당 캘린더 | DivGrow' });

    const scopes = [
        { label: '전체 공식 ETF', value: 'all' },
        { label: '내 보유 ETF', value: 'portfolio' },
        { label: '관심 ETF', value: 'watchlist' },
    ];
    const statuses = [
        { label: '공식 확인만', value: 'verified' },
        { label: '검토 대기 포함', value: 'review' },
    ];
    const priceFilters = [
        { label: '가격 상태 전체', value: 'all' },
        { label: '가격 누락·노후', value: 'attention' },
    ];
    const entries = computed(() =>
        rows.value
            .filter(
                (row) =>
                    status.value === 'review' ||
                    ['official', 'cross_checked'].includes(
                        row.latest.verification_status
                    )
            )
            .filter(
                (row) =>
                    scope.value !== 'portfolio' ||
                    holdings.value.some(
                        (holding) => holding.ticker === row.ticker
                    )
            )
            .filter(
                (row) =>
                    scope.value !== 'watchlist' ||
                    watchlist.value.includes(row.ticker)
            )
            .filter((row) =>
                row.ticker.toLowerCase().includes(query.value.toLowerCase())
            )
            .map((row) => {
                const next = nextExpectedDate(row.latest);
                const annual = isEstimateEligible(row)
                    ? annualized(row.latest)
                    : null;
                const quote = prices.value.prices[row.ticker];
                return {
                    row,
                    next,
                    annual,
                    quote,
                    yield: yieldPercent(annual, quote),
                };
            })
            .filter((entry) => entry.next)
            .filter(
                (entry) =>
                    priceHealth.value !== 'attention' ||
                    !entry.quote ||
                    entry.quote.stale
            )
            .filter(
                (entry) =>
                    month.value === 'all' ||
                    entry.next?.slice(0, 7) === month.value
            )
            .sort((a, b) => (a.next || '').localeCompare(b.next || ''))
    );
    const months = computed(() => [
        ...new Set(entries.value.map((entry) => entry.next!.slice(0, 7))),
    ]);
    const reload = () => globalThis.location.reload();

    onMounted(async () => {
        try {
            const inputs = await loadMarketInputs();
            rows.value = inputs.rows;
            prices.value = inputs.priceIndex;
        } catch (reason) {
            error.value =
                reason instanceof Error
                    ? reason.message
                    : '캘린더 데이터를 불러오지 못했습니다.';
        } finally {
            loading.value = false;
        }
    });
</script>

<template>
    <section class="view">
        <header>
            <p class="eyebrow">OFFICIAL DISTRIBUTION CALENDAR</p>
            <h1>배당 캘린더</h1>
            <p>
                공식 원장의 최신 발표와 지급 주기로 계산한 다음 예상
                배당락일입니다. 세전 USD 참고치입니다.
            </p>
        </header>
        <div class="filters">
            <Select
                v-model="scope"
                :options="scopes"
                option-label="label"
                option-value="value" /><Select
                v-model="priceHealth"
                :options="priceFilters"
                option-label="label"
                option-value="value" /><Select
                v-model="status"
                :options="statuses"
                option-label="label"
                option-value="value" /><Select
                v-model="month"
                :options="[
                    { label: '전체 월', value: 'all' },
                    ...months.map((value) => ({ label: value, value })),
                ]"
                option-label="label"
                option-value="value" /><InputText
                v-model="query"
                placeholder="티커 검색" /><Button
                label="새로고침"
                outlined
                @click="reload" />
        </div>
        <p v-if="error" class="notice error">{{ error }}</p>
        <p v-else-if="loading" class="notice">
            공식 배당·가격 스냅샷을 불러오는 중…
        </p>
        <div v-else class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>예상 배당락일</th>
                        <th>ETF</th>
                        <th>운용사</th>
                        <th>주기</th>
                        <th>최근 배당</th>
                        <th>예상 수익률</th>
                        <th>가격 기준일</th>
                        <th>검증</th>
                        <th>원문</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="entry in entries" :key="entry.row.ticker">
                        <td>{{ entry.next }}</td>
                        <td>
                            <strong>{{ entry.row.ticker }}</strong>
                        </td>
                        <td>{{ entry.row.providerSlug }}</td>
                        <td>{{ entry.row.latest.frequency || '—' }}</td>
                        <td>${{ entry.row.latest.distribution_per_share }}</td>
                        <td>
                            {{
                                entry.yield === null
                                    ? '—'
                                    : `${entry.yield.toFixed(2)}%`
                            }}
                        </td>
                        <td>
                            {{
                                entry.quote?.stale
                                    ? `${entry.quote.priceDate} (노후)`
                                    : entry.quote?.priceDate || '가격 없음'
                            }}
                        </td>
                        <td>
                            {{
                                entry.row.latest.verification_status ===
                                'cross_checked'
                                    ? '교차 검증'
                                    : entry.row.latest.verification_status ===
                                        'official'
                                      ? '공식 확인'
                                      : '검토 필요'
                            }}
                        </td>
                        <td>
                            <a
                                :href="entry.row.latest.official_url"
                                target="_blank"
                                rel="noreferrer"
                                >보기</a
                            >
                        </td>
                    </tr>
                    <tr v-if="!entries.length">
                        <td colspan="9">
                            조건에 맞는 다음 예상 배당락일이 없습니다.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>

<style scoped>
    .view {
        display: grid;
        gap: 1.25rem;
    }
    .eyebrow {
        margin: 0;
        color: var(--studio-accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.12em;
    }
    h1 {
        margin: 0.25rem 0;
    }
    .filters {
        display: flex;
        gap: 0.6rem;
        flex-wrap: wrap;
    }
    .table-wrap {
        overflow: auto;
        border: 1px solid var(--studio-border);
        border-radius: 1rem;
        background: var(--studio-surface);
    }
    table {
        width: 100%;
        border-collapse: collapse;
    }
    th,
    td {
        padding: 0.8rem 0.7rem;
        border-bottom: 1px solid var(--studio-border);
        text-align: left;
        white-space: nowrap;
    }
    th {
        color: var(--studio-muted);
        font-size: 0.75rem;
    }
    .notice {
        margin: 0;
        padding: 1rem;
        border-radius: 0.75rem;
        background: var(--studio-surface-subtle);
        color: var(--studio-muted);
    }
    .error {
        color: var(--studio-danger);
    }
    @media (max-width: 640px) {
        .filters {
            display: grid;
        }
        .filters :deep(.p-select),
        .filters :deep(.p-inputtext) {
            width: 100%;
        }
    }
</style>
