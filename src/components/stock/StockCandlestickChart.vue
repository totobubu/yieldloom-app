<script setup>
    import Button from 'primevue/button';
    import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
    import { loadStockPrices } from '@/services/stockPrices.js';
    import { aggregateCandles } from '@/services/stockAnalysis';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    const emit = defineEmits(['prices-state']);
    const chartHost = ref(null),
        chartWidth = ref(1000);
    let observer;
    onMounted(() => {
        observer = new ResizeObserver((entries) => {
            chartWidth.value = Math.max(240, entries[0].contentRect.width);
        });
        if (chartHost.value) observer.observe(chartHost.value);
    });
    onBeforeUnmount(() => {
        observer?.disconnect();
        sequence++;
        controller?.abort();
    });
    const props = defineProps({
        symbol: { type: String, required: true },
        currency: { type: String, default: '' },
        events: { type: Array, default: () => [] },
    });
    const data = ref(null),
        loading = ref(false),
        error = ref(''),
        period = ref(1),
        selected = ref(null);
    useFullscreenLoading(loading, '일봉 데이터를 불러오고 있습니다.');
    const interval = ref('day'),
        visibleCount = ref(null),
        windowEnd = ref(null);
    const intervalLabels = { day: '일봉', week: '주봉', month: '월봉' };
    const resetWindow = () => {
        visibleCount.value = null;
        windowEnd.value = null;
        selected.value = null;
    };
    watch(interval, resetWindow);
    const periods = [
        { label: '1개월', months: 1 },
        { label: '3개월', months: 3 },
        { label: '6개월', months: 6 },
        { label: '1년', months: 12 },
        { label: '2년', months: 24 },
    ];
    let sequence = 0;
    let controller;
    const load = async (force = false) => {
        const current = ++sequence;
        controller?.abort();
        controller = new AbortController();
        const symbol = props.symbol;
        loading.value = true;
        error.value = '';
        data.value = null;
        selected.value = null;
        emit('prices-state', {
            symbol,
            loading: true,
            payload: null,
            error: '',
        });
        try {
            const payload = await loadStockPrices(symbol, {
                force,
                signal: controller.signal,
            });
            if (!payload.candles?.length)
                throw new Error('확인 가능한 일봉 데이터가 없습니다.');
            if (sequence === current) data.value = payload;
        } catch (reason) {
            if (sequence === current)
                error.value =
                    reason.name === 'TimeoutError'
                        ? '조회 시간이 초과되었습니다. 다시 시도해 주세요.'
                        : reason.message;
        } finally {
            if (sequence === current) {
                loading.value = false;
                emit('prices-state', {
                    symbol,
                    loading: false,
                    payload: data.value,
                    error: error.value,
                });
            }
        }
    };
    watch(
        () => props.symbol,
        () => load(),
        { immediate: true }
    );
    watch(period, () => {
        resetWindow();
    });
    const periodCandles = computed(() => {
        const rows = data.value?.candles ?? [];
        if (!rows.length) return [];
        const cutoff = new Date(`${rows.at(-1).date}T12:00:00Z`);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - period.value);
        return rows.filter(
            (row) => row.date >= cutoff.toISOString().slice(0, 10)
        );
    });
    const allAggregated = computed(() =>
        aggregateCandles(data.value?.candles ?? [], interval.value)
    );
    const aggregated = computed(() =>
        periodCandles.value.length
            ? allAggregated.value.filter(
                  (row) => row.endDate >= periodCandles.value[0].date
              )
            : []
    );
    const endIndex = computed(() =>
        Math.min(
            aggregated.value.length,
            windowEnd.value ?? aggregated.value.length
        )
    );
    const candles = computed(() =>
        aggregated.value.slice(
            Math.max(
                0,
                endIndex.value - (visibleCount.value ?? aggregated.value.length)
            ),
            endIndex.value
        )
    );
    const zoom = (factor) => {
        const length = aggregated.value.length;
        visibleCount.value = Math.min(
            length,
            Math.max(
                Math.min(10, length),
                Math.round((visibleCount.value ?? length) * factor)
            )
        );
        if (endIndex.value < visibleCount.value)
            windowEnd.value = visibleCount.value;
        selected.value = null;
    };
    const pan = (direction) => {
        const count = visibleCount.value ?? aggregated.value.length;
        windowEnd.value = Math.max(
            count,
            Math.min(
                aggregated.value.length,
                endIndex.value + direction * Math.max(1, Math.round(count / 2))
            )
        );
        selected.value = null;
    };
    const chartEvents = computed(() => {
        const seen = new Set();
        return [...props.events, ...(data.value?.events ?? [])].flatMap(
            (event) => {
                const key = `${event.date}-${event.kind}`;
                if (seen.has(key)) return [];
                seen.add(key);
                const index = candles.value.findIndex(
                    (row) => event.date >= row.date && event.date <= row.endDate
                );
                return index < 0 ? [] : [{ ...event, index, key }];
            }
        );
    });
    const currentIndex = computed(() =>
        Math.max(
            0,
            Math.min(
                selected.value ?? candles.value.length - 1,
                candles.value.length - 1
            )
        )
    );
    const current = computed(() => candles.value[currentIndex.value]);
    const previous = computed(() => {
        if (!current.value) return null;
        const index = allAggregated.value.findIndex(
            (row) => row.date === current.value.date
        );
        return allAggregated.value[index - 1]?.close ?? null;
    });
    const change = computed(() =>
        previous.value ? (current.value.close / previous.value - 1) * 100 : null
    );
    const format = (value, digits = 2) =>
        value == null
            ? '—'
            : Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: digits,
                  minimumFractionDigits: digits,
              });
    const bounds = computed(() => {
        const low = Math.min(...candles.value.map((row) => row.low));
        const high = Math.max(...candles.value.map((row) => row.high));
        const margin = Math.max((high - low) * 0.08, high * 0.005);
        return { low: low - margin, high: high + margin };
    });
    const y = (value) =>
        24 +
        ((bounds.value.high - value) / (bounds.value.high - bounds.value.low)) *
            232;
    const step = computed(
        () => (chartWidth.value - 84) / Math.max(1, candles.value.length)
    );
    const x = (index) => 16 + (index + 0.5) * step.value;
    const bodyWidth = computed(() =>
        Math.max(0.6, Math.min(16, step.value * 0.65))
    );
    const maxVolume = computed(() =>
        Math.max(1, ...candles.value.map((row) => row.volume ?? 0))
    );
    const ticks = computed(() =>
        Array.from(
            { length: 5 },
            (_, i) =>
                bounds.value.high -
                ((bounds.value.high - bounds.value.low) * i) / 4
        )
    );
    const dateLabels = computed(() =>
        [
            ...new Set([
                0,
                ...(chartWidth.value >= 500
                    ? [Math.floor((candles.value.length - 1) / 2)]
                    : []),
                candles.value.length - 1,
            ]),
        ].filter((i) => i >= 0)
    );
    const selectAt = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const localX =
            ((event.clientX - rect.left) / rect.width) * chartWidth.value;
        selected.value = Math.max(
            0,
            Math.min(
                candles.value.length - 1,
                Math.floor((localX - 16) / step.value)
            )
        );
    };
    const move = (delta) => {
        selected.value = Math.max(
            0,
            Math.min(candles.value.length - 1, currentIndex.value + delta)
        );
    };
</script>

<template>
    <section
        ref="chartHost"
        class="stock-candlestick"
        aria-label="일봉 캔들 차트">
        <h2 class="chart-accessible-title">
            주가 차트 · {{ intervalLabels[interval] }} ·
            {{ data?.currency || currency }}
        </h2>
        <div class="chart-controls">
            <header class="chart-heading">
                <div class="periods" aria-label="차트 기간">
                    <Button
                        severity="secondary"
                        outlined
                        v-for="item in periods"
                        :key="item.months"
                        :aria-pressed="period === item.months"
                        :class="{ active: period === item.months }"
                        @click="period = item.months">
                        {{ item.label }}
                    </Button>
                </div>
            </header>
            <div class="chart-navigation">
                <div class="interval-controls" aria-label="봉 주기">
                    <Button
                        severity="secondary"
                        outlined
                        v-for="(label, key) in intervalLabels"
                        :key="key"
                        :aria-pressed="interval === key"
                        @click="interval = key">
                        {{ label }}
                    </Button>
                </div>
                <div class="zoom-controls" aria-label="차트 확대와 이동">
                    <Button
                        severity="secondary"
                        outlined
                        aria-label="차트 왼쪽 이동"
                        :disabled="
                            endIndex <= (visibleCount ?? aggregated.length)
                        "
                        @click="pan(-1)">
                        ←</Button
                    ><Button
                        severity="secondary"
                        outlined
                        aria-label="차트 축소"
                        :disabled="
                            !candles.length ||
                            candles.length >= aggregated.length
                        "
                        @click="zoom(1.5)">
                        −</Button
                    ><Button
                        severity="secondary"
                        outlined
                        aria-label="차트 확대"
                        :disabled="candles.length <= 10"
                        @click="zoom(0.65)">
                        ＋</Button
                    ><Button
                        severity="secondary"
                        outlined
                        aria-label="차트 오른쪽 이동"
                        :disabled="endIndex >= aggregated.length"
                        @click="pan(1)">
                        →</Button
                    ><Button severity="secondary" outlined @click="resetWindow"
                        >전체 보기</Button
                    >
                </div>
            </div>
        </div>
        <div v-if="loading" class="chart-state" role="status">
            일봉 데이터를 불러오는 중…
        </div>
        <div v-else-if="error" class="chart-state" role="alert">
            <p>{{ error }}</p>
            <Button severity="secondary" outlined @click="load(true)"
                >다시 시도</Button
            >
        </div>
        <template v-else-if="current">
            <div class="chart-frame">
                <div class="quote-summary">
                    <div>
                        <span
                            >{{ current.date
                            }}{{
                                current.endDate !== current.date
                                    ? ` ~ ${current.endDate}`
                                    : ''
                            }}</span
                        ><strong
                            :class="{
                                up: current.close >= current.open,
                                down: current.close < current.open,
                            }"
                            >{{ format(current.close) }}
                            <small>{{
                                data.currency || currency
                            }}</small></strong
                        ><span
                            v-if="change != null"
                            :class="change >= 0 ? 'up' : 'down'"
                            >{{ change >= 0 ? '+' : '' }}{{ format(change) }}%
                            <small>{{
                                interval === 'day'
                                    ? '전일 종가 대비'
                                    : '직전 봉 종가 대비'
                            }}</small></span
                        >
                    </div>
                    <dl>
                        <div
                            v-for="[label, value] in [
                                ['시가', current.open],
                                ['고가', current.high],
                                ['저가', current.low],
                                ['종가', current.close],
                            ]"
                            :key="label">
                            <dt>{{ label }}</dt>
                            <dd>{{ format(value, 4) }}</dd>
                        </div>
                        <div>
                            <dt>거래량</dt>
                            <dd>{{ format(current.volume, 0) }}</dd>
                        </div>
                    </dl>
                </div>
                <svg
                    class="candle-plot"
                    :viewBox="`0 0 ${chartWidth} 280`"
                    preserveAspectRatio="none"
                    role="img"
                    tabindex="0"
                    :aria-label="`${symbol} ${period}개월 ${intervalLabels[interval]} 캔들 차트. 좌우 방향키로 날짜별 가격 확인`"
                    @pointermove="selectAt"
                    @pointerdown="selectAt"
                    @pointerleave="selected = null"
                    @keydown.left.prevent="move(-1)"
                    @keydown.right.prevent="move(1)"
                    @keydown.home.prevent="selected = 0"
                    @keydown.end.prevent="selected = candles.length - 1">
                    <g v-for="tick in ticks" :key="tick">
                        <line
                            x1="16"
                            :x2="chartWidth - 68"
                            :y1="y(tick)"
                            :y2="y(tick)"
                            class="grid-line" />
                        <text
                            :x="chartWidth - 56"
                            :y="y(tick) + 4"
                            class="axis">
                            {{ format(tick) }}
                        </text>
                    </g>
                    <g
                        v-for="(row, index) in candles"
                        :key="row.date"
                        :class="
                            row.close >= row.open ? 'candle-up' : 'candle-down'
                        "
                        class="candle">
                        <title>
                            {{ row.date }} · 시가 {{ row.open }} · 고가
                            {{ row.high }} · 저가 {{ row.low }} · 종가
                            {{ row.close }}
                        </title>
                        <line
                            :x1="x(index)"
                            :x2="x(index)"
                            :y1="y(row.high)"
                            :y2="y(row.low)"
                            stroke-width="1" />
                        <rect
                            :x="x(index) - bodyWidth / 2"
                            :y="Math.min(y(row.open), y(row.close))"
                            :width="bodyWidth"
                            :height="
                                Math.max(
                                    1,
                                    Math.abs(y(row.open) - y(row.close))
                                )
                            " />
                    </g>
                    <g
                        v-for="event in chartEvents"
                        :key="event.key"
                        class="chart-event">
                        <title>{{ event.date }} · {{ event.label }}</title>
                        <circle
                            :cx="x(event.index)"
                            :cy="
                                Math.max(12, y(candles[event.index].high) - 18)
                            "
                            r="8"
                            :class="event.kind" />
                        <text
                            :x="x(event.index)"
                            :y="
                                Math.max(
                                    12,
                                    y(candles[event.index].high) - 18
                                ) + 4
                            "
                            text-anchor="middle">
                            {{
                                event.kind === 'split'
                                    ? 'S'
                                    : event.kind === 'dividend'
                                      ? 'D'
                                      : '?'
                            }}
                        </text>
                    </g>

                    <line
                        :x1="x(currentIndex)"
                        :x2="x(currentIndex)"
                        y1="24"
                        y2="256"
                        class="crosshair" />
                    <line
                        x1="16"
                        :x2="chartWidth - 68"
                        :y1="y(current.close)"
                        :y2="y(current.close)"
                        class="crosshair" />
                </svg>
                <svg
                    class="volume-plot"
                    :viewBox="`0 0 ${chartWidth} 80`"
                    preserveAspectRatio="none"
                    role="img"
                    :aria-label="`${symbol} ${intervalLabels[interval]} 거래량. 미제공은 막대 미표시`"
                    @pointermove="selectAt"
                    @pointerdown="selectAt"
                    @pointerleave="selected = null">
                    <g
                        v-for="(row, index) in candles"
                        :key="row.date"
                        class="volume-bar"
                        :class="[
                            row.close >= row.open ? 'candle-up' : 'candle-down',
                            { 'volume-selected': index === currentIndex },
                        ]">
                        <title>
                            {{ row.date }} · 거래량
                            {{ row.volume == null ? '미제공' : row.volume }}
                        </title>
                        <rect
                            v-if="row.volume != null"
                            :x="x(index) - bodyWidth / 2"
                            :y="56 - (row.volume / maxVolume) * 48"
                            :width="bodyWidth"
                            :height="(row.volume / maxVolume) * 48"
                            opacity=".35" />
                    </g>
                    <text x="16" y="12" class="axis">거래량</text>
                    <text
                        v-for="index in dateLabels"
                        :key="index"
                        :x="x(index)"
                        y="76"
                        :text-anchor="
                            index === 0
                                ? 'start'
                                : index === candles.length - 1
                                  ? 'end'
                                  : 'middle'
                        "
                        class="axis">
                        {{ candles[index].date }}
                    </text>
                </svg>
                <p v-if="chartEvents.length" class="event-legend">
                    <strong>차트 이벤트:</strong>
                    <span class="event-key"
                        ><span class="marker-badge dividend">D</span>
                        배당락</span
                    >
                    <span class="event-key"
                        ><span class="marker-badge split">S</span>
                        주식분할</span
                    >
                    <span
                        >표시된 이벤트에 마우스를 올리면 날짜와 내용을 확인할 수
                        있습니다.</span
                    >
                </p>
                <div class="chart-meta-footer">
                    <footer class="chart-note">
                        <span
                            ><i class="red" />상승 <i class="blue" />하락 ·
                            {{ candles.length }}거래일</span
                        ><span
                            >Yahoo Finance · 일별 시세 · 장중에는 당일 봉이
                            변동될 수 있습니다.</span
                        >
                    </footer>
                    <p class="basis-note">
                        분할·배당 조정 여부는 제공처 기준입니다. 배당을 포함한
                        총수익률과는 다릅니다.
                    </p>
                </div>
            </div>
        </template>
        <div v-if="!error" class="chart-refresh">
            <span
                >차트 로딩 오류 발생 시 종가 선차트 대안 또는 재시도 액션이
                유지됩니다.</span
            >
            <Button
                type="button"
                label="시세 데이터 재조회"
                class="chart-refresh-button"
                severity="secondary"
                outlined
                :disabled="loading"
                :aria-busy="loading"
                @click="!loading && load(true)" />
        </div>
    </section>
</template>

<style scoped>
    .chart-refresh {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 16px;
        color: var(--app-muted);
        font-size: 12px;
    }
    .chart-refresh .chart-refresh-button {
        height: 30px;
        min-height: 30px;
        padding: 0 10px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface);
        color: var(--app-muted);
        font-size: 12px;
        font-weight: 500;
        line-height: normal;
    }
    .chart-navigation {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 16px;
    }
    .interval-controls,
    .zoom-controls {
        display: flex;
        gap: 4px;
    }
    .chart-navigation button {
        border: 1px solid var(--app-border);
        border-radius: 6px;
        background: var(--app-surface);
        color: var(--app-muted);
        padding: 6px 10px;
        cursor: pointer;
    }
    .chart-navigation button[aria-pressed='true'] {
        color: var(--app-accent);
        border-color: var(--app-accent);
    }
    .chart-navigation button:disabled {
        opacity: 0.35;
        cursor: default;
    }
    .chart-event circle {
        fill: var(--app-accent);
    }
    .chart-event circle.split {
        fill: var(--app-warning);
    }
    .chart-event text {
        fill: white;
        font-size: 9px;
        font-weight: 700;
    }
    .event-legend {
        font-size: 0.75rem;
        color: var(--app-muted);
    }
    .stock-candlestick {
        --stock-chart-grid: #f1f5f9;
        --stock-chart-volume: #e2e8f0;
        color: var(--app-text);
    }
    .p-dark .stock-candlestick {
        --stock-chart-grid: var(--app-border-subtle);
        --stock-chart-volume: var(--app-border);
    }
    .chart-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        flex-wrap: wrap;
    }
    .chart-heading h2 {
        margin: 0;
        font-size: 1.2rem;
    }
    .chart-heading h2 span {
        font-size: 0.75rem;
        background: var(--app-surface-muted);
        border-radius: 5px;
        padding: 4px 8px;
        margin-left: 8px;
        color: var(--app-muted);
    }
    .chart-heading p,
    .basis-note {
        font-size: 0.8rem;
        color: var(--app-muted);
        margin: 10px 0;
    }
    .periods {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
    }
    .periods button,
    .chart-state button {
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 8px 12px;
        background: var(--app-surface);
        color: var(--app-muted);
        cursor: pointer;
        font: inherit;
        font-size: 0.8rem;
    }
    .periods button.active {
        background: var(--app-accent);
        border-color: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .quote-summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        flex-wrap: wrap;
        margin: 24px 0;
    }
    .quote-summary > div {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .quote-summary span {
        font-size: 0.8rem;
        color: var(--app-muted);
    }
    .quote-summary strong {
        font-size: 2rem;
    }
    .quote-summary small {
        font-size: 0.7rem;
        font-weight: 400;
        color: var(--app-muted);
    }
    .quote-summary dl {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
        margin: 0;
    }
    .quote-summary dt {
        font-size: 0.75rem;
        color: var(--app-muted);
        margin-bottom: 6px;
    }
    .quote-summary dd {
        margin: 0;
        font-size: 0.85rem;
        font-variant-numeric: tabular-nums;
    }
    .up {
        color: #ef4444 !important;
    }
    .down {
        color: #3b82f6 !important;
    }
    .candle-plot {
        display: block;
        width: 100%;
        height: 280px;
        touch-action: pan-y;
    }
    .candle-plot:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 4px;
    }
    .candle-up {
        fill: #ef4444;
        stroke: #ef4444;
    }
    .candle-down {
        fill: #3b82f6;
        stroke: #3b82f6;
    }
    .candle rect {
        stroke: none;
    }
    .grid-line {
        stroke: var(--stock-chart-grid);
        stroke-dasharray: none;
    }
    .axis {
        fill: var(--app-muted);
        font-size: 11px;
    }
    .crosshair {
        stroke: var(--app-muted);
        stroke-dasharray: 4 4;
        opacity: 0.5;
        pointer-events: none;
    }
    .chart-state {
        min-height: 360px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        color: var(--app-muted);
    }
    .chart-note {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        font-size: 0.75rem;
        color: var(--app-muted);
        margin: 12px 0;
    }
    .chart-note i {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 2px;
        margin: 0 4px 0 8px;
    }
    .red {
        background: #ef4444;
    }
    .blue {
        background: #3b82f6;
    }
    @media (max-width: 600px) {
        .axis {
            font-size: 16px;
        }
        .candle-plot {
            height: 280px;
        }
        .quote-summary {
            gap: 16px;
        }
        .quote-summary dl {
            gap: 14px;
        }
        .quote-summary dd {
            font-size: 0.75rem;
        }
        .periods {
            width: 100%;
        }
        .periods button {
            flex: 1;
            padding: 8px;
        }
        .chart-note {
            line-height: 1.6;
        }
    }

    /* 87cd200... source: three tool groups in one wrapping toolbar. */
    .chart-accessible-title {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }
    .chart-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
    }
    .chart-heading,
    .chart-navigation {
        display: contents;
    }
    .periods,
    .interval-controls {
        display: inline-flex;
        flex-wrap: nowrap;
        padding: 4px;
        gap: 4px;
        border-radius: 8px;
        background: var(--app-surface-muted);
        width: auto;
        max-width: 100%;
        overflow-x: auto;
    }
    .periods button,
    .interval-controls button {
        flex: 0 0 auto;
        height: 36px;
        min-height: 36px;
        padding: 0 12px;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: var(--app-muted);
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
    }
    .periods button.active,
    .interval-controls button[aria-pressed='true'] {
        background: var(--app-surface);
        color: var(--app-accent);
        box-shadow: 0 1px 2px rgb(0 0 0 / 6%);
    }
    .zoom-controls {
        flex-wrap: wrap;
        gap: 6px;
    }
    .zoom-controls button {
        height: 36px;
        min-height: 36px;
        padding: 0 10px;
        border-radius: 8px;
        font-size: 12px;
        white-space: nowrap;
    }
    .chart-frame {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 32px;
        padding: 18px 16px 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface);
    }
    .quote-summary {
        margin: 0;
        padding: 8px 12px;
        gap: 8px;
        border: 1px solid var(--app-border);
        border-radius: 6px;
        background: var(--app-bg);
        font-size: 12px;
    }
    .quote-summary > div {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }
    .quote-summary strong,
    .quote-summary span,
    .quote-summary dd,
    .quote-summary dt {
        font-size: 12px;
    }
    .quote-summary dl {
        gap: 8px 16px;
    }
    .quote-summary dl > div {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .quote-summary dt {
        margin: 0;
    }
    @media (max-width: 768px) {
        .chart-controls {
            flex-direction: column;
            align-items: stretch;
        }
        .periods,
        .interval-controls {
            width: 100%;
        }
    }
    .volume-plot {
        display: block;
        width: 100%;
        height: 80px;
        box-sizing: border-box;
        padding-top: 8px;
        border-top: 1px dashed var(--app-border);
        touch-action: pan-y;
    }
    .volume-bar rect {
        stroke: none;
        fill: var(--stock-chart-volume);
        opacity: 1;
    }
    .volume-selected rect {
        fill: var(--app-accent);
        opacity: 0.75;
    }
    .chart-event circle:not(.split):not(.dividend) {
        fill: var(--app-muted);
    }
    .chart-frame .event-legend {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 14px;
        margin: 4px 0 0;
        font-size: 12px;
    }
    .event-legend strong {
        color: var(--app-text);
        font-weight: 600;
    }
    .event-key {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .marker-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        color: var(--app-accent-contrast);
        font-size: 11px;
        font-weight: 800;
    }
    .marker-badge.dividend {
        background: var(--app-accent);
    }
    .marker-badge.split {
        background: var(--app-warning);
        color: var(--app-brand-brown);
    }
    .chart-meta-footer {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        border-top: 1px solid var(--app-border);
        padding-top: 10px;
        color: var(--app-muted);
        font-size: 12px;
    }
    .chart-meta-footer .chart-note,
    .chart-meta-footer .basis-note {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
    }
    @media (max-width: 600px) {
        .chart-meta-footer .chart-note {
            display: block;
        }
        .chart-meta-footer .chart-note > span + span {
            margin-inline-start: 8px;
        }
    }
</style>
