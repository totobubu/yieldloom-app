<script setup>
    import {
        computed,
        onBeforeUnmount,
        onMounted,
        provide,
        ref,
        watch,
    } from 'vue';
    import {
        cardDimensions,
        cardPresentationKey,
        normalizeCardPresentation,
    } from '@/services/thumbnail/cardPresentation';

    const props = defineProps({
        presentation: { type: Object, default: () => ({}) },
    });
    const presentation = computed(() =>
        normalizeCardPresentation(props.presentation)
    );
    const dimensions = computed(() => cardDimensions(presentation.value));
    provide(cardPresentationKey, presentation);

    const frame = ref(null);
    const scale = ref(0);
    let observer;
    const measure = () => {
        if (frame.value)
            scale.value = Math.min(
                1,
                frame.value.clientWidth / dimensions.value.width
            );
    };
    watch(dimensions, measure, { flush: 'post' });
    onMounted(() => {
        observer = new ResizeObserver(measure);
        observer.observe(frame.value);
        measure();
    });
    onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
    <div
        ref="frame"
        class="thumbnail-preview"
        :style="{
            maxWidth: `${dimensions.width}px`,
            aspectRatio: `${dimensions.width} / ${dimensions.height}`,
        }">
        <div
            class="thumbnail-preview-artboard"
            :style="{
                width: `${dimensions.width}px`,
                height: `${dimensions.height}px`,
                transform: `scale(${scale})`,
            }">
            <slot />
        </div>
    </div>
</template>

<style scoped>
    .thumbnail-preview {
        position: relative;
        width: 100%;
        max-width: 720px;
        min-width: 0;
        aspect-ratio: 1;
    }
    .thumbnail-preview-artboard {
        position: absolute;
        top: 0;
        left: 0;
        width: 720px;
        height: 720px;
        transform-origin: top left;
    }
</style>
