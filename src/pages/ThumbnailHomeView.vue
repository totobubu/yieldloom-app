<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import { useHead } from '@vueuse/head';
    import { useRoute, useRouter } from 'vue-router';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import InputText from 'primevue/inputtext';
    import IconField from 'primevue/iconfield';
    import InputIcon from 'primevue/inputicon';
    import Select from 'primevue/select';
    import Paginator from 'primevue/paginator';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    import Skeleton from 'primevue/skeleton';
    import StockSearchFilters from '@/components/stock/StockSearchFilters.vue';
    import { getDataUrl, getR2Url } from '@/utils/dataUrl';
    import {
        isDivgrowReleaseConfigured,
        loadDivgrowTickerIndex,
    } from '@/services/divgrowRelease';
    import { loadCoreDirectory } from '@/services/coreRelease';
    import { loadDataReleaseIndex } from '@/services/dataRelease';
    import { readPublicJson } from '@/services/publicJson.js';
    import { mergeDiscoveredStocks } from '../../lib/discovered-stocks.js';
    import { applyVerifiedUnderlyings } from '../../lib/security-underlyings.js';
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
        [query, company, securityType, sort],
        () => {
            if (!restoring) page.value = 1;
        },
        { flush: 'sync' }
    );
    watch([query, company, securityType, sort, page], syncUrl, {
        flush: 'post',
    });
    watch(
        () => route.query,
        (values) => {
            if (route.name !== 'thumbnail-home') return;
            restoring = true;
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
    function reset() {
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
    async function fetchJson(path) {
        const local = getDataUrl(path);
        try {
            return await readPublicJson(local, { ttlMs: 180_000 });
        } catch {
            const fallback = getR2Url(path);
            if (!fallback || fallback === local)
                throw new Error('데이터를 불러오지 못했습니다.');
            return readPublicJson(fallback, { ttlMs: 180_000 });
        }
    }
    async function load() {
        loading.value = true;
        error.value = '';
        const coreConfigured = Boolean(
            import.meta.env.VITE_DATA_RELEASE_BASE_URL
        );
        const indexLoader = coreConfigured
            ? loadCoreDirectory().then((instruments) => ({
                  nav: instruments
                      .filter((row) => row.active !== false)
                      .map((row) => ({
                          ...row,
                          company: row.officialProvider,
                          securityType: inferSecurityType(row),
                      })),
              }))
            : isDivgrowReleaseConfigured()
              ? loadDivgrowTickerIndex()
              : fetchJson('ticker-index.json');
        const [index, dividend, discovered] = await Promise.allSettled([
            indexLoader,
            coreConfigured
                ? loadDataReleaseIndex()
                : fetchJson('content-studio/distribution-index.json'),
            fetchJson('us-dividend-stocks.json'),
        ]);
        if (index.status === 'fulfilled')
            rows.value = applyVerifiedUnderlyings(
                mergeDiscoveredStocks(
                    index.value.nav ?? [],
                    discovered.status === 'fulfilled' ? discovered.value : {}
                )
            ).filter((row) => row.symbol && row.active !== false);
        else
            error.value =
                '종목 목록을 불러오지 못했습니다. 다시 시도해 주세요.';
        if (dividend.status === 'fulfilled')
            distributions.value = Object.fromEntries(
                (dividend.value.tickers ?? []).map((row) => [
                    row.ticker,
                    row.latest,
                ])
            );
        loading.value = false;
        page.value = Math.min(page.value, pages.value);
    }
    onMounted(load);
</script>

<template>
    <section class="search-page studio-page">
        <header class="search-heading">
            <div>
                <span class="studio-eyebrow"
                    ><i class="pi pi-chart-line" aria-hidden="true" /> DIVIDEND
                    EXPLORER</span
                >
                <h1>ETF·주식 검색</h1>
                <p>배당을 살펴보고, 나에게 맞는 종목을 찾아보세요.</p>
            </div>
            <Tag
                v-if="!loading && !error"
                :value="`등록 종목 ${rows.length.toLocaleString()}개`"
                severity="secondary"
                rounded />
        </header>
        <div class="search-controls">
            <div class="search-input-row">
                <label for="ticker-search" class="studio-sr-only"
                    >종목명, 티커 또는 운용사 검색</label
                >
                <IconField class="search-input"
                    ><InputIcon class="pi pi-search" /><InputText
                        id="ticker-search"
                        v-model="query"
                        type="search"
                        placeholder="종목명, 티커 또는 운용사 검색"
                        fluid
                        autocomplete="off"
                /></IconField>
                <Button
                    v-if="query"
                    icon="pi pi-times"
                    aria-label="검색어 지우기"
                    severity="secondary"
                    outlined
                    @click="query = ''" />
            </div>
            <StockSearchFilters
                v-model:type="securityType"
                v-model:company="company"
                :companies="companies"
                :providers="popularCompanies" />
        </div>
        <div
            v-if="securityType || company || query"
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
                ><small>개 종목</small>
            </h2>
            <div class="sort-field">
                <label for="sort-order" class="studio-sr-only"
                    >검색 결과 정렬</label
                ><Select
                    v-model="sort"
                    input-id="sort-order"
                    :options="sortOptions"
                    option-label="label"
                    option-value="value" />
            </div>
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
                                    <router-link
                                        v-if="row.underlying"
                                        class="stock-compare-action"
                                        :to="`/underlying/${row.underlying}`"
                                        :aria-label="`${row.underlying} 기반 ETF 비교`"
                                        :title="`${row.underlying} 기반 ETF 비교`"
                                        ><span aria-hidden="true"
                                            >VS</span
                                        ></router-link
                                    >
                                    <span
                                        v-if="row.company"
                                        class="stock-provider-badge"
                                        >{{ row.company }}</span
                                    >
                                </div>
                                <span>{{
                                    row.koName || row.longName || row.symbol
                                }}</span>
                            </div>
                            <router-link
                                :to="stockLink(row)"
                                class="stock-detail-action"
                                :aria-label="`${row.symbol} 종목 상세 보기`"
                                ><i
                                    class="pi pi-arrow-up-right"
                                    aria-hidden="true"
                            /></router-link>
                        </div>
                        <div class="stock-card-metrics">
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
                                >{{ row.dividendEtfs.length }}개 ETF 편입</span
                            >
                        </div>
                        <router-link
                            :to="stockLink(row)"
                            class="stock-detail-link"
                            >상세 배당 분석
                            <i class="pi pi-angle-right" aria-hidden="true"
                        /></router-link>
                    </div>
                </li>
            </ul>
            <Paginator
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
                데이터가 없는 항목입니다.
            </p>
            <!-- eslint-disable-next-line vue/no-deprecated-slot-attribute -- This is AdSlot's ad-unit prop. -->
            <AdSlot :slot="homeAdSlot" label="종목 검색 결과 광고" />
        </template>
    </section>
</template>

<style scoped>
    .search-controls {
        padding: 24px;
        border-radius: 16px;
        border: 1px solid var(--app-border-subtle);
        background: var(--app-surface);
        box-shadow: 0 1px 2px
            color-mix(in srgb, var(--app-text) 3%, transparent);
    }
    .search-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        margin-bottom: 24px;
    }
    .search-heading h1 {
        margin: 10px 0 8px;
        font-size: 32px;
    }
    .search-heading p {
        color: var(--app-muted);
        margin: 0;
    }
    .search-input-row {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
    }
    .search-input {
        flex: 1;
        min-width: 0;
    }
    .search-input :deep(.p-inputtext) {
        height: 56px;
        border-radius: 12px;
        background: color-mix(
            in srgb,
            var(--app-accent) 5%,
            var(--app-surface)
        );
        border-color: transparent;
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
        margin: 28px 0 16px;
    }
    .results-toolbar h2 {
        font-size: 18px;
        margin: 0;
    }
    .results-toolbar h2 span {
        color: var(--app-accent);
        margin-left: 8px;
    }
    .results-toolbar small {
        font-size: 13px;
        font-weight: 400;
        margin-left: 4px;
    }
    .sort-field :deep(.p-select) {
        min-width: 124px;
    }
    .stock-card-grid + :deep(.p-paginator) {
        margin-block: 28px 20px;
        padding-block: 12px;
    }
    .row-note {
        display: block;
        font-size: 12px;
        color: var(--app-muted);
        margin-top: 5px;
    }
    .stock-card-grid,
    .loading-cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
    }
    .stock-card-grid {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .stock-result-item {
        display: flex;
        flex-direction: column;
        min-width: 0;
        position: relative;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
        transition:
            border-color 0.18s ease,
            box-shadow 0.18s ease,
            transform 0.18s ease;
    }
    .stock-result-item:hover,
    .stock-result-item:focus-within {
        border-color: color-mix(
            in srgb,
            var(--app-accent) 55%,
            var(--app-border)
        );
        box-shadow: 0 10px 26px
            color-mix(in srgb, var(--app-accent) 10%, transparent);
        transform: translateY(-2px);
    }
    .stock-result-card {
        display: grid;
        height: 100%;
        gap: 16px;
        padding: 20px;
        color: var(--app-text);
    }
    .stock-compare-action {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 24px;
        border: 1px solid var(--app-border);
        border-radius: 7px;
        color: var(--app-accent);
        background: var(--app-surface-soft);
        font-size: 11px;
        font-weight: 800;
        text-decoration: none;
    }
    .stock-compare-action:hover,
    .stock-compare-action:focus-visible {
        border-color: var(--app-accent);
        outline: 2px solid
            color-mix(in srgb, var(--app-accent) 28%, transparent);
        outline-offset: 2px;
    }
    .stock-card-heading {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        min-width: 0;
    }
    .stock-card-heading > div {
        display: grid;
        gap: 4px;
        min-width: 0;
    }
    .stock-title-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .stock-symbol-link {
        color: var(--app-text);
        font-size: 22px;
        font-weight: 750;
        text-decoration: none;
    }
    .stock-symbol-link:hover,
    .stock-symbol-link:focus-visible {
        color: var(--app-accent);
        text-decoration: underline;
        text-underline-offset: 3px;
    }
    .stock-title-actions {
        flex-wrap: wrap;
    }
    .stock-card-heading .stock-provider-badge {
        display: inline-block;
        min-height: 0;
        padding: 3px 8px;
        border-radius: 999px;
        background: color-mix(
            in srgb,
            var(--app-accent) 12%,
            var(--app-surface)
        );
        color: var(--app-accent);
        font-size: 11px;
        line-height: 1.3;
        overflow-wrap: anywhere;
    }
    .stock-detail-link {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        color: var(--app-accent);
        font-size: 12px;
        font-weight: 600;
        text-decoration: none;
    }
    .stock-card-heading span {
        min-height: 2.5em;
        overflow: hidden;
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.25;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
    }
    .stock-detail-action {
        color: var(--app-accent);
        padding-top: 3px;
        text-decoration: none;
    }
    .stock-detail-action:focus-visible {
        outline: 2px solid
            color-mix(in srgb, var(--app-accent) 28%, transparent);
        outline-offset: 3px;
        border-radius: 6px;
    }
    .stock-card-metrics {
        display: grid;
        grid-template-columns: 1fr;
        gap: 10px;
        padding: 14px;
        border-radius: 10px;
        background: color-mix(
            in srgb,
            var(--app-accent) 6%,
            var(--app-surface)
        );
        font-variant-numeric: tabular-nums;
    }
    .stock-card-metrics > div {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
    }
    .stock-card-metrics > div:first-child strong {
        color: var(--app-accent);
        font-size: 17px;
    }
    .stock-card-metrics small,
    .stock-card-metrics span {
        color: var(--app-muted);
        font-size: 11px;
    }
    .stock-card-metrics strong {
        font-size: 14px;
        overflow-wrap: anywhere;
    }
    .stock-card-meta {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid var(--app-border-subtle);
        color: var(--app-muted);
        font-size: 11px;
    }
    .stock-card-meta span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .data-note {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.7;
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    @media (max-width: 1100px) {
        .stock-card-grid,
        .loading-cards {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }
    @media (max-width: 820px) and (min-width: 768px) {
        .stock-card-grid,
        .loading-cards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    .error-state {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
    }
    @media (max-width: 767px) {
        .search-heading {
            margin-bottom: 20px;
        }
        .search-heading h1 {
            font-size: 26px;
        }
        .search-heading p {
            font-size: 14px;
        }
        .search-heading :deep(.p-tag) {
            display: none;
        }
        .search-input-row {
            margin-bottom: 12px;
            gap: 8px;
        }
        .search-input :deep(.p-inputtext) {
            height: 48px;
            font-size: 14px;
        }
        .search-controls {
            padding: 0;
            border: 0;
            background: transparent;
            box-shadow: none;
        }
        .search-input-row {
            margin-bottom: 16px;
        }
        .search-input :deep(.p-inputtext) {
            background: var(--app-surface);
            border-color: var(--app-border-subtle);
        }
        .stock-result-card {
            padding: 16px;
            gap: 12px;
        }
        .stock-card-metrics {
            grid-template-columns: 1fr 1fr;
        }
        .stock-card-metrics > div {
            display: grid;
            gap: 4px;
        }
        .stock-card-meta {
            border-top: 0;
            padding-top: 0;
        }
        .stock-detail-link {
            display: none;
        }
        .stock-card-grid,
        .loading-cards {
            grid-template-columns: 1fr;
        }
        .stock-card-heading span {
            min-height: auto;
        }
        .results-toolbar {
            margin-top: 20px;
        }
        .results-toolbar h2 {
            font-size: 16px;
        }
        .active-filters {
            margin-top: 12px;
        }
        .error-state {
            align-items: flex-start;
            flex-direction: column;
        }
    }
</style>
