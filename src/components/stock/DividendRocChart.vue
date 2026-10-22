<script setup>
    import { computed, ref, watch } from 'vue';
    const props = defineProps({
        rows: { type: Array, required: true },
        currency: { type: String, required: true },
    });
    const selected = ref('');
    const numeric = (value) =>
        value != null && value !== '' && Number.isFinite(Number(value))
            ? Number(value)
            : null;
    const series = computed(() =>
        [...props.rows]
            .filter((row) => row.currency === props.currency)
            .reverse()
    );
    const maximum = computed(
        () =>
            Math.max(
                0.01,
                ...series.value.flatMap((row) => [
                    numeric(row.distributionAmount) ?? 0,
                    numeric(row.rocAmount) ?? 0,
                ])
            ) * 1.15
    );
    const ratioMaximum = computed(() =>
        Math.max(
            100,
            ...series.value.map((row) => numeric(row.rocPercent) ?? 0)
        )
    );
    const x = (index) =>
        70 + ((index + 0.5) * 820) / Math.max(series.value.length, 1);
    const moneyY = (value) => 260 - (Number(value) / maximum.value) * 220;
    const ratioY = (value) => 260 - (Number(value) / ratioMaximum.value) * 220;
    const barWidth = computed(() =>
        Math.min(22, 240 / Math.max(series.value.length, 1))
    );
    const current = computed(
        () =>
            series.value.find((row) => row.id === selected.value) ||
            series.value.at(-1)
    );
    const display = (value) =>
        value == null || value === '' ? '미확인' : String(value);
    const description = (row) =>
        `${row.exDate || row.payableDate || '날짜 미확인'}, 분배금 ${display(row.distributionAmount)} ${row.currency}, ROC 금액 ${display(row.rocAmount)}, ROC 비율 ${display(row.rocPercent)}${row.rocPercent == null ? '' : '%'}`;
    watch(
        () => props.rows,
        () => {
            selected.value = '';
        }
    );
</script>
<template>
    <div class="dividend-roc-chart">
        <p class="chart-legend">
            <span><i class="distribution-key" />주당 분배금</span
            ><span><i class="roc-key" />ROC 금액</span
            ><span><i class="ratio-key" />ROC 비율 · 오른쪽 축</span>
        </p>
        <div
            class="chart-scroll"
            tabindex="0"
            role="region"
            aria-label="배당·ROC 차트, 가로로 이동 가능">
            <svg
                v-if="series.length"
                viewBox="0 0 960 315"
                role="group"
                aria-label="주당 분배금과 ROC 금액 막대 및 ROC 비율 차트">
                <text x="14" y="18" class="axis-title">
                    {{ currency }} · 주당 세전
                </text>
                <text x="900" y="18" class="axis-title">ROC %</text>
                <g v-for="tick in [0, 1, 2, 3, 4]" :key="tick">
                    <line
                        x1="70"
                        x2="890"
                        :y1="260 - tick * 55"
                        :y2="260 - tick * 55"
                        class="grid-line" />
                    <text x="60" :y="264 - tick * 55" text-anchor="end">
                        {{ Number(((maximum * tick) / 4).toPrecision(3)) }}
                    </text>
                    <text x="900" :y="264 - tick * 55">
                        {{ Number(((ratioMaximum * tick) / 4).toFixed(1)) }}%
                    </text>
                </g>
                <g
                    v-for="(row, index) in series"
                    :key="row.id"
                    class="chart-payment"
                    tabindex="0"
                    role="button"
                    :aria-label="description(row)"
                    :aria-pressed="current?.id === row.id"
                    @click="selected = row.id"
                    @focus="selected = row.id"
                    @keydown.enter.prevent="selected = row.id"
                    @keydown.space.prevent="selected = row.id">
                    <title>{{ description(row) }}</title>
                    <rect
                        :x="x(index) - 28"
                        y="35"
                        width="56"
                        height="230"
                        class="chart-hit"
                        :class="{ active: current?.id === row.id }" />
                    <rect
                        v-if="numeric(row.distributionAmount) != null"
                        :x="x(index) - barWidth"
                        :y="moneyY(row.distributionAmount)"
                        :width="barWidth"
                        :height="
                            Math.max(1, 260 - moneyY(row.distributionAmount))
                        "
                        rx="3"
                        class="distribution-bar" />
                    <rect
                        v-if="numeric(row.rocAmount) != null"
                        :x="x(index) + 2"
                        :y="moneyY(row.rocAmount)"
                        :width="barWidth"
                        :height="Math.max(1, 260 - moneyY(row.rocAmount))"
                        rx="3"
                        class="roc-bar" />
                    <circle
                        v-if="numeric(row.rocPercent) != null"
                        :cx="x(index)"
                        :cy="ratioY(row.rocPercent)"
                        r="5"
                        class="ratio-point" />
                    <text :x="x(index)" y="285" text-anchor="middle">
                        {{
                            (row.exDate || row.payableDate || '미확인').slice(2)
                        }}
                    </text>
                </g>
            </svg>
            <p v-else>이 통화로 표시할 지급 내역이 없습니다.</p>
        </div>
        <p v-if="current" class="chart-detail" aria-live="polite">
            <strong>{{
                current.exDate || current.payableDate || '날짜 미확인'
            }}</strong
            ><span
                >주당 분배금 {{ display(current.distributionAmount) }}
                {{ current.currency }}</span
            ><span>ROC 금액 {{ display(current.rocAmount) }}</span
            ><span
                >ROC 비율 {{ display(current.rocPercent)
                }}{{ current.rocPercent == null ? '' : '%' }}</span
            >
        </p>
        <p class="chart-note">
            표의 현재 페이지와 같은 지급 내역입니다. 비어 있는 금액·비율은 0으로
            그리지 않습니다. 막대 또는 점을 선택하면 값을 확인할 수 있습니다.
        </p>
    </div>
</template>
<style scoped>
    .chart-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px 20px;
        font-size: 12px;
        color: var(--app-muted);
    }
    .chart-legend span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .chart-legend i {
        width: 10px;
        height: 10px;
        display: inline-block;
        border-radius: 2px;
    }
    .distribution-key,
    .distribution-bar {
        background: var(--app-accent);
        fill: var(--app-accent);
    }
    .roc-key,
    .roc-bar {
        background: #0d9488;
        fill: #0d9488;
    }
    .ratio-key,
    .ratio-point {
        background: #9333ea;
        fill: #9333ea;
        border-radius: 50%;
    }
    :global(.p-dark) .ratio-point {
        fill: #d8b4fe;
    }
    .chart-scroll {
        overflow-x: auto;
        padding-bottom: 6px;
    }
    svg {
        display: block;
        width: 100%;
        min-width: 660px;
    }
    text {
        font-size: 11px;
        fill: var(--app-muted);
    }
    .axis-title {
        font-size: 12px;
    }
    .grid-line {
        stroke: var(--app-border);
        stroke-dasharray: 3 4;
    }
    .chart-hit {
        fill: transparent;
    }
    .chart-hit.active {
        fill: var(--app-surface-muted);
    }
    .chart-payment {
        cursor: pointer;
        outline: none;
    }
    .chart-payment:focus .chart-hit {
        stroke: var(--app-accent);
        stroke-width: 2;
    }
    .chart-detail {
        display: flex;
        gap: 8px 20px;
        flex-wrap: wrap;
        padding: 14px;
        background: var(--app-surface-muted);
        border-radius: 10px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
    }
    .chart-note {
        font-size: 12px;
        color: var(--app-muted);
        line-height: 1.7;
    }
</style>
