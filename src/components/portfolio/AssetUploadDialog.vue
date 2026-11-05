<script setup>
    import Dialog from 'primevue/dialog';
    const visible = defineModel('visible', { type: Boolean });
    defineProps({
        title: { type: String, default: '자료 업로드' },
        busy: Boolean,
        mapping: Boolean,
        receipt: Boolean,
        review: Boolean,
        upload: Boolean,
    });
</script>
<template>
    <Dialog
        v-model:visible="visible"
        modal
        :header="title"
        :class="{
            'asset-upload-dialog--mapping': mapping,
            'asset-upload-dialog--receipt': receipt,
            'asset-upload-dialog--review': review,
            'asset-upload-dialog--upload': upload,
        }"
        :style="{
            width: mapping
                ? '80rem'
                : receipt || review
                  ? '882px'
                  : upload
                    ? '834px'
                    : '72rem',
            maxWidth:
                mapping || receipt || review || upload
                    ? '100vw'
                    : 'calc(100vw - 24px)',
            overflowX: 'hidden',
        }"
        :content-style="{ minWidth: 0, overflowX: 'hidden' }"
        :closable="!busy"
        :close-on-escape="!busy">
        <slot v-if="visible" />
    </Dialog>
</template>

<style>
    .asset-upload-dialog--mapping {
        border-width: 0;
    }
    .asset-upload-dialog--mapping .p-dialog-content {
        padding: 32px 24px;
        background: var(--app-bg);
    }
    @media (max-width: 1023px) {
        .asset-upload-dialog--mapping .p-dialog-content {
            padding: 24px;
        }
    }
    @media (max-width: 640px) {
        .asset-upload-dialog--mapping .p-dialog-content {
            padding: 20px 16px;
        }
    }

    /* Reference content max-width 834px plus the two 24px outer gutters. */
    .asset-upload-dialog--receipt {
        border-width: 0;
    }
    .asset-upload-dialog--receipt .p-dialog-content {
        padding: 24px;
        background: var(--app-bg);
    }
    @media (max-width: 640px) {
        .asset-upload-dialog--receipt .p-dialog-content {
            padding: 16px 8px;
        }
    }
    .asset-upload-dialog--review {
        border-width: 0;
    }
    .asset-upload-dialog--review .p-dialog-content {
        padding: 24px;
        background: var(--app-bg);
    }
    @media (max-width: 640px) {
        .asset-upload-dialog--review .p-dialog-content {
            padding: 20px 16px 48px;
        }
    }
    .asset-upload-dialog--upload {
        border-width: 0;
    }
    .asset-upload-dialog--upload .p-dialog-content {
        padding: 24px;
        background: var(--app-bg);
    }
    @media (max-width: 640px) {
        .asset-upload-dialog--upload .p-dialog-content {
            padding: 16px;
        }
    }
</style>
