<script setup>
    import { computed } from 'vue';
    import ThumbnailCardShell from './ThumbnailCardShell.vue';

    const props = defineProps({ data: { type: Object, required: true } });
    const usd = (value, digits = 4) =>
        value != null && Number.isFinite(Number(value))
            ? `$${Number(value)
                  .toFixed(digits)
                  .replace(/\.?(0+)$/, '')}`
            : '데이터 없음';
    const date = (value) =>
        value ? String(value).replace(/-/g, '.') : '날짜 미정';
    const hasComparison = computed(
        () =>
            props.data.dividendDifference != null &&
            props.data.dividendChangePercent != null &&
            Number.isFinite(Number(props.data.dividendDifference)) &&
            Number.isFinite(Number(props.data.dividendChangePercent))
    );
    const change = computed(() => Number(props.data.dividendDifference));
    const changePercent = computed(() =>
        Number(props.data.dividendChangePercent)
    );
    const tone = computed(() =>
        change.value > 0 ? 'up' : change.value < 0 ? 'down' : 'flat'
    );
    const chartRows = computed(() => props.data.monthlyTotals ?? []);
    const historyRows = computed(() => chartRows.value.slice(-3));
</script>

<template>
    <ThumbnailCardShell
        class="summary-card"
        :class="tone"
        :title="data.symbol"
        context-label="최신 1건 배당 요약"
        :badge="data.referenceData ? '참고 배당 · 검토 필요' : '배당 정보'"
        date-label="배당락일"
        :date-value="date(data.exDate)"
        data-thumbnail-kind="summary">
        <template v-if="data.hasDividend">
            <section class="hero">
                <p>최신 1건 주당 배당금 <small>세전</small></p>
                <strong>{{ usd(data.currentDividendAmount, 6) }}</strong
                ><span v-if="hasComparison" :class="tone"
                    ><i>{{ change >= 0 ? '▲' : '▼' }}</i
                    >{{
                        Number.isFinite(changePercent)
                            ? `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`
                            : '변동 없음'
                    }}
                    <b
                        >({{ change >= 0 ? '+' : '' }}{{ usd(change, 6) }})</b
                    ></span
                ><span v-else class="flat"
                    >비교 불가{{
                        data.comparisonUnavailableReason
                            ? ` · ${data.comparisonUnavailableReason}`
                            : ''
                    }}</span
                >
            </section>
            <section class="metrics">
                <div>
                    <small>예상 세후 실수령</small
                    ><b>{{ usd(data.afterTaxDividendAmount, 6) }}</b
                    ><em>15% 원천징수</em>
                </div>
                <div>
                    <small>{{
                        data.referencePriceLabel || '배당락일 종가'
                    }}</small
                    ><b>{{ usd(data.exDividendClose, 2) }}</b
                    ><em>{{
                        data.usesLatestPrice
                            ? `${data.referencePriceDate} 기준`
                            : 'USD 기준'
                    }}</em>
                </div>
                <div>
                    <small>최신 1건 배당률</small
                    ><b>{{
                        data.exDividendYield != null
                            ? `${Number(data.exDividendYield).toFixed(2)}%`
                            : '—'
                    }}</b
                    ><em
                        >{{
                            data.referencePriceLabel || '배당락일 종가'
                        }}
                        기준</em
                    >
                </div>
            </section>
        </template>
        <p v-else class="unavailable">
            표시할 배당 이력을 확인하지 못했습니다.
        </p>
        <section v-if="historyRows.length" class="history">
            <header>
                <b>최근 3개월 배당금 추이</b
                ><small class="history-legend"><i />이전 월 <i />이번 달</small>
            </header>
            <div class="history-cells">
                <article
                    v-for="(row, index) in historyRows"
                    :key="row.month"
                    :class="{
                        latest:
                            index === historyRows.length - 1 &&
                            row.total != null,
                        missing: row.total == null,
                    }">
                    <span>{{ row.month }}</span
                    ><b>{{
                        row.total == null ? '자료 없음' : usd(row.total, 4)
                    }}</b
                    ><em v-if="row.partial">집계 중</em>
                </article>
            </div>
            <p class="history-note">
                배당락일 기준 세전 합계 ·
                {{ data.referenceData ? '참고 자료' : '당월 확정 공시 포함' }}
            </p>
        </section>
        <template #footer
            ><span v-if="data.referenceData"
                >Yahoo Finance 참고 배당 · 검토 필요 · </span
            >주당 USD 기준 · 세후 금액은 15% 원천징수 단순 가정</template
        >
    </ThumbnailCardShell>
</template>

<style scoped lang="scss">
    .summary-card :deep(.thumbnail-card-footer) {
        font-size: 14px;
    }

    .metrics small {
        display: block;
        color: #94a3b8;
        font-size: 16px;
        font-weight: 600;
    }

    .hero {
        display: flex;
        height: 100%;
        padding: 20px;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 1.5px solid #a7f3d0;
        border-radius: 24px;
        background: #ecfdf5;
        text-align: center;
    }

    .hero p {
        margin: 0;
        color: #64748b;
        font-size: 16px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }

    .hero p small {
        font-size: 12px;
    }

    .hero strong {
        display: block;
        margin: 12px 0;
        font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
        font-weight: 900;
        color: #047857;
        font-size: 52px;
        letter-spacing: -0.05em;
    }

    .hero span {
        display: inline-block;
        padding: 8px 14px;
        border: 1px solid #a7f3d0;
        border-radius: 999px;
        background: #d1fae5;
        color: #047857;
        font-size: 14px;
        font-weight: 800;

        i {
            font-style: normal;
        }
    }

    .hero span.down {
        border-color: #fca5a5;
        background: #fee2e2;
        color: #dc2626;
    }

    .hero span.flat {
        border-color: #e2e8f0;
        background: #f8fafc;
        color: #475569;
    }

    .summary-card.down :deep(.thumbnail-card-header p) {
        color: #dc2626;
    }

    .summary-card.down .hero {
        border-color: #fee2e2;
        background: #fef2f2;
    }

    .summary-card.down .hero strong {
        color: #dc2626;
    }

    .summary-card.flat :deep(.thumbnail-card-header p) {
        color: #475569;
    }

    .summary-card.flat .hero {
        border-color: #e2e8f0;
        background: #f8fafc;
    }

    .summary-card.flat .hero strong {
        color: #475569;
    }

    .metrics {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        padding: 20px 20px;
        border: 1px solid #e2e8f0;
        border-radius: 24px;
        background: #f8fafce6;
    }

    .metrics > div {
        padding: 0 8px;
        text-align: center;
        border-left: 1px solid #e2e8f0;
    }

    .metrics > div:first-child {
        border-left: 0;
    }

    .metrics b {
        display: block;
        margin: 7px 0 3px;
        color: #0f172a;
        font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
        font-size: 26px;
        font-weight: 800;
    }

    .metrics em {
        color: #94a3b8;
        font-size: 14px;
        font-style: normal;
        font-weight: 500;
    }

    .history {
        padding: 16px;
        border: 1px solid #e2e8f0;
        border-radius: 24px;
        background: #f8fafccc;
    }

    .history header {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
        padding: 0 4px;
    }

    .history header small {
        color: #94a3b8;
    }

    .history header b {
        color: #94a3b8;
        font-size: 16px;
        font-weight: 600;
    }

    .history-legend {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 14px;
        font-weight: 500;
    }

    .history-legend i {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #cbd5e1;
    }

    .history-legend i:last-child {
        background: #057a55;
    }

    .summary-card.down .history-legend i:last-child {
        background: #dc2626;
    }

    .summary-card.flat .history-legend i:last-child {
        background: #2563eb;
    }

    .history-cells {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
    }

    .history-cells article {
        position: relative;
        min-height: 48px;
        padding: 11px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        background: #fff;
    }

    .history-cells span {
        display: block;
        color: #94a3b8;
        font-size: 14px;
        font-weight: 700;
    }

    .history-cells b {
        display: block;
        margin-top: 6px;
        color: #334155;
        font-size: 20px;
        font-family: 'Plus Jakarta Sans', 'Pretendard', sans-serif;
        font-weight: 800;
    }

    .history-note {
        margin: 8px 4px 0;
        font-size: 12px;
        color: #64748b;
    }
    .history-cells .missing {
        border-style: dashed;
        background: #f1f5f9;
    }
    .history-cells .missing b {
        color: #64748b;
        font-size: 18px;
    }

    .history-cells .latest {
        border-color: #059669;
        background: #057a55;
        color: #fff;
    }

    .summary-card.down .history-cells .latest {
        border-color: #dc2626;
        background: #dc2626;
    }

    .history-cells .latest span {
        color: #d1fae5;
    }

    .history-cells .latest b {
        color: #fff;
    }

    .history-cells em {
        position: absolute;
        right: 9px;
        top: 9px;
        padding: 3px 5px;
        border-radius: 4px;
        background: #0003;
        color: #fff;
        font-size: 12px;
        font-style: normal;
    }

    .unavailable {
        margin: auto;
        text-align: center;
        font-size: 25px;
    }
    /* New source palette/layout; all existing latest-event metrics and history remain. */
    .summary-card {
        border-radius: 16px;
        font-family: 'Hanken Grotesk', sans-serif;
    }
    .summary-card :deep(.thumbnail-card-context-label) {
        background: #e6f4f2;
        color: #0d7a6e;
        border-radius: 6px;
    }
    .summary-card .hero {
        height: auto;
        min-height: 150px;
        flex: 1;
        align-items: flex-start;
        border: 0;
        border-radius: 12px;
        background: #f2f4f6;
        text-align: left;
    }
    .summary-card .hero strong {
        font-family: 'JetBrains Mono', monospace;
        font-size: 44px;
        letter-spacing: -0.03em;
    }
    .summary-card .metrics {
        padding: 16px;
        gap: 12px;
        border: 0;
        border-radius: 12px;
        background: #f2f4f6;
    }
    .summary-card .metrics > div {
        padding: 12px 8px;
        border: 0;
        border-radius: 8px;
        background: white;
    }
    .summary-card .metrics small {
        font-size: 14px;
        color: #64748b;
    }
    .summary-card .metrics b {
        font-family: 'JetBrains Mono', monospace;
        font-size: 24px;
    }
    .summary-card .metrics em {
        font-size: 12px;
    }
    .summary-card .history {
        border: 0;
        border-radius: 12px;
        background: #f2f4f6;
    }
    .summary-card .history-cells article {
        border-radius: 8px;
    }
    .summary-card .history-cells .latest {
        background: #0d7a6e;
        border-color: #0d7a6e;
    }
    /* Latest-event values keep their original period; share source typography. */
    .summary-card {
        padding: 28px;
        border-radius: 12px;
    }
    .summary-card :deep(.thumbnail-card-title-group h1) {
        font:
            600 22px/30px 'Hanken Grotesk',
            sans-serif;
        letter-spacing: -0.025em;
    }
    .summary-card .hero strong {
        font:
            600 36px/44px 'Hanken Grotesk',
            sans-serif;
    }
    .summary-card .metrics b {
        font:
            600 24px/32px 'Hanken Grotesk',
            sans-serif;
    }
    .summary-card :deep(.thumbnail-card-footer-note) {
        white-space: normal;
        overflow: visible;
    }
</style>
