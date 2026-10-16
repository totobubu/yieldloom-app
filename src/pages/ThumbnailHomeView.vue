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
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Paginator from 'primevue/paginator';
    import Drawer from 'primevue/drawer';
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
    import { mergeDiscoveredStocks } from '../../lib/discovered-stocks.js';
    import {
        inferSecurityType,
        matchesProductType,
        productTypeOptions,
        topProviders,
    } from '../../lib/security-filters.js';
    import AdSlot from '@/components/ads/AdSlot.vue';
    useHead({ title: 'ETF·주식 검색' });
    const route = useRoute(),
        router = useRouter();
    const stringParam = (value) => (typeof value === 'string' ? value : '');
    const query = ref(stringParam(route.query.q)),
        company = ref(stringParam(route.query.company));
    const securityType = ref(stringParam(route.query.type));
    const sort = ref(
        ['company', 'ipoDate'].includes(route.query.sort)
            ? route.query.sort
            : 'symbol'
    );
    const filterOpen = ref(false),
        draftType = ref(''),
        draftCompany = ref('');
    const sortOptions = [
        { label: '티커순', value: 'symbol' },
        { label: '운용사순', value: 'company' },
        { label: '최근 상장순', value: 'ipoDate' },
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
    const pageSize = 25;
    const companies = computed(() =>
        [
            ...new Set(
                rows.value.map((row) => row.company?.trim()).filter(Boolean)
            ),
        ].sort((a, b) => a.localeCompare(b))
    );
    const popularCompanies = computed(() => topProviders(rows.value));
    const filtered = computed(() => {
        const needle = query.value.trim().toLowerCase();
        return rows.value
            .filter(
                (row) =>
                    (!company.value || row.company?.trim() === company.value) &&
                    matchesProductType(
                        row,
                        securityType.value,
                        distributions.value[row.symbol]
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
                return sort.value === 'ipoDate'
                    ? String(b.ipoDate ?? '').localeCompare(
                          String(a.ipoDate ?? '')
                      )
                    : String(a[sort.value] ?? '').localeCompare(
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
    const filterCount = computed(
        () =>
            [company.value, securityType.value, query.value.trim()].filter(
                Boolean
            ).length
    );
    function syncUrl() {
        if (restoring || route.name !== 'thumbnail-home') return;
        const next = { ...route.query };
        for (const [key, value] of Object.entries({
            q: query.value,
            company: company.value,
            type: securityType.value,
            sort: sort.value === 'symbol' ? '' : sort.value,
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
            sort.value = ['company', 'ipoDate'].includes(values.sort)
                ? values.sort
                : 'symbol';
            page.value = parsePage(values.page);
            restoring = false;
        },
        { flush: 'sync' }
    );
    watch(pages, (count) => {
        if (!loading.value && page.value > count) page.value = count;
    });
    function openFilters() {
        draftType.value = securityType.value;
        draftCompany.value = company.value;
        filterOpen.value = true;
    }
    function applyFilters() {
        securityType.value = draftType.value;
        company.value = draftCompany.value;
        filterOpen.value = false;
    }
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
        let response = await fetch(local).catch(() => null);
        if (!response?.ok) {
            const fallback = getR2Url(path);
            if (!fallback || fallback === local)
                throw new Error('데이터를 불러오지 못했습니다.');
            response = await fetch(fallback);
        }
        if (!response.ok) throw new Error('데이터를 불러오지 못했습니다.');
        return response.json();
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
            rows.value = mergeDiscoveredStocks(
                index.value.nav ?? [],
                discovered.status === 'fulfilled' ? discovered.value : {}
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
            <Button
                class="mobile-filter-button"
                icon="pi pi-sliders-h"
                :label="filterCount ? `필터 ${filterCount}` : '필터'"
                severity="secondary"
                outlined
                @click="openFilters" />
        </div>
        <Card class="desktop-filters"
            ><template #content
                ><StockSearchFilters
                    v-model:type="securityType"
                    v-model:company="company"
                    :companies="companies"
                    :providers="popularCompanies" /></template
        ></Card>
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
                    input-id="sort-order"
                    v-model="sort"
                    :options="sortOptions"
                    option-label="label"
                    option-value="value" />
            </div>
        </div>
        <div
            v-if="loading"
            class="loading-rows"
            role="status"
            aria-label="종목 목록을 불러오는 중">
            <Skeleton
                v-for="n in 5"
                :key="n"
                height="5rem"
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
            <DataTable
                class="desktop-results"
                :value="visible"
                data-key="symbol"
                table-style="min-width: 48rem"
                striped-rows
                :table-props="{ 'aria-label': '종목 검색 결과' }">
                <Column header="종목명 / 티커"
                    ><template #body="{ data }"
                        ><router-link class="ticker-link" :to="stockLink(data)"
                            ><strong>{{ data.symbol }}</strong
                            ><span>{{
                                data.koName || data.longName || data.symbol
                            }}</span></router-link
                        ><small v-if="data.underlying" class="row-note"
                            >{{ data.underlying }} 기반</small
                        ><small
                            v-else-if="data.dividendEtfs?.length"
                            class="row-note"
                            >{{
                                data.dividendEtfs
                                    .map((etf) => etf.ticker)
                                    .join(' · ')
                            }}
                            편입</small
                        ></template
                    ></Column
                >
                <Column header="운용사"
                    ><template #body="{ data }"
                        ><span class="studio-muted">{{
                            data.company || '—'
                        }}</span></template
                    ></Column
                >
                <Column header="최근 주당 배당금" body-class="studio-numeric"
                    ><template #body="{ data }"
                        ><strong>{{ amount(data) }}</strong
                        ><small
                            v-if="
                                !distributions[data.symbol] &&
                                data.dividendEvidence
                            "
                            class="row-note"
                            >Yahoo Finance ·
                            {{ data.dividendEvidence.asOfDate }}</small
                        ></template
                    ></Column
                >
                <Column header="최근 배당락일"
                    ><template #body="{ data }"
                        ><span class="studio-numeric">{{
                            exDate(data)
                        }}</span></template
                    ></Column
                >
                <Column
                    ><template #body="{ data }"
                        ><router-link
                            class="detail-link"
                            :to="stockLink(data)"
                            :aria-label="`${data.symbol} 종목 상세`"
                            ><i
                                class="pi pi-arrow-right"
                                aria-hidden="true" /></router-link></template
                ></Column>
            </DataTable>
            <ul class="mobile-results" aria-label="종목 검색 결과">
                <li v-for="row in visible" :key="row.symbol">
                    <router-link :to="stockLink(row)" class="mobile-stock-card">
                        <div class="mobile-stock-heading">
                            <strong>{{ row.symbol }}</strong
                            ><span>{{
                                row.koName || row.longName || row.symbol
                            }}</span
                            ><i class="pi pi-angle-right" aria-hidden="true" />
                        </div>
                        <div class="mobile-stock-metrics">
                            <div>
                                <small>최근 주당 배당금</small
                                ><strong>{{ amount(row) }}</strong>
                            </div>
                            <div>
                                <small>배당락일</small
                                ><span>{{ exDate(row) }}</span>
                            </div>
                        </div>
                        <div class="mobile-stock-meta">
                            <span>{{
                                row.company ||
                                (inferSecurityType(row) === 'stock'
                                    ? '일반 주식'
                                    : '운용사 미확인')
                            }}</span
                            ><span v-if="row.underlying"
                                >{{ row.underlying }} 기반</span
                            >
                        </div>
                    </router-link>
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
            <AdSlot :slot="homeAdSlot" label="종목 검색 결과 광고" />
        </template>
        <Drawer
            v-model:visible="filterOpen"
            header="검색 필터"
            position="bottom"
            class="search-filter-drawer"
            :style="{ height: 'min(82dvh, 740px)' }">
            <StockSearchFilters
                id-prefix="mobile"
                v-model:type="draftType"
                v-model:company="draftCompany"
                :companies="companies"
                :providers="popularCompanies" />
            <template #footer
                ><div class="filter-footer">
                    <Button
                        label="초기화"
                        severity="secondary"
                        outlined
                        @click="
                            draftType = '';
                            draftCompany = '';
                        " /><Button
                        label="필터 적용"
                        icon="pi pi-check"
                        @click="applyFilters" /></div
            ></template>
        </Drawer>
    </section>
</template>

<style scoped>
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
    }
    .mobile-filter-button {
        display: none;
    }
    .desktop-filters {
        border: 1px solid var(--app-border);
    }
    .desktop-filters :deep(.p-card-content) {
        padding: 0;
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
    .desktop-results {
        border: 1px solid var(--app-border);
        border-radius: 14px;
        overflow: hidden;
    }
    .desktop-results :deep(th) {
        font-size: 13px;
        color: var(--app-muted);
        background: var(--app-surface-muted);
        padding: 16px;
    }
    .desktop-results :deep(td) {
        padding: 18px 16px;
        font-size: 14px;
    }
    .ticker-link {
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: var(--app-text);
        text-decoration: none;
    }
    .ticker-link strong {
        font-size: 17px;
    }
    .ticker-link span {
        max-width: 360px;
        overflow-wrap: anywhere;
        font-size: 13px;
        color: var(--app-muted);
    }
    .row-note {
        display: block;
        font-size: 12px;
        color: var(--app-muted);
        margin-top: 5px;
    }
    .detail-link {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        color: var(--app-accent);
        border-radius: 10px;
        background: var(--app-surface-muted);
    }
    .mobile-results {
        display: none;
    }
    .data-note {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.7;
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    .loading-rows {
        display: grid;
        gap: 12px;
    }
    .error-state {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
    }
    .filter-footer {
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        padding-bottom: env(safe-area-inset-bottom, 0px);
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
        .mobile-filter-button {
            display: inline-flex;
            white-space: nowrap;
        }
        .desktop-filters,
        .desktop-results {
            display: none;
        }
        .mobile-results {
            display: grid;
            list-style: none;
            padding: 0;
            margin: 0;
            gap: 12px;
        }
        .mobile-stock-card {
            display: grid;
            gap: 14px;
            padding: 16px;
            background: var(--app-surface);
            border: 1px solid var(--app-border);
            border-radius: 14px;
            color: var(--app-text);
            text-decoration: none;
        }
        .mobile-stock-heading {
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 0;
        }
        .mobile-stock-heading strong {
            font-size: 18px;
            flex-shrink: 0;
        }
        .mobile-stock-heading > span {
            color: var(--app-muted);
            font-size: 13px;
            min-width: 0;
            overflow-wrap: anywhere;
        }
        .mobile-stock-heading i {
            margin-left: auto;
            color: var(--app-muted);
        }
        .mobile-stock-metrics {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            font-variant-numeric: tabular-nums;
        }
        .mobile-stock-metrics > div {
            display: grid;
            gap: 4px;
        }
        .mobile-stock-metrics > div:last-child {
            text-align: right;
        }
        .mobile-stock-metrics small {
            color: var(--app-muted);
            font-size: 12px;
        }
        .mobile-stock-metrics strong {
            font-size: 17px;
        }
        .mobile-stock-metrics span {
            font-size: 14px;
        }
        .mobile-stock-meta {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            border-top: 1px solid var(--app-border-subtle);
            padding-top: 10px;
            color: var(--app-muted);
            font-size: 12px;
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
