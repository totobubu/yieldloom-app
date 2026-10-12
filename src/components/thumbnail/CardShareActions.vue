<script setup>
import { computed, ref } from 'vue';

const props = defineProps({ title: { type: String, required: true }, text: { type: String, required: true }, url: { type: String, required: true } });
const copied = ref(false);
const canWebShare = computed(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function');
const encodedUrl = computed(() => encodeURIComponent(props.url));
const encodedText = computed(() => encodeURIComponent(props.text));

const copyLink = async () => {
    try {
        await navigator.clipboard.writeText(props.url);
        copied.value = true;
        window.setTimeout(() => (copied.value = false), 1800);
    } catch { window.prompt('링크를 복사하세요.', props.url); }
};
const webShare = async () => {
    try { await navigator.share({ title: props.title, text: props.text, url: props.url }); } catch (error) { if (error?.name !== 'AbortError') console.warn('Web Share failed', error); }
};
const open = (url) => window.open(url, '_blank', 'noopener,noreferrer,width=640,height=560');
</script>

<template>
    <nav class="card-share-actions" :aria-label="`${title} 공유`">
        <button v-if="canWebShare" type="button" class="web-share" @click="webShare">공유</button>
        <button type="button" class="kakao" @click="open(`https://sharer.kakao.com/talk/friends/picker/link?url=${encodedUrl}`)">카카오톡</button>
        <button type="button" class="x" @click="open(`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`)">X</button>
        <button type="button" class="facebook" @click="open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`)">Facebook</button>
        <button type="button" @click="copyLink">{{ copied ? '링크 복사됨' : '링크 복사' }}</button>
    </nav>
</template>

<style scoped>
.card-share-actions{display:flex;flex-wrap:wrap;gap:7px}.card-share-actions button{border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;padding:8px 10px;font:700 .75rem/1 inherit;cursor:pointer}.card-share-actions button:hover{border-color:#2563eb;color:#1d4ed8}.card-share-actions .kakao{background:#fee500;border-color:#fee500;color:#191919}.card-share-actions .x{background:#111827;border-color:#111827;color:#fff}.card-share-actions .facebook{background:#1877f2;border-color:#1877f2;color:#fff}.card-share-actions .web-share{background:#2563eb;border-color:#2563eb;color:#fff}
</style>
