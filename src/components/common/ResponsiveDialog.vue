<script setup>
    import { computed } from 'vue';
    import Dialog from 'primevue/dialog';
    import Drawer from 'primevue/drawer';
    import { useBreakpoint } from '@/composables/shared/useBreakpoint';

    const props = defineProps({
        visible: {
            type: Boolean,
            required: true,
        },
        header: {
            type: String,
            default: '',
        },
        modal: {
            type: Boolean,
            default: true,
        },
        dialogStyle: {
            type: Object,
            default: () => ({ width: '50rem' }),
        },
        drawerPosition: {
            type: String,
            default: 'bottom',
        },
        drawerStyle: {
            type: Object,
            default: () => ({ height: 'auto', maxHeight: '90vh' }),
        },
    });

    const emit = defineEmits(['update:visible', 'hide', 'show']);

    const { isMobile } = useBreakpoint();

    const isVisible = computed({
        get: () => props.visible,
        set: (value) => emit('update:visible', value),
    });
</script>

<template>
    <Drawer
        v-if="isMobile"
        v-model:visible="isVisible"
        :position="drawerPosition"
        :header="header"
        :modal="modal"
        :style="drawerStyle"
        class="responsive-drawer"
        v-bind="$attrs"
        @hide="$emit('hide')"
        @show="$emit('show')">
        <slot></slot>
        <template v-if="$slots.footer" #footer>
            <slot name="footer"></slot>
        </template>
    </Drawer>

    <Dialog
        v-else
        v-model:visible="isVisible"
        :header="header"
        :modal="modal"
        :style="dialogStyle"
        class="responsive-dialog"
        v-bind="$attrs"
        @hide="$emit('hide')"
        @show="$emit('show')">
        <slot></slot>
        <template v-if="$slots.footer" #footer>
            <slot name="footer"></slot>
        </template>
    </Dialog>
</template>

<style scoped>
    /* 모바일 Drawer 스타일 조정 */
    :deep(.p-drawer-content) {
        padding: 1.25rem;
    }
</style>
