<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';

const frame = ref(null);
const scale = ref(0);
let observer;
onMounted(() => {
    const measure = () => { scale.value = Math.min(1, frame.value.clientWidth / 720); };
    observer = new ResizeObserver(measure);
    observer.observe(frame.value);
    measure();
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
    <div ref="frame" class="thumbnail-preview">
        <div class="thumbnail-preview-artboard" :style="{ transform: `scale(${scale})` }"><slot /></div>
    </div>
</template>

<style scoped>
.thumbnail-preview { position: relative; width: 100%; max-width: 720px; min-width: 0; aspect-ratio: 1; }
.thumbnail-preview-artboard { position: absolute; top: 0; left: 0; width: 720px; height: 720px; transform-origin: top left; }
</style>
