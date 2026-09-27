<script setup>
    import { computed } from 'vue';
    import ProgressSpinner from 'primevue/progressspinner';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        message: {
            type: String,
            default: '데이터를 불러오는 중...',
        },
        spinnerSize: {
            type: String,
            default: '60px',
        },
        spinnerStrokeWidth: {
            type: String,
            default: '4',
        },
        blur: {
            type: Boolean,
            default: true,
        },
    });
</script>

<template>
    <Teleport to="body">
        <Transition name="fade">
            <div
                v-if="visible"
                class="loading-overlay"
                :class="{ 'with-blur': blur }">
                <div class="loading-content">
                    <ProgressSpinner
                        :style="{ width: spinnerSize, height: spinnerSize }"
                        :strokeWidth="spinnerStrokeWidth"
                        animationDuration="1s" />
                    <p v-if="message" class="loading-text">{{ message }}</p>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
    .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        /* background-color: rgba(0, 0, 0, 0.7); */
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
    }

    .loading-overlay.with-blur {
        backdrop-filter: blur(4px);
    }

    .loading-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
        padding: 3rem;
        background: var(--surface-card);
        border-radius: 1rem;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }

    .loading-text {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 500;
        color: var(--text-color);
        text-align: center;
        max-width: 300px;
    }

    /* Fade transition */
    .fade-enter-active,
    .fade-leave-active {
        transition: opacity 0.3s ease;
    }

    .fade-enter-from,
    .fade-leave-to {
        opacity: 0;
    }
</style>
