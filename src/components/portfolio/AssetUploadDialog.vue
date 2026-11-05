<script setup>
    import Dialog from 'primevue/dialog';
    const visible = defineModel('visible', { type: Boolean });
    defineProps({
        title: { type: String, default: '자료 업로드' },
        busy: Boolean,
        mapping: Boolean,
    });
</script>
<template>
    <Dialog
        v-model:visible="visible"
        modal
        :header="title"
        :class="{ 'asset-upload-dialog--mapping': mapping }"
        :style="{
            width: mapping ? '80rem' : '72rem',
            maxWidth: mapping ? '100vw' : 'calc(100vw - 24px)',
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
</style>
