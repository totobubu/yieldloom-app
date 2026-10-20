<script setup>
    import ProgressSpinner from 'primevue/progressspinner';

    defineProps({ busy: Boolean });
</script>

<template>
    <div class="portfolio-content" :aria-busy="busy">
        <div v-if="busy" class="portfolio-loading-overlay">
            <div
                class="portfolio-loading-status"
                role="status"
                aria-live="polite">
                <ProgressSpinner
                    class="portfolio-loading-spinner"
                    aria-hidden="true" />
                <strong>자료를 처리하고 있습니다.</strong>
                <p>처리가 완료될 때까지 잠시만 기다려 주세요.</p>
            </div>
        </div>
        <div class="portfolio-content-body" :inert="busy">
            <slot />
        </div>
    </div>
</template>

<style scoped>
    .portfolio-content {
        position: relative;
        min-height: calc(100dvh - 160px);
    }
    .portfolio-loading-overlay {
        position: absolute;
        inset: 0;
        z-index: 1200;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: clamp(64px, 18vh, 160px) 16px;
        background: color-mix(in srgb, var(--app-bg) 90%, transparent);
        backdrop-filter: blur(4px);
        border-radius: 16px;
        cursor: wait;
    }
    .portfolio-loading-status {
        position: sticky;
        top: max(24px, calc(50dvh - 100px));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        text-align: center;
        color: var(--app-text);
        overflow-wrap: anywhere;
    }
    .portfolio-loading-spinner {
        width: 80px;
        height: 80px;
        --p-progressspinner-color-one: var(--app-accent);
        --p-progressspinner-color-two: var(--app-accent);
        --p-progressspinner-color-three: var(--app-accent);
        --p-progressspinner-color-four: var(--app-accent);
    }
    .portfolio-loading-status strong {
        font-size: clamp(20px, 4vw, 26px);
    }
    .portfolio-loading-status p {
        margin: 0;
        color: var(--app-muted);
    }
    @media (prefers-reduced-motion: reduce) {
        .portfolio-loading-spinner :deep(*) {
            animation: none;
        }
    }
</style>
