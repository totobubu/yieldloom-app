<script setup>
import { computed, ref, watch } from 'vue';
import { useBreakpoint } from '@/composables/shared/useBreakpoint';
import { debounce } from '@/utils';

// PrimeVue 컴포넌트 import
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';

const { isMobile, isDesktop } = useBreakpoint();

const props = defineProps({
    modelValue: String,
    title: {
        type: String,
        required: true,
    },
    filterType: {
        type: String,
        default: 'global', // 'global' or 'calendar'
        validator: (value) => ['global', 'calendar'].includes(value),
    },
});

const emit = defineEmits(['update:modelValue']);

const inputModel = ref(props.modelValue);

// Debounce emit
const updateModelValue = debounce((value) => {
    emit('update:modelValue', value);
}, 300);

watch(
    () => props.modelValue,
    (newValue) => {
        inputModel.value = newValue;
    }
);

const onInput = (value) => {
    updateModelValue(value);
};

const iconClass = computed(() => {
    return props.filterType === 'calendar'
        ? 'pi pi-filter-fill'
        : 'pi pi-search';
});

const responsiveSize = computed(() => {
    if (isMobile.value) {
        return 'small';
        // } else if (isDesktop.value) {
        //     return "large";
    } else {
        return null;
    }
});

const clearInput = () => {
    inputModel.value = null;
    emit('update:modelValue', null);
};
</script>

<template>
    <div class="flex-auto flex items-center gap-2">
        <InputText v-model="inputModel" @update:modelValue="onInput" placeholder="전체 주식 검색" :size="responsiveSize"
            class="flex-1" />
        <Button v-if="modelValue" icon="pi pi-times" severity="secondary" @click="clearInput" aria-label="Clear Filter">
        </Button>
        <Button v-else :icon="iconClass" disabled :title="title" severity="secondary">
        </Button>
    </div>
</template>
