<script setup>
    import Dialog from 'primevue/dialog';
    import ProgressSpinner from 'primevue/progressspinner';
    import { useFullscreenLoadingState } from '@/composables/useFullscreenLoading.js';

    const { loading, message } = useFullscreenLoadingState();
</script>

<template>
    <Dialog
        :visible="loading"
        modal
        block-scroll
        :closable="false"
        :close-on-escape="false"
        :draggable="false"
        :show-header="false"
        :style="{ width: 'min(360px, calc(100vw - 40px))' }"
        :pt="{
            root: { class: 'fullscreen-data-loading' },
            mask: {
                class: 'fullscreen-data-loading-mask',
                style: {
                    background:
                        'color-mix(in srgb, var(--app-bg) 88%, transparent)',
                    backdropFilter: 'blur(5px)',
                },
            },
            content: {
                class: 'fullscreen-data-loading-content',
                style: {
                    padding: '32px',
                    background: 'var(--app-surface)',
                },
            },
        }">
        <div
            class="fullscreen-data-loading-status"
            role="status"
            aria-live="polite"
            aria-atomic="true">
            <ProgressSpinner aria-hidden="true" />
            <strong>{{ message }}</strong>
            <span>잠시만 기다려 주세요.</span>
        </div>
    </Dialog>
</template>

<style>
    .fullscreen-data-loading {
        border: 1px solid var(--app-border);
        border-radius: 18px;
        background: var(--app-surface);
        box-shadow: 0 24px 64px rgb(15 23 42 / 18%);
    }
    .fullscreen-data-loading-content {
        border-radius: inherit;
    }
    .fullscreen-data-loading-status {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        text-align: center;
        color: var(--app-text);
    }
    .fullscreen-data-loading-status .p-progressspinner {
        width: 56px;
        height: 56px;
        margin-bottom: 4px;
        --p-progressspinner-color-one: var(--app-accent);
        --p-progressspinner-color-two: var(--app-accent);
        --p-progressspinner-color-three: var(--app-accent);
        --p-progressspinner-color-four: var(--app-accent);
    }
    .fullscreen-data-loading-status strong {
        font-size: 17px;
        line-height: 1.45;
    }
    .fullscreen-data-loading-status span {
        color: var(--app-muted);
        font-size: 14px;
    }
    @media (prefers-reduced-motion: reduce) {
        .fullscreen-data-loading-status .p-progressspinner-svg {
            animation: none;
        }
    }
</style>
