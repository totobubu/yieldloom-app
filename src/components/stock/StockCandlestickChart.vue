<script setup>
    import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
    import { apiUrl } from '@/services/apiUrl';
    const chartHost = ref(null),
        chartWidth = ref(1000);
    let observer;
    onMounted(() => {
        observer = new ResizeObserver((entries) => {
            chartWidth.value = Math.max(240, entries[0].contentRect.width);
        });
        if (chartHost.value) observer.observe(chartHost.value);
    });
    onBeforeUnmount(() => observer?.disconnect());
    const props = defineProps({
        symbol: { type: String, required: true },
        currency: { type: String, default: '' },
    });
    const data = ref(null),
        loading = ref(false),
        error = ref(''),
        period = ref(3),
        selected = ref(null);
    const periods = [
        { label: '1개월', months: 1 },
        { label: '3개월', months: 3 },
        { label: '6개월', months: 6 },
        { label: '1년', months: 12 },
        { label: '2년', months: 24 },
    ];
    let sequence = 0;
    const load = async () => {
        const current = ++sequence;
        const symbol = props.symbol;
        loading.value = true;
        error.value = '';
        data.value = null;
        selected.value = null;
        try {
            const response = await fetch(
                apiUrl(
                    `/api/stock-prices?ticker=${encodeURIComponent(symbol)}`
                ),
                { signal: AbortSignal.timeout(15000) }
            );
            const payload = await response.json();
            if (!response.ok)
                throw new Error(
                    payload.error || '일봉 데이터를 불러오지 못했습니다.'
                );
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
            if (sequence === current) loading.value = false;
        }
    };
    watch(() => props.symbol, load, { immediate: true });
    watch(period, () => {
        selected.value = null;
    });
    const candles = computed(() => {
        const rows = data.value?.candles ?? [];
        if (!rows.length) return [];
        const cutoff = new Date(`${rows.at(-1).date}T12:00:00Z`);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - period.value);
        return rows.filter(
            (row) => row.date >= cutoff.toISOString().slice(0, 10)
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
        const index = data.value.candles.findIndex(
            (row) => row.date === current.value.date
        );
        return data.value.candles[index - 1]?.close ?? null;
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
            276;
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
        <header class="chart-heading">
            <div>
                <h2>주가 차트 <span>일봉</span></h2>
                <p>시가·고가·저가·종가 · {{ data?.currency || currency }}</p>
            </div>
            <div class="periods" aria-label="차트 기간">
                <button
                    v-for="item in periods"
                    :key="item.months"
                    :aria-pressed="period === item.months"
                    :class="{ active: period === item.months }"
                    @click="period = item.months">
                    {{ item.label }}
                </button>
            </div>
        </header>
        <div v-if="loading" class="chart-state" role="status">
            일봉 데이터를 불러오는 중…
        </div>
        <div v-else-if="error" class="chart-state" role="alert">
            <p>{{ error }}</p>
            <button @click="load">다시 시도</button>
        </div>
        <template v-else-if="current">
            <div class="quote-summary">
                <div>
                    <span>{{ current.date }}</span
                    ><strong
                        :class="{
                            up: current.close >= current.open,
                            down: current.close < current.open,
                        }"
                        >{{ format(current.close) }}
                        <small>{{ data.currency || currency }}</small></strong
                    ><span
                        v-if="change != null"
                        :class="change >= 0 ? 'up' : 'down'"
                        >{{ change >= 0 ? '+' : '' }}{{ format(change) }}%
                        <small>전일 종가 대비</small></span
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
                :viewBox="`0 0 ${chartWidth} 410`"
                preserveAspectRatio="none"
                role="img"
                tabindex="0"
                :aria-label="`${symbol} ${period}개월 일봉 캔들 차트. 좌우 방향키로 날짜별 가격 확인`"
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
                    <text :x="chartWidth - 56" :y="y(tick) + 4" class="axis">
                        {{ format(tick) }}
                    </text>
                </g>
                <g
                    v-for="(row, index) in candles"
                    :key="row.date"
                    :class="row.close >= row.open ? 'candle-up' : 'candle-down'"
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
                            Math.max(1, Math.abs(y(row.open) - y(row.close)))
                        " />
                    <rect
                        v-if="row.volume != null"
                        :x="x(index) - bodyWidth / 2"
                        :y="378 - (row.volume / maxVolume) * 50"
                        :width="bodyWidth"
                        :height="(row.volume / maxVolume) * 50"
                        opacity=".35" />
                </g>
                <text x="16" y="320" class="axis">거래량</text>
                <line
                    :x1="x(currentIndex)"
                    :x2="x(currentIndex)"
                    y1="24"
                    y2="378"
                    class="crosshair" />
                <line
                    x1="16"
                    :x2="chartWidth - 68"
                    :y1="y(current.close)"
                    :y2="y(current.close)"
                    class="crosshair" />
                <text
                    v-for="index in dateLabels"
                    :key="index"
                    :x="x(index)"
                    y="402"
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
            <footer class="chart-note">
                <span
                    ><i class="red" />상승 <i class="blue" />하락 ·
                    {{ candles.length }}거래일</span
                ><span
                    >Yahoo Finance · 일별 시세 · 장중에는 당일 봉이 변동될 수
                    있습니다.</span
                >
            </footer>
            <p class="basis-note">
                분할·배당 조정 여부는 제공처 기준입니다. 배당을 포함한
                총수익률과는 다릅니다.
            </p>
        </template>
    </section>
</template>

<style scoped>
    .stock-candlestick {
        color: var(--app-text);
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
        height: 410px;
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
        stroke: var(--app-border);
        stroke-dasharray: 3 5;
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
            height: 320px;
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
</style>
