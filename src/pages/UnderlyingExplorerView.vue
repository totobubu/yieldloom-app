<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import Select from 'primevue/select';
    import Button from 'primevue/button';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    import {
        loadSecurityDirectory,
        loadSecurityInsights,
    } from '@/services/securityDirectory.js';
    import { loadStockPrices } from '@/services/stockPrices.js';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    import {
        underlyingProducts,
        comparableMetric,
        candleRisk,
    } from '../../lib/underlying-comparison.js';
    const route = useRoute(),
        router = useRouter();
    const underlying = computed(() =>
        String(route.params.symbol || '').toUpperCase()
    );
    const directory = ref(null),
        loading = ref(false),
        error = ref(''),
        detailsError = ref('');
    const insights = ref({}),
        risks = ref({}),
        detailed = ref(false),
        pending = ref(false);
    useFullscreenLoading(
        computed(() => loading.value || pending.value),
        '기초자산 데이터를 불러오고 있습니다.'
    );
    const strategy = ref(''),
        direction = ref(''),
        frequency = ref('');
    const strategyNames = {
        income: '인컴·옵션',
        leveraged: '레버리지',
        'single-stock': '단일종목',
        unknown: '전략 미확인',
    };
    const directionNames = {
        long: '롱',
        inverse: '인버스',
        unknown: '방향 미확인',
    };
    const strategyOptions = [
        { label: '모든 전략', value: '' },
        ...Object.entries(strategyNames).map(([value, label]) => ({
            value,
            label,
        })),
    ];
    const directionOptions = [
        { label: '모든 방향', value: '' },
        ...Object.entries(directionNames).map(([value, label]) => ({
            value,
            label,
        })),
    ];
    const assets = computed(() =>
        [
            ...new Set(
                (directory.value?.rows || [])
                    .map((row) => row.underlying)
                    .filter(Boolean)
            ),
        ].sort()
    );
    const products = computed(() =>
        underlyingProducts(
            directory.value?.rows || [],
            underlying.value,
            directory.value?.distributions || {}
        )
    );
    const frequencies = computed(() =>
        [
            { label: '모든 배당주기', value: '' },
            ...new Set(products.value.map((row) => row.frequency)),
        ].map((value) =>
            typeof value === 'string' ? { label: value, value } : value
        )
    );
    const visible = computed(() =>
        products.value.filter(
            (row) =>
                (!strategy.value || row.strategy === strategy.value) &&
                (!direction.value || row.direction === direction.value) &&
                (!frequency.value || row.frequency === frequency.value)
        )
    );
    const number = (value) =>
        value == null || !Number.isFinite(Number(value))
            ? '미확인'
            : Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: 4,
              });
    const metric = (symbol, key) =>
        key === 'totalReturn1Y' &&
        insights.value[symbol]?.performance?.corporateActionReview
            ? null
            : comparableMetric(
                  key === 'expenseRatio'
                      ? insights.value[symbol]?.fund?.expenseRatio
                      : insights.value[symbol]?.performance?.[key]
              );
    let generation = 0,
        controller;
    async function load() {
        const request = ++generation;
        loading.value = true;
        error.value = '';
        try {
            const result = await loadSecurityDirectory();
            if (request === generation) directory.value = result;
        } catch (reason) {
            if (request === generation) error.value = reason.message;
        } finally {
            if (request === generation) loading.value = false;
        }
    }
    async function loadDetails() {
        if (pending.value) return;
        controller?.abort();
        controller = new AbortController();
        const signal = controller.signal,
            asset = underlying.value,
            selected = visible.value.slice(0, 12);
        pending.value = true;
        detailsError.value = '';
        try {
            const results = [];
            let cursor = 0;
            await Promise.all(
                Array.from(
                    { length: Math.min(2, selected.length) },
                    async () => {
                        while (cursor < selected.length && !signal.aborted) {
                            const row = selected[cursor++];
                            const [info, prices] = await Promise.allSettled([
                                loadSecurityInsights(row.symbol, { signal }),
                                loadStockPrices(row.symbol, { signal }),
                            ]);
                            results.push({
                                status: 'fulfilled',
                                value: {
                                    symbol: row.symbol,
                                    info:
                                        info.status === 'fulfilled'
                                            ? info.value
                                            : null,
                                    risk:
                                        prices.status === 'fulfilled'
                                            ? candleRisk(prices.value)
                                            : { unavailable: '가격 조회 실패' },
                                    partial:
                                        info.status === 'rejected' ||
                                        prices.status === 'rejected',
                                },
                            });
                        }
                    }
                )
            );
            if (signal.aborted || underlying.value !== asset) return;
            for (const result of results)
                if (result.status === 'fulfilled') {
                    insights.value[result.value.symbol] = result.value.info;
                    risks.value[result.value.symbol] = result.value.risk;
                }
            detailed.value = true;
            if (
                results.some(
                    (row) => row.status === 'rejected' || row.value.partial
                )
            )
                detailsError.value =
                    '일부 자료를 조회하지 못했습니다. 확인된 자료만 표시합니다.';
            if (visible.value.length > 12)
                detailsError.value =
                    '상세 조회는 표시된 첫 12개까지입니다. 필터로 범위를 좁혀 주세요.';
        } finally {
            if (underlying.value === asset) pending.value = false;
        }
    }
    watch(underlying, () => {
        controller?.abort();
        pending.value = false;
        detailed.value = false;
        detailsError.value = '';
        insights.value = {};
        risks.value = {};
        strategy.value = '';
        direction.value = '';
        frequency.value = '';
    });
    onScopeDispose(() => {
        generation++;
        controller?.abort();
    });
    load();
</script>
<template>
    <main class="underlying-explorer">
        <header>
            <h1>기초자산별 ETF 비교</h1>
            <p>같은 기초자산을 참조해도 전략과 수익 구조는 다릅니다.</p>
        </header>
        <Message v-if="error" severity="error" role="alert"
            >{{ error }} <Button label="다시 시도" @click="load"
        /></Message>
        <p v-if="loading" role="status">공용 종목 목록을 불러오고 있습니다.</p>
        <template v-if="directory"
            ><div class="explorer-filters">
                <label for="explorer-asset"
                    ><span id="explorer-asset-label">기초자산</span
                    ><Select
                        :model-value="underlying"
                        input-id="explorer-asset"
                        aria-labelledby="explorer-asset-label"
                        :options="assets"
                        @update:model-value="
                            router.push(`/underlying/${$event}`)
                        " /></label
                ><label for="explorer-strategy"
                    ><span id="explorer-strategy-label">전략</span
                    ><Select
                        v-model="strategy"
                        placeholder="모든 전략"
                        input-id="explorer-strategy"
                        aria-labelledby="explorer-strategy-label"
                        :options="strategyOptions"
                        option-label="label"
                        option-value="value" /></label
                ><label for="explorer-direction"
                    ><span id="explorer-direction-label">방향</span
                    ><Select
                        v-model="direction"
                        placeholder="모든 방향"
                        input-id="explorer-direction"
                        aria-labelledby="explorer-direction-label"
                        :options="directionOptions"
                        option-label="label"
                        option-value="value" /></label
                ><label for="explorer-frequency"
                    ><span id="explorer-frequency-label">배당주기</span
                    ><Select
                        v-model="frequency"
                        placeholder="모든 배당주기"
                        input-id="explorer-frequency"
                        aria-labelledby="explorer-frequency-label"
                        :options="frequencies"
                        option-label="label"
                        option-value="value"
                /></label>
            </div>
            <h2>{{ underlying }} 기반 · {{ visible.length }}개</h2>
            <Message v-if="directory.dividendUnavailable" severity="warn"
                >배당 자료를 불러오지 못했습니다. 연결 정보만 확인할 수
                있습니다.</Message
            ><Message severity="info"
                >일간 배수가 장기 수익률의 배수를 뜻하지 않습니다. 기초자산
                연결은 직접 보유 비중을 의미하지 않습니다. 종목별 수익률
                기준일·기간을 함께 확인하세요.</Message
            ><Button
                label="수익률·수수료·가격 하락 조회"
                icon="pi pi-chart-line"
                :loading="pending"
                :disabled="!visible.length"
                @click="loadDetails" /><Message
                v-if="detailsError"
                severity="warn"
                >{{ detailsError }}</Message
            >
            <div class="product-grid">
                <article v-for="row in visible" :key="row.symbol">
                    <header>
                        <router-link :to="`/stock/${row.symbol}`"
                            ><h3>{{ row.symbol }}</h3></router-link
                        ><Tag
                            :value="
                                row.verified
                                    ? '공식 검증'
                                    : '기존 연결·재검증 대기'
                            "
                            :severity="row.verified ? 'success' : 'warn'" />
                    </header>
                    <p>{{ row.koName || row.longName || row.symbol }}</p>
                    <p>{{ row.company || '운용사 미확인' }}</p>
                    <p>
                        {{ strategyNames[row.strategy] }} ·
                        {{ directionNames[row.direction] }} ·
                        {{
                            row.leverage == null
                                ? '배수 미확인'
                                : `${row.leverage}배`
                        }}
                        · {{ row.frequency }}
                    </p>
                    <dl>
                        <dt>최근 주당 배당금</dt>
                        <dd>
                            {{ number(row.dividend) }}
                            {{ row.dividend == null ? '' : row.currency }}
                            <small>{{ row.exDate || '배당락일 미확인' }}</small>
                        </dd>
                        <template v-if="detailed"
                            ><dt>1년 총수익률</dt>
                            <dd>
                                {{
                                    number(
                                        metric(row.symbol, 'totalReturn1Y')
                                            ?.value
                                    )
                                }}{{
                                    metric(row.symbol, 'totalReturn1Y')
                                        ? '%'
                                        : ''
                                }}
                                <small
                                    v-if="metric(row.symbol, 'totalReturn1Y')"
                                    >{{
                                        metric(row.symbol, 'totalReturn1Y')
                                            .estimated
                                            ? '제공처 조정 종가 추정 · '
                                            : ''
                                    }}{{
                                        metric(row.symbol, 'totalReturn1Y')
                                            .startDate
                                    }}
                                    ~
                                    {{
                                        metric(row.symbol, 'totalReturn1Y')
                                            .asOfDate
                                    }}</small
                                >
                            </dd>
                            <dt>운용 보수</dt>
                            <dd>
                                {{
                                    number(
                                        metric(row.symbol, 'expenseRatio')
                                            ?.value
                                    )
                                }}{{
                                    metric(row.symbol, 'expenseRatio')
                                        ? '%'
                                        : ''
                                }}
                                <small
                                    >기준일
                                    {{
                                        metric(row.symbol, 'expenseRatio')
                                            ?.asOfDate || '미확인'
                                    }}</small
                                >
                            </dd>
                            <dt>기간 가격 변화 / 최대 하락</dt>
                            <dd v-if="risks[row.symbol]?.startDate">
                                {{ number(risks[row.symbol].priceReturn) }}% /
                                {{ number(risks[row.symbol].maxDrawdown) }}%
                                <small
                                    >{{ risks[row.symbol].startDate }} ~
                                    {{ risks[row.symbol].endDate }} · 배당
                                    제외</small
                                >
                            </dd>
                            <dd v-else>
                                {{ risks[row.symbol]?.unavailable || '미조회' }}
                            </dd></template
                        >
                    </dl>
                    <a
                        v-if="row.source"
                        :href="row.source.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        >공식 연결 근거</a
                    >
                </article>
            </div>
            <p v-if="!visible.length">조건에 맞는 ETF가 없습니다.</p></template
        >
    </main>
</template>
<style scoped>
    .underlying-explorer {
        max-width: 1200px;
        margin: auto;
        padding: 24px;
        color: var(--app-text);
    }
    .explorer-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin: 20px 0;
    }
    .explorer-filters label {
        display: grid;
        gap: 8px;
        flex: 1;
        min-width: 150px;
    }
    .product-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
        margin: 20px 0;
    }
    .product-grid article {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 14px;
        padding: 18px;
        min-width: 0;
        overflow-wrap: anywhere;
    }
    article header {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
    }
    h3 {
        margin: 0;
    }
    dt {
        font-weight: 700;
    }
    dd {
        margin: 5px 0 15px;
    }
    small {
        display: block;
        color: var(--app-muted);
    }
    @media (max-width: 400px) {
        .underlying-explorer {
            padding: 16px;
        }
        .product-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
