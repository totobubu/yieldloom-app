<script setup>
    import { computed, ref, watch } from 'vue';
    import { useRoute } from 'vue-router';
    import Select from 'primevue/select';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import Paginator from 'primevue/paginator';
    import Dialog from 'primevue/dialog';
    import { comparisonSections } from '../../../lib/comparison-groups.js';

    // Presentation consumes the existing directory and explicit detail queries.
    // No provider requests or financial calculations belong in this component.
    const props = defineProps({
        view: { type: String, required: true },
        theme: { type: Object, required: true },
        themeOptions: { type: Array, required: true },
        rows: { type: Array, required: true },
        total: { type: Number, required: true },
        references: { type: Array, required: true },
        options: { type: Object, required: true },
        conditions: { type: Array, required: true },
        loading: Boolean,
        pending: Boolean,
        detailed: Boolean,
        error: { type: String, default: '' },
        detailsError: { type: String, default: '' },
        dividendUnavailable: Boolean,
        page: { type: Number, required: true },
        pageSize: { type: Number, required: true },
    });
    const emit = defineEmits([
        'theme',
        'load-details',
        'reset',
        'clear-condition',
        'retry',
        'page',
    ]);
    const strategy = defineModel('strategy', { type: String, required: true });
    const direction = defineModel('direction', {
        type: String,
        required: true,
    });
    const dividend = defineModel('dividend', { type: String, required: true });
    const frequency = defineModel('frequency', {
        type: String,
        required: true,
    });
    const search = defineModel('search', { type: String, required: true });
    const reference = defineModel('reference', {
        type: String,
        required: true,
    });
    const referenceSelect = ref(null);
    const filterCard = ref(null);
    function focusFilters() {
        filterCard.value?.scrollIntoView({ block: 'center' });
        filterCard.value
            ?.querySelector('#explorer-strategy:not([aria-disabled="true"])')
            ?.focus({ preventScroll: true });
    }
    const detailSymbol = ref('');
    const detailVisible = ref(false);
    const detailRow = computed(() =>
        props.rows.find((row) => row.symbol === detailSymbol.value)
    );
    function showProductDetails(symbol) {
        detailSymbol.value = symbol;
        detailVisible.value = true;
    }
    const models = { strategy, direction, dividend, frequency };
    const fields = [
        { key: 'strategy', label: '전략' },
        { key: 'direction', label: '방향' },
        { key: 'dividend', label: '배당 여부' },
        { key: 'frequency', label: '지급 주기' },
    ];
    const route = useRoute();
    const isTheme = computed(() => props.view === 'theme');
    const analysisView = ref('matrix');
    const analysisTabs = computed(() =>
        isTheme.value
            ? [
                  {
                      id: 'matrix',
                      label: '테마 대표 종목 및 연관 ETF 매트릭스',
                  },
                  { id: 'allocation', label: '기초자산 비중 및 섹터 분배' },
                  { id: 'cadence', label: '배당 지급 주기 및 현금흐름 대조' },
              ]
            : [
                  { id: 'basis', label: '기초지수 및 자산구성' },
                  { id: 'matrix', label: '유사 상품군 매트릭스' },
                  { id: 'allocation', label: '테마 및 섹터 분배' },
              ]
    );
    watch(
        () => props.view,
        () => {
            analysisView.value = 'matrix';
        }
    );
    const title = computed(() =>
        isTheme.value ? '테마별 배당 ETF 및 구성종목 비교' : '유사 ETF 비교'
    );
    const currencies = computed(() => [
        ...new Set(props.rows.map((row) => row.currency || '통화 미확인')),
    ]);
    const currencyLabel = computed(() =>
        currencies.value.length
            ? `표시 통화: ${currencies.value.join(' · ')} · 환산 없음`
            : '종목별 원문 통화 · 환산 없음'
    );
    const conditionSummary = computed(() => {
        const active = props.conditions.filter((condition) => condition.active);
        return `${active.length ? active.map((condition) => condition.value).join(' · ') : '전체 조건'} · ${props.total}종`;
    });
    const conditionValue = (key) =>
        props.options[key]?.find((option) => option.value === models[key].value)
            ?.label ||
        models[key].value ||
        '미확인';
    const selection = ref([]);
    // A changed result page starts a new tray; metric responses do not reset it.
    watch(
        () =>
            `${props.view}:${props.theme.value}:${props.rows.map((row) => row.symbol).join(',')}`,
        () => {
            selection.value = props.rows.slice(0, 3).map((row) => row.symbol);
        },
        { immediate: true }
    );
    const selectedRows = computed(() =>
        props.rows.filter((row) => selection.value.includes(row.symbol))
    );
    function toggleSelection(symbol) {
        if (selection.value.includes(symbol))
            selection.value = selection.value.filter(
                (value) => value !== symbol
            );
        else if (selection.value.length < 3)
            selection.value = [...selection.value, symbol];
    }
    const number = (value) =>
        value == null || !Number.isFinite(Number(value))
            ? '미확인'
            : Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: 4,
              });
    const detailNumber = (value, row) =>
        value != null || row?.detailsRequested || props.detailed
            ? number(value)
            : props.pending
              ? '조회 중'
              : '조회 전';
    const fee = (row) =>
        row.kind === 'underlying-stock'
            ? '— (개별주식 비적용)'
            : `${detailNumber(row.expenseRatio, row)}${row.expenseInfo ? '%' : ''}`;
    const dividendAmount = (row) =>
        row.dividendStatus === 'none'
            ? '무배당'
            : row.dividend == null
              ? '미확인'
              : `${number(row.dividend)} ${row.currency || '통화 미확인'} / 주`;
    const dividendStatus = (row) =>
        ({
            available: '연속성 미검증',
            none: '무배당',
            unavailable: '자료 미확인',
        })[row.dividendStatus] || '자료 미확인';
    const basis = (row) =>
        isTheme.value
            ? row.themeReason
            : row.underlying ||
              (row.kind === 'underlying-stock' ? row.symbol : '미확인');
    const feeSummary = computed(() => {
        const available = props.rows.filter((row) => row.expenseInfo);
        return available.length
            ? available
                  .map(
                      (row) =>
                          `${row.symbol} ${number(row.expenseRatio)}% (${row.expenseInfo.asOfDate || '기준일 미확인'})`
                  )
                  .join(' · ')
            : '운용보수는 명시적으로 지표를 조회한 뒤 자료 기준일과 함께 확인합니다. 개별 주식에는 ETF 운용보수를 적용하지 않습니다.';
    });
    const cycleSummary = computed(() =>
        props.rows.length
            ? props.rows
                  .map((row) => `${row.symbol}: ${row.frequency || '미확인'}`)
                  .join(' · ')
            : '조건에 맞는 종목이 없습니다.'
    );
    const matrixFields = computed(() => [
        ...(isTheme.value
            ? [{ key: 'basis', label: '기초자산 분류', value: basis }]
            : []),
        {
            key: 'fee',
            label: isTheme.value ? '총보수율 (TER)' : '운용보수 (연)',
            value: fee,
        },
        {
            key: 'frequency',
            label: '분배 / 배당 주기',
            value: (row) => row.frequency || '미확인',
        },
        {
            key: 'dividend',
            label: '최근 주당 배당(분배)금',
            value: dividendAmount,
        },
        {
            key: 'yield',
            label: '추정 분배율 (세전 연환산)',
            value: () => '산출 보류 · 분배율 계산 자료 미제공',
        },
        { key: 'history', label: '배당 이력 연속성', value: dividendStatus },
    ]);
    const actionStatus = ref('');
    const snapshot = () => ({
        version: 1,
        view: props.view,
        theme: isTheme.value ? props.theme.value : undefined,
        conditions: {
            strategy: strategy.value,
            direction: direction.value,
            dividend: dividend.value,
            frequency: frequency.value,
            search: search.value,
        },
        symbols: [...selection.value],
    });
    async function share() {
        try {
            const url = new URL(window.location.href);
            // Route links contain the basis/theme. Include local filters as text,
            // without implying the URL restores unsupported query parameters.
            await navigator.clipboard.writeText(
                `${title.value}\n${url.href}\n${JSON.stringify(snapshot(), null, 2)}`
            );
            actionStatus.value =
                '화면 링크와 현재 비교 조건을 복사했습니다. 링크는 기본 화면을 엽니다.';
        } catch {
            actionStatus.value =
                '복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.';
        }
    }
    function save() {
        const url = URL.createObjectURL(
            new Blob([JSON.stringify(snapshot(), null, 2)], {
                type: 'application/json',
            })
        );
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `comparison-${props.view}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        actionStatus.value =
            '현재 비교 조건을 JSON으로 저장했습니다. 자동 불러오기는 지원하지 않습니다.';
    }
</script>

<template>
    <div
        class="responsive-comparison"
        :class="{ 'theme-comparison': isTheme }"
        :data-responsive-view="view">
        <header class="responsive-heading">
            <div v-if="isTheme" class="heading-badges">
                <span>종목 목록 기준</span><span>{{ currencyLabel }}</span>
            </div>
            <div class="responsive-title-row">
                <div>
                    <h1 id="comparison-title">{{ title }}</h1>
                    <p>
                        {{
                            isTheme
                                ? '테마를 탐색하고 구성 본주와 관련 ETF의 운용 지표 및 배당 성격을 대조합니다.'
                                : '전략 및 배당 주기별 상품군을 탐색하고 운용 지표와 보수를 대조합니다.'
                        }}
                    </p>
                </div>
                <div class="heading-actions">
                    <Button
                        label="공유"
                        icon="pi pi-share-alt"
                        severity="secondary"
                        outlined
                        @click="share" />
                    <Button
                        label="저장"
                        icon="pi pi-bookmark"
                        severity="secondary"
                        outlined
                        @click="save" />
                </div>
            </div>
            <p v-if="actionStatus" role="status" class="action-status">
                {{ actionStatus }}
            </p>
        </header>
        <Message v-if="error" severity="error" role="alert"
            >{{ error }} <Button label="다시 시도" @click="emit('retry')"
        /></Message>
        <p v-if="loading" role="status">공용 종목 목록을 불러오고 있습니다.</p>

        <section
            ref="filterCard"
            class="responsive-filter-card"
            aria-label="단계적 비교 필터">
            <label v-if="isTheme" class="theme-choice" for="explorer-theme">
                <span id="explorer-theme-label"
                    ><i class="pi pi-search" aria-hidden="true" /> 테마
                    검색</span
                >
                <Select
                    :model-value="theme.value"
                    input-id="explorer-theme"
                    aria-labelledby="explorer-theme-label"
                    :options="themeOptions"
                    option-group-label="label"
                    option-group-children="items"
                    option-disabled="disabled"
                    option-label="displayLabel"
                    option-value="value"
                    filter
                    @update:model-value="emit('theme', $event)">
                    <template #dropdownicon
                        ><span
                            class="comparison-filter-arrow"
                            aria-hidden="true"
                            >keyboard_arrow_down</span
                        ></template
                    >
                </Select>
            </label>
            <div v-else class="responsive-filter-heading">
                <h2>종속 필터 설정</h2>
                <span>{{ currencyLabel }}</span>
            </div>
            <div class="explorer-filters">
                <label
                    v-for="(field, index) in fields"
                    :key="field.key"
                    :for="`explorer-${field.key}`">
                    <span :id="`explorer-${field.key}-label`"
                        >{{ index + 1 }}. {{ field.label }}</span
                    >
                    <Select
                        :model-value="models[field.key].value"
                        :input-id="`explorer-${field.key}`"
                        :aria-labelledby="`explorer-${field.key}-label`"
                        :options="options[field.key]"
                        :placeholder="options[field.key]?.[0]?.label"
                        option-label="label"
                        option-value="value"
                        :disabled="loading || !options[field.key]?.length"
                        @update:model-value="models[field.key].value = $event">
                        <template #dropdownicon
                            ><span
                                class="comparison-filter-arrow"
                                aria-hidden="true"
                                >keyboard_arrow_down</span
                            ></template
                        >
                    </Select>
                </label>
            </div>
            <div class="filter-search-row">
                <label
                    v-if="!isTheme"
                    class="product-search"
                    for="comparison-product-search"
                    ><span>티커 및 상품명 검색</span
                    ><span class="search-input"
                        ><i class="pi pi-search" aria-hidden="true" /><input
                            id="comparison-product-search"
                            v-model="search"
                            type="search"
                            placeholder="티커 및 상품명 검색" /></span
                ></label>
                <p>
                    ※ 상위 전략·방향 변경 시 하위 조건이 자동 재설정되는 종속
                    필터입니다.
                </p>
            </div>
            <details class="filter-details">
                <summary>현재 조건 및 지표 조회</summary>
                <div
                    class="comparison-applied-conditions"
                    aria-label="적용된 비교 조건">
                    <span>적용된 조건:</span
                    ><span
                        v-for="condition in conditions"
                        :key="condition.key"
                        class="comparison-condition-chip"
                        ><span
                            >{{ condition.label }}: {{ condition.value }}</span
                        ><Button
                            v-if="condition.active"
                            :aria-label="`${condition.label} 조건 해제`"
                            icon="pi pi-times"
                            text
                            rounded
                            size="small"
                            @click="emit('clear-condition', condition.key)"
                    /></span>
                </div>
                <nav
                    class="comparison-route-navigation"
                    aria-label="종목 비교 하위 메뉴">
                    <router-link
                        v-for="item in comparisonSections"
                        :key="item.value"
                        :to="{
                            name: 'security-compare',
                            query: { ...route.query, view: item.value },
                        }"
                        :class="{ active: view === item.value }"
                        :aria-current="view === item.value ? 'page' : undefined"
                        >{{ item.label }}</router-link
                    >
                </nav>
                <Button
                    label="필터 전체 초기화"
                    severity="secondary"
                    text
                    @click="emit('reset')" />
                <div
                    v-if="!isTheme"
                    class="reference-choice similar-reference-card">
                    <strong>{{ reference || '선택 대기' }}</strong>
                    <label for="comparison-reference"
                        >비교 기준 ETF (필터 범위와 독립적인 참고 종목)</label
                    ><select
                        id="comparison-reference"
                        ref="referenceSelect"
                        v-model="reference"
                        :disabled="!references.length">
                        <option
                            v-for="row in references"
                            :key="row.symbol"
                            :value="row.symbol">
                            {{ row.symbol }} ·
                            {{ row.koName || row.longName || row.symbol }}
                        </option>
                    </select>
                    <Button
                        label="변경"
                        severity="secondary"
                        outlined
                        @click="referenceSelect?.focus()" />
                </div>
                <Button
                    class="comparison-load-button"
                    label="수익률·수수료·가격 하락 조회"
                    icon="pi pi-search"
                    :loading="pending"
                    :disabled="loading || !rows.length"
                    @click="emit('load-details')" />
                <p>
                    현재 페이지의 자료를 명시적으로 조회합니다. 동일
                    기준일·기간일 때만 지표를 비교하며 가격 하락은 배당 제외
                    기준입니다.
                </p>
            </details>
        </section>

        <section v-if="isTheme" class="responsive-theme-context">
            <div class="theme-badges">
                <span>규칙 기반 테마 분류</span
                ><span>공식 편입 정보 미검증</span>
            </div>
            <h2>{{ theme.label }} 테마</h2>
            <p>{{ theme.description }}</p>
            <p class="theme-warning">
                <i class="pi pi-info-circle" aria-hidden="true" />등록된 구성
                주식·기초자산 목록·상품명 키워드로 분류합니다. 실제 지수
                편입이나 보유 비중을 보증하지 않습니다.
            </p>
            <div class="theme-members">
                <span>대표 기초자산 및 연관 ETF:</span
                ><span
                    v-for="row in rows.slice(0, 3)"
                    :key="row.symbol"
                    class="member-chip"
                    >{{ row.symbol }} ({{
                        row.currency || '통화 미확인'
                    }})</span
                >
            </div>
        </section>
        <nav class="responsive-navigation" aria-label="비교 분석 뷰">
            <button
                v-for="tab in analysisTabs"
                :key="tab.id"
                type="button"
                :class="{ active: analysisView === tab.id }"
                :aria-pressed="analysisView === tab.id"
                @click="analysisView = tab.id">
                {{ tab.label }}
            </button>
        </nav>
        <section v-if="analysisView !== 'matrix'" class="analysis-panel">
            <h2>
                {{ analysisTabs.find((tab) => tab.id === analysisView)?.label }}
            </h2>
            <Message
                v-if="analysisView === 'allocation'"
                severity="info"
                :closable="false"
                >현재 비교 자료에는 종목별 보유 비중·섹터 비중이 제공되지
                않습니다. 이름·기초자산 연결을 실제 편입 비중으로 해석하지
                않습니다.</Message
            ><template v-else
                ><p>
                    {{
                        analysisView === 'cadence'
                            ? '확인된 지급 주기와 최근 배당만 표시합니다. 지급일별 현금흐름 예측 자료는 제공되지 않습니다.'
                            : '확인된 기초자산 연결과 분류 근거를 표시합니다. 실제 자산 보유 비중이나 지수 구성 비중을 뜻하지 않습니다.'
                    }}
                </p>
                <div
                    class="matrix-scroll"
                    tabindex="0"
                    role="region"
                    :aria-label="
                        analysisView === 'cadence'
                            ? '배당 주기 및 최근 기록'
                            : '기초자산 연결 정보'
                    ">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">종목</th>
                                <th scope="col">
                                    {{
                                        analysisView === 'cadence'
                                            ? '배당 주기'
                                            : '기초자산·분류 근거'
                                    }}
                                </th>
                                <th scope="col">
                                    {{
                                        analysisView === 'cadence'
                                            ? '최근 주당 배당(분배)금'
                                            : '전략·방향'
                                    }}
                                </th>
                                <th scope="col">
                                    {{
                                        analysisView === 'cadence'
                                            ? '배당락일'
                                            : '자료 상태'
                                    }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in rows" :key="row.symbol">
                                <th scope="row">{{ row.symbol }}</th>
                                <td>
                                    {{
                                        analysisView === 'cadence'
                                            ? row.frequency || '미확인'
                                            : basis(row)
                                    }}
                                </td>
                                <td>
                                    {{
                                        analysisView === 'cadence'
                                            ? dividendAmount(row)
                                            : `${row.strategyLabel} · ${row.directionLabel}`
                                    }}
                                </td>
                                <td>
                                    {{
                                        analysisView === 'cadence'
                                            ? row.exDate || '미확인'
                                            : row.verified
                                              ? '공식 연결 검증'
                                              : '분류·연결 재검증 대기'
                                    }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div></template
            >
        </section>

        <div v-if="isTheme" class="currency-notice">
            <i class="pi pi-sliders-h" aria-hidden="true" />
            <div>
                <strong>통화 독립 표기 원칙</strong>
                <p>
                    {{ currencyLabel }} · 서로 다른 통화의 금액을 합산하지
                    않습니다.
                </p>
            </div>
        </div>
        <Message v-if="dividendUnavailable" severity="warn"
            >배당 자료를 불러오지 못했습니다. 연결 정보만 확인할 수
            있습니다.</Message
        >
        <Message v-if="detailsError" severity="warn">{{
            detailsError
        }}</Message>

        <template v-if="analysisView === 'matrix'">
            <div class="responsive-results-heading comparison-result-count">
                <h2>
                    <i v-if="!isTheme" class="pi pi-clone" aria-hidden="true" />
                    {{ isTheme ? '지표별 상세 대조표' : '비교 대상' }}
                    <span>{{ total }}개 항목</span>
                </h2>
                <span>자료 기준일은 항목별 확인</span>
            </div>
            <section
                v-if="rows.length"
                class="responsive-matrix"
                aria-label="태블릿 비교표">
                <div class="matrix-scroll-cue">
                    <span
                        ><i class="pi pi-arrows-h" aria-hidden="true" /> 좌우로
                        스크롤하여 전체 비교 항목을 확인하세요</span
                    ><span>현재 페이지 {{ rows.length }}개</span>
                </div>
                <div
                    class="matrix-scroll"
                    tabindex="0"
                    role="region"
                    aria-label="종목 비교 결과표">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">비교 지표</th>
                                <th
                                    v-for="row in rows"
                                    :key="row.symbol"
                                    scope="col"
                                    class="matrix-product">
                                    <div class="ticker-line">
                                        <span class="currency-chip">{{
                                            row.currency || '통화 미확인'
                                        }}</span
                                        ><router-link
                                            :to="`/stock/${row.symbol}`"
                                            >{{ row.symbol }}</router-link
                                        >
                                    </div>
                                    <strong>{{
                                        row.koName || row.longName || row.symbol
                                    }}</strong
                                    ><label class="select-product"
                                        ><input
                                            type="checkbox"
                                            :checked="
                                                selection.includes(row.symbol)
                                            "
                                            :disabled="
                                                !selection.includes(
                                                    row.symbol
                                                ) && selection.length >= 3
                                            "
                                            :aria-label="`${row.symbol} 비교 트레이 선택`"
                                            @change="
                                                toggleSelection(row.symbol)
                                            " />
                                        비교 트레이</label
                                    >
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="field in matrixFields" :key="field.key">
                                <th scope="row">{{ field.label }}</th>
                                <td
                                    v-for="row in rows"
                                    :key="row.symbol"
                                    :class="`matrix-${field.key}`">
                                    {{ field.value(row)
                                    }}<small
                                        v-if="
                                            field.key === 'fee' &&
                                            row.expenseInfo
                                        "
                                        >기준일
                                        {{
                                            row.expenseInfo.asOfDate || '미확인'
                                        }}</small
                                    ><small v-if="field.key === 'dividend'">{{
                                        row.exDate
                                            ? `배당락일 ${row.exDate}`
                                            : '배당락일 미확인'
                                    }}</small>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="matrix-note">
                    종목별 원문 통화와 자료 기준일을 확인하세요. 최근 배당금은
                    연간 분배율이나 지급 연속성을 뜻하지 않습니다.
                </p>
            </section>

            <div
                v-if="rows.length"
                class="product-grid responsive-product-grid">
                <article
                    v-for="row in rows"
                    :key="row.symbol"
                    class="responsive-product-card">
                    <header>
                        <div class="product-identity">
                            <div class="ticker-line">
                                <span class="currency-chip">{{
                                    row.currency || '통화 미확인'
                                }}</span
                                ><router-link :to="`/stock/${row.symbol}`">{{
                                    row.symbol
                                }}</router-link>
                            </div>
                            <h3>
                                <button
                                    type="button"
                                    class="product-detail-trigger"
                                    :aria-label="`${row.symbol} 지표·출처 확인`"
                                    @click="showProductDetails(row.symbol)">
                                    {{
                                        row.koName || row.longName || row.symbol
                                    }}
                                </button>
                            </h3>
                        </div>
                        <label class="select-product"
                            ><span
                                v-if="isTheme"
                                class="product-kind-badge"
                                :class="{
                                    'kind-stock':
                                        row.kind === 'underlying-stock',
                                }"
                                >{{
                                    row.kind === 'underlying-stock'
                                        ? '대표 기초자산'
                                        : '관련 ETF'
                                }}</span
                            ><input
                                type="checkbox"
                                :checked="selection.includes(row.symbol)"
                                :disabled="
                                    !selection.includes(row.symbol) &&
                                    selection.length >= 3
                                "
                                :aria-label="`${row.symbol} 비교 트레이 선택`"
                                @change="toggleSelection(row.symbol)" /><span
                                class="sr-only"
                                >비교 트레이</span
                            ></label
                        >
                    </header>
                    <div v-if="!isTheme" class="primary-product-metrics">
                        <div>
                            <span>운용보수(연)</span
                            ><strong>{{ fee(row) }}</strong
                            ><small v-if="row.expenseInfo"
                                >기준일
                                {{
                                    row.expenseInfo.asOfDate || '미확인'
                                }}</small
                            >
                        </div>
                        <div>
                            <span>추정 분배율 (세전)</span>
                            <p>산출 보류 · 분배율 계산 자료 미제공</p>
                        </div>
                    </div>
                    <dl class="responsive-product-facts">
                        <div v-if="isTheme">
                            <dt>기초자산 분류</dt>
                            <dd>{{ basis(row) }}</dd>
                        </div>
                        <div v-if="isTheme">
                            <dt>총보수율 (TER)</dt>
                            <dd>
                                {{ fee(row)
                                }}<small v-if="row.expenseInfo"
                                    >기준일
                                    {{
                                        row.expenseInfo.asOfDate || '미확인'
                                    }}</small
                                >
                            </dd>
                        </div>
                        <div>
                            <dt>분배 / 배당 주기</dt>
                            <dd>{{ row.frequency || '미확인' }}</dd>
                        </div>
                        <div class="product-dividend">
                            <dt>최근 주당 배당(분배)금</dt>
                            <dd>
                                {{ dividendAmount(row) }}
                            </dd>
                        </div>
                        <div v-if="isTheme">
                            <dt>추정 분배율 (세전 연환산)</dt>
                            <dd>산출 보류 · 분배율 계산 자료 미제공</dd>
                        </div>
                        <div>
                            <dt>배당 이력 연속성</dt>
                            <dd>{{ dividendStatus(row) }}</dd>
                        </div>
                        <div v-if="!isTheme">
                            <dt>기초자산</dt>
                            <dd>{{ basis(row) }}</dd>
                        </div>
                    </dl>
                </article>
            </div>
            <details v-if="rows.length" class="tablet-extra">
                <summary>분류·수익률·자료 출처 상세</summary>
                <div
                    class="matrix-scroll"
                    tabindex="0"
                    role="region"
                    aria-label="추가 지표 비교표">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">종목</th>
                                <th scope="col">분류 · 방향</th>
                                <th scope="col">1년 총수익률</th>
                                <th scope="col">기간 가격 변화 / 최대 하락</th>
                                <th scope="col">자료 출처</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in rows" :key="row.symbol">
                                <th scope="row">{{ row.symbol }}</th>
                                <td>
                                    {{ basis(row) }} · {{ row.strategyLabel }} ·
                                    {{ row.directionLabel }}
                                </td>
                                <td>
                                    {{ detailNumber(row.totalReturn, row)
                                    }}{{ row.totalReturnInfo ? '%' : ''
                                    }}<small v-if="row.totalReturnInfo"
                                        >{{
                                            row.totalReturnInfo.estimated
                                                ? '제공처 조정 종가 추정 · '
                                                : ''
                                        }}{{
                                            row.totalReturnInfo.startDate ||
                                            '시작일 미확인'
                                        }}
                                        ~
                                        {{
                                            row.totalReturnInfo.asOfDate ||
                                            '기준일 미확인'
                                        }}</small
                                    >
                                </td>
                                <td>
                                    <template v-if="row.risk?.startDate"
                                        >{{ number(row.risk.priceReturn) }}% /
                                        {{
                                            number(row.risk.maxDrawdown)
                                        }}%<small
                                            >{{ row.risk.startDate }} ~
                                            {{ row.risk.endDate }} · 배당
                                            제외</small
                                        ></template
                                    ><template v-else>{{
                                        row.risk?.unavailable ||
                                        (pending
                                            ? '조회 중'
                                            : detailed
                                              ? '미확인'
                                              : '조회 전')
                                    }}</template>
                                </td>
                                <td>
                                    <span>{{
                                        row.kind === 'underlying-stock'
                                            ? '본주'
                                            : row.verified
                                              ? '공식 연결 검증'
                                              : '기존 연결·재검증 대기'
                                    }}</span
                                    ><a
                                        v-if="row.source?.url"
                                        :href="row.source.url"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        >공식 연결 근거</a
                                    ><router-link :to="`/stock/${row.symbol}`"
                                        >종목 상세</router-link
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </details>
            <Paginator
                v-if="total > pageSize"
                :first="(page - 1) * pageSize"
                :rows="pageSize"
                :total-records="total"
                :page-link-size="3"
                template="PrevPageLink PageLinks NextPageLink"
                aria-label="종목 비교 결과 페이지"
                @page="emit('page', $event.page + 1)" />
            <section
                v-if="!loading && !error && !rows.length"
                class="explorer-empty"
                role="status">
                <h2>조건에 맞는 종목이 없습니다</h2>
                <p>필터 조건을 줄이거나 전체 조건으로 다시 확인해 보세요.</p>
                <Button
                    label="필터 초기화"
                    severity="secondary"
                    outlined
                    @click="emit('reset')" />
            </section>
        </template>
        <section class="responsive-support" aria-label="비교 인사이트와 조건">
            <aside
                class="responsive-insights"
                aria-labelledby="comparison-insights-title">
                <h2 id="comparison-insights-title">
                    <i class="pi pi-chart-line" aria-hidden="true" />
                    {{ isTheme ? '테마 ' : '' }}비교 분석 인사이트
                </h2>
                <div class="insight-cards">
                    <article>
                        <i class="pi pi-percentage" aria-hidden="true" />
                        <div>
                            <h3>운용보수 대조</h3>
                            <p>{{ feeSummary }}</p>
                        </div>
                    </article>
                    <article>
                        <i class="pi pi-calendar" aria-hidden="true" />
                        <div>
                            <h3>배당 주기 점검</h3>
                            <p>{{ cycleSummary }}</p>
                        </div>
                    </article>
                    <article>
                        <i class="pi pi-chart-bar" aria-hidden="true" />
                        <div>
                            <h3>분배율 산출 안내</h3>
                            <p>
                                현재 비교 자료에 검증된 연환산 분배율이 제공되지
                                않아 산출을 보류합니다. 최근 주당 배당금으로
                                연간 지급액을 가정하지 않습니다.
                            </p>
                        </div>
                    </article>
                </div>
            </aside>
            <div class="comparison-support-details">
                <div class="comparison-warning">
                    <i class="pi pi-info-circle" aria-hidden="true" />
                    <div>
                        <h3>비교 자료 주의사항</h3>
                        <p>
                            자료 기준일과 통화·기간을 함께 확인하세요. 동일한
                            위험이나 미래 수익률을 보장하지 않으며 투자 추천을
                            의미하지 않습니다.
                        </p>
                    </div>
                </div>
                <section
                    class="comparison-filter-context"
                    :aria-label="
                        isTheme ? '설정된 비교 조건' : '대조군 필터 조건'
                    ">
                    <template v-if="isTheme">
                        <div class="context-heading">
                            <h3>설정된 비교 조건</h3>
                            <span>4개 파라미터</span>
                        </div>
                        <dl>
                            <div>
                                <dt>테마군:</dt>
                                <dd>{{ theme.label }}</dd>
                            </div>
                            <div>
                                <dt>적용 통화:</dt>
                                <dd>
                                    {{ currencies.join(' · ') || '미확인' }}
                                    (환산 없음)
                                </dd>
                            </div>
                            <div>
                                <dt>운용 전략:</dt>
                                <dd>{{ conditionValue('strategy') }}</dd>
                            </div>
                            <div>
                                <dt>지급 주기:</dt>
                                <dd>{{ conditionValue('frequency') }}</dd>
                            </div>
                        </dl>
                    </template>
                    <div v-else class="context-summary">
                        <span>대조군 필터 조건</span
                        ><strong>{{ conditionSummary }}</strong>
                    </div>
                    <Button
                        :label="isTheme ? '필터 조건 변경하기' : '조건 변경'"
                        :icon="isTheme ? 'pi pi-filter' : undefined"
                        severity="secondary"
                        outlined
                        aria-controls="explorer-strategy"
                        title="화면 위 비교 필터로 이동"
                        :disabled="loading"
                        @click="focusFilters" />
                </section>
            </div>
        </section>
        <section class="comparison-tray" aria-label="비교 트레이">
            <div class="tray-heading">
                <h2>
                    비교 트레이 <span>{{ selection.length }}/3</span>
                </h2>
                <Button
                    label="선택 초기화"
                    icon="pi pi-refresh"
                    text
                    severity="secondary"
                    @click="selection = []" />
            </div>
            <div class="tray-items">
                <span v-for="row in selectedRows" :key="row.symbol"
                    ><b>{{ row.currency || '통화 미확인' }}</b> {{ row.symbol
                    }}<Button
                        :aria-label="`${row.symbol} 비교 트레이 제거`"
                        icon="pi pi-times"
                        text
                        rounded
                        @click="toggleSelection(row.symbol)"
                /></span>
                <p v-if="!selection.length">
                    종목의 선택란을 눌러 최대 3개를 담으세요.
                </p>
            </div>
            <Button
                class="tray-compare-button"
                :label="`선택 항목 정밀 비교 실행 (${selection.length}/3)`"
                icon="pi pi-chart-bar"
                :loading="pending"
                :disabled="loading || !selection.length"
                @click="emit('load-details', [...selection])" />
            <p>
                현재 페이지의 선택 항목만 조회합니다. 결과는 각 종목의 상세
                지표에서 확인하세요.
            </p>
        </section>
        <Dialog
            v-model:visible="detailVisible"
            modal
            :header="`${detailSymbol} 지표·출처 확인`"
            class="comparison-detail-dialog"
            :style="{ width: 'min(640px, calc(100vw - 32px))' }"
            ><template v-if="detailRow"
                ><p>
                    자료별 기준일과 기간을 확인하세요. 최근 주당 배당금은 연간
                    지급액이나 지급 연속성을 뜻하지 않습니다.
                </p>
                <dl class="product-fields">
                    <div>
                        <dt>최근 주당 배당(분배)금</dt>
                        <dd>{{ dividendAmount(detailRow) }}</dd>
                    </div>
                    <div>
                        <dt>배당락일</dt>
                        <dd>{{ detailRow.exDate || '미확인' }}</dd>
                    </div>
                    <div>
                        <dt>배당 이력</dt>
                        <dd>
                            {{
                                detailRow.dividendStatus === 'available'
                                    ? '배당 이력 있음 · 연속성 미검증'
                                    : dividendStatus(detailRow)
                            }}
                        </dd>
                    </div>
                    <div>
                        <dt>운용보수 기준일</dt>
                        <dd>
                            {{ detailRow.expenseInfo?.asOfDate || '미확인' }}
                        </dd>
                    </div>
                </dl>
                <dl class="product-fields">
                    <div>
                        <dt>
                            {{ isTheme ? '테마 분류 근거' : '기초자산' }}
                        </dt>
                        <dd>{{ basis(detailRow) }}</dd>
                    </div>
                    <div>
                        <dt>전략 · 방향</dt>
                        <dd>
                            {{
                                detailRow.kind === 'underlying-stock'
                                    ? '직접 보유 주식'
                                    : `${detailRow.strategyLabel} · ${detailRow.directionLabel} · ${detailRow.leverage == null ? '배수 미확인' : detailRow.leverage + '배'}`
                            }}
                        </dd>
                    </div>
                    <div>
                        <dt>운용사</dt>
                        <dd>
                            {{
                                detailRow.company ||
                                (detailRow.kind === 'underlying-stock'
                                    ? '일반 주식'
                                    : '미확인')
                            }}
                        </dd>
                    </div>
                </dl>
                <dl class="product-metrics">
                    <div>
                        <dt>1년 총수익률</dt>
                        <dd>
                            {{ detailNumber(detailRow.totalReturn, detailRow)
                            }}{{ detailRow.totalReturnInfo ? '%' : ''
                            }}<small v-if="detailRow.totalReturnInfo"
                                >{{
                                    detailRow.totalReturnInfo.estimated
                                        ? '제공처 조정 종가 추정 · '
                                        : ''
                                }}{{
                                    detailRow.totalReturnInfo.startDate ||
                                    '시작일 미확인'
                                }}
                                ~
                                {{
                                    detailRow.totalReturnInfo.asOfDate ||
                                    '기준일 미확인'
                                }}</small
                            >
                        </dd>
                    </div>
                    <div>
                        <dt>운용 보수</dt>
                        <dd>{{ fee(detailRow) }}</dd>
                    </div>
                    <div>
                        <dt>기간 가격 변화 / 최대 하락</dt>
                        <dd v-if="detailRow.risk?.startDate">
                            {{ number(detailRow.risk.priceReturn) }}% /
                            {{ number(detailRow.risk.maxDrawdown) }}%<small
                                >{{ detailRow.risk.startDate }} ~
                                {{ detailRow.risk.endDate }} · 배당 제외</small
                            >
                        </dd>
                        <dd v-else>
                            {{
                                detailRow.risk?.unavailable ||
                                (pending
                                    ? '조회 중'
                                    : detailed
                                      ? '미확인'
                                      : '조회 전')
                            }}
                        </dd>
                    </div>
                </dl>
                <footer class="product-meta">
                    <span>{{
                        detailRow.kind === 'underlying-stock'
                            ? '본주'
                            : detailRow.verified
                              ? '공식 연결 검증'
                              : '기존 연결·재검증 대기'
                    }}</span
                    ><a
                        v-if="detailRow.source?.url"
                        :href="detailRow.source.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        >공식 연결 근거</a
                    ><router-link :to="`/stock/${detailRow.symbol}`"
                        >종목 상세</router-link
                    >
                </footer>
                <Button
                    label="이 종목 지표 조회"
                    icon="pi pi-search"
                    :loading="pending"
                    @click="
                        emit('load-details', [detailRow.symbol])
                    " /></template
        ></Dialog>
    </div>
</template>

<style scoped>
    @font-face {
        font-family: 'Comparison Material Symbols';
        src: url('../../assets/fonts/MaterialSymbolsOutlined.ttf')
            format('truetype');
        font-weight: 400;
        font-style: normal;
        font-display: block;
    }
    .responsive-comparison :deep(.pi::before) {
        font-family: 'Comparison Material Symbols';
        content: var(--comparison-symbol);
        font-weight: 400;
        font-style: normal;
        font-feature-settings: 'liga';
        -webkit-font-smoothing: antialiased;
    }
    .responsive-comparison :deep(.pi-share-alt) {
        --comparison-symbol: 'share';
    }
    .responsive-comparison :deep(.pi-bookmark) {
        --comparison-symbol: 'bookmark_border';
    }
    .responsive-comparison :deep(.pi-search) {
        --comparison-symbol: 'search';
    }
    .responsive-comparison :deep(.pi-times) {
        --comparison-symbol: 'close';
    }
    .responsive-comparison :deep(.pi-refresh) {
        --comparison-symbol: 'restart_alt';
    }
    .responsive-comparison :deep(.pi-arrows-h) {
        --comparison-symbol: 'swipe';
    }
    .responsive-comparison :deep(.pi-chart-line) {
        --comparison-symbol: 'insights';
    }
    .responsive-comparison :deep(.pi-chart-bar) {
        --comparison-symbol: 'analytics';
    }
    .responsive-comparison :deep(.pi-percentage) {
        --comparison-symbol: 'percent';
    }
    .responsive-comparison :deep(.pi-calendar) {
        --comparison-symbol: 'calendar_today';
    }
    .responsive-comparison :deep(.pi-filter) {
        --comparison-symbol: 'filter_alt';
    }
    .responsive-comparison :deep(.pi-info-circle) {
        --comparison-symbol: 'info';
    }
    .responsive-comparison :deep(.pi-sliders-h) {
        --comparison-symbol: 'balance';
    }
    .responsive-comparison :deep(.pi-clone) {
        --comparison-symbol: 'layers';
    }
    .tray-compare-button :deep(.pi-chart-bar) {
        --comparison-symbol: 'compare_arrows';
    }
    .product-detail-trigger {
        display: block;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        text-align: left;
        font: inherit;
        cursor: pointer;
    }
    .product-detail-trigger:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }

    @font-face {
        font-family: 'Comparison Pretendard';
        src: url('../../assets/fonts/PretendardVariable.woff2') format('woff2');
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
    }
    @font-face {
        font-family: 'Comparison Inter';
        src: url('../../assets/fonts/Inter-latin-variable.woff2')
            format('woff2');
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
    }
    .responsive-comparison {
        /* Exact source palette is scoped to the two new comparison layouts. */
        --app-text: light-dark(#191c1e, #f1f5f9);
        --app-muted: light-dark(#3e4947, #b3c0d1);
        --app-border: light-dark(#dee4e3, #35445b);
        --app-border-subtle: light-dark(#e0e3e5, #2a3a51);
        --app-accent: light-dark(#005f55, #7dd6c8);
        --comparison-heading: light-dark(#382418, #f1f5f9);
        width: 100%;
        max-width: 834px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
        color: var(--app-text);
        font-size: 14px;
        line-height: 20px;
        font-family:
            'Comparison Pretendard',
            'Comparison Inter',
            -apple-system,
            BlinkMacSystemFont,
            'Apple SD Gothic Neo',
            sans-serif;
    }
    h1,
    h2,
    h3,
    p {
        margin: 0;
    }
    h1 {
        color: var(--comparison-heading);
        font-size: 30px;
        line-height: 38px;
        letter-spacing: -0.015em;
    }
    h2 {
        color: var(--comparison-heading);
        font-size: 20px;
        line-height: 28px;
    }
    h3 {
        color: var(--comparison-heading);
        font-size: 14px;
        line-height: 20px;
    }
    button,
    input,
    select {
        font: inherit;
    }
    a {
        color: var(--app-accent);
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }
    a:focus-visible,
    summary:focus-visible,
    .matrix-scroll:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    small {
        display: block;
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
        margin-top: 4px;
    }
    .responsive-heading {
        padding-top: 8px;
    }
    .responsive-title-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
    }
    .responsive-title-row > div:first-child {
        min-width: 0;
    }
    .responsive-title-row p {
        margin-top: 6px;
        color: var(--app-muted);
    }
    .heading-actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
    }
    .heading-actions :deep(.p-button) {
        min-height: 44px;
        padding: 0 12px;
        border-radius: 8px;
        font-size: 13px;
        white-space: nowrap;
    }
    .action-status {
        margin-top: 8px;
        color: var(--app-muted);
    }
    .heading-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
    }
    .heading-badges span,
    .theme-badges span {
        font-size: 11px;
        line-height: 16px;
        padding: 2px 10px;
        border: 1px solid var(--app-border);
        border-radius: 999px;
        background: var(--app-surface-muted);
        color: var(--app-muted);
    }
    .heading-badges span:last-child {
        color: var(--app-accent);
        background: var(--app-accent-light);
    }
    .responsive-filter-card {
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .responsive-filter-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .responsive-filter-heading h2 {
        font-size: 13px;
        line-height: 18px;
    }
    .responsive-filter-heading > span {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-accent);
        padding: 4px 10px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface-muted);
    }
    .explorer-filters {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }
    .explorer-filters label,
    .theme-choice,
    .product-search {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    .explorer-filters label > span {
        font-size: 11px;
        line-height: 16px;
        font-weight: 500;
        color: var(--app-muted);
    }
    :deep(.p-select) {
        min-width: 0;
        width: 100%;
        height: 44px;
        border-radius: 8px;
        font-size: 14px;
        border-color: var(--app-border);
    }
    :deep(.p-select-label) {
        padding: 0 12px;
        line-height: 42px;
    }
    :deep(.p-select-dropdown) {
        width: 28px;
        flex-shrink: 0;
    }
    .filter-search-row {
        display: flex;
        gap: 12px;
        align-items: center;
        border-top: 1px solid var(--app-border-subtle);
        padding-top: 8px;
    }
    .product-search {
        flex: 1;
    }
    .product-search > span:first-child {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .search-input {
        position: relative;
        display: flex;
        align-items: center;
    }
    .search-input i {
        position: absolute;
        left: 12px;
        color: var(--app-muted);
    }
    input[type='search'],
    .reference-choice select {
        width: 100%;
        min-width: 0;
        height: 44px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 0 12px 0 36px;
        background: var(--app-surface);
        color: var(--app-text);
    }
    input:focus-visible,
    select:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 2px;
    }
    .filter-search-row > p {
        flex: 1;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .filter-details,
    .product-extra,
    .tablet-extra {
        color: var(--app-muted);
        font-size: 12px;
        line-height: 18px;
    }
    summary {
        cursor: pointer;
        min-height: 44px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
    }
    summary::before {
        content: '+';
        color: var(--app-accent);
    }
    details[open] > summary::before {
        content: '−';
    }
    .filter-details > p {
        margin-top: 8px;
    }
    .comparison-applied-conditions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin: 8px 0;
    }
    .comparison-condition-chip {
        display: inline-flex;
        gap: 4px;
        align-items: center;
        border: 1px solid var(--app-border);
        background: var(--app-accent-light);
        border-radius: 999px;
        padding: 2px 8px;
        color: var(--app-accent);
    }
    .comparison-condition-chip :deep(.p-button) {
        width: 28px;
        height: 28px;
        padding: 0;
    }
    .reference-choice {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 8px 0 16px;
    }
    .reference-choice select {
        padding: 0 12px;
    }
    .comparison-load-button {
        min-height: 44px;
        max-width: 100%;
    }
    .responsive-theme-context {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .theme-badges {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }
    .theme-badges span:last-child {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .theme-warning {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding: 10px;
        border: 1px solid var(--app-border-subtle);
        border-radius: 8px;
        color: var(--app-muted);
        background: var(--app-surface-muted);
        font-size: 12px;
        line-height: 18px;
    }
    .theme-warning i {
        margin-top: 2px;
        flex-shrink: 0;
    }
    .theme-members {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        align-items: center;
        border-top: 1px solid var(--app-border-subtle);
        padding-top: 8px;
        font-size: 11px;
        line-height: 16px;
    }
    .member-chip {
        padding: 4px 10px;
        border-radius: 6px;
        border: 1px solid var(--app-border);
        background: var(--app-surface-muted);
    }
    .responsive-navigation {
        display: flex;
        overflow-x: auto;
        min-width: 0;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        padding: 6px;
        gap: 4px;
    }
    .responsive-navigation button {
        appearance: none;
        border: 0;
        border-radius: 0;
        background: transparent;
        font: inherit;
        cursor: pointer;
        flex: 1;
        flex-shrink: 0;
        padding: 8px 12px;
        text-align: center;
        min-height: 44px;
        display: flex;
        justify-content: center;
        align-items: center;
        font-size: 13px;
        line-height: 18px;
        font-weight: 600;
        color: var(--app-muted);
        border-bottom: 2px solid transparent;
        white-space: nowrap;
    }
    .responsive-navigation button:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: -2px;
    }
    .comparison-route-navigation {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 8px 0;
    }
    .comparison-route-navigation a {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
    }
    .analysis-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .responsive-navigation button.active {
        color: var(--app-accent);
        border-bottom-color: var(--app-accent);
        background: var(--app-surface-muted);
        border-radius: 8px 8px 0 0;
    }
    .currency-notice {
        display: flex;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface-muted);
        font-size: 12px;
        line-height: 18px;
    }
    .currency-notice i {
        margin-top: 2px;
        color: var(--app-accent);
    }
    .currency-notice p {
        margin-top: 4px;
        color: var(--app-muted);
    }
    .responsive-comparison:not(.theme-comparison) .responsive-results-heading {
        display: none;
    }
    .heading-actions :deep(.pi) {
        font-size: 18px;
        line-height: 18px;
    }
    .tray-compare-button :deep(.pi) {
        font-size: 18px;
        line-height: 18px;
    }
    .responsive-results-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .responsive-results-heading h2 {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        line-height: 18px;
    }
    .responsive-results-heading h2 .pi {
        font-size: 18px;
        line-height: 18px;
        color: var(--app-accent);
    }
    .responsive-results-heading > span {
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
    }
    .responsive-matrix {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        overflow: hidden;
        background: var(--app-surface);
    }
    .matrix-scroll-cue {
        padding: 10px 16px;
        background: var(--app-surface-muted);
        border-bottom: 1px solid var(--app-border);
        display: flex;
        gap: 12px;
        justify-content: space-between;
        font-size: 11px;
        line-height: 16px;
    }
    .matrix-scroll-cue i {
        color: var(--app-accent);
        margin-right: 4px;
    }
    .matrix-scroll-cue > span:last-child {
        white-space: nowrap;
    }
    .matrix-scroll {
        overflow: auto;
        max-width: 100%;
    }
    table {
        width: 100%;
        min-width: 620px;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
    }
    th,
    td {
        min-width: 160px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--app-border-subtle);
        border-left: 1px solid var(--app-border-subtle);
        text-align: left;
        font-size: 13px;
        line-height: 18px;
    }
    tr > :first-child {
        border-left: 0;
    }
    thead {
        background: var(--app-surface-muted);
    }
    thead th {
        padding: 12px 16px;
    }
    tbody th {
        color: var(--app-muted);
        font-weight: 500;
        background: var(--app-surface-muted);
    }
    .matrix-product {
        min-width: 192px;
        background: var(--app-surface);
    }
    .matrix-product > strong {
        display: block;
        margin: 4px 0;
        font-size: 14px;
        line-height: 20px;
    }
    .matrix-fee,
    .matrix-dividend {
        text-align: right;
        font-weight: 600;
    }
    .matrix-yield,
    .matrix-history {
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
    }
    .matrix-note {
        padding: 12px;
        color: var(--app-muted);
        background: var(--app-surface-muted);
        font-size: 11px;
        line-height: 16px;
    }
    .ticker-line {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
    }
    .ticker-line a {
        font-weight: 600;
    }
    .currency-chip {
        font-size: 10px;
        line-height: 14px;
        padding: 2px 6px;
        border: 1px solid var(--app-border);
        border-radius: 4px;
        color: var(--app-accent);
        background: var(--app-accent-light);
        font-weight: 700;
    }
    .select-product {
        display: flex;
        align-items: center;
        gap: 6px;
        min-height: 24px;
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
        font-weight: 400;
    }
    .select-product input {
        width: 20px;
        height: 20px;
        accent-color: var(--app-accent);
    }
    .responsive-product-grid {
        display: none;
    }
    .responsive-product-card {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 16px;
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .responsive-product-card > header {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        justify-content: space-between;
        border-bottom: 1px solid var(--app-border-subtle);
        padding-bottom: 10px;
    }
    .responsive-product-card h3 {
        font-size: 20px;
        line-height: 28px;
        font-weight: 700;
        margin-top: 4px;
    }
    .primary-product-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 12px 0;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .primary-product-metrics > div {
        min-width: 0;
        background: var(--app-surface-muted);
        border-radius: 8px;
        padding: 10px;
    }
    .primary-product-metrics span {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .primary-product-metrics strong {
        display: block;
        margin-top: 2px;
        color: var(--app-accent);
        font-size: 22px;
        line-height: 28px;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
    }
    .primary-product-metrics p {
        margin-top: 4px;
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
    }
    dl {
        margin: 0;
    }
    .responsive-product-facts {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding-top: 12px;
    }
    .responsive-product-facts > div {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        padding: 2px 0;
    }
    dt {
        font-size: 11px;
        line-height: 16px;
        font-weight: 400;
        color: var(--app-muted);
    }
    dd {
        margin: 0;
        text-align: right;
        font-size: 13px;
        line-height: 18px;
        font-weight: 500;
        max-width: 65%;
    }
    .product-dividend dd {
        color: var(--app-accent);
        font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .product-extra {
        border-top: 1px solid var(--app-border-subtle);
        margin-top: 12px;
    }
    .product-fields > div,
    .product-metrics > div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin: 8px 0;
    }
    .product-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }
    .tablet-extra {
        margin-top: -16px;
    }
    .explorer-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 32px 16px;
        border: 1px dashed var(--app-border);
        border-radius: 12px;
        text-align: center;
    }
    .responsive-support {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .comparison-support-details {
        display: contents;
    }
    .comparison-filter-context {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
    }
    .context-summary {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .context-summary > span,
    .context-heading > span {
        color: light-dark(#6e7977, var(--app-muted));
        font-size: 11px;
        line-height: 16px;
    }
    .context-summary > strong {
        color: var(--comparison-heading);
        font-size: 13px;
        line-height: 18px;
        font-weight: 600;
    }
    .comparison-filter-context :deep(.p-button) {
        flex-shrink: 0;
        height: 36px;
        min-height: 36px;
        padding: 0 12px;
        font-size: 11px;
        line-height: 16px;
        font-weight: 500;
        border-radius: 8px;
        white-space: nowrap;
        color: var(--app-muted);
        border-color: light-dark(#bdc9c6, var(--app-border));
        background: var(--app-surface);
    }
    .theme-comparison .responsive-support {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
    }
    .theme-comparison .responsive-insights {
        padding: 16px;
    }
    .theme-comparison .comparison-support-details {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .theme-comparison .comparison-filter-context {
        flex-direction: column;
        align-items: stretch;
        border-color: light-dark(rgb(189 201 198 / 40%), var(--app-border));
    }
    .context-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .context-heading > h3 {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 18px;
        font-weight: 600;
    }
    .comparison-filter-context dl {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin: 0;
        font-size: 12px;
        line-height: 18px;
    }
    .comparison-filter-context dl > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 4px 0;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .comparison-filter-context dl > div:last-child {
        border-bottom: 0;
    }
    .comparison-filter-context dt {
        flex-shrink: 0;
        color: var(--app-muted);
    }
    .comparison-filter-context dd {
        margin: 0;
        color: var(--comparison-heading);
        font-weight: 500;
        text-align: right;
        overflow-wrap: anywhere;
    }
    .theme-comparison .comparison-filter-context :deep(.p-button) {
        height: 44px;
        min-height: 44px;
        width: 100%;
        font-size: 14px;
        line-height: 20px;
        gap: 6px;
        padding: 0;
        color: var(--comparison-heading);
        border-color: light-dark(rgb(189 201 198 / 70%), var(--app-border));
    }
    .theme-comparison .comparison-filter-context :deep(.p-button-icon) {
        color: light-dark(#6e7977, var(--app-muted));
        font-size: 18px;
        line-height: 18px;
    }
    .responsive-insights {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .responsive-insights > h2 {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .responsive-insights > h2 i {
        color: var(--app-accent);
    }
    .insight-cards {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .insight-cards article {
        display: flex;
        gap: 12px;
        padding: 14px;
        background: var(--app-surface-muted);
        border: 1px solid var(--app-border-subtle);
        border-radius: 8px;
    }
    .insight-cards article > i {
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        display: grid;
        place-items: center;
        color: var(--app-accent);
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-accent-light);
        font-size: 18px;
    }
    .insight-cards p {
        margin-top: 4px;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .comparison-warning {
        display: flex;
        gap: 10px;
        padding: 14px;
        border: 1px solid var(--app-warning-light);
        border-radius: 12px;
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .comparison-warning > i {
        font-size: 20px;
        margin-top: 2px;
    }
    .comparison-warning p {
        font-size: 11px;
        line-height: 16px;
        margin-top: 4px;
    }
    .comparison-tray {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
    }
    .tray-heading {
        display: flex;
        align-items: center;
        gap: 8px;
        justify-content: space-between;
    }
    .tray-heading h2 {
        font-size: 13px;
        line-height: 18px;
    }
    .tray-heading :deep(.p-button) {
        min-height: 44px;
        font-size: 11px;
        white-space: nowrap;
        padding: 0 4px;
    }
    .tray-items {
        display: flex;
        overflow-x: auto;
        gap: 8px;
    }
    .tray-items > span {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--app-surface-muted);
        border: 1px solid var(--app-border);
        font-size: 12px;
    }
    .tray-items b {
        font-size: 10px;
        color: var(--app-accent);
    }
    .tray-items :deep(.p-button) {
        width: 36px;
        height: 36px;
        padding: 0;
    }
    .tray-compare-button {
        min-height: 44px;
        width: 100%;
        border-radius: 8px;
    }
    .comparison-tray > p {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .theme-comparison {
        gap: 16px;
        max-width: 786px;
    }
    .theme-comparison h1 {
        font-size: 24px;
        line-height: 32px;
    }
    .theme-comparison .responsive-heading {
        padding-bottom: 20px;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .theme-comparison .responsive-filter-card {
        padding: 16px;
    }
    .theme-comparison .theme-choice {
        font-size: 13px;
        font-weight: 600;
    }
    .theme-comparison .explorer-filters {
        padding-top: 12px;
        border-top: 1px solid var(--app-border-subtle);
    }
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }
    @media (max-width: 640px) {
        .responsive-support,
        .theme-comparison .responsive-support {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .comparison-support-details,
        .theme-comparison .comparison-support-details {
            display: contents;
        }
        .comparison-filter-context {
            display: none;
        }
        .theme-comparison .responsive-insights {
            padding: 0;
        }
        .responsive-comparison {
            --app-border: light-dark(#cbd5e1, #35445b);
            gap: 16px;
            max-width: 358px;
        }
        .responsive-title-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 6px 8px;
        }
        .responsive-title-row > div:first-child {
            display: contents;
        }
        .responsive-title-row h1 {
            grid-row: 1;
            grid-column: 1;
        }
        .responsive-title-row p {
            grid-row: 2;
            grid-column: 1 / -1;
        }
        h1 {
            font-size: 20px;
            line-height: 28px;
        }
        .heading-actions {
            grid-row: 1;
            grid-column: 2;
            align-self: start;
        }
        .heading-actions :deep(.p-button) {
            min-height: 32px;
            padding: 0 10px;
            font-size: 11px;
        }
        .responsive-heading {
            padding-top: 4px;
        }
        .responsive-filter-card {
            padding: 16px;
            gap: 12px;
        }
        .responsive-filter-heading {
            gap: 8px;
        }
        .responsive-filter-heading h2 {
            font-size: 11px;
            line-height: 16px;
        }
        .explorer-filters {
            gap: 10px;
        }
        .filter-search-row {
            flex-direction: column-reverse;
            align-items: stretch;
            border-top: 0;
            padding-top: 0;
            gap: 12px;
        }
        .responsive-navigation {
            padding: 0;
            border: 0;
            border-bottom: 1px solid var(--app-border);
            border-radius: 0;
            background: transparent;
            gap: 0;
        }
        .responsive-navigation button {
            appearance: none;
            border: 0;
            border-radius: 0;
            background: transparent;
            font: inherit;
            cursor: pointer;
            padding: 0 10px 10px;
            font-size: 13px;
        }
        .responsive-navigation button:focus-visible {
            outline: 2px solid var(--app-accent);
            outline-offset: -2px;
        }
        .comparison-route-navigation {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            margin: 8px 0;
        }
        .comparison-route-navigation a {
            min-height: 44px;
            display: inline-flex;
            align-items: center;
        }
        .analysis-panel {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .responsive-navigation button.active {
            background: transparent;
            border-radius: 0;
        }
        .responsive-matrix,
        .tablet-extra {
            display: none;
        }
        .responsive-product-grid .currency-chip {
            color: light-dark(#1e3a8a, #bfdbfe);
            background: light-dark(#eff6ff, #172b4d);
            border-color: light-dark(#bfdbfe, #315583);
        }
        .theme-comparison .responsive-product-grid .currency-chip {
            color: light-dark(#5a4300, #ffdf9a);
            background: light-dark(#fff0c2, #47390f);
            border-color: transparent;
        }
        .responsive-product-grid {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .responsive-comparison:not(.theme-comparison)
            .responsive-results-heading {
            display: flex;
        }
        .theme-comparison .responsive-results-heading {
            display: none;
        }
        .heading-actions :deep(.pi) {
            font-size: 16px;
            line-height: 16px;
        }
        .responsive-results-heading {
            margin: 0;
        }
        .responsive-insights {
            border: 0;
            border-radius: 0;
            padding: 0;
            background: transparent;
            gap: 10px;
        }
        .responsive-insights > h2 {
            font-size: 13px;
            line-height: 18px;
        }
        .insight-cards {
            gap: 10px;
        }
        .insight-cards article {
            background: var(--app-surface);
            border: 1px solid var(--app-border);
            border-radius: 12px;
            padding: 14px;
        }
        .theme-comparison .heading-actions {
            display: grid;
            grid-template-columns: 1fr 1fr;
            grid-row: 3;
            grid-column: 1 / -1;
            margin-top: 8px;
        }
        .theme-comparison .heading-actions :deep(.p-button) {
            min-height: 44px;
        }
        .theme-comparison .responsive-title-row h1 {
            grid-column: 1 / -1;
        }
        .theme-comparison .responsive-heading {
            border: 0;
            padding-bottom: 0;
        }
        .theme-comparison .responsive-filter-card {
            border: 0;
            padding: 0;
            background: transparent;
            box-shadow: none;
            gap: 10px;
        }
        .theme-comparison .explorer-filters {
            padding-top: 0;
            border: 0;
            gap: 8px;
        }
        .theme-comparison .responsive-product-card .ticker-line {
            font-size: 16px;
            line-height: 24px;
            font-weight: 700;
        }
        .theme-comparison .responsive-product-card .select-product {
            position: relative;
            flex-shrink: 0;
        }
        .theme-comparison .responsive-product-card .select-product input {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            margin: 0;
            opacity: 0;
        }
        .theme-comparison
            .responsive-product-card
            .select-product:focus-within {
            outline: 2px solid var(--app-accent);
            outline-offset: 3px;
        }
        .product-kind-badge {
            font-size: 11px;
            line-height: 16px;
            padding: 2px 8px;
            border-radius: 999px;
            background: light-dark(#99f3e4, #103c36);
            color: light-dark(#005048, #7dd6c8);
            font-weight: 600;
        }
        .product-kind-badge.kind-stock {
            background: light-dark(#ffdbc9, #403024);
            color: light-dark(#594234, #ffdbc9);
        }
        .theme-comparison .responsive-product-card h3 {
            font-size: 11px;
            line-height: 16px;
            margin-top: 0;
            font-weight: 400;
            color: var(--app-muted);
        }
        .theme-comparison .responsive-product-facts {
            gap: 8px;
        }
        .theme-comparison .responsive-product-facts > div {
            align-items: center;
            gap: 8px;
            border-bottom: 1px solid var(--app-border-subtle);
            padding: 4px 0;
        }
        .theme-comparison .responsive-product-facts > div:last-child {
            border: 0;
            padding-bottom: 0;
        }
        .theme-comparison .responsive-product-facts dd {
            font-size: 12px;
            line-height: 16px;
        }
    }
    @media (max-width: 390px) {
        .responsive-comparison {
            width: calc(100% - 8px);
        }
    }
    @media (min-width: 641px) and (max-width: 768px) {
        .responsive-comparison {
            width: calc(100% - 16px);
        }
    }
    .comparison-filter-arrow {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 18px;
        height: 18px;
        overflow: hidden;
        white-space: nowrap;
        font-family: 'Comparison Material Symbols';
        font-size: 18px;
        line-height: 1;
        font-weight: 400;
        font-style: normal;
        font-feature-settings: 'liga';
        color: var(--app-muted);
        pointer-events: none;
    }
</style>
