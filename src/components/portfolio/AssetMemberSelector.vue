<script setup>
    import { computed } from 'vue';
    import Select from 'primevue/select';
    import Button from 'primevue/button';
    const props = defineProps({
        profiles: { type: Array, required: true },
        selected: { type: String, default: '' },
        busy: Boolean,
        allowAll: Boolean,
        allSelected: Boolean,
    });
    const emit = defineEmits(['select', 'select-all', 'add']);
    const allOwnersKey = '__all_owners__';
    const options = computed(() => [
        ...(props.allowAll
            ? [
                  {
                      key: allOwnersKey,
                      name: `전체 명의자 (${props.profiles.map((p) => p.name).join(', ')})`,
                  },
              ]
            : []),
        ...props.profiles,
    ]);
    function choose(key) {
        if (key === allOwnersKey && props.allowAll) emit('select-all');
        else emit('select', key);
    }
</script>
<template>
    <div class="members" aria-label="자산관리 가족 선택">
        <Select
            :model-value="allSelected ? allOwnersKey : selected"
            :options="options"
            option-label="name"
            option-value="key"
            aria-label="명의자 선택"
            :disabled="busy"
            @update:model-value="choose" />
        <Button
            label="가족 추가"
            icon="pi pi-user-plus"
            severity="secondary"
            :disabled="busy"
            @click="$emit('add')" />
        <slot />
    </div>
</template>
<style scoped>
    .members {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        min-width: 0;
    }
    .members :deep(.p-select.p-component) {
        min-width: 180px;
        max-width: 100%;
        height: 44px;
        font-size: 14px;
        background: var(--app-surface);
    }
    .members :deep(.p-button) {
        height: 44px;
        font-size: 14px;
        white-space: nowrap;
    }
    .members :deep(.p-select-label) {
        overflow: hidden;
        text-overflow: ellipsis;
    }
</style>
