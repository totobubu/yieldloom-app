<script setup>
    defineProps({ events: { type: Array, default: () => [] } });
</script>
<template>
    <span
        v-if="!events.length"
        class="price-event-missing"
        aria-label="제공된 이벤트 미확인"
        >—</span
    >
    <span v-else class="price-events">
        <span
            v-for="event in events"
            :key="`${event.date}:${event.kind}`"
            class="price-event">
            <span class="event-marker" :class="event.kind" aria-hidden="true">{{
                event.kind === 'split'
                    ? 'S'
                    : event.kind === 'dividend'
                      ? 'D'
                      : '?'
            }}</span>
            <span>{{
                event.label ||
                (event.kind === 'split'
                    ? '주식분할·병합'
                    : event.kind === 'dividend'
                      ? '배당락'
                      : '이벤트 종류 미확인')
            }}</span>
        </span>
    </span>
</template>
<style scoped>
    .price-events {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 6px 10px;
    }
    .price-event {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        text-align: left;
    }
    .event-marker {
        flex-shrink: 0;
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 700;
        background: var(--app-surface-muted);
        color: var(--app-muted);
    }
    .dividend {
        color: var(--app-accent);
        background: var(--app-accent-light);
    }
    .split {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .price-event-missing {
        color: var(--app-muted);
    }
</style>
