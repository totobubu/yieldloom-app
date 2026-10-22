<script setup>
    import { ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import InsightMetricCard from '@/components/thumbnail/InsightMetricCard.vue';
    import { loadOfficialFund } from '@/services/officialFundData.js';

    const props = defineProps({ symbol: { type: String, required: true } });
    const data = ref(null),
        holdings = ref(null),
        loading = ref(false),
        failed = ref(false);
    const holdingsLoading = ref(false),
        holdingsFailed = ref(false),
        holdingsOpen = ref(false);
    const retry = ref(0);
    let controller;
    const labels = {
        nav: 'NAV',
        aum: '운용자산',
        sharesOutstanding: '발행주식 수',
        closingPrice: '종가',
        medianSpread30D: '30일 중앙 호가 스프레드',
        secYield30D: '30일 SEC 수익률',
        trailingYield12M: '최근 12개월 수익률',
    };
    const suffix = (row) =>
        row.unit === 'percent'
            ? '%'
            : row.unit === 'shares'
              ? '주'
              : row.currency || '';
    const stale = (row, payload) => {
        const limit = ['secYield30D', 'trailingYield12M'].includes(row.field)
            ? 60
            : 5;
        const checked = payload.inputVersions?.[row.sourceId]?.lastSuccessAt;
        return (
            Date.now() - Date.parse(row.asOfDate) > limit * 86400000 ||
            Boolean(checked && Date.now() - Date.parse(checked) > 48 * 3600000)
        );
    };
    const safeUrl = (value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password
                ? url.href
                : null;
        } catch {
            return null;
        }
    };
    const weight = (value) =>
        value == null
            ? '미확인'
            : `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}%`;
    watch(
        [() => props.symbol, retry],
        async (_, __, cleanup) => {
            controller = new AbortController();
            const active = controller;
            cleanup(() => active.abort());
            data.value = holdings.value = null;
            failed.value = holdingsFailed.value = holdingsOpen.value = false;
            loading.value = true;
            holdingsLoading.value = false;
            try {
                const result = await loadOfficialFund(
                    props.symbol,
                    'fund-observations',
                    { signal: active.signal }
                );
                if (!active.signal.aborted) data.value = result;
            } catch {
                if (!active.signal.aborted) failed.value = true;
            } finally {
                if (!active.signal.aborted) loading.value = false;
            }
        },
        { immediate: true }
    );
    async function showHoldings() {
        holdingsOpen.value = true;
        if (holdings.value || holdingsLoading.value) return;
        const active = controller;
        holdingsLoading.value = true;
        holdingsFailed.value = false;
        try {
            const result = await loadOfficialFund(props.symbol, 'holdings', {
                signal: active.signal,
            });
            if (!active.signal.aborted) holdings.value = result;
        } catch {
            if (!active.signal.aborted) holdingsFailed.value = true;
        } finally {
            if (!active.signal.aborted) holdingsLoading.value = false;
        }
    }
</script>
<template>
    <section class="official-fund-data" aria-labelledby="official-fund-title">
        <h3 id="official-fund-title">공식 ETF 운용정보</h3>
        <p v-if="loading" role="status">공식 운용정보를 불러오는 중입니다.</p>
        <Message v-else-if="failed" severity="warn" :closable="false">
            공식 운용정보를 불러오지 못했습니다.
            <Button label="다시 시도" text @click="retry++" />
        </Message>
        <p v-else-if="!data">
            이 종목의 공식 운용정보가 아직 제공되지 않습니다.
        </p>
        <template v-else>
            <div class="official-metrics">
                <div
                    v-for="row in data.observations"
                    :key="`${row.field}:${row.sourceId}:${row.asOfDate}`">
                    <InsightMetricCard
                        :name="labels[row.field] || row.field"
                        :metric="{ ...row, status: 'available' }"
                        :suffix="suffix(row)" />
                    <a
                        v-if="safeUrl(row.sourceUrl)"
                        :href="safeUrl(row.sourceUrl)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >공식 출처<span
                            v-if="row.qualifiers?.scope === 'holdings_file'">
                            · 보유자산 파일</span
                        ></a
                    >
                    <small v-if="stale(row, data)" role="status"
                        >기준일 또는 갱신 확인이 지난 자료입니다.</small
                    >
                </div>
            </div>
            <p
                v-for="policy in data.policies"
                :key="policy.citation"
                class="hint">
                출처: {{ policy.citation }}
            </p>
            <Button
                label="보유자산 요약 보기"
                :loading="holdingsLoading"
                :aria-expanded="holdingsOpen"
                aria-controls="official-holdings"
                @click="showHoldings" />
            <div v-if="holdingsOpen" id="official-holdings" aria-live="polite">
                <p v-if="holdingsLoading">보유자산을 불러오는 중입니다.</p>
                <Message
                    v-else-if="holdingsFailed"
                    severity="warn"
                    :closable="false"
                    >보유자산을 불러오지 못했습니다.
                    <Button label="다시 시도" text @click="showHoldings"
                /></Message>
                <template v-else-if="holdings">
                    <p>
                        공식 파일 {{ holdings.positionCount }}개 항목 중 비중
                        상위 {{ holdings.observations.length }}개 · 기준
                        {{ holdings.observations[0]?.asOfDate }}
                    </p>
                    <ul>
                        <li
                            v-for="row in holdings.observations"
                            :key="row.qualifiers.rowKey">
                            {{ row.value.Name }} ({{ row.value.Ticker }}) ·
                            {{ weight(row.value['Weight (%)']) }}
                        </li>
                    </ul>
                    <a
                        v-if="safeUrl(holdings.observations[0]?.sourceUrl)"
                        :href="safeUrl(holdings.observations[0]?.sourceUrl)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >공식 보유자산 파일</a
                    >
                </template>
                <p v-else>보유자산 요약이 아직 제공되지 않습니다.</p>
            </div>
        </template>
    </section>
</template>
<style scoped>
    .official-fund-data {
        margin-block: 1.5rem;
        min-width: 0;
    }
    .official-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
    }
    a {
        display: inline-block;
        color: var(--app-primary, var(--p-primary-color));
        margin-block: 0.5rem;
    }
    li,
    p {
        overflow-wrap: anywhere;
    }
</style>
