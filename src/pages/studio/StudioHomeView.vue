<script setup lang="ts">
    import { computed, onMounted, ref } from 'vue';
    import { useHead } from '@vueuse/head';

    type DashboardSnapshot = {
        generatedAt: string | null;
        counts: Record<string, number>;
        providers: Array<{
            slug: string;
            display_name: string;
            enabled: number;
            last_fetched_at: string | null;
            source_count: number;
            event_count: number;
            last_attempt_status: string | null;
            last_attempt_message: string | null;
            last_fetch_mode: string | null;
            last_attempt_at: string | null;
        }>;
        recentEvents: Array<{
            id: number;
            provider_slug: string;
            ticker: string;
            fund_name: string | null;
            distribution_per_share: string;
            currency: string;
            declared_date: string;
            ex_date: string;
            payable_date: string | null;
            official_url: string;
            verification_status: string;
        }>;
        openFindings: Array<{
            id: number;
            severity: string;
            code: string;
            message: string;
            provider_slug: string | null;
            ticker: string | null;
        }>;
        recentRuns: Array<{
            id: number;
            provider_slug: string | null;
            started_at: string;
            status: string;
            accepted_count: number;
            rejected_count: number;
        }>;
    };

    const emptySnapshot: DashboardSnapshot = {
        generatedAt: null,
        counts: {},
        providers: [],
        recentEvents: [],
        openFindings: [],
        recentRuns: [],
    };

    const dashboard = ref<DashboardSnapshot>(emptySnapshot);
    const recommendations = ref<
        Array<{
            topic: string;
            score: number;
            sampleSize: number;
            totalViews: number;
            tickers: string[];
            bestPlatform: string;
            reason: string;
        }>
    >([]);
    const priceQuality = ref<{
        generatedAt: string;
        summary: { priced: number; missing: number; stale: number };
        findings: Array<{
            ticker: string;
            status: string;
            message: string;
            priceDate?: string;
        }>;
    }>({
        generatedAt: '',
        summary: { priced: 0, missing: 0, stale: 0 },
        findings: [],
    });
    const isLoading = ref(true);
    const error = ref('');
    const activeProvider = ref('all');

    const recentProviderTabs = computed(() => [
        { slug: 'all', label: '전체' },
        ...dashboard.value.providers
            .filter((provider) =>
                dashboard.value.recentEvents.some(
                    (event) => event.provider_slug === provider.slug
                )
            )
            .map((provider) => ({
                slug: provider.slug,
                label: provider.display_name,
            })),
    ]);

    const visibleRecentEvents = computed(() =>
        activeProvider.value === 'all'
            ? dashboard.value.recentEvents
            : dashboard.value.recentEvents.filter(
                  (event) => event.provider_slug === activeProvider.value
              )
    );

    useHead({
        title: '콘텐츠 스튜디오',
        meta: [{ name: 'robots', content: 'noindex, nofollow' }],
    });

    const metricCards = computed(() => [
        {
            label: '공급자',
            value: dashboard.value.counts.providers || 0,
            detail: '활성 공식 소스',
        },
        {
            label: '공식 원문',
            value: dashboard.value.counts.source_documents || 0,
            detail: '해시 보존 문서',
        },
        {
            label: '배당 이벤트',
            value: dashboard.value.counts.distribution_events || 0,
            detail: '정규화 누적',
        },
        {
            label: '검토 대기',
            value: dashboard.value.openFindings.length,
            detail: '미해결 검증 항목',
            attention: dashboard.value.openFindings.length > 0,
        },
        {
            label: '가격 품질',
            value:
                priceQuality.value.summary.missing +
                priceQuality.value.summary.stale,
            detail: `${priceQuality.value.summary.priced}개 가격 연결`,
            attention:
                priceQuality.value.summary.missing +
                    priceQuality.value.summary.stale >
                0,
        },
    ]);

    const formatTimestamp = (value: string | null) => {
        if (!value) return '아직 없음';
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime())
            ? value
            : new Intl.DateTimeFormat('ko-KR', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
              }).format(parsed);
    };

    const statusLabel = (status: string) =>
        ({
            official: '공식 확인',
            cross_checked: '교차 검증',
            needs_review: '검토 필요',
            detected: '감지',
            rejected: '제외',
        })[status] || status;

    const loadDashboard = async () => {
        isLoading.value = true;
        error.value = '';
        try {
            const [response, recommendationResponse, priceResponse] =
                await Promise.all([
                    fetch(`/content-studio/dashboard.json?t=${Date.now()}`, {
                        cache: 'no-store',
                    }),
                    fetch(
                        `/content-studio/recommendations.json?t=${Date.now()}`,
                        {
                            cache: 'no-store',
                        }
                    ),
                    fetch(
                        `/content-studio/price-quality.json?t=${Date.now()}`,
                        { cache: 'no-store' }
                    ),
                ]);
            if (!response.ok) {
                throw new Error(
                    `대시보드 스냅샷을 읽지 못했습니다 (${response.status})`
                );
            }
            dashboard.value = await response.json();
            if (
                activeProvider.value !== 'all' &&
                !dashboard.value.providers.some(
                    (provider) => provider.slug === activeProvider.value
                )
            ) {
                activeProvider.value = 'all';
            }
            if (recommendationResponse.ok) {
                const payload = await recommendationResponse.json();
                recommendations.value = payload.recommendations || [];
            }
            if (priceResponse.ok)
                priceQuality.value = await priceResponse.json();
        } catch (loadError) {
            error.value =
                loadError instanceof Error
                    ? loadError.message
                    : '대시보드를 불러오지 못했습니다.';
        } finally {
            isLoading.value = false;
        }
    };

    onMounted(loadDashboard);
</script>

<template>
    <section class="studio-dashboard">
        <header class="dashboard-heading">
            <div>
                <p class="eyebrow">OFFICIAL DISTRIBUTION INTELLIGENCE</p>
                <h1>배당 콘텐츠 관제실</h1>
                <p class="lead">
                    공식 발표 수집부터 검증, 콘텐츠 제작 대기 상태까지
                    확인합니다.
                </p>
            </div>
            <div class="snapshot-state">
                <span>마지막 스냅샷</span>
                <strong>{{ formatTimestamp(dashboard.generatedAt) }}</strong>
                <button type="button" @click="loadDashboard">새로고침</button>
            </div>
        </header>

        <p v-if="error" class="error-banner">{{ error }}</p>

        <div class="metric-grid" :class="{ loading: isLoading }">
            <article
                v-for="metric in metricCards"
                :key="metric.label"
                class="metric-card"
                :class="{ attention: metric.attention }">
                <span>{{ metric.label }}</span>
                <strong>{{ metric.value.toLocaleString() }}</strong>
                <small>{{ metric.detail }}</small>
            </article>
        </div>

        <div class="dashboard-grid">
            <article class="panel panel-wide">
                <header class="panel-heading">
                    <div>
                        <p class="panel-kicker">RECENT EVENTS</p>
                        <h2>최근 배당 발표</h2>
                    </div>
                    <span>{{ visibleRecentEvents.length }}건</span>
                </header>
                <div
                    class="provider-tabs"
                    role="tablist"
                    aria-label="운용사별 최근 배당 발표">
                    <button
                        v-for="tab in recentProviderTabs"
                        :key="tab.slug"
                        type="button"
                        role="tab"
                        :aria-selected="activeProvider === tab.slug"
                        :class="{ active: activeProvider === tab.slug }"
                        @click="activeProvider = tab.slug">
                        {{ tab.label }}
                    </button>
                </div>
                <div v-if="visibleRecentEvents.length" class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>공급자</th>
                                <th>티커</th>
                                <th>배당금</th>
                                <th>배당락일</th>
                                <th>상태</th>
                                <th>원문</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="event in visibleRecentEvents"
                                :key="event.id">
                                <td>{{ event.provider_slug }}</td>
                                <td>
                                    <strong>{{ event.ticker }}</strong>
                                </td>
                                <td>${{ event.distribution_per_share }}</td>
                                <td>{{ event.ex_date }}</td>
                                <td>
                                    <span
                                        class="status-chip"
                                        :data-status="
                                            event.verification_status
                                        ">
                                        {{
                                            statusLabel(
                                                event.verification_status
                                            )
                                        }}
                                    </span>
                                </td>
                                <td>
                                    <a
                                        :href="event.official_url"
                                        target="_blank"
                                        rel="noreferrer"
                                        >보기</a
                                    >
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-else class="empty-state">
                    아직 누적된 배당 이벤트가 없습니다. 공식 수집기를 실행하면
                    여기에 표시됩니다.
                </p>
            </article>

            <article class="panel">
                <header class="panel-heading">
                    <div>
                        <p class="panel-kicker">SOURCE HEALTH</p>
                        <h2>공급자 상태</h2>
                    </div>
                </header>
                <ul v-if="dashboard.providers.length" class="source-list">
                    <li
                        v-for="provider in dashboard.providers"
                        :key="provider.slug">
                        <div>
                            <strong>{{ provider.display_name }}</strong>
                            <span>{{
                                [
                                    provider.last_fetch_mode || '미실행',
                                    provider.last_attempt_status || '기록 없음',
                                    formatTimestamp(
                                        provider.last_attempt_at ||
                                            provider.last_fetched_at
                                    ),
                                ].join(' · ')
                            }}</span>
                            <span v-if="provider.last_attempt_message">{{
                                provider.last_attempt_message
                            }}</span>
                        </div>
                        <b>{{ provider.event_count }} events</b>
                    </li>
                </ul>
                <p v-else class="empty-state">등록된 공급자가 없습니다.</p>
            </article>

            <article class="panel">
                <header class="panel-heading">
                    <div>
                        <p class="panel-kicker">PRICE QUALITY</p>
                        <h2>가격 커버리지</h2>
                    </div>
                    <router-link to="/dividend-calendar?price=attention"
                        >필터 보기</router-link
                    >
                </header>
                <p class="empty-state">
                    Yahoo EOD 가격 {{ priceQuality.summary.priced }}개 · 누락
                    {{ priceQuality.summary.missing }}개 · 노후
                    {{ priceQuality.summary.stale }}개
                </p>
                <ul v-if="priceQuality.findings.length" class="finding-list">
                    <li
                        v-for="finding in priceQuality.findings.slice(0, 6)"
                        :key="finding.ticker">
                        <span data-severity="warning">{{
                            finding.status
                        }}</span>
                        <div>
                            <strong>{{ finding.ticker }}</strong>
                            <p>{{ finding.message }}</p>
                        </div>
                    </li>
                </ul>
                <p v-else class="empty-state">
                    가격 누락 또는 노후 종목이 없습니다.
                </p>
            </article>

            <article class="panel">
                <header class="panel-heading">
                    <div>
                        <p class="panel-kicker">QUALITY GATE</p>
                        <h2>검토 대기</h2>
                    </div>
                </header>
                <ul v-if="dashboard.openFindings.length" class="finding-list">
                    <li
                        v-for="finding in dashboard.openFindings"
                        :key="finding.id">
                        <span :data-severity="finding.severity">{{
                            finding.severity
                        }}</span>
                        <div>
                            <strong>{{
                                finding.ticker || finding.code
                            }}</strong>
                            <p>{{ finding.message }}</p>
                        </div>
                    </li>
                </ul>
                <p v-else class="empty-state">미해결 검증 항목이 없습니다.</p>
            </article>

            <article class="panel panel-wide">
                <header class="panel-heading">
                    <div>
                        <p class="panel-kicker">NEXT TOPICS</p>
                        <h2>다음 콘텐츠 추천</h2>
                    </div>
                </header>
                <ol v-if="recommendations.length" class="recommendation-list">
                    <li v-for="item in recommendations" :key="item.topic">
                        <strong>{{ item.topic }}</strong>
                        <span>{{ item.score.toFixed(1) }}점</span>
                        <p>{{ item.reason }}</p>
                    </li>
                </ol>
                <p v-else class="empty-state">
                    게시 성과 CSV를 가져오면 다음 제작 주제를 추천합니다.
                </p>
            </article>
        </div>
    </section>
</template>

<style scoped>
    .studio-dashboard {
        display: grid;
        gap: 1.5rem;
    }

    .dashboard-heading {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 2rem;
    }

    .eyebrow,
    .panel-kicker {
        margin: 0 0 0.45rem;
        color: var(--studio-accent);
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.12em;
    }

    h1,
    h2,
    p {
        margin-top: 0;
    }

    h1 {
        margin-bottom: 0.6rem;
        font-size: clamp(2rem, 5vw, 3.8rem);
        line-height: 1;
    }

    .lead,
    .snapshot-state span,
    .metric-card small,
    .source-list span {
        color: var(--studio-muted);
    }

    .snapshot-state {
        display: grid;
        min-width: 14rem;
        gap: 0.25rem;
        text-align: right;
    }

    .snapshot-state button {
        justify-self: end;
        margin-top: 0.4rem;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--studio-accent);
        cursor: pointer;
    }

    .metric-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 1rem;
    }

    .metric-card,
    .panel {
        border: 1px solid var(--studio-border);
        border-radius: 1rem;
        background: var(--studio-surface);
    }

    .metric-card {
        display: grid;
        gap: 0.35rem;
        padding: 1.25rem;
    }

    .metric-card strong {
        font-size: 2.25rem;
    }

    .metric-card.attention {
        border-color: var(--studio-warning);
    }

    .dashboard-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
    }

    .panel {
        min-width: 0;
        padding: 1.25rem;
    }

    .panel-wide {
        grid-column: 1 / -1;
    }

    .panel-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1rem;
    }

    .panel-heading h2 {
        margin-bottom: 0;
    }

    .table-wrap {
        overflow-x: auto;
    }

    .provider-tabs {
        display: flex;
        gap: 0.45rem;
        overflow-x: auto;
        margin: -0.2rem 0 0.85rem;
        padding-bottom: 0.2rem;
    }

    .provider-tabs button {
        flex: 0 0 auto;
        border: 1px solid var(--studio-border);
        border-radius: 999px;
        background: var(--studio-surface-subtle);
        color: var(--studio-muted);
        cursor: pointer;
        font: inherit;
        font-size: 0.8rem;
        padding: 0.4rem 0.7rem;
    }

    .provider-tabs button.active {
        border-color: var(--studio-accent);
        background: color-mix(in srgb, var(--studio-accent) 15%, transparent);
        color: var(--studio-accent);
        font-weight: 800;
    }

    table {
        width: 100%;
        border-collapse: collapse;
    }

    th,
    td {
        padding: 0.8rem 0.65rem;
        border-bottom: 1px solid var(--studio-border);
        text-align: left;
        white-space: nowrap;
    }

    th {
        color: var(--studio-muted);
        font-size: 0.75rem;
        letter-spacing: 0.05em;
    }

    .status-chip,
    .finding-list > li > span {
        display: inline-flex;
        padding: 0.25rem 0.55rem;
        border-radius: 999px;
        background: var(--studio-surface-subtle);
        font-size: 0.75rem;
        font-weight: 700;
    }

    .status-chip[data-status='cross_checked'],
    .status-chip[data-status='official'] {
        background: color-mix(in srgb, var(--p-green-500) 16%, transparent);
        color: var(--studio-success);
    }

    .status-chip[data-status='needs_review'] {
        background: color-mix(in srgb, var(--p-orange-500) 16%, transparent);
        color: var(--studio-warning);
    }

    .source-list,
    .finding-list,
    .recommendation-list {
        display: grid;
        gap: 0.7rem;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .source-list li,
    .finding-list li,
    .recommendation-list li {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 0.9rem;
        border-radius: 0.75rem;
        background: var(--studio-surface-subtle);
    }

    .source-list div,
    .finding-list div {
        display: grid;
        gap: 0.2rem;
    }

    .finding-list p {
        margin-bottom: 0;
        color: var(--studio-muted);
    }

    .recommendation-list {
        counter-reset: recommendation;
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .recommendation-list li {
        display: grid;
        grid-template-columns: 1fr auto;
    }

    .recommendation-list p {
        grid-column: 1 / -1;
        margin: 0.25rem 0 0;
        color: var(--studio-muted);
    }

    .empty-state,
    .error-banner {
        margin-bottom: 0;
        padding: 1rem;
        border-radius: 0.75rem;
        background: var(--studio-surface-subtle);
        color: var(--studio-muted);
    }

    .error-banner {
        background: color-mix(in srgb, var(--p-red-500) 12%, transparent);
        color: var(--studio-danger);
    }

    @media (max-width: 760px) {
        .dashboard-heading {
            align-items: flex-start;
            flex-direction: column;
        }

        .snapshot-state {
            min-width: 0;
            text-align: left;
        }

        .snapshot-state button {
            justify-self: start;
        }

        .metric-grid,
        .dashboard-grid,
        .recommendation-list {
            grid-template-columns: 1fr;
        }
    }
</style>
