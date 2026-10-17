<script setup>
    import { computed } from 'vue';
    const props = defineProps({
        rows: { type: Array, required: true },
        currency: { type: String, required: true },
    });
    const scale = computed(() =>
        Math.max(1, ...props.rows.flatMap((r) => [r.income, r.goal]))
    );
    const x = (i) => 55 + (i / Math.max(1, props.rows.length - 1)) * 690;
    const y = (v) => 255 - (v / scale.value) * 215;
    const path = (key) =>
        props.rows
            .map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r[key])}`)
            .join(' ');
    const label = (n) =>
        Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 });
</script>
<template>
    <figure>
        <svg
            viewBox="0 0 800 305"
            role="img"
            aria-labelledby="projection-chart-title projection-chart-desc">
            <title id="projection-chart-title">
                월 세후 배당과 물가 반영 목표 추이
            </title>
            <desc id="projection-chart-desc">
                {{ rows.length - 1 }}년간 연말 기준 월 배당과 월 목표 금액 비교.
                단위 {{ currency }}. 상세 수치는 연도별 FIRE 전망 표에서 확인할
                수 있습니다.
            </desc>
            <line x1="55" x2="755" y1="255" y2="255" stroke="currentColor" />
            <path
                :d="path('income')"
                fill="none"
                stroke="#2563eb"
                stroke-width="3" />
            <path
                :d="path('goal')"
                fill="none"
                stroke="#c05621"
                stroke-width="3"
                stroke-dasharray="8 5" />
            <text x="10" y="24" fill="currentColor">
                {{ label(scale) }} {{ currency }}
            </text>
            <text x="55" y="285" fill="currentColor">현재</text>
            <text x="680" y="285" fill="currentColor">
                {{ rows.length - 1 }}년 후
            </text>
        </svg>
        <figcaption>실선: 월 세후 배당 · 점선: 물가 반영 월 목표</figcaption>
    </figure>
</template>
<style scoped>
    figure {
        margin: 1rem 0;
    }
    svg {
        width: 100%;
        height: auto;
        max-height: 360px;
    }
    figcaption {
        color: var(--p-text-muted-color);
        font-size: 0.9rem;
    }
</style>
