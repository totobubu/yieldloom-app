<script setup>
    import { stockCardSummary } from '../../lib/stock-card-summary.js';
    import { computed, onMounted, ref, watch } from 'vue';
    import { useHead } from '@vueuse/head';
    import { useRoute, useRouter } from 'vue-router';
    import Checkbox from 'primevue/checkbox';
    import {
        isSearchableSecurity,
        isDelisted,
    } from '../../lib/security-status.js';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import Paginator from 'primevue/paginator';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    import Skeleton from 'primevue/skeleton';
    import StockSearchFilters from '@/components/stock/StockSearchFilters.vue';
    import { loadSecurityDirectory } from '@/services/securityDirectory.js';
    import {
        inferSecurityType,
        matchesProductType,
        productTypeOptions,
        topProviders,
    } from '../../lib/security-filters.js';
    import { authLoading, firebaseUser } from '@/services/firebaseClient';
    import {
        loadPortfolioAssets,
        portfolioTickerStates,
    } from '@/services/portfolio';
    import AdSlot from '@/components/ads/AdSlot.vue';
    useHead({ title: 'ETF·주식 검색' });
    const route = useRoute(),
        router = useRouter();
    const stringParam = (value) => (typeof value === 'string' ? value : '');
    const query = ref(stringParam(route.query.q)),
        company = ref(stringParam(route.query.company));
    const includeDelisted = ref(route.query.delisted === '1');
    const securityType = ref(stringParam(route.query.type));
    const sortValues = [
        'symbol',
        'company',
        'ipoDate',
        'dividendDate',
        'dividendAmount',
        'marketCap',
    ];
    const sort = ref(
        sortValues.includes(route.query.sort)
            ? route.query.sort
            : 'dividendDate'
    );
    const sortOptions = [
        { label: '티커순', value: 'symbol' },
        { label: '운용사순', value: 'company' },
        { label: '최근 상장순', value: 'ipoDate' },
        { label: '최근 배당일순', value: 'dividendDate' },
        { label: '배당금 높은순', value: 'dividendAmount' },
        { label: '시가총액 높은순', value: 'marketCap' },
    ];
    let restoring = false;
    const parsePage = (value) =>
        Number.isSafeInteger(Number(value)) && Number(value) > 0
            ? Number(value)
            : 1;
    const homeAdSlot = String(import.meta.env.VITE_ADSENSE_HOME_SLOT || '');
    const page = ref(parsePage(route.query.page)),
        rows = ref([]),
        distributions = ref({}),
        loading = ref(true),
        error = ref('');
    const holdingStates = ref(new Map()),
        holdingsLoading = ref(false),
        holdingsError = ref('');
    let holdingsRequest = 0;
    watch(
        [firebaseUser, authLoading],
        async ([user, pending]) => {
            const request = ++holdingsRequest;
            holdingStates.value = new Map();
            holdingsError.value = '';
            holdingsLoading.value = false;
            if (pending || !user) return;
            holdingsLoading.value = true;
            try {
                const assets = await loadPortfolioAssets(user.uid);
                if (request === holdingsRequest)
                    holdingStates.value = portfolioTickerStates(assets);
            } catch {
                if (request === holdingsRequest)
                    holdingsError.value =
                        '보유이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
            } finally {
                if (request === holdingsRequest) holdingsLoading.value = false;
            }
        },
        { immediate: true }
    );
    const holdingMessage = computed(() => {
        if (securityType.value !== 'holding-history') return '';
        if (authLoading.value || holdingsLoading.value)
            return '보유이력을 불러오는 중입니다.';
        if (!firebaseUser.value) return '보유이력을 보려면 로그인해 주세요.';
        return holdingsError.value;
    });
    const pageSize = 60;
    const companies = computed(() =>
        [
            ...new Set(
                rows.value.map((row) => row.company?.trim()).filter(Boolean)
            ),
        ].sort((a, b) => a.localeCompare(b))
    );
    const popularCompanies = computed(() => topProviders(rows.value, 15));
    const dividendDateValue = (row) =>
        distributions.value[row.symbol]?.ex_date ||
        row.dividendEvidence?.latestExDate ||
        '';
    const dividendAmountValue = (row) => {
        const value =
            distributions.value[row.symbol]?.distribution_per_share ??
            row.dividendEvidence?.latestAmount;
        return Number.isFinite(Number(value)) && Number(value) > 0
            ? Number(value)
            : null;
    };
    const descendingNumber = (a, b, valueFor) => {
        const aValue = valueFor(a);
        const bValue = valueFor(b);
        if (aValue == null && bValue == null)
            return String(a.symbol).localeCompare(String(b.symbol));
        if (aValue == null) return 1;
        if (bValue == null) return -1;
        return (
            bValue - aValue || String(a.symbol).localeCompare(String(b.symbol))
        );
    };
    const filtered = computed(() => {
        const needle = query.value.trim().toLowerCase();
        return rows.value
            .filter(
                (row) =>
                    isSearchableSecurity(row, includeDelisted.value) &&
                    (!company.value || row.company?.trim() === company.value) &&
                    matchesProductType(
                        row,
                        securityType.value,
                        distributions.value[row.symbol],
                        holdingStates.value
                    ) &&
                    [
                        row.symbol,
                        row.koName,
                        row.longName,
                        row.company,
                        row.underlying,
                        ...(row.dividendEtfs ?? []).map((etf) => etf.ticker),
                    ].some((value) =>
                        String(value ?? '')
                            .toLowerCase()
                            .includes(needle)
                    )
            )
            .sort((a, b) => {
                if (sort.value === 'ipoDate')
                    return String(b.ipoDate ?? '').localeCompare(
                        String(a.ipoDate ?? '')
                    );
                if (sort.value === 'dividendDate')
                    return dividendDateValue(b).localeCompare(
                        dividendDateValue(a)
                    );
                if (sort.value === 'dividendAmount')
                    return descendingNumber(a, b, dividendAmountValue);
                if (sort.value === 'marketCap')
                    return descendingNumber(a, b, (row) => {
                        const value = Number(row.marketCap);
                        return Number.isFinite(value) && value > 0
                            ? value
                            : null;
                    });
                return String(a[sort.value] ?? '').localeCompare(
                    String(b[sort.value] ?? ''),
                    'ko'
                );
            });
    });
    const pages = computed(() =>
        Math.max(1, Math.ceil(filtered.value.length / pageSize))
    );
    const visible = computed(() =>
        filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize)
    );
    function syncUrl() {
        if (restoring || route.name !== 'thumbnail-home') return;
        const next = { ...route.query };
        for (const [key, value] of Object.entries({
            delisted: includeDelisted.value ? '1' : '',
            q: query.value,
            company: company.value,
            type: securityType.value,
            sort: sort.value === 'dividendDate' ? '' : sort.value,
            page: page.value > 1 ? String(page.value) : '',
        })) {
            if (value) next[key] = value;
            else delete next[key];
        }
        if (JSON.stringify(next) !== JSON.stringify(route.query))
            void router.replace({ query: next });
    }
    watch(
        [query, company, securityType, sort, includeDelisted],
        () => {
            if (!restoring) page.value = 1;
        },
        { flush: 'sync' }
    );
    watch(
        [query, company, securityType, sort, includeDelisted, page],
        syncUrl,
        {
            flush: 'post',
        }
    );
    watch(
        () => route.query,
        (values) => {
            if (route.name !== 'thumbnail-home') return;
            restoring = true;
            includeDelisted.value = values.delisted === '1';
            query.value = stringParam(values.q);
            company.value = stringParam(values.company);
            securityType.value = stringParam(values.type);
            sort.value = sortValues.includes(values.sort)
                ? values.sort
                : 'dividendDate';
            page.value = parsePage(values.page);
            restoring = false;
        },
        { flush: 'sync' }
    );
    watch(pages, (count) => {
        if (!loading.value && page.value > count) page.value = count;
    });
    const typeLabel = computed(
        () =>
            productTypeOptions.find(
                (option) => option.value === securityType.value
            )?.label
    );
    const stockLink = (row) => ({
        name: 'ticker-stock',
        params: { ticker: row.symbol },
    });
    const exDate = (row) =>
        distributions.value[row.symbol]?.ex_date ||
        row.dividendEvidence?.latestExDate ||
        '미확인';
    function hasDividendMetrics(row) {
        if (row.noDividends === true) return false;
        const event = distributions.value[row.symbol];
        const value =
            event?.distribution_per_share ?? row.dividendEvidence?.latestAmount;
        return (
            (Number.isFinite(Number(value)) && Number(value) > 0) ||
            Boolean(event?.ex_date || row.dividendEvidence?.latestExDate)
        );
    }
    function stockTypeLabel(row) {
        if (inferSecurityType(row) === 'stock')
            return hasDividendMetrics(row) ? '배당주 (일반)' : '일반 주식';
        if (
            matchesProductType(
                row,
                'leveraged-etf',
                distributions.value[row.symbol]
            )
        )
            return '레버리지 ETF';
        return hasDividendMetrics(row)
            ? '배당 ETF'
            : row.noDividends === true
              ? 'ETF'
              : '배당자료 미확인 ETF';
    }
    function reset() {
        includeDelisted.value = false;
        query.value = '';
        company.value = '';
        securityType.value = '';
    }
    function amount(row) {
        const event = distributions.value[row.symbol],
            value =
                event?.distribution_per_share ??
                row.dividendEvidence?.latestAmount;
        if (value == null || !Number.isFinite(Number(value))) return '—';
        const currency = event?.currency ?? row.currency;
        return `${currency === 'USD' ? '$' : currency ? currency + ' ' : ''}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
    }
    async function load() {
        loading.value = true;
        error.value = '';
        try {
            const result = await loadSecurityDirectory({
                includeDelisted: true,
            });
            rows.value = result.rows;
            distributions.value = Object.fromEntries(
                (result.distributions?.tickers ?? []).map((row) => [
                    row.ticker,
                    row.latest,
                ])
            );
        } catch {
            error.value =
                '종목 목록을 불러오지 못했습니다. 다시 시도해 주세요.';
        }
        loading.value = false;
        page.value = Math.min(page.value, pages.value);
    }
    onMounted(load);
</script>

<template>
    <section class="search-page studio-page">
        <header class="search-heading">
            <div>
                <h1>ETF·주식 검색</h1>
            </div>
            <span class="search-public-note"
                >공개 종목 카탈로그 · 로그인 불필요</span
            >
        </header>
        <div class="search-controls">
            <div class="search-input-row">
                <label for="ticker-search" class="studio-sr-only"
                    >종목명, 티커 또는 운용사 검색</label
                >
                <div class="search-input">
                    <InputText
                        id="ticker-search"
                        v-model="query"
                        type="search"
                        placeholder="종목명, 티커 또는 운용사 검색"
                        fluid
                        autocomplete="off" />
                    <Button
                        v-if="query"
                        icon="pi pi-times"
                        aria-label="검색어 지우기"
                        class="search-clear"
                        severity="secondary"
                        text
                        rounded
                        @click="query = ''" />
                </div>
            </div>
            <StockSearchFilters
                v-model:type="securityType"
                v-model:company="company"
                :companies="companies"
                :providers="popularCompanies" />
            <div class="search-control-row">
                <div class="delisted-filter">
                    <Checkbox
                        v-model="includeDelisted"
                        input-id="include-delisted"
                        binary />
                    <label for="include-delisted">상장폐지 종목 포함</label>
                </div>
                <div class="sort-field">
                    <label for="sort-order">정렬 기준</label>
                    <Select
                        v-model="sort"
                        input-id="sort-order"
                        :options="sortOptions"
                        option-label="label"
                        option-value="value" />
                </div>
            </div>
        </div>
        <div
            v-if="securityType || company"
            class="active-filters"
            aria-label="적용된 검색 조건">
            <Button
                v-if="securityType"
                :label="typeLabel"
                icon="pi pi-times"
                icon-pos="right"
                size="small"
                severity="secondary"
                outlined
                rounded
                :aria-label="`${typeLabel} 조건 해제`"
                @click="securityType = ''" />
            <Button
                v-if="company"
                :label="company"
                icon="pi pi-times"
                icon-pos="right"
                size="small"
                severity="secondary"
                outlined
                rounded
                :aria-label="`${company} 조건 해제`"
                @click="company = ''" />
            <Button
                label="초기화"
                icon="pi pi-refresh"
                size="small"
                text
                severity="secondary"
                @click="reset" />
        </div>
        <div class="results-toolbar">
            <h2>
                검색 결과
                <span aria-live="polite">{{
                    loading ? '—' : filtered.length.toLocaleString()
                }}</span
                ><small>건 (페이지 크기 {{ pageSize }})</small>
            </h2>
        </div>
        <div
            v-if="loading"
            class="loading-cards"
            role="status"
            aria-label="종목 목록을 불러오는 중">
            <Skeleton
                v-for="n in 12"
                :key="n"
                height="10.5rem"
                border-radius="12px" />
        </div>
        <Message v-else-if="error" severity="error" :closable="false"
            ><div class="error-state">
                <span>{{ error }}</span
                ><Button
                    label="다시 시도"
                    icon="pi pi-refresh"
                    severity="danger"
                    outlined
                    @click="load" /></div
        ></Message>
        <Message
            v-else-if="holdingMessage"
            :severity="holdingsError ? 'error' : 'info'"
            :closable="false"
            >{{ holdingMessage }}</Message
        >
        <Card v-else-if="!filtered.length"
            ><template #content
                ><div class="studio-empty">
                    <i class="pi pi-search" aria-hidden="true" />
                    <h2>검색 결과가 없습니다</h2>
                    <p>검색어를 바꾸거나 적용된 필터를 해제해 보세요.</p>
                    <Button
                        label="검색 조건 초기화"
                        outlined
                        @click="reset" /></div></template
        ></Card>
        <template v-else>
            <ul class="stock-card-grid" aria-label="종목 검색 결과">
                <li
                    v-for="row in visible"
                    :key="row.symbol"
                    class="stock-result-item">
                    <div class="stock-result-card">
                        <div class="stock-card-heading">
                            <div>
                                <div class="stock-title-actions">
                                    <router-link
                                        :to="stockLink(row)"
                                        class="stock-symbol-link"
                                        >{{ row.symbol }}</router-link
                                    >
                                    <Tag
                                        v-if="isDelisted(row)"
                                        value="상장폐지"
                                        severity="warn" />
                                    <Tag
                                        class="stock-product-type"
                                        :class="{
                                            'stock-type-stock':
                                                inferSecurityType(row) ===
                                                'stock',
                                        }"
                                        :value="stockTypeLabel(row)"
                                        :severity="
                                            inferSecurityType(row) === 'stock'
                                                ? 'warn'
                                                : undefined
                                        " />
                                </div>
                                <span>{{
                                    row.koName || row.longName || row.symbol
                                }}</span>
                                <div class="stock-card-meta">
                                    <span>{{
                                        row.company ||
                                        (inferSecurityType(row) === 'stock'
                                            ? '일반 주식'
                                            : '운용사 미확인')
                                    }}</span
                                    ><span v-if="row.underlying"
                                        >{{ row.underlying }} 기반</span
                                    ><span v-else-if="row.dividendEtfs?.length"
                                        >{{ row.dividendEtfs.length }}개 ETF
                                        편입</span
                                    >
                                </div>
                            </div>
                        </div>
                        <div
                            v-if="hasDividendMetrics(row)"
                            class="stock-card-metrics">
                            <div>
                                <small
                                    >현재 가격 ({{
                                        row.currency || '통화 미확인'
                                    }})</small
                                ><span>목록 자료 미제공</span>
                            </div>
                            <div>
                                <small>최근 주당 배당금</small
                                ><strong v-if="hasDividendMetrics(row)">{{
                                    amount(row)
                                }}</strong
                                ><span v-else>정보 확인 중</span>
                            </div>
                            <div>
                                <small>배당락일</small
                                ><strong v-if="hasDividendMetrics(row)">{{
                                    exDate(row)
                                }}</strong
                                ><span v-else>미확인</span>
                            </div>
                        </div>
                        <div
                            v-else
                            class="stock-card-metrics stock-card-summary">
                            <div>
                                <small
                                    >현재 가격 ({{
                                        row.currency || '통화 미확인'
                                    }})</small
                                ><span>목록 자료 미제공</span>
                            </div>
                            <div>
                                <small>{{
                                    stockCardSummary(row).primaryLabel
                                }}</small
                                ><strong>{{
                                    stockCardSummary(row).primaryValue
                                }}</strong>
                            </div>
                            <div>
                                <small>{{
                                    stockCardSummary(row).secondaryLabel
                                }}</small
                                ><strong>{{
                                    stockCardSummary(row).secondaryValue
                                }}</strong>
                            </div>
                            <span class="stock-dividend-status">{{
                                stockCardSummary(row).status
                            }}</span>
                        </div>
                        <div class="stock-card-actions">
                            <router-link
                                v-if="row.underlying && !isDelisted(row)"
                                class="stock-compare-action"
                                :to="`/underlying/${row.underlying}`"
                                :aria-label="`${row.underlying} 기반 ETF 비교`"
                                :title="`${row.underlying} 기반 ETF 비교`"
                                ><span aria-hidden="true"
                                    >VS 비교</span
                                ></router-link
                            >
                            <router-link
                                :to="stockLink(row)"
                                class="stock-detail-action"
                                :aria-label="`${row.symbol} 종목 상세 보기`"
                                >상세 보기</router-link
                            >
                        </div>
                    </div>
                </li>
            </ul>
            <Paginator
                class="search-pagination"
                :first="(page - 1) * pageSize"
                :rows="pageSize"
                :total-records="filtered.length"
                :page-link-size="3"
                template="PrevPageLink PageLinks NextPageLink"
                aria-label="검색 결과 페이지"
                @page="page = $event.page + 1" />
            <p class="data-note">
                <i class="pi pi-info-circle" aria-hidden="true" />
                배당금·배당락일은 저장된 최근 이력 기준입니다. ‘—’는 제공된
                데이터가 없는 항목입니다. 검색 목록에는 현재 시세가 제공되지
                않으며 종목 상세에서 확인할 수 있습니다.
            </p>
            <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -- This is AdSlot's ad-unit prop. -->
            <AdSlot :slot="homeAdSlot" label="종목 검색 결과 광고" />
        </template>
    </section>
</template>

<style scoped>
    .search-page {
        line-height: 1.5;
    }
    .search-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 24px;
    }
    @media (max-width: 768px) {
        .search-public-note {
            flex-basis: 100%;
        }
    }
    .search-heading h1 {
        margin: 0;
        font-size: 22px;
        line-height: 33px;
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    .search-controls {
        padding: 20px;
        border-radius: 12px;
        border: 1px solid var(--app-border);
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
    }
    .search-input-row {
        display: flex;
        gap: 12px;
        margin-bottom: 16px;
    }
    .search-public-note {
        color: var(--app-muted);
        font-size: 13px;
    }
    .search-input {
        position: relative;
        flex: 1;
        min-width: 0;
    }
    .search-input :deep(.search-clear) {
        position: absolute;
        right: 10px;
        top: 10px;
        width: 24px;
        height: 24px;
        min-width: 24px;
        min-height: 24px;
        padding: 0;
        border-radius: 50%;
        background: var(--app-border);
        color: var(--app-muted);
    }
    .search-input :deep(.search-clear .p-button-icon) {
        font-size: 12px;
    }

    .search-input :deep(.p-inputtext) {
        height: 44px;
        padding: 0 40px 0 14px;
        border-radius: 8px;
        font-size: 15px;
        background: var(--app-surface);
        border-color: var(--app-border);
    }
    .search-control-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-top: 1px solid var(--app-border);
        margin-top: 16px;
        padding-top: 6px;
    }
    .delisted-filter,
    .sort-field {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .delisted-filter label {
        font-size: 14px;
    }
    .sort-field label {
        color: var(--app-muted);
        font-size: 13px;
        white-space: nowrap;
    }
    .sort-field :deep(.p-select) {
        min-width: 144px;
    }
    .active-filters {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-top: 16px;
    }
    .results-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 20px 0 16px;
    }
    .results-toolbar h2 {
        font-size: 14px;
        color: var(--app-muted);
        font-weight: 400;
        margin: 0;
    }
    .results-toolbar h2 span {
        color: var(--app-accent);
        margin-left: 8px;
        font-weight: 700;
    }
    .results-toolbar small {
        font-size: 13px;
        font-weight: 400;
        margin-left: 4px;
    }
    .search-pagination {
        margin: 0;
        padding: 16px 0;
    }
    .search-pagination :deep(.p-paginator-page),
    .search-pagination :deep(.p-paginator-prev),
    .search-pagination :deep(.p-paginator-next) {
        width: 44px;
        min-width: 44px;
        height: 44px;
        border-radius: 8px;
        border: 1px solid var(--app-border);
    }
    .search-pagination :deep(.p-paginator-content),
    .search-pagination :deep(.p-paginator-pages) {
        gap: 8px;
    }
    .stock-card-grid,
    .loading-cards {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
    }
    .stock-card-grid {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .stock-result-item {
        display: flex;
        min-width: 0;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .stock-result-item:hover,
    .stock-result-item:focus-within {
        border-color: var(--app-accent);
        box-shadow: 0 4px 12px rgb(0 0 0 / 5%);
    }
    .stock-result-card {
        display: flex;
        flex-direction: column;
        width: 100%;
        gap: 14px;
        padding: 18px;
        color: var(--app-text);
    }
    .stock-card-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
    }
    .stock-card-heading > div {
        width: 100%;
        display: grid;
        gap: 8px;
        min-width: 0;
    }
    .stock-title-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }
    .stock-title-actions :deep(.stock-product-type) {
        margin-left: auto;
    }
    .stock-symbol-link {
        color: var(--app-text);
        font-size: 18px;
        font-weight: 800;
        text-decoration: none;
        letter-spacing: -0.01em;
    }
    .stock-symbol-link:hover,
    .stock-symbol-link:focus-visible {
        color: var(--app-accent);
        text-decoration: underline;
    }
    .stock-card-heading > div > span {
        font-size: 15px;
        line-height: 1.35;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .stock-card-heading :deep(.stock-product-type) {
        --p-tag-font-weight: 600;
        flex-shrink: 0;
        font-size: 11px;
        padding: 3px 8px;
        border-radius: 8px;
        background: var(--app-accent-light);
        color: var(--app-accent);
        border: 1px solid color-mix(in srgb, var(--app-accent) 20%, transparent);
    }
    .stock-card-heading :deep(.stock-type-stock) {
        background: var(--app-warning-light);
        color: var(--app-warning-text);
        border-color: color-mix(in srgb, var(--app-warning) 25%, transparent);
    }
    .stock-card-metrics {
        display: grid;
        gap: 8px;
        padding: 12px;
        border-radius: 8px;
        background: var(--app-bg);
        font-variant-numeric: tabular-nums;
    }
    .stock-card-metrics > div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
    }
    .stock-card-metrics small,
    .stock-card-metrics span {
        color: var(--app-muted);
        font-size: 13px;
    }
    .stock-card-metrics strong {
        font-size: 13px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .stock-card-summary .stock-dividend-status {
        font-size: 11px;
        color: var(--app-muted);
    }
    .stock-card-meta {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 8px;
        color: var(--app-muted);
        font-size: 13px;
    }
    .stock-card-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: auto;
        padding-top: 4px;
    }
    .stock-compare-action,
    .stock-detail-action {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        height: 44px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 0 12px;
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
    }
    .stock-compare-action {
        color: var(--app-muted);
        white-space: nowrap;
    }
    .stock-detail-action {
        flex: 1;
        background: var(--app-accent);
        border-color: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .stock-card-actions a:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    .data-note {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.7;
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    .error-state {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
    }
    @media (max-width: 1024px) {
        .stock-card-grid,
        .loading-cards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 768px) {
        .search-controls {
            padding: 16px;
        }
        .stock-card-grid,
        .loading-cards {
            grid-template-columns: 1fr;
        }
        .search-control-row {
            align-items: stretch;
            flex-direction: column;
        }
        .sort-field {
            justify-content: space-between;
        }
        .sort-field :deep(.p-select) {
            flex: 1;
            min-width: 0;
        }
        .error-state {
            align-items: flex-start;
            flex-direction: column;
        }
    }
</style>
