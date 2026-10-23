<script setup>
    import { computed, ref, watch } from 'vue';
    import Message from 'primevue/message';
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
    function linePath(field, y) {
        let connected = false;
        return series.value
            .map((row, index) => {
                const value = numeric(row[field]);
                if (value == null) {
                    connected = false;
                    return '';
                }
                const command = connected ? 'L' : 'M';
                connected = true;
                return `${command}${x(index)},${y(value)}`;
            })
            .filter(Boolean)
            .join(' ');
    }
    const current = computed(
        () =>
            series.value.find((row) => row.id === selected.value) ||
            series.value.at(-1)
    );
    const display = (value) =>
        value == null || value === '' ? '미확인' : String(value);
    const pointValue = (value, percent = false) =>
        Number(value).toLocaleString('ko-KR', {
            maximumFractionDigits: percent ? 2 : 4,
        }) + (percent ? '%' : '');
    function ratioLabelY(row) {
        const y = ratioY(row.rocPercent);
        const reserved = [
            numeric(row.distributionAmount) == null
                ? null
                : moneyY(row.distributionAmount) - 12,
            numeric(row.rocAmount) == null ? null : moneyY(row.rocAmount) + 18,
        ].filter((value) => value != null);
        return (
            [y - 12, y + 18, y - 30, y + 34]
                .map((value) => Math.max(28, Math.min(273, value)))
                .find((value) =>
                    reserved.every((other) => Math.abs(value - other) >= 14)
                ) ?? Math.max(28, y - 30)
        );
    }
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
                aria-label="주당 분배금·ROC 금액·ROC 비율 라인 차트">
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
                <path
                    :d="linePath('distributionAmount', moneyY)"
                    class="distribution-line"
                    aria-hidden="true" />
                <path
                    :d="linePath('rocAmount', moneyY)"
                    class="roc-line"
                    aria-hidden="true" />
                <path
                    :d="linePath('rocPercent', ratioY)"
                    class="ratio-line"
                    aria-hidden="true" />
                <g
                    v-for="(row, index) in series"
                    :key="row.id"
                    class="chart-payment"
                    tabindex="0"
                    role="button"
                    :aria-label="description(row)"
                    :aria-pressed="current?.id === row.id"
                    @pointerenter="selected = row.id"
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
                    <circle
                        v-if="numeric(row.distributionAmount) != null"
                        :cx="x(index)"
                        :cy="moneyY(row.distributionAmount)"
                        r="4"
                        class="distribution-point" />
                    <circle
                        v-if="numeric(row.rocAmount) != null"
                        :cx="x(index)"
                        :cy="moneyY(row.rocAmount)"
                        r="4"
                        class="roc-point" />
                    <circle
                        v-if="numeric(row.rocPercent) != null"
                        :cx="x(index)"
                        :cy="ratioY(row.rocPercent)"
                        r="5"
                        class="ratio-point" />
                    <text
                        v-if="numeric(row.distributionAmount) != null"
                        :x="x(index)"
                        :y="moneyY(row.distributionAmount) - 12"
                        text-anchor="middle"
                        class="point-value distribution-value"
                        aria-hidden="true">
                        {{ pointValue(row.distributionAmount) }}
                    </text>
                    <text
                        v-if="numeric(row.rocAmount) != null"
                        :x="x(index)"
                        :y="Math.min(273, moneyY(row.rocAmount) + 18)"
                        text-anchor="middle"
                        class="point-value roc-value"
                        aria-hidden="true">
                        {{ pointValue(row.rocAmount) }}
                    </text>
                    <text
                        v-if="numeric(row.rocPercent) != null"
                        :x="x(index)"
                        :y="ratioLabelY(row)"
                        text-anchor="middle"
                        class="point-value ratio-value"
                        aria-hidden="true">
                        {{ pointValue(row.rocPercent, true) }}
                    </text>
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
        <Message
            class="chart-note"
            severity="info"
            :closable="false"
            role="note">
            <div class="chart-note-content">
                <strong>차트 읽는 방법</strong>
                <p>
                    표의 현재 페이지와 같은 지급 내역입니다. 비어 있는
                    금액·비율은 0으로 그리지 않으며, 해당 구간의 선도 연결하지
                    않습니다.
                </p>
                <p>
                    포인트 값은 간략히 표시합니다. 마우스를 올리거나 점을
                    선택하면 상세 영역에서 원문 정밀도의 값을 확인할 수
                    있습니다.
                </p>
            </div>
        </Message>
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
        width: 18px;
        height: 0;
        display: inline-block;
        border-top: 3px solid;
    }
    .chart-legend .distribution-key {
        border-color: var(--app-accent);
    }
    .chart-legend .roc-key {
        border-color: #0d9488;
        border-top-style: dashed;
    }
    .chart-legend .ratio-key {
        border-color: #9333ea;
        border-top-style: dotted;
    }
    .distribution-point {
        fill: var(--app-accent);
    }
    .roc-point {
        fill: #0d9488;
    }
    .ratio-point {
        fill: #9333ea;
    }
    .distribution-line,
    .roc-line,
    .ratio-line {
        fill: none;
        stroke-width: 2.5;
        stroke-linejoin: round;
        stroke-linecap: round;
        pointer-events: none;
    }
    .distribution-line {
        stroke: var(--app-accent);
    }
    .roc-line {
        stroke: #0d9488;
        stroke-dasharray: 7 4;
    }
    .ratio-line {
        stroke: #9333ea;
        stroke-dasharray: 2 5;
    }
    :global(.p-dark) .ratio-point {
        fill: #d8b4fe;
    }
    :global(.p-dark) .ratio-line {
        stroke: #d8b4fe;
    }
    :global(.p-dark) .ratio-key {
        border-color: #d8b4fe;
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
        stroke: var(--app-border);
        stroke-dasharray: 4 3;
    }
    .chart-payment {
        cursor: pointer;
        outline: none;
    }
    .chart-payment:focus .chart-hit {
        stroke: var(--app-accent);
        stroke-width: 2;
    }
    .point-value {
        font-size: 11px;
        font-weight: 650;
        paint-order: stroke fill;
        stroke: var(--app-surface);
        stroke-width: 3px;
        stroke-linejoin: round;
        pointer-events: none;
    }
    .distribution-value {
        fill: var(--app-accent);
    }
    .roc-value {
        fill: #0d9488;
    }
    .ratio-value {
        fill: #9333ea;
    }
    :global(.p-dark) .ratio-value {
        fill: #d8b4fe;
    }
    .chart-detail {
        display: flex;
        gap: 8px 20px;
        flex-wrap: wrap;
        margin: 16px 0 0;
        padding: 16px;
        background: var(--app-surface-muted);
        border-radius: 10px;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
    }
    .chart-note {
        margin: 16px 0 0;
    }
    .chart-note-content {
        font-size: 13px;
        line-height: 1.8;
    }
    .chart-note-content strong {
        font-weight: 650;
    }
    .chart-note-content p {
        margin: 6px 0 0;
    }
</style>
