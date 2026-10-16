<script setup>
    import Button from 'primevue/button';
    import { computed, ref } from 'vue';
    import { monthlyDividendSeries } from '@/services/stockAnalysis';
    const props = defineProps({
        rows: { type: Array, default: () => [] },
        asOf: { type: String, default: '' },
        currency: { type: String, default: 'USD' },
    });
    const selected = ref(null),
        length = ref(12);
    const series = computed(() =>
        monthlyDividendSeries(props.rows, props.asOf, length.value)
    );
    const max = computed(() =>
        Math.max(
            0.001,
            ...series.value.flatMap((row) => [
                row.total ?? 0,
                row.previousTotal ?? 0,
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
                <h2>월별 배당 흐름</h2>
                <p>주당 세전 {{ currency }} · 배당락일 기준</p>
            </div>
            <div class="trend-controls">
                <Button
                    :severity="length === n ? undefined : 'secondary'"
                    :outlined="length !== n"
                    v-for="n in [12, 24]"
                    :key="n"
                    :aria-pressed="length === n"
                    @click="length = n">
                    {{ n }}개월
                </Button>
            </div>
        </header>
        <div
            v-if="series.some((row) => row.total != null)"
            class="trend-chart"
            role="group"
            aria-label="월별 주당 배당금 차트">
            <button
                v-for="row in series"
                :key="row.month"
                class="month-bar"
                :class="{ selected: current?.month === row.month }"
                :aria-label="`${row.month} 배당 ${format(row.total)}, ${row.count ?? '미확인'}회${row.partial ? ', 집계 중' : ''}`"
                @focus="selected = row.month"
                @click="selected = row.month">
                <div class="bars">
                    <i
                        v-if="row.previousTotal != null"
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
                <span>{{ row.month.slice(2).replace('-', '.') }}</span>
            </button>
        </div>
        <p v-else class="empty">
            월별 배당 추이를 계산할 실제 이력이 없습니다.
        </p>
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
            ><span
                >전년 동월 <b>{{ format(current.previousTotal) }}</b></span
            ><span
                >전년 대비
                <b>{{
                    current.growth == null
                        ? '비교 자료 부족'
                        : `${current.growth > 0 ? '+' : ''}${current.growth.toFixed(2)}%`
                }}</b></span
            >
        </div>
        <p class="trend-note">
            <i class="blue" />선택 연도 <i class="gray" />전년 동월 · 당월은
            기준일까지 집계합니다. 회차는 배당락일 기준이며, 공시가 없는 달은
            0으로 채우지 않습니다.
        </p>
    </section>
</template>
<style scoped>
    .dividend-trend {
        margin: 24px 0 32px;
    }
    .dividend-trend header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
    }
    .dividend-trend h2 {
        margin: 0 !important;
    }
    .dividend-trend header p,
    .trend-note {
        color: var(--app-muted);
        font-size: 0.8rem;
        line-height: 1.7;
    }
    .trend-controls {
        display: flex;
        gap: 6px;
    }
    .trend-chart {
        display: flex;
        gap: 4px;
        height: 220px;
        overflow-x: auto;
        align-items: stretch;
        border-bottom: 1px solid var(--app-border);
        margin-top: 22px;
    }
    .month-bar {
        flex: 1;
        min-width: 36px;
        border: 0;
        background: transparent;
        color: var(--app-muted);
        cursor: pointer;
        padding: 6px 2px;
        font-size: 0.7rem;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 10px;
    }
    .month-bar.selected {
        background: var(--app-surface-muted);
        border-radius: 6px;
    }
    .bars {
        height: 174px;
        display: flex;
        gap: 3px;
        align-items: flex-end;
        justify-content: center;
        position: relative;
    }
    .bars i {
        width: 35%;
        min-height: 2px;
        border-radius: 4px 4px 0 0;
    }
    .actual,
    .blue {
        background: var(--app-accent);
    }
    .actual.partial {
        opacity: 0.6;
    }
    .previous,
    .gray {
        background: #cbd5e1;
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
        width: 8px;
        height: 8px;
        border-radius: 2px;
        margin-right: 4px;
    }
    .empty {
        padding: 30px;
        color: var(--app-muted);
    }
</style>
