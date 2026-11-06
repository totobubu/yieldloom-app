<script setup>
    import InfoHelp from '@/components/common/InfoHelp.vue';
    import Button from 'primevue/button';
    import { computed, ref, watch } from 'vue';
    import { monthlyDividendSeries } from '@/services/stockAnalysis';
    const props = defineProps({
        rows: { type: Array, default: () => [] },
        asOf: { type: String, default: '' },
        currency: { type: String, default: 'USD' },
    });
    const selected = ref(null),
        length = ref(12),
        chartYear = ref('all');
    const chart = ref(null);
    // Preserve the active month inside this scroller when its width changes.
    // Scroll only this element: never refocus, change selection or move the document.
    watch(
        chart,
        (element, _previous, onCleanup) => {
            if (!element || typeof ResizeObserver === 'undefined') return;
            const observer = new ResizeObserver(() => {
                if (chart.value !== element) return;
                const active = element.ownerDocument.activeElement;
                if (
                    !element.contains(active) ||
                    !active?.classList.contains('month-bar')
                )
                    return;
                const clip = element.getBoundingClientRect();
                const rect = active.getBoundingClientRect();
                const left = clip.left + element.clientLeft;
                const right = left + element.clientWidth;
                if (rect.left < left) element.scrollLeft -= left - rect.left;
                else if (rect.right > right)
                    element.scrollLeft += rect.right - right;
            });
            observer.observe(element);
            onCleanup(() => observer.disconnect());
        },
        { flush: 'post' }
    );
    const years = computed(() => {
        const year = Number(props.asOf.slice(0, 4));
        return Number.isFinite(year) && year > 0 ? [year, year - 1] : [];
    });
    // Reuse the strict ex-date cutoff. Calendar padding never advances asOf
    // or turns future/unobserved months into zero-valued observations.
    const series = computed(() => {
        if (chartYear.value === 'rolling')
            return monthlyDividendSeries(props.rows, props.asOf, length.value);
        const year =
            chartYear.value === 'all' ? years.value[0] : chartYear.value;
        if (!year) return [];
        const count =
            (years.value[0] - Number(year)) * 12 +
            Number(props.asOf.slice(5, 7));
        const observed = new Map(
            monthlyDividendSeries(props.rows, props.asOf, count).map((row) => [
                row.month,
                row,
            ])
        );
        return Array.from({ length: 12 }, (_, index) => {
            const month = `${year}-${String(index + 1).padStart(2, '0')}`;
            return (
                observed.get(month) ?? {
                    month,
                    total: null,
                    count: null,
                    average: null,
                    previousTotal: null,
                    growth: null,
                    partial: false,
                }
            );
        });
    });
    const compare = computed(
        () => chartYear.value === 'all' || chartYear.value === 'rolling'
    );
    const max = computed(() =>
        Math.max(
            0.001,
            ...series.value.flatMap((row) => [
                row.total ?? 0,
                compare.value ? (row.previousTotal ?? 0) : 0,
            ])
        )
    );
    const current = computed(
        () =>
            series.value.find((row) => row.month === selected.value) ??
            series.value.at(-1)
    );
    const format = (value) =>
        value == null
            ? '미확인'
            : Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: 4,
              });
</script>
<template>
    <section class="dividend-trend">
        <header>
            <div>
                <div class="trend-title">
                    <h2>월별 배당 추이</h2>
                    <InfoHelp
                        label="월별 배당 집계 안내"
                        text="선택 연도와 전년 동월을 비교합니다. 당월은 기준일까지 집계합니다. 회차는 배당락일 기준이며, 공시가 없는 달은 0으로 채우지 않습니다." />
                </div>
            </div>
            <div class="trend-header-tools">
                <p
                    v-if="series.some((row) => row.total != null)"
                    class="trend-note">
                    <span v-if="compare"
                        ><i class="gray" aria-hidden="true" />{{
                            chartYear === 'rolling'
                                ? '전년 동월'
                                : `${years[0] - 1}년`
                        }}</span
                    >
                    <span
                        ><i class="blue" aria-hidden="true" />{{
                            chartYear === 'all'
                                ? years[0]
                                : chartYear === 'rolling'
                                  ? '선택 기간'
                                  : chartYear
                        }}{{ chartYear === 'rolling' ? '' : '년' }}</span
                    >
                </p>
                <div class="trend-controls">
                    <Button
                        label="전체 비교"
                        :aria-pressed="chartYear === 'all'"
                        :severity="
                            chartYear === 'all' ? undefined : 'secondary'
                        "
                        text
                        @click="
                            chartYear = 'all';
                            selected = null;
                        " />
                    <Button
                        v-for="year in years"
                        :key="year"
                        :label="String(year)"
                        :aria-pressed="chartYear === year"
                        :severity="chartYear === year ? undefined : 'secondary'"
                        text
                        @click="
                            chartYear = year;
                            selected = null;
                        " />
                </div>
            </div>
        </header>
        <div class="trend-guidance">
            <p class="trend-unit">
                단위: 주당 세전 {{ currency }} · 배당락일 기준
            </p>
            <p class="trend-coverage">
                기록 없음은 0이 아닙니다. 기준 월은 집계 중이며 미래 월은
                미확인입니다.
            </p>
        </div>
        <details class="trend-periods">
            <summary>최근 기간 보기</summary>
            <div class="trend-period-buttons">
                <Button
                    :severity="length === n ? undefined : 'secondary'"
                    :outlined="length !== n"
                    v-for="n in [12, 24]"
                    :key="n"
                    :aria-pressed="length === n"
                    @click="
                        length = n;
                        chartYear = 'rolling';
                        selected = null;
                    ">
                    {{ n }}개월
                </Button>
            </div>
        </details>
        <div
            v-if="series.some((row) => row.total != null)"
            ref="chart"
            class="trend-chart"
            role="group"
            aria-label="월별 주당 배당금 차트">
            <div
                class="trend-plot"
                :class="{ rolling: chartYear === 'rolling' && length === 24 }">
                <span
                    v-for="line in 3"
                    :key="line"
                    class="trend-gridline"
                    aria-hidden="true" />
                <button
                    v-for="row in series"
                    :key="row.month"
                    class="month-bar"
                    :class="{
                        selected: current?.month === row.month,
                        'has-status': row.partial || row.total == null,
                    }"
                    :aria-label="`${row.month} 배당 ${format(row.total)}, ${row.count ?? '미확인'}회${row.partial ? ', 집계 중' : ''}`"
                    @focus="selected = row.month"
                    @click="selected = row.month">
                    <div class="bars">
                        <i
                            v-if="compare && row.previousTotal != null"
                            class="previous"
                            :style="{
                                height: `${(row.previousTotal / max) * 100}%`,
                            }" /><i
                            v-if="row.total != null"
                            class="actual"
                            :class="{ partial: row.partial }"
                            :style="{
                                height: `${(row.total / max) * 100}%`,
                            }" /><span v-if="row.total == null" class="missing"
                            >—</span
                        >
                    </div>
                    <span class="month-label">
                        <span>{{
                            chartYear === 'rolling'
                                ? row.month.slice(2).replace('-', '.')
                                : `${Number(row.month.slice(5))}월`
                        }}</span>
                        <small
                            v-if="row.partial && row.total != null"
                            class="month-status partial"
                            >부분</small
                        >
                        <small
                            v-else-if="row.total == null"
                            class="month-status"
                            >미확인</small
                        >
                    </span>
                </button>
            </div>
        </div>
        <div v-else class="trend-empty" role="status">
            <span class="empty-icon" aria-hidden="true"
                ><i class="pi pi-chart-bar"
            /></span>
            <strong>아직 표시할 월별 배당 이력이 없습니다</strong>
            <p>확인된 배당 이력이 쌓이면 월별 흐름을 보여드립니다.</p>
        </div>
        <div v-if="current" class="trend-detail" aria-live="polite">
            <strong
                >{{ current.month
                }}{{ current.partial ? ' · 집계 중' : '' }}</strong
            ><span
                >합계 <b>{{ format(current.total) }}</b></span
            ><span
                >지급 회차 <b>{{ current.count ?? '미확인' }}회</b></span
            ><span
                >회당 평균 <b>{{ format(current.average) }}</b></span
            ><span v-if="compare"
                >전년 동월 <b>{{ format(current.previousTotal) }}</b></span
            ><span v-if="compare"
                >전년 대비
                <b>{{
                    current.growth == null
                        ? '비교 자료 부족'
                        : `${current.growth > 0 ? '+' : ''}${current.growth.toFixed(2)}%`
                }}</b></span
            >
        </div>
    </section>
</template>
<style scoped>
    .dividend-trend {
        margin: 24px 0 32px;
    }
    .dividend-trend header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
    }
    .dividend-trend h2 {
        margin: 0;
        font-size: 20px;
        line-height: 28px;
        font-weight: 600;
    }
    .trend-header-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
    }
    .trend-note {
        color: var(--app-muted);
        font-family: 'JetBrains Mono', monospace;
        font-size: 16px;
        line-height: 24px;
    }
    .trend-note {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
    }
    .trend-note span {
        white-space: nowrap;
    }
    .trend-note span:last-child {
        color: var(--app-accent);
        font-weight: 600;
    }
    .trend-controls {
        display: flex;
        border-radius: 8px;
        background: var(--app-surface-muted);
        padding: 2px;
    }
    .trend-controls :deep(.p-button) {
        height: 32px;
        min-height: 32px;
        padding: 0 10px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 16px;
        line-height: 24px;
        border-radius: 6px;
    }
    .trend-controls :deep(.p-button[aria-pressed='true']) {
        background: var(--app-surface);
        color: var(--app-accent);
        font-weight: 600;
        box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
    }
    .trend-guidance {
        display: grid;
        gap: 4px;
        margin-top: 24px;
    }
    .trend-unit {
        margin: 0;
        color: var(--app-muted);
        font-family: 'JetBrains Mono', monospace;
        font-size: 16px;
        line-height: 24px;
    }
    .trend-coverage,
    .trend-periods {
        font-size: 12px;
        color: var(--app-muted);
        margin: 8px 0;
    }
    .trend-coverage {
        margin: 0;
        font-size: 16px;
        line-height: 24px;
    }
    .trend-periods summary {
        cursor: pointer;
    }
    .trend-period-buttons {
        display: flex;
        gap: 6px;
        margin-top: 8px;
    }
    .trend-chart {
        overflow-x: auto;
        padding-bottom: 8px;
        margin-top: 24px;
    }
    /* bd619d... keeps the twelve-month graphic readable inside its own scroll region. */
    .trend-plot {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        position: relative;
        min-width: 620px;
        height: 224px;
        padding: 24px 16px 0;
        background: var(--app-surface-muted);
        border-radius: 12px;
    }
    .trend-plot.rolling {
        min-width: 1232px;
    }
    .trend-gridline {
        position: absolute;
        left: 0;
        right: 0;
        height: 1px;
        background: var(--app-border);
        opacity: 0.3;
        pointer-events: none;
    }
    .trend-gridline:nth-child(1) {
        top: 24px;
    }
    .trend-gridline:nth-child(2) {
        top: 96px;
        opacity: 0.2;
    }
    .trend-gridline:nth-child(3) {
        top: 160px;
        opacity: 0.2;
    }
    .month-bar {
        flex: 0 0 44px;
        min-width: 0;
        z-index: 1;
        border: 0;
        background: transparent;
        color: var(--app-muted);
        cursor: pointer;
        padding: 0;
        font-family: 'JetBrains Mono', monospace;
        font-size: 16px;
        line-height: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
    }
    .month-bar.has-status {
        flex-basis: 48px;
    }
    .month-label {
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    .month-status {
        font-size: 9px;
        line-height: 9px;
    }
    .month-status.partial {
        color: var(--app-brand-brown);
        font-weight: 600;
    }
    .month-bar.selected {
        background: var(--app-surface-muted);
        border-radius: 6px;
    }
    .bars {
        height: 144px;
        display: flex;
        gap: 6px;
        align-items: flex-end;
        justify-content: center;
        position: relative;
    }
    .bars i {
        width: 14px;
        min-height: 2px;
        border-radius: 4px 4px 0 0;
    }
    .actual,
    .blue {
        background: var(--app-accent);
    }
    .actual.partial {
        opacity: 0.5;
        border-top: 2px dashed var(--app-accent);
    }
    .previous,
    .gray {
        background: #94a3b8;
    }
    .missing {
        position: absolute;
        bottom: 0;
    }
    .trend-detail {
        display: flex;
        gap: 14px 24px;
        flex-wrap: wrap;
        align-items: center;
        padding: 18px;
        background: var(--app-surface-muted);
        border-radius: 10px;
        margin-top: 16px;
        font-size: 0.85rem;
    }
    .trend-detail span {
        color: var(--app-muted);
    }
    .trend-detail b {
        color: var(--app-text);
        margin-left: 5px;
    }
    .trend-note i {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 2px;
        margin-right: 6px;
        vertical-align: middle;
    }
    .trend-title {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .trend-title::before {
        content: '';
        flex: 0 0 10px;
        height: 24px;
        background: var(--app-accent);
        border-radius: 2px;
    }
    .trend-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 36px 20px;
        margin-top: 16px;
        text-align: center;
        border: 1px dashed var(--app-border);
        border-radius: 12px;
        background: var(--app-surface-muted);
    }
    .empty-icon {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: var(--app-surface);
        color: var(--app-accent);
        font-size: 20px;
    }
    .trend-empty strong {
        color: var(--app-text);
        font-size: 14px;
    }
    .trend-empty p {
        margin: 0;
        color: var(--app-muted);
        font-size: 12px;
        line-height: 1.7;
    }
    @media (max-width: 639px) {
        .dividend-trend header {
            flex-direction: column;
            align-items: flex-start;
        }
    }
</style>
