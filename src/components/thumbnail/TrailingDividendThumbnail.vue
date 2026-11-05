<script setup>
    import { computed } from 'vue';
    import ThumbnailCardShell from './ThumbnailCardShell.vue';
    const props = defineProps({ data: { type: Object, required: true } });
    const money = (value) =>
        value == null || !Number.isFinite(Number(value))
            ? '미확인'
            : `${props.data.currency === 'USD' ? '$' : props.data.currency === 'KRW' ? '₩' : props.data.currency + ' '}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 8 })}`;
    const scale = computed(() =>
        Math.max(
            Number.EPSILON,
            ...props.data.segments.map((row) => row.amount || 0)
        )
    );
</script>
<template>
    <ThumbnailCardShell
        class="ttm-summary-card"
        :title="data.symbol"
        context-label="최근 12개월 배당 요약"
        :badge="
            data.complete
                ? data.referenceData
                    ? '참고 이력 합계'
                    : '기간 이력 확인'
                : data.status === 'conflict'
                  ? '검토 필요'
                  : '전체 기간 미확인'
        "
        date-label="기준일"
        :date-value="data.end || '미확인'"
        data-thumbnail-kind="ttm-summary">
        <template #header>
            <div class="ttm-identity">
                <span class="ttm-mark" aria-hidden="true">D</span>
                <div>
                    <h1>{{ data.symbol }}</h1>
                    <span class="thumbnail-card-badge">{{
                        data.complete
                            ? data.referenceData
                                ? '참고 이력 합계'
                                : '기간 이력 확인'
                            : data.status === 'conflict'
                              ? '검토 필요'
                              : '전체 기간 미확인'
                    }}</span
                    ><small>최근 12개월 배당 요약</small>
                </div>
            </div>
            <div class="ttm-reference-price">
                <b>{{ money(data.price) }}</b
                ><small>기준 시세 · {{ data.priceDate || '미확인' }}</small>
            </div>
        </template>
        <div class="ttm-period">
            {{ data.start || '미확인' }} ~ {{ data.end || '미확인' }} · 배당락일
            기준 · 주당 {{ data.currency || '통화 미확인' }}
        </div>
        <div class="ttm-body">
            <section class="ttm-metrics">
                <article>
                    <small>최근 12개월 주당 배당금</small
                    ><strong class="ttm-amount">{{
                        money(data.amount)
                    }}</strong>
                </article>
                <article>
                    <small>세전 연 배당률</small
                    ><strong class="ttm-yield">{{
                        data.yieldPercent == null
                            ? '미확인'
                            : data.yieldPercent > 0 && data.yieldPercent < 0.005
                              ? '<0.01%'
                              : `${data.yieldPercent.toFixed(2)}%`
                    }}</strong>
                </article>
            </section>
            <section class="ttm-chart">
                <h2>3개월 구간별 배당 합계</h2>
                <p v-if="data.segments.length">
                    달력 분기가 아닌, 위 12개월을 나눈 4개 구간
                </p>
                <p v-else>기준일을 확인하지 못해 구간을 표시하지 않습니다.</p>
                <div class="ttm-bars">
                    <article
                        v-for="(row, index) in data.segments"
                        :key="row.end">
                        <b>{{ money(row.amount) }}</b>
                        <div>
                            <i
                                v-if="row.amount != null"
                                :style="{
                                    height: `${(row.amount / scale) * 100}%`,
                                }" /><span v-else>—</span>
                        </div>
                        <strong>구간 {{ index + 1 }}</strong
                        ><small
                            >{{ row.start.slice(5) }} ~
                            {{ row.end.slice(5) }}</small
                        >
                    </article>
                </div>
            </section>
            <p v-if="data.message" class="ttm-warning">{{ data.message }}</p>
            <p v-else class="ttm-definition">
                12개월 합계 ÷ 기준 시세 · 최신 배당 1건의 연율화·예상 배당·실제
                계좌 수령액이 아닙니다.<br />기준 시세 {{ money(data.price) }} ·
                {{ data.priceDate }}
            </p>
        </div>
        <template #footer
            >세전 이력 합계 · 12개월 전체 이력 검증이 없으면 수치 미표시 · 통화
            환산 없음</template
        >
    </ThumbnailCardShell>
</template>
<style scoped>
    .ttm-summary-card {
        font-family: 'Hanken Grotesk', sans-serif;
        border-radius: 16px;
    }
    .ttm-period {
        font-size: 14px;
        color: #64748b;
    }
    .ttm-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        padding: 20px;
        border-radius: 12px;
        background: #f2f4f6;
    }
    .ttm-metrics article {
        padding: 16px;
        border-radius: 8px;
        background: white;
        min-width: 0;
    }
    .ttm-metrics small {
        display: block;
        color: #64748b;
        font-size: 15px;
        line-height: 1.5;
    }
    .ttm-metrics strong {
        display: block;
        margin-top: 12px;
        font:
            700 36px 'JetBrains Mono',
            monospace;
        color: #0d7a6e;
    }
    .ttm-chart {
        padding: 20px;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
    }
    .ttm-chart h2 {
        font-size: 18px;
        margin: 0;
    }
    .ttm-chart p {
        font-size: 13px;
        color: #64748b;
        margin: 6px 0 12px;
    }
    .ttm-bars {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 14px;
        text-align: center;
    }
    .ttm-bars article {
        min-width: 0;
        display: grid;
        gap: 6px;
    }
    .ttm-bars b {
        font:
            600 16px 'JetBrains Mono',
            monospace;
        color: #0d7a6e;
    }
    .ttm-bars article > div {
        height: 74px;
        display: flex;
        align-items: end;
        justify-content: center;
        background: #f8fafc;
    }
    .ttm-bars i {
        display: block;
        width: 70%;
        background: #0d7a6e;
        border-radius: 4px 4px 0 0;
    }
    .ttm-bars strong {
        font-size: 14px;
    }
    .ttm-bars small {
        font-size: 11px;
        color: #64748b;
    }
    .ttm-warning,
    .ttm-definition {
        font-size: 14px;
        line-height: 1.5;
        padding: 12px 16px;
        background: #fef9c3;
        border-radius: 8px;
        color: #785a00;
        margin: 0;
    }
    .ttm-definition {
        background: #f8fafc;
        color: #64748b;
    }
    .ttm-summary-card :deep(.thumbnail-card-footer) {
        font-size: 12px;
    }

    /* Reviewed share preview: identity/price, two metric tiles, chart and status
       share one muted body. Period and missing-data semantics remain explicit. */
    .ttm-summary-card {
        padding: 28px;
        gap: 12px;
        border-radius: 12px;
    }
    .ttm-summary-card :deep(.thumbnail-card-header) {
        margin-bottom: 0;
        gap: 16px;
    }
    .ttm-identity {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }
    .ttm-mark {
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        flex-shrink: 0;
        border-radius: 10px;
        background: #e6f4f2;
        color: #0d7a6e;
        font-weight: 700;
    }
    .ttm-identity h1 {
        margin: 0;
        font:
            600 22px/30px 'Hanken Grotesk',
            sans-serif;
        color: #1e293b;
    }
    .ttm-identity small,
    .ttm-reference-price small {
        display: block;
        font-size: 12px;
        line-height: 18px;
        color: #64748b;
    }
    .ttm-identity .thumbnail-card-badge {
        display: inline-block;
        margin: 0;
        max-width: none;
        padding: 2px 6px;
        font-size: 11px;
        line-height: 16px;
        color: #0d7a6e;
        background: #e6f4f2;
    }
    .ttm-reference-price {
        text-align: right;
        flex-shrink: 0;
    }
    .ttm-reference-price b {
        font:
            600 22px/30px 'Hanken Grotesk',
            sans-serif;
        color: #1e293b;
    }
    .ttm-summary-card :deep(.thumbnail-card-content) {
        gap: 10px;
    }
    .ttm-period {
        font-size: 12px;
        line-height: 18px;
    }
    .ttm-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border-radius: 12px;
        background: #f2f4f6;
    }
    .ttm-metrics {
        padding: 0;
        gap: 12px;
        background: transparent;
    }
    .ttm-metrics article {
        padding: 12px;
    }
    .ttm-metrics small {
        font-size: 13px;
        line-height: 18px;
    }
    .ttm-metrics strong {
        margin-top: 4px;
        font:
            600 28px/34px 'Hanken Grotesk',
            sans-serif;
        color: #1e293b;
    }
    .ttm-metrics .ttm-yield {
        color: #0d7a6e;
    }
    .ttm-chart {
        padding: 12px;
        border: 0;
        border-radius: 8px;
        background: #fff;
    }
    .ttm-chart h2 {
        font-size: 14px;
        line-height: 20px;
    }
    .ttm-chart p {
        margin: 4px 0 8px;
        font-size: 11px;
        line-height: 16px;
    }
    .ttm-bars {
        gap: 12px;
    }
    .ttm-bars article {
        gap: 4px;
    }
    .ttm-bars b {
        font:
            600 14px/18px 'Hanken Grotesk',
            sans-serif;
    }
    .ttm-bars article > div {
        height: 56px;
        background: transparent;
    }
    .ttm-bars i {
        width: 100%;
        border-radius: 3px 3px 0 0;
    }
    .ttm-bars article:nth-child(1) i {
        background: #0d7a6e33;
    }
    .ttm-bars article:nth-child(2) i {
        background: #0d7a6e4d;
    }
    .ttm-bars article:nth-child(3) i {
        background: #0d7a6e80;
    }
    .ttm-bars strong {
        font-size: 12px;
        line-height: 16px;
    }
    .ttm-bars small {
        font-size: 10px;
        line-height: 14px;
    }
    .ttm-warning,
    .ttm-definition {
        padding: 10px 12px;
        font-size: 12px;
        line-height: 18px;
    }
    .ttm-summary-card :deep(.thumbnail-card-footer) {
        font-size: 11px;
        line-height: 16px;
    }
    .ttm-summary-card :deep(.thumbnail-card-footer-note) {
        white-space: normal;
        overflow: visible;
    }

    /* Canonical source square520px -> exported720px. Scale its shared geometry
       explicitly; preserve extra coverage/date annotations as labelled extensions. */
    .ttm-summary-card {
        --source-artwork-scale: 1.3846153846;
        padding: calc(28px * var(--source-artwork-scale));
        gap: calc(12px * var(--source-artwork-scale));
    }
    .ttm-body {
        padding: calc(16px * var(--source-artwork-scale));
        gap: calc(12px * var(--source-artwork-scale));
    }
    .ttm-metrics {
        gap: calc(12px * var(--source-artwork-scale));
    }
    .ttm-metrics article,
    .ttm-chart {
        padding: calc(12px * var(--source-artwork-scale));
    }
    .ttm-metrics small {
        font-size: calc(12px * var(--source-artwork-scale));
        line-height: calc(16px * var(--source-artwork-scale));
    }
    .ttm-metrics strong {
        font-size: calc(20px * var(--source-artwork-scale));
        line-height: calc(28px * var(--source-artwork-scale));
    }
    .ttm-reference-price b {
        font-size: calc(20px * var(--source-artwork-scale));
        line-height: calc(28px * var(--source-artwork-scale));
    }
    .ttm-chart h2,
    .ttm-bars b {
        font-size: calc(12px * var(--source-artwork-scale));
        line-height: calc(16px * var(--source-artwork-scale));
    }
    .ttm-bars article > div {
        height: calc(56px * var(--source-artwork-scale));
    }

    .ttm-summary-card,
    .ttm-body {
        border-radius: calc(12px * var(--source-artwork-scale));
    }
    .ttm-metrics article,
    .ttm-chart {
        border-radius: calc(8px * var(--source-artwork-scale));
    }
    .ttm-mark {
        background: #0d7a6e;
        color: #fff;
    }
    .ttm-bars article > div {
        height: calc(40px * var(--source-artwork-scale));
    }
</style>
