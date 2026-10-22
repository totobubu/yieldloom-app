<script setup>
    import { readPublicJson } from '@/services/publicJson.js';
    import { computed, ref, watch } from 'vue';
    import InsightMetricCard from './InsightMetricCard.vue';
    import InfoHelp from '@/components/common/InfoHelp.vue';
    import { getAssetUrl } from '@/utils/dataUrl';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';

    const basisHelp = ref(null);
    const fundamentalsOpen = ref(
        typeof window !== 'undefined' &&
            window.matchMedia('(min-width: 601px)').matches
    );
    const basisText =
        '최근 12개월 지표는 배당락일 기준입니다. 총수익률은 Yahoo 조정 종가로 계산한 추정치이며, 호가 스프레드는 수집 시점의 값입니다. 미확인은 0을 뜻하지 않습니다.';
    const etfProfiles = {
        SCHD: {
            name: 'Schwab U.S. Dividend Equity ETF',
            company: 'Schwab',
            index: 'Dow Jones U.S. Dividend 100 Index',
            description:
                '배당 지급 이력과 재무 지표를 기준으로 미국 배당주에 투자합니다.',
            url: 'https://www.schwabassetmanagement.com/products/schd',
        },
        VYM: {
            name: 'Vanguard High Dividend Yield ETF',
            company: 'Vanguard',
            index: 'FTSE High Dividend Yield Index',
            description: '배당수익률이 높은 미국 주식에 폭넓게 투자합니다.',
            url: 'https://investor.vanguard.com/investment-products/etfs/profile/vym',
        },
    };
    const etfSymbol = (row) =>
        String(row.ticker || row.etf || '').toUpperCase();
    const profile = (row) => etfProfiles[etfSymbol(row)];
    const props = defineProps({ symbol: { type: String, required: true } });
    const data = ref(null),
        loading = ref(false),
        failed = ref(false),
        asOf = ref('');
    useFullscreenLoading(loading, '누적 분석 데이터를 불러오고 있습니다.');
    let sequence = 0;
    const safeUrl = (value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : null;
        } catch {
            return null;
        }
    };
    const labels = {
        available: '확인됨',
        provider_adjusted_estimate: '조정 종가 추정',
        not_available: '미확인',
        insufficient_history: '이력 부족',
        insufficient_adjusted_history: '조정 이력 부족',
        needs_corporate_action_review: '분할 보정 확인 필요',
        no_prior_dividends: '전년 배당 없음',
        conflicting_sources: '출처 간 차이 확인 필요',
        collected: '수집 완료',
        partial: '일부 항목 누락',
        unavailable: '조회 불가',
        ineligible: '수집 대상 아님',
    };
    const label = (value) => labels[value] ?? '미확인';
    const number = (value, suffix = '') =>
        value == null || value === '' || !Number.isFinite(Number(value))
            ? '—'
            : `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${suffix}`;
    const metrics = computed(() => {
        const d = data.value ?? {},
            p = d.performance ?? {},
            q = d.quote ?? {},
            c = d.dividendCapacity ?? {};
        return [
            ['1년 총수익률', p.totalReturn1Y, '%'],
            ['최근 12개월 주당 분배금', p.ttmDividendPerShare, ' USD'],
            ['최근 12개월 분배수익률', p.ttmDividendYield, '%'],
            ['전년 대비 배당 증감', p.ttmDividendGrowth, '%'],
            ['이익 배당성향', q.reportedPayoutRatio, '%'],
            ['FCF 배당성향', c.fcfPayoutRatio, '%'],
            ['운용 보수', d.fund?.expenseRatio, '%'],
            ['운용자산', q.assetsUnderManagement, ' USD'],
            ['시가총액', q.marketCap, ' USD'],
            ['평균 거래량', q.averageDailyVolume, '주'],
            ['현재 호가 스프레드', q.bidAskSpread, '%'],
            ['NAV 관측값', q.navSnapshot, ' USD'],
        ];
    });
    const metricGroups = computed(() => [
        {
            key: 'core',
            title: '핵심 수익 및 연간 분배 지표',
            rows: metrics.value.slice(0, 3),
        },
        {
            key: 'trading',
            title: '상품 및 거래 정보',
            rows: [6, 11, 7, 10, 9, 8].map((index) => metrics.value[index]),
        },
    ]);
    watch(
        () => props.symbol,
        async (value) => {
            const current = ++sequence,
                symbol = String(value)
                    .trim()
                    .toUpperCase()
                    .replaceAll('.', '-');
            basisHelp.value?.hide();
            data.value = null;
            failed.value = false;
            loading.value = true;
            try {
                const bucket =
                    [...symbol].reduce(
                        (sum, char) => sum + char.charCodeAt(0),
                        0
                    ) % 64;
                const payload = await readPublicJson(
                    getAssetUrl(`security-insights/${bucket}.json`),
                    {
                        ttlMs: 180_000,
                        validate: (value) =>
                            value?.securities &&
                            typeof value.securities === 'object',
                    }
                );
                if (current === sequence) {
                    data.value = payload.securities[symbol] ?? null;
                    asOf.value = payload.asOfDate;
                }
            } catch {
                if (current === sequence) failed.value = true;
            } finally {
                if (current === sequence) loading.value = false;
            }
        },
        { immediate: true }
    );
</script>

<template>
    <slot
        name="history"
        :observations="data?.rocObservations ?? []"
        :loading="loading"
        :failed="failed" />
    <section
        class="security-insights"
        aria-labelledby="insights-heading"
        :aria-busy="loading">
        <header class="insights-header">
            <div class="insights-title">
                <h2 id="insights-heading">{{ symbol }} 누적 데이터</h2>
                <InfoHelp
                    v-if="data"
                    ref="basisHelp"
                    label="누적 데이터 기준 및 출처 안내"
                    :text="basisText">
                    <p v-if="safeUrl(data.sourceUrl)">
                        지표 출처:
                        <a
                            :href="safeUrl(data.sourceUrl)"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ data.source || 'Yahoo Finance' }}</a
                        >
                    </p>
                </InfoHelp>
            </div>
            <p v-if="data" class="collection-status">
                <span
                    ><i class="pi pi-calendar" aria-hidden="true" /> 수집 기준일
                    {{ data.collectedAt?.slice(0, 10) || asOf }}</span
                >
                <span>{{ label(data.status) }}</span>
            </p>
        </header>
        <p v-if="loading" role="status">누적 데이터를 불러오는 중…</p>
        <p v-else-if="failed" role="status">
            누적 데이터를 불러오지 못했습니다. 잠시 후 페이지를 새로고침해
            주세요.
        </p>
        <p v-else-if="!data">아직 이 종목의 누적 데이터가 없습니다.</p>
        <template v-else>
            <p v-if="data.performance?.freshness === 'stale'" class="notice">
                가격 갱신이 지연된 데이터입니다. 각 지표의 기준일을 확인해
                주세요.
            </p>
            <section
                v-for="group in metricGroups"
                :key="group.key"
                class="metric-section"
                :aria-label="group.title">
                <h3>{{ group.title }}</h3>
                <div class="metric-grid" :class="group.key">
                    <InsightMetricCard
                        v-for="[name, metric, suffix] in group.rows"
                        :key="name"
                        :name="name"
                        :metric="metric"
                        :suffix="suffix"
                        :featured="group.key === 'core'" />
                </div>
            </section>
            <details
                class="fundamentals"
                :open="fundamentalsOpen"
                @toggle="fundamentalsOpen = $event.target.open">
                <summary>
                    <span
                        ><i class="pi pi-building-columns" aria-hidden="true" />
                        배당 지속성 및 펀더멘털</span
                    ><i class="pi pi-chevron-down" aria-hidden="true" />
                </summary>
                <div class="metric-grid fundamentals-grid">
                    <InsightMetricCard
                        v-for="[name, metric, suffix] in metrics.slice(3, 6)"
                        :key="name"
                        :name="name"
                        :metric="metric"
                        :suffix="suffix" />
                </div>
            </details>
            <details v-if="data.navHistory?.status === 'available'">
                <summary>공식 NAV 기록 요약</summary>
                <p>
                    {{ data.navHistory.availableStart }} ~
                    {{ data.navHistory.asOfDate }} ·
                    {{ data.navHistory.rowCount }}개 관측
                </p>
                <p>
                    분배금 제외 NAV 변화
                    {{
                        number(
                            data.navHistory.availablePeriodPriceChangePercent,
                            '%'
                        )
                    }}
                    (가용 기간 기준)
                </p>
                <a
                    v-if="safeUrl(data.navHistory.sourceUrl)"
                    :href="safeUrl(data.navHistory.sourceUrl)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >운용사 원문</a
                >
            </details>
            <details
                v-if="data.dividendCapacity?.quarterlyObservations?.length">
                <summary>배당 지급 여력의 분기별 근거</summary>
                <p>
                    보고 통화: {{ data.financialCurrency || '미확인' }} ·
                    현금배당은 제공처의 지출 부호를 유지합니다.
                </p>
                <div class="table-scroll" tabindex="0">
                    <table>
                        <thead>
                            <tr>
                                <th>분기 종료일</th>
                                <th>잉여현금흐름</th>
                                <th>현금배당</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="row in data.dividendCapacity
                                    .quarterlyObservations"
                                :key="row.periodEnd">
                                <td>{{ row.periodEnd }}</td>
                                <td>{{ number(row.freeCashFlow) }}</td>
                                <td>{{ number(row.cashDividendsPaid) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </details>
            <details v-if="data.officialDistributionCalendar?.length">
                <summary>공식 배당 일정 이력</summary>
                <div class="table-scroll" tabindex="0">
                    <table>
                        <thead>
                            <tr>
                                <th>배당락일</th>
                                <th>지급일</th>
                                <th>출처</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="row in data.officialDistributionCalendar"
                                :key="`${row.exDate}-${row.payableDate}`">
                                <td>{{ row.exDate || '미확인' }}</td>
                                <td>{{ row.payableDate || '미확인' }}</td>
                                <td>
                                    <a
                                        v-if="safeUrl(row.sourceUrl)"
                                        :href="safeUrl(row.sourceUrl)"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        >운용사</a
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </details>
            <section
                v-if="data.dividendEtfs?.length"
                class="holding-etfs"
                aria-labelledby="holding-etfs-heading">
                <h3 id="holding-etfs-heading">배당 ETF 편입 근거</h3>
                <p class="basis">
                    편입 비중은 각 기준일의 ETF 보유 자료 기준입니다.
                </p>
                <div class="holding-etf-grid">
                    <article
                        v-for="row in data.dividendEtfs"
                        :key="etfSymbol(row)"
                        class="holding-etf-card">
                        <div class="holding-etf-title">
                            <router-link :to="'/stock/' + etfSymbol(row)">{{
                                etfSymbol(row)
                            }}</router-link
                            ><span v-if="profile(row)">{{
                                profile(row).company
                            }}</span>
                        </div>
                        <h4>
                            {{
                                profile(row)?.name ||
                                row.name ||
                                `${etfSymbol(row)} ETF`
                            }}
                        </h4>
                        <p v-if="profile(row)" class="holding-etf-description">
                            {{ profile(row).description }}
                        </p>
                        <dl>
                            <div>
                                <dt>ETF 내 {{ symbol }} 비중</dt>
                                <dd>{{ number(row.weightPercent, '%') }}</dd>
                            </div>
                            <div>
                                <dt>보유 자료 기준일</dt>
                                <dd>{{ row.asOfDate || '기준일 미제공' }}</dd>
                            </div>
                            <div v-if="profile(row)">
                                <dt>추종 지수</dt>
                                <dd>{{ profile(row).index }}</dd>
                            </div>
                        </dl>
                        <div class="holding-etf-links">
                            <router-link :to="'/stock/' + etfSymbol(row)"
                                >ETF 상세 보기
                                <i class="pi pi-angle-right" aria-hidden="true"
                            /></router-link>
                            <a
                                v-if="safeUrl(row.sourceUrl)"
                                :href="safeUrl(row.sourceUrl)"
                                target="_blank"
                                rel="noopener noreferrer"
                                >편입 근거 원문
                                <i
                                    class="pi pi-external-link"
                                    aria-hidden="true"
                            /></a>
                            <a
                                v-if="profile(row)"
                                :href="profile(row).url"
                                target="_blank"
                                rel="noopener noreferrer"
                                >운용사 상품 안내</a
                            >
                        </div>
                    </article>
                </div>
            </section>
        </template>
    </section>
</template>

<style scoped>
    .security-insights {
        margin: 2rem 0;
        padding: 24px;
        border: 1px solid var(--p-content-border-color, #dbe3ee);
        border-radius: 20px;
        background: var(--app-surface-muted);
        color: var(--p-text-color, #172033);
    }
    header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
    }
    h2 {
        margin: 0 0 1rem;
        font-size: 1.3rem;
    }
    h3 {
        font-size: 1rem;
    }
    .insights-title {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .insights-title h2 {
        margin: 0;
    }
    .insights-title > .p-button {
        min-width: 44px;
        min-height: 44px;
    }
    .security-insights > header {
        align-items: center;
        margin-bottom: 16px;
    }
    .holding-etfs {
        margin-top: 20px;
    }
    .holding-etfs > h3 {
        margin-bottom: 6px;
    }
    .holding-etf-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
        gap: 16px;
    }
    .holding-etf-card {
        border: 1px solid var(--app-border);
        border-radius: 14px;
        padding: 18px;
        background: var(--app-surface);
        min-width: 0;
    }
    .holding-etf-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .holding-etf-title > a {
        color: var(--app-accent);
        font-size: 21px;
        font-weight: 750;
        text-decoration: none;
    }
    .holding-etf-title > span {
        font-size: 12px;
        color: var(--app-muted);
    }
    .holding-etf-card h4 {
        margin: 8px 0;
        font-size: 14px;
    }
    .holding-etf-description {
        color: var(--app-muted);
        line-height: 1.6;
        font-size: 13px;
    }
    .holding-etf-card dl {
        margin: 16px 0;
        display: grid;
        gap: 12px;
        padding-top: 14px;
        border-top: 1px solid var(--app-border-subtle);
    }
    .holding-etf-card dl > div {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 12px;
    }
    .holding-etf-card dt {
        font-size: 12px;
        color: var(--app-muted);
    }
    .holding-etf-card dd {
        margin: 0;
        text-align: right;
        overflow-wrap: anywhere;
        font-size: 13px;
        font-variant-numeric: tabular-nums;
    }
    .holding-etf-links {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
    }
    .holding-etf-links a {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--app-accent);
        font-size: 12px;
        min-height: 44px;
    }
    small {
        display: block;
        margin-top: 6px;
        font-size: 12px;
        color: var(--app-muted);
    }
    .basis {
        font-size: 0.85rem;
        line-height: 1.7;
        color: var(--p-text-muted-color, #5b6575);
    }
    .table-scroll {
        overflow: auto;
        max-height: 420px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
        white-space: nowrap;
    }
    th,
    td {
        padding: 0.75rem;
        text-align: left;
        border-bottom: 1px solid var(--p-content-border-color, #dbe3ee);
    }
    th {
        position: sticky;
        top: 0;
        background: var(--p-content-background, #fff);
    }
    a {
        color: var(--app-accent);
        text-decoration: underline;
    }
    details {
        margin-top: 1rem;
        padding: 1rem;
        border: 1px solid var(--p-content-border-color, #dbe3ee);
        border-radius: 8px;
    }
    summary {
        cursor: pointer;
        font-weight: 600;
    }
    .notice {
        color: #9a3412;
    }
    .insights-header {
        background: var(--app-surface);
        border-radius: 16px;
        padding: 16px 20px;
        align-items: center;
    }
    .insights-title h2 {
        margin: 0;
        font-size: 19px;
    }
    .insights-title::before {
        content: '';
        width: 5px;
        height: 24px;
        border-radius: 4px;
        background: var(--app-accent);
        flex: none;
    }
    .collection-status {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0;
        font-size: 12px;
        color: var(--app-muted);
    }
    .collection-status span {
        background: var(--app-surface-muted);
        border-radius: 8px;
        padding: 8px 10px;
    }
    .metric-section {
        margin-top: 28px;
    }
    .metric-section > h3 {
        margin: 0 0 14px;
        font-size: 15px;
    }
    .metric-grid {
        display: grid;
        gap: 14px;
    }
    .metric-grid.core,
    .fundamentals-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .metric-grid.trading {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    details.fundamentals {
        padding: 0;
        border: 0;
        margin-top: 28px;
    }
    .fundamentals > summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 15px;
        min-height: 48px;
        list-style: none;
    }
    .fundamentals > summary::-webkit-details-marker {
        display: none;
    }
    .fundamentals > summary span {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .fundamentals[open] > summary > i {
        transform: rotate(180deg);
    }
    .fundamentals-grid {
        margin-top: 12px;
    }
    @media (max-width: 900px) and (min-width: 601px) {
        .metric-grid.core {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 600px) {
        .security-insights {
            padding: 16px;
            margin: 24px 0;
        }
        .insights-header {
            background: transparent;
            padding: 0;
            gap: 6px;
        }
        .insights-title h2 {
            font-size: 17px;
        }
        .insights-title {
            gap: 4px;
        }
        .insights-title::before {
            display: none;
        }
        .collection-status {
            font-size: 11px;
        }
        .collection-status span {
            background: var(--app-surface);
        }
        .metric-grid.core,
        .fundamentals-grid {
            grid-template-columns: 1fr;
        }
        .metric-grid.trading {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .metric-section {
            margin-top: 24px;
        }
        details.fundamentals {
            background: var(--app-surface);
            border-radius: 14px;
            padding: 8px 16px;
        }
        .fundamentals-grid {
            padding-bottom: 8px;
        }
    }
</style>
