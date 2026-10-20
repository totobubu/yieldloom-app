<script setup>
    import Dialog from 'primevue/dialog';
    const visible = defineModel('visible', { type: Boolean });
    defineProps({
        title: { type: String, default: '자료 업로드' },
        busy: Boolean,
    });
</script>
<template>
    <Dialog
        v-model:visible="visible"
        modal
        :header="title"
        :style="{ width: '72rem', maxWidth: '96vw' }"
        :closable="!busy"
        :close-on-escape="!busy">
        <slot v-if="visible" />
    </Dialog>
</template>
