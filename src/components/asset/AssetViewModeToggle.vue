<!-- src/components/asset/AssetViewModeToggle.vue -->
<script setup>
    import { ref, computed } from 'vue';
    import Button from 'primevue/button';

    const props = defineProps({
        mode: {
            type: String,
            default: 'account', // 'account' or 'stock'
        },
    });

    const emit = defineEmits(['update:mode']);

    const options = ref([
        {
            label: '계좌 기준',
            value: 'account',
            icon: 'pi pi-building-columns',
        },
        { label: '자산별 기준', value: 'asset_type', icon: 'pi pi-chart-bar' },
    ]);

    const selectedOption = computed({
        get: () => props.mode,
        set: (value) => emit('update:mode', value),
    });
</script>

<template>
    <div class="flex align-items-center gap-3">
        <label class="font-semibold text-sm hidden">View 모드:</label>
        <div class="flex gap-2">
            <Button
                v-for="option in options"
                :key="option.value"
                :icon="option.icon"
                :severity="
                    selectedOption === option.value ? 'primary' : 'secondary'
                "
                @click="selectedOption = option.value"
                :label="option.label" />
        </div>
    </div>
</template>
