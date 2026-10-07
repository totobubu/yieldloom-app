<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import {
        nextExpectedDate,
        type DistributionTicker,
        useDividendPortfolio,
    } from '@/composables/studio/useDividendPortfolio';
    import {
        loadMarketInputs,
        type PriceIndex,
    } from '@/services/dividendMarketData';
    import {
        getComparisonSignals,
        type PriceQuality,
        type StabilitySignal,
    } from '@/services/etfComparison';
    const rows = ref<DistributionTicker[]>([]);
    const prices = ref<PriceIndex>({
        generatedAt: '',
        source: 'yahoo_eod',
        prices: {},
    });
    const selected = ref<string[]>([]);
    const query = ref('');
    const frequency = ref('all');
    const providers = ref<string[]>([]);
    const stability = ref<'all' | StabilitySignal>('all');
    const priceQuality = ref<'all' | PriceQuality>('all');
    const minimumYield = ref<number | null>(null);
    const maximumYield = ref<number | null>(null);
    const error = ref('');
    const loading = ref(true);
    const { watchlist, toggleWatchlist } = useDividendPortfolio();
    useHead({ title: 'ETF 비교 | 토토부부 배당 스튜디오' });
    const explorerRows = computed(() =>
        rows.value
            .map((row) => ({
                row,
                signals: getComparisonSignals(row, prices.value),
            }))
            .filter(({ row }) => {
                const needle = query.value.toLowerCase();
                return (
                    row.ticker.toLowerCase().includes(needle) ||
                    row.providerSlug.toLowerCase().includes(needle)
                );
            })
            .filter(
                ({ row }) =>
                    frequency.value === 'all' ||
                    row.latest.frequency === frequency.value
            )
            .filter(
                ({ row }) =>
                    !providers.value.length ||
                    providers.value.includes(row.providerSlug)
            )
            .filter(
                ({ signals }) =>
                    stability.value === 'all' ||
                    signals.stability === stability.value
            )
            .filter(
                ({ signals }) =>
                    priceQuality.value === 'all' ||
                    signals.priceQuality === priceQuality.value
            )
            .filter(
                ({ signals }) =>
                    minimumYield.value === null ||
                    (signals.annualYield !== null &&
                        signals.annualYield * 100 >= minimumYield.value!)
            )
            .filter(
                ({ signals }) =>
                    maximumYield.value === null ||
                    (signals.annualYield !== null &&
                        signals.annualYield * 100 <= maximumYield.value!)
            )
            .sort((a, b) => a.row.ticker.localeCompare(b.row.ticker))
    );
    const frequencyOptions = computed(() => [
        { label: '지급 주기 전체', value: 'all' },
        ...[
            ...new Set(
                rows.value.map((row) => row.latest.frequency).filter(Boolean)
            ),
        ]
            .sort()
            .map((value) => ({ label: value, value })),
    ]);
    const providerOptions = computed(() =>
        [...new Set(rows.value.map((row) => row.providerSlug))]
            .sort()
            .map((value) => ({ label: value, value }))
    );
    const compared = computed(
        () =>
            selected.value
                .map((ticker) =>
                    rows.value.find((row) => row.ticker === ticker)
                )
                .filter(Boolean) as DistributionTicker[]
    );
    const money = (value: number | null) =>
        value === null || !Number.isFinite(value)
            ? '—'
            : `$${value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
    const change = (row: DistributionTicker) =>
        row.latest.comparisonBasis === 'corporate_action_or_frequency_change' ||
        row.latest.previous_amount === null
            ? '—'
            : money(
                  Number(row.latest.distribution_per_share) -
                      Number(row.latest.previous_amount)
              );
    const stabilityLabel: Record<StabilitySignal, string> = {
        stable: '안정',
        caution: '주의',
        review: '검토 필요',
    };
    const qualityLabel: Record<PriceQuality, string> = {
        fresh: '가격 정상',
        stale: '가격 노후',
        missing: '가격 누락',
    };
    const signals = (row: DistributionTicker) =>
        getComparisonSignals(row, prices.value);
    const annualYield = (row: DistributionTicker) => {
        const value = signals(row).annualYield;
        return value === null ? null : value * 100;
    };
    const percent = (value: number | null) =>
        value === null || !Number.isFinite(value)
            ? '—'
            : `${value.toFixed(2)}%`;
    const toggleCompare = (ticker: string) => {
        selected.value = selected.value.includes(ticker)
            ? selected.value.filter((item) => item !== ticker)
            : selected.value.length < 4
              ? [...selected.value, ticker]
              : selected.value;
    };
    onMounted(async () => {
        try {
            const inputs = await loadMarketInputs();
            rows.value = inputs.rows.filter((row: DistributionTicker) =>
                ['official', 'cross_checked'].includes(
                    row.latest.verification_status
                )
            );
            prices.value = inputs.priceIndex;
        } catch (e) {
            error.value =
                e instanceof Error
                    ? e.message
                    : '공식 원장을 불러오지 못했습니다.';
        } finally {
            loading.value = false;
        }
    });
</script>
<template>
    <section class="view">
        <header>
            <p class="eyebrow">OFFICIAL DISTRIBUTION COMPARISON</p>
            <h1>ETF 배당 비교</h1>
            <p>
                공식 확인된 배당 이력으로 최대 4개 미국 ETF를 비교합니다.
                예상값은 과거 지급 주기와 최신 발표를 바탕으로 한 세전 USD
                추정입니다.
            </p>
        </header>
        <p v-if="error" class="notice error">{{ error }}</p>
        <div class="picker">
            <InputText
                v-model="query"
                placeholder="티커 또는 운용사 검색 (예: TSLY)" />
            <span>{{ selected.length }}/4 선택</span>
        </div>
        <div class="filters" aria-label="ETF 탐색 필터">
            <Select
                v-model="frequency"
                :options="frequencyOptions"
                option-label="label"
                option-value="value" />
            <Select
                v-model="providers"
                :options="providerOptions"
                option-label="label"
                option-value="value"
                multiple
                placeholder="운용사 전체" />
            <Select
                v-model="stability"
                :options="[
                    { label: '안정성 전체', value: 'all' },
                    { label: '안정', value: 'stable' },
                    { label: '주의', value: 'caution' },
                    { label: '검토 필요', value: 'review' },
                ]"
                option-label="label"
                option-value="value" />
            <Select
                v-model="priceQuality"
                :options="[
                    { label: '가격 품질 전체', value: 'all' },
                    { label: '가격 정상', value: 'fresh' },
                    { label: '가격 노후', value: 'stale' },
                    { label: '가격 누락', value: 'missing' },
                ]"
                option-label="label"
                option-value="value" />
            <label
                >최소 분배율
                <input
                    v-model.number="minimumYield"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="%"
            /></label>
            <label
                >최대 분배율
                <input
                    v-model.number="maximumYield"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="%"
            /></label>
        </div>
        <p class="hint">
            안정성은 배당 지급 패턴의 검토 신호이며, 총수익률·위험·보수에 대한
            투자 추천이 아닙니다. 가격 누락·노후 ETF는 분배율을 계산하지
            않습니다.
        </p>
        <div v-if="!loading" class="results">
            <div
                v-for="entry in explorerRows.slice(0, 50)"
                :key="entry.row.ticker">
                <div>
                    <strong>{{ entry.row.ticker }}</strong>
                    <small
                        >{{ entry.row.providerSlug }} ·
                        {{ entry.row.latest.frequency || '주기 미상' }}</small
                    >
                    <span
                        :class="['badge', entry.signals.stability]"
                        :title="entry.signals.stabilityReasons.join(', ')"
                        >{{ stabilityLabel[entry.signals.stability] }}</span
                    >
                    <span :class="['badge', entry.signals.priceQuality]">{{
                        qualityLabel[entry.signals.priceQuality]
                    }}</span>
                    <small
                        >연 환산 분배율
                        {{
                            percent(
                                entry.signals.annualYield === null
                                    ? null
                                    : entry.signals.annualYield * 100
                            )
                        }}</small
                    >
                </div>
                <div>
                    <Button
                        size="small"
                        :label="
                            selected.includes(entry.row.ticker)
                                ? '비교 해제'
                                : '비교'
                        "
                        :disabled="
                            !selected.includes(entry.row.ticker) &&
                            selected.length >= 4
                        "
                        @click="toggleCompare(entry.row.ticker)" /><Button
                        size="small"
                        text
                        :label="
                            watchlist.includes(entry.row.ticker)
                                ? '관심 해제'
                                : '관심'
                        "
                        @click="toggleWatchlist(entry.row.ticker)" />
                </div>
            </div>
        </div>
        <p v-if="!loading && !explorerRows.length" class="notice">
            현재 필터와 일치하는 공식 ETF가 없습니다.
        </p>
        <p v-if="loading" class="notice">공식 원장을 불러오는 중…</p>
        <div v-else-if="compared.length" class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>ETF</th>
                        <th>최근 배당</th>
                        <th>직전 대비</th>
                        <th>4회 평균</th>
                        <th>12회 평균</th>
                        <th>지급 주기</th>
                        <th>다음 예상 배당락일</th>
                        <th>연 환산 추정</th>
                        <th>안정성</th>
                        <th>가격 품질</th>
                        <th>공식 원문</th>
                        <th>검증</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in compared" :key="row.ticker">
                        <td>
                            <strong>{{ row.ticker }}</strong
                            ><small>{{ row.providerSlug }}</small>
                        </td>
                        <td>
                            {{
                                money(Number(row.latest.distribution_per_share))
                            }}
                        </td>
                        <td>{{ change(row) }}</td>
                        <td>{{ money(row.latest.average4) }}</td>
                        <td>{{ money(row.latest.average12) }}</td>
                        <td>{{ row.latest.frequency || '—' }}</td>
                        <td>
                            {{ nextExpectedDate(row.latest) || '이력 부족' }}
                        </td>
                        <td>{{ percent(annualYield(row)) }}</td>
                        <td>
                            <span
                                :class="['badge', signals(row).stability]"
                                :title="
                                    signals(row).stabilityReasons.join(', ')
                                "
                                >{{
                                    stabilityLabel[signals(row).stability]
                                }}</span
                            >
                        </td>
                        <td>
                            <span
                                :class="['badge', signals(row).priceQuality]"
                                >{{
                                    qualityLabel[signals(row).priceQuality]
                                }}</span
                            >
                        </td>
                        <td>
                            <a
                                :href="row.latest.official_url"
                                target="_blank"
                                rel="noreferrer"
                                >보기</a
                            >
                        </td>
                        <td>
                            <span
                                v-if="
                                    row.latest.comparisonBasis ===
                                    'corporate_action_or_frequency_change'
                                "
                                >기업행동/주기 변경</span
                            >
                            <span v-else>{{
                                row.latest.verification_status ===
                                'cross_checked'
                                    ? '교차 검증'
                                    : '공식 확인'
                            }}</span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-else-if="!loading" class="notice">
            탐색 목록에서 비교할 ETF를 선택하세요.
        </p>
    </section>
</template>
<style scoped>
    .view {
        display: grid;
        gap: 1.25rem;
    }
    h1,
    p {
        margin-top: 0;
    }
    .eyebrow {
        color: var(--studio-accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.12em;
    }
    .picker {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: center;
    }
    .picker :deep(.p-inputtext) {
        width: min(28rem, 100%);
    }
    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 0.65rem;
        align-items: center;
        padding: 1rem;
        border: 1px solid var(--studio-border);
        border-radius: 0.75rem;
        background: var(--studio-surface);
    }
    .filters label {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        color: var(--studio-muted);
        font-size: 0.82rem;
    }
    .filters input {
        width: 5rem;
        padding: 0.5rem;
        border: 1px solid var(--studio-border);
        border-radius: 0.4rem;
        background: var(--studio-surface);
        color: var(--studio-text);
    }
    .hint {
        margin: 0;
        color: var(--studio-muted);
        font-size: 0.82rem;
    }
    .results {
        display: grid;
        gap: 0.5rem;
    }
    .results > div {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.7rem 1rem;
        border: 1px solid var(--studio-border);
        border-radius: 0.75rem;
        background: var(--studio-surface);
    }
    .results small,
    td small {
        display: block;
        color: var(--studio-muted);
    }
    .results > div > div {
        margin-left: auto;
        display: flex;
        gap: 0.3rem;
    }
    .badge {
        display: inline-block;
        margin: 0.3rem 0.35rem 0 0;
        padding: 0.15rem 0.4rem;
        border-radius: 999px;
        font-size: 0.72rem;
        font-weight: 800;
    }
    .stable,
    .fresh {
        background: #dcfae6;
        color: #067647;
    }
    .caution,
    .stale {
        background: #fef0c7;
        color: #93370d;
    }
    .review,
    .missing {
        background: #fee4e2;
        color: #b42318;
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
        .picker {
            align-items: stretch;
            flex-direction: column;
        }
        .picker :deep(.p-inputtext) {
            width: 100%;
        }
    }
</style>
