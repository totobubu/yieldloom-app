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
        String(route.params.symbol || route.query.symbol || '').toUpperCase()
    );
    const selectUnderlying = (symbol) =>
        route.name === 'security-compare'
            ? router.push({ name: 'security-compare', query: { symbol } })
            : router.push(`/underlying/${symbol}`);
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
    const comparisonRows = computed(() =>
        visible.value.map((row) => ({
            ...row,
            totalReturn: metric(row.symbol, 'totalReturn1Y')?.value ?? null,
            expenseRatio: metric(row.symbol, 'expenseRatio')?.value ?? null,
            maxDrawdown: risks.value[row.symbol]?.maxDrawdown ?? null,
        }))
    );
    const bestValue = (key, direction = 'max') => {
        const values = comparisonRows.value
            .map((row) => row[key])
            .filter((value) => Number.isFinite(value));
        if (!values.length) return null;
        return direction === 'min' ? Math.min(...values) : Math.max(...values);
    };
    const isBest = (row, key, direction = 'max') =>
        Number.isFinite(row[key]) && row[key] === bestValue(key, direction);
    const resetFilters = () => {
        strategy.value = '';
        direction.value = '';
        frequency.value = '';
    };
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
                        @update:model-value="selectUnderlying" /></label
                ><label v-if="underlying" for="explorer-strategy"
                    ><span id="explorer-strategy-label">전략</span
                    ><Select
                        v-model="strategy"
                        placeholder="모든 전략"
                        input-id="explorer-strategy"
                        aria-labelledby="explorer-strategy-label"
                        :options="strategyOptions"
                        option-label="label"
                        option-value="value" /></label
                ><label v-if="underlying" for="explorer-direction"
                    ><span id="explorer-direction-label">방향</span
                    ><Select
                        v-model="direction"
                        placeholder="모든 방향"
                        input-id="explorer-direction"
                        aria-labelledby="explorer-direction-label"
                        :options="directionOptions"
                        option-label="label"
                        option-value="value" /></label
                ><label v-if="underlying" for="explorer-frequency"
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
            <h2 v-if="underlying">
                {{ underlying }} 기반 · {{ visible.length }}개
            </h2>
            <Message v-else severity="info" :closable="false"
                >비교할 기초자산을 선택해 주세요.</Message
            >
            <Message
                v-if="underlying && directory.dividendUnavailable"
                severity="warn"
                >배당 자료를 불러오지 못했습니다. 연결 정보만 확인할 수
                있습니다.</Message
            ><Message v-if="underlying" severity="info"
                >일간 배수가 장기 수익률의 배수를 뜻하지 않습니다. 기초자산
                연결은 직접 보유 비중을 의미하지 않습니다. 종목별 수익률
                기준일·기간을 함께 확인하세요.</Message
            ><Button
                v-if="underlying"
                label="수익률·수수료·가격 하락 조회"
                icon="pi pi-chart-line"
                :loading="pending"
                :disabled="!visible.length"
                @click="loadDetails" /><Message
                v-if="detailsError"
                severity="warn"
                >{{ detailsError }}</Message
            >
            <section v-if="underlying && detailed" class="comparison-summary">
                <div class="comparison-summary-heading">
                    <div>
                        <h3>한눈에 비교</h3>
                        <p>현재 필터의 ETF를 같은 기준으로 비교합니다.</p>
                    </div>
                    <span>유리한 값 표시</span>
                </div>
                <div class="comparison-table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">종목</th>
                                <th scope="col">전략</th>
                                <th scope="col">1년 총수익률</th>
                                <th scope="col">운용 보수</th>
                                <th scope="col">최대 하락</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in comparisonRows" :key="row.symbol">
                                <th scope="row">
                                    <router-link :to="'/stock/' + row.symbol">{{
                                        row.symbol
                                    }}</router-link>
                                </th>
                                <td>{{ strategyNames[row.strategy] }}</td>
                                <td
                                    :class="{
                                        'is-best': isBest(row, 'totalReturn'),
                                    }">
                                    {{ number(row.totalReturn)
                                    }}{{ row.totalReturn == null ? '' : '%' }}
                                    <small v-if="isBest(row, 'totalReturn')"
                                        >상대 우위</small
                                    >
                                </td>
                                <td
                                    :class="{
                                        'is-best': isBest(
                                            row,
                                            'expenseRatio',
                                            'min'
                                        ),
                                    }">
                                    {{ number(row.expenseRatio)
                                    }}{{ row.expenseRatio == null ? '' : '%' }}
                                    <small
                                        v-if="
                                            isBest(row, 'expenseRatio', 'min')
                                        "
                                        >낮은 보수</small
                                    >
                                </td>
                                <td
                                    :class="{
                                        'is-best': isBest(row, 'maxDrawdown'),
                                    }">
                                    {{ number(row.maxDrawdown)
                                    }}{{ row.maxDrawdown == null ? '' : '%' }}
                                    <small v-if="isBest(row, 'maxDrawdown')"
                                        >낮은 하락</small
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="comparison-caution">
                    상대 우위 표시는 조회된 동일 기간 값만 비교하며 투자 추천을
                    의미하지 않습니다.
                </p>
            </section>
            <div v-if="underlying" class="product-grid">
                <article v-for="row in visible" :key="row.symbol">
                    <header>
                        <router-link :to="`/stock/${row.symbol}`"
                            ><h3>{{ row.symbol }}</h3></router-link
                        ><a
                            v-if="row.verified && row.source?.url"
                            class="verification-link"
                            :href="row.source.url"
                            target="_blank"
                            rel="noopener noreferrer"
                            :aria-label="`${row.symbol} 공식 연결 근거 보기`"
                            ><Tag value="공식 검증" severity="success"
                        /></a>
                        <Tag
                            v-else
                            :value="
                                row.verified
                                    ? '공식 검증'
                                    : '기존 연결·재검증 대기'
                            "
                            :severity="row.verified ? 'success' : 'warn'"
                            :title="
                                row.verified
                                    ? undefined
                                    : '기존 목록에는 연결되어 있지만 운용사 공식 근거가 검증 레지스트리에 등록되지 않았습니다.'
                            " />
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
                </article>
            </div>
            <section
                v-if="underlying && !visible.length"
                class="explorer-empty"
                role="status">
                <i class="pi pi-filter-slash" aria-hidden="true" />
                <h3>조건에 맞는 ETF가 없습니다</h3>
                <p>필터 조건을 줄이거나 전체 조건으로 다시 확인해 보세요.</p>
                <Button
                    label="필터 초기화"
                    icon="pi pi-refresh"
                    severity="secondary"
                    outlined
                    @click="resetFilters" /></section
        ></template>
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
    .comparison-summary {
        margin: 20px 0;
        padding: 18px;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
    }
    .comparison-summary-heading {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: start;
        margin-bottom: 14px;
    }
    .comparison-summary-heading h3,
    .comparison-summary-heading p,
    .comparison-caution {
        margin: 0;
    }
    .comparison-summary-heading p,
    .comparison-caution {
        color: var(--app-muted);
        font-size: 13px;
    }
    .comparison-summary-heading > span {
        flex: none;
        padding: 4px 9px;
        border-radius: 999px;
        color: var(--app-accent);
        background: var(--app-surface-muted);
        font-size: 12px;
        font-weight: 700;
    }
    .comparison-table-wrap {
        overflow-x: auto;
    }
    table {
        width: 100%;
        min-width: 720px;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
    }
    th,
    td {
        padding: 12px;
        border-bottom: 1px solid var(--app-border-subtle);
        text-align: left;
        vertical-align: top;
    }
    thead th {
        color: var(--app-muted);
        background: var(--app-surface-muted);
        font-size: 12px;
    }
    td.is-best {
        color: var(--app-accent);
        background: color-mix(in srgb, var(--app-accent) 7%, transparent);
        font-weight: 750;
    }
    td.is-best small {
        color: inherit;
        font-weight: 600;
    }
    .comparison-caution {
        margin-top: 12px;
    }
    .explorer-empty {
        display: grid;
        justify-items: center;
        gap: 10px;
        margin: 24px 0;
        padding: 44px 20px;
        border: 1px dashed var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
        text-align: center;
    }
    .explorer-empty > .pi {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        color: var(--app-accent);
        background: var(--app-surface-muted);
        font-size: 20px;
    }
    .explorer-empty h3,
    .explorer-empty p {
        margin: 0;
    }
    .explorer-empty p {
        color: var(--app-muted);
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
    .verification-link {
        display: inline-flex;
        border-radius: var(--p-tag-border-radius);
        text-decoration: none;
    }
    .verification-link:hover,
    .verification-link:focus-visible {
        outline: 2px solid
            color-mix(in srgb, var(--app-accent) 35%, transparent);
        outline-offset: 3px;
    }
    dl {
        margin: 16px 0 0;
        padding-top: 14px;
        border-top: 1px solid var(--app-border-subtle);
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
