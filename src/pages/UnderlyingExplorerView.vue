<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import Select from 'primevue/select';
    import Button from 'primevue/button';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    import Popover from 'primevue/popover';
    import {
        comparisonSections,
        comparisonThemes,
        similarProducts,
        canCompareSimilar,
        themeProducts,
    } from '../../lib/comparison-groups.js';
    import {
        loadSecurityDirectory,
        loadSecurityInsights,
    } from '@/services/securityDirectory.js';
    import { loadStockPrices } from '@/services/stockPrices.js';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    import {
        underlyingProducts,
        comparisonProducts,
        comparableMetric,
        candleRisk,
    } from '../../lib/underlying-comparison.js';
    const route = useRoute(),
        router = useRouter();
    const underlying = computed(() =>
        String(route.params.symbol || route.query.symbol || '').toUpperCase()
    );
    const section = computed(
        () =>
            comparisonSections.find(
                (item) => item.value === route.query.view
            ) ?? comparisonSections[0]
    );
    const theme = computed(
        () =>
            comparisonThemes.find((item) => item.value === route.query.theme) ??
            comparisonThemes[0]
    );
    function sectionLink(view) {
        return {
            name: 'security-compare',
            query: {
                view,
                ...(underlying.value ? { symbol: underlying.value } : {}),
                ...(route.query.ticker ? { ticker: route.query.ticker } : {}),
                ...(route.query.theme ? { theme: route.query.theme } : {}),
            },
        };
    }
    function updateSelection(key, value) {
        const query = {
            ...route.query,
            view: section.value.value,
            [key]: value,
        };
        if (route.params.symbol) query.symbol = underlying.value;
        void router.push({ name: 'security-compare', query });
    }
    const selectUnderlying = (symbol) => updateSelection('symbol', symbol);
    const help = ref(null);
    const helpText =
        '일간 배수가 장기 수익률의 배수를 뜻하지 않습니다. 기초자산 연결은 직접 보유 비중을 의미하지 않습니다. 종목별 수익률 기준일·기간을 함께 확인하세요.';
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
        '비교 데이터를 불러오고 있습니다.'
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
    const allProducts = computed(() =>
        comparisonProducts(
            (directory.value?.rows ?? []).filter(
                (row) => row.underlying && row.symbol !== row.underlying
            ),
            directory.value?.distributions
        )
    );
    const similarReady = computed(() => canCompareSimilar(reference.value));
    const referenceOptions = computed(() =>
        allProducts.value
            .map((row) => ({
                label: `${row.symbol} · ${row.koName || row.longName || row.company || ''}`,
                value: row.symbol,
            }))
            .sort((a, b) => a.value.localeCompare(b.value))
    );
    const reference = computed(() => {
        const symbol =
            typeof route.query.ticker === 'string'
                ? route.query.ticker.toUpperCase()
                : 'APLY';
        return allProducts.value.find((row) => row.symbol === symbol) ?? null;
    });
    const products = computed(() => {
        if (section.value.value === 'similar')
            return reference.value
                ? [
                      reference.value,
                      ...similarProducts(allProducts.value, reference.value),
                  ]
                : [];
        if (section.value.value === 'theme')
            return themeProducts(allProducts.value, theme.value);
        return underlyingProducts(
            directory.value?.rows ?? [],
            underlying.value,
            directory.value?.distributions
        );
    });
    const hasSelection = computed(
        () => section.value.value !== 'underlying' || Boolean(underlying.value)
    );
    const resultLabel = computed(() =>
        section.value.value === 'similar'
            ? `${reference.value?.symbol || '기준 ETF 미선택'} 비교`
            : section.value.value === 'theme'
              ? `${theme.value.label} 관련 ETF`
              : `${underlying.value} 기반`
    );
    const selectionKey = computed(
        () =>
            `${section.value.value}:${underlying.value}:${route.query.ticker || ''}:${theme.value.value}`
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
        const candidates = comparisonRows.value.filter((row) =>
            Number.isFinite(row[key])
        );
        if (candidates.length < 2) return null;
        const periods = candidates.map((row) => {
            if (key === 'maxDrawdown') {
                const risk = risks.value[row.symbol];
                return risk?.startDate && risk?.endDate
                    ? `${risk.startDate}:${risk.endDate}`
                    : null;
            }
            const info = metric(
                row.symbol,
                key === 'totalReturn' ? 'totalReturn1Y' : 'expenseRatio'
            );
            if (!info?.asOfDate || (key === 'totalReturn' && !info.startDate))
                return null;
            return `${info.startDate || ''}:${info.asOfDate}`;
        });
        if (periods.some((period) => !period) || new Set(periods).size !== 1)
            return null;
        const values = candidates.map((row) => row[key]);
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
        detailsGeneration = 0,
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
        const request = ++detailsGeneration;
        const signal = controller.signal,
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
            if (signal.aborted || request !== detailsGeneration) return;
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
            if (request === detailsGeneration) pending.value = false;
        }
    }
    function clearDetails() {
        detailsGeneration++;
        controller?.abort();
        pending.value = false;
        detailed.value = false;
        detailsError.value = '';
        insights.value = {};
        risks.value = {};
    }
    watch(selectionKey, () => {
        resetFilters();
        clearDetails();
        help.value?.hide();
    });
    watch([strategy, direction, frequency], clearDetails);
    onScopeDispose(() => {
        generation++;
        detailsGeneration++;
        controller?.abort();
    });
    load();
</script>
<template>
    <section class="underlying-explorer" aria-labelledby="comparison-title">
        <header class="comparison-page-heading">
            <span class="studio-eyebrow">ETF COMPARISON</span>
            <h1 id="comparison-title">종목 비교</h1>
            <p>어떤 기준으로 비교할까요?</p>
        </header>
        <nav class="comparison-navigation" aria-label="종목 비교 하위 메뉴">
            <router-link
                v-for="item in comparisonSections"
                :key="item.value"
                :to="sectionLink(item.value)"
                :class="{ active: section.value === item.value }"
                :aria-current="
                    section.value === item.value ? 'page' : undefined
                ">
                <i :class="item.icon" aria-hidden="true" />{{ item.label }}
            </router-link>
        </nav>
        <header class="comparison-section-heading">
            <div>
                <div class="comparison-section-title">
                    <h2>{{ section.label }}</h2>
                    <Button
                        v-tooltip.bottom="{ value: helpText, showDelay: 250 }"
                        icon="pi pi-info-circle"
                        aria-label="비교 안내"
                        aria-describedby="comparison-help-text"
                        severity="secondary"
                        text
                        rounded
                        @click="help.toggle($event)" />
                    <span id="comparison-help-text" class="studio-sr-only">{{
                        helpText
                    }}</span>
                </div>
                <p>{{ section.description }}</p>
            </div>
            <Button
                v-if="hasSelection"
                class="comparison-load-button"
                label="수익률·수수료·가격 하락 조회"
                icon="pi pi-chart-line"
                :loading="pending"
                :disabled="loading || !visible.length"
                @click="loadDetails" />
        </header>
        <Popover ref="help" aria-label="비교 안내"
            ><p class="comparison-help-content">{{ helpText }}</p></Popover
        >
        <Message v-if="error" severity="error" role="alert"
            >{{ error }} <Button label="다시 시도" @click="load"
        /></Message>
        <p v-if="loading" role="status">공용 종목 목록을 불러오고 있습니다.</p>
        <template v-if="directory"
            ><div class="explorer-filters">
                <label
                    v-if="section.value === 'underlying'"
                    for="explorer-asset"
                    ><span id="explorer-asset-label">기초자산</span
                    ><Select
                        :model-value="underlying"
                        input-id="explorer-asset"
                        aria-labelledby="explorer-asset-label"
                        :options="assets"
                        @update:model-value="selectUnderlying"
                /></label>
                <label
                    v-if="section.value === 'similar'"
                    for="explorer-reference">
                    <span>기준 ETF</span
                    ><Select
                        :model-value="reference?.symbol"
                        input-id="explorer-reference"
                        :options="referenceOptions"
                        option-label="label"
                        option-value="value"
                        filter
                        placeholder="기준 ETF 선택"
                        @update:model-value="
                            updateSelection('ticker', $event)
                        " />
                </label>
                <label v-if="section.value === 'theme'" for="explorer-theme">
                    <span>테마</span
                    ><Select
                        :model-value="theme.value"
                        input-id="explorer-theme"
                        :options="comparisonThemes"
                        option-label="label"
                        option-value="value"
                        @update:model-value="
                            updateSelection('theme', $event)
                        " />
                </label>
                <label v-if="hasSelection" for="explorer-strategy"
                    ><span id="explorer-strategy-label">전략</span
                    ><Select
                        v-model="strategy"
                        placeholder="모든 전략"
                        input-id="explorer-strategy"
                        aria-labelledby="explorer-strategy-label"
                        :options="strategyOptions"
                        option-label="label"
                        option-value="value" /></label
                ><label v-if="hasSelection" for="explorer-direction"
                    ><span id="explorer-direction-label">방향</span
                    ><Select
                        v-model="direction"
                        placeholder="모든 방향"
                        input-id="explorer-direction"
                        aria-labelledby="explorer-direction-label"
                        :options="directionOptions"
                        option-label="label"
                        option-value="value" /></label
                ><label v-if="hasSelection" for="explorer-frequency"
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
            <div v-if="section.value === 'theme'" class="comparison-context">
                <strong>{{ theme.label }}</strong>
                <p>{{ theme.description }}</p>
                <small
                    >위 종목을 기초자산으로 참조하는 ETF 목록입니다. 테마 전체의
                    보유 비중이나 성과를 뜻하지 않습니다.</small
                >
            </div>
            <p v-if="section.value === 'similar'" class="comparison-context">
                기준 ETF를 포함하며, 전략·방향이 같은 ETF를 표시합니다. 레버리지
                ETF는 배수도 일치해야 합니다. 같은 기초자산을 우선 정렬하며
                수익률 상관관계는 계산하지 않습니다.
            </p>
            <Message
                v-if="section.value === 'similar' && reference && !similarReady"
                severity="info"
                :closable="false">
                기준 ETF의 전략·방향·배수 정보가 부족해 유사 ETF를 판별할 수
                없습니다. 다른 기준 ETF를 선택해 주세요.
            </Message>
            <h3 v-if="hasSelection" class="comparison-result-count">
                {{ resultLabel }} · {{ visible.length }}개
            </h3>
            <Message v-else severity="info" :closable="false"
                >비교할 기초자산을 선택해 주세요.</Message
            >
            <Message
                v-if="hasSelection && directory.dividendUnavailable"
                severity="warn"
                >배당 자료를 불러오지 못했습니다. 연결 정보만 확인할 수
                있습니다.</Message
            >
            <Message v-if="detailsError" severity="warn">{{
                detailsError
            }}</Message>
            <section v-if="hasSelection && detailed" class="comparison-summary">
                <div class="comparison-summary-heading">
                    <div>
                        <h3>한눈에 비교</h3>
                        <p>현재 필터의 ETF를 같은 기준으로 비교합니다.</p>
                    </div>
                    <span>동일 기준일·기간일 때 상대 우위 표시</span>
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
                                    <small
                                        v-if="
                                            metric(row.symbol, 'totalReturn1Y')
                                        "
                                        >{{
                                            metric(row.symbol, 'totalReturn1Y')
                                                .startDate || '시작일 미확인'
                                        }}
                                        ~
                                        {{
                                            metric(row.symbol, 'totalReturn1Y')
                                                .asOfDate || '기준일 미확인'
                                        }}</small
                                    >
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
                                            metric(row.symbol, 'expenseRatio')
                                        "
                                        >기준일
                                        {{
                                            metric(row.symbol, 'expenseRatio')
                                                .asOfDate || '미확인'
                                        }}</small
                                    >
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
                                    <small v-if="risks[row.symbol]?.startDate"
                                        >{{ risks[row.symbol].startDate }} ~
                                        {{ risks[row.symbol].endDate }}</small
                                    >
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
            <div v-if="hasSelection" class="product-grid">
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
                    <div
                        v-if="section.value !== 'underlying'"
                        class="product-context-tags">
                        <Tag
                            v-if="
                                section.value === 'similar' &&
                                row.symbol === reference?.symbol
                            "
                            value="기준 ETF" />
                        <router-link
                            v-if="row.underlying"
                            :to="`/underlying/${row.underlying}`"
                            >{{ row.underlying }} 기반</router-link
                        >
                    </div>
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
                v-if="hasSelection && !visible.length"
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
    </section>
</template>
<style scoped>
    .underlying-explorer {
        max-width: 1200px;
        margin: auto;
        padding: 24px 0;
        color: var(--app-text);
    }
    .comparison-page-heading h1 {
        margin: 8px 0;
        font-size: 30px;
    }
    .comparison-page-heading p {
        margin: 0;
        color: var(--app-muted);
    }
    .comparison-navigation {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding: 6px 2px;
        margin: 24px 0;
        border-bottom: 1px solid var(--app-border);
    }
    .comparison-navigation a {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        padding: 12px 16px;
        min-height: 44px;
        color: var(--app-muted);
        border-radius: 10px;
        text-decoration: none;
        font-weight: 600;
    }
    .comparison-navigation a:hover,
    .comparison-navigation a.active {
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 8%,
            var(--app-surface)
        );
    }
    .comparison-navigation a:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: -2px;
    }
    .comparison-section-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
    }
    .comparison-section-title {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .comparison-section-title h2 {
        margin: 0;
        font-size: 24px;
    }
    .comparison-section-title > .p-button {
        min-width: 44px;
        min-height: 44px;
    }
    .comparison-section-heading p {
        margin: 4px 0 0;
        color: var(--app-muted);
        font-size: 14px;
    }
    .comparison-load-button {
        flex-shrink: 0;
        min-height: 44px;
    }
    .comparison-help-content {
        max-width: min(320px, 75vw);
        margin: 0;
        line-height: 1.7;
        font-size: 14px;
    }
    .comparison-context {
        padding: 16px;
        border: 1px solid var(--app-border-subtle);
        border-radius: 12px;
        background: var(--app-surface);
        font-size: 13px;
        line-height: 1.7;
        color: var(--app-muted);
    }
    .comparison-context strong {
        color: var(--app-text);
    }
    .comparison-context p {
        margin: 4px 0;
    }
    .comparison-result-count {
        margin: 20px 0 12px;
        font-size: 18px;
    }
    .product-context-tags {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
    }
    .product-context-tags a {
        color: var(--app-accent);
    }
    .explorer-filters {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin: 20px 0;
    }
    .explorer-filters label {
        display: grid;
        gap: 8px;
        flex: 1;
        min-width: 0;
    }
    .explorer-filters :deep(.p-select) {
        width: 100%;
        min-width: 0;
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
    @media (max-width: 767px) {
        .underlying-explorer {
            padding: 8px 0;
        }
        .comparison-page-heading h1 {
            font-size: 26px;
        }
        .comparison-navigation {
            margin: 20px 0;
        }
        .comparison-navigation a {
            padding: 12px;
            font-size: 13px;
        }
        .comparison-section-heading {
            align-items: stretch;
            flex-direction: column;
            gap: 12px;
        }
        .comparison-section-title h2 {
            font-size: 21px;
        }
        .comparison-load-button {
            align-self: flex-end;
        }
        .explorer-filters {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .explorer-filters label {
            min-width: 0;
        }
        .product-grid {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 400px) {
        .underlying-explorer {
            padding: 8px 0;
        }
        .product-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
