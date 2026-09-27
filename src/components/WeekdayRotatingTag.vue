<script setup>
    import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
    import Tag from 'primevue/tag';
    import {
        extractWeekdayLabels,
        getGroupSeverity,
    } from '@/utils/uiHelpers.js';

    const props = defineProps({
        labels: {
            type: Array,
            default: () => [],
        },
        fallback: {
            type: [String, Object, Array],
            default: null,
        },
        interval: {
            type: Number,
            default: 1800,
        },
    });

    const currentIndex = ref(0);
    const activeLabels = computed(() => {
        const provided =
            props.labels
                ?.map((label) =>
                    typeof label === 'string' ? label.trim() : ''
                )
                .filter(Boolean) || [];

        if (provided.length > 0) {
            return [...new Set(provided)];
        }

        if (!props.fallback) return [];

        return extractWeekdayLabels(props.fallback);
    });

    const currentLabel = computed(
        () => activeLabels.value[currentIndex.value] || null
    );

    let timerId = null;

    const resetRotation = () => {
        if (timerId) {
            clearInterval(timerId);
            timerId = null;
        }

        currentIndex.value = 0;

        if (activeLabels.value.length > 1) {
            timerId = setInterval(() => {
                currentIndex.value =
                    (currentIndex.value + 1) % activeLabels.value.length;
            }, props.interval);
        }
    };

    watch(activeLabels, () => {
        resetRotation();
    });

    onMounted(() => {
        resetRotation();
    });

    onBeforeUnmount(() => {
        if (timerId) {
            clearInterval(timerId);
        }
    });
</script>

<template>
    <Transition name="weekday-rotate" mode="out-in">
        <Tag
            v-if="currentLabel"
            :key="currentLabel"
            :value="currentLabel"
            :severity="getGroupSeverity(currentLabel)" />
    </Transition>
</template>

<style scoped>
    .weekday-rotate-enter-active,
    .weekday-rotate-leave-active {
        transition: opacity 0.25s ease;
    }
    .weekday-rotate-enter-from,
    .weekday-rotate-leave-to {
        opacity: 0;
    }
</style>
