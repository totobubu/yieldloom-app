<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';

const props = defineProps({ slot: { type: String, required: true }, label: { type: String, default: '광고' } });
const client = String(import.meta.env.VITE_ADSENSE_CLIENT || '');
const enabled = computed(() => /^ca-pub-\d+$/.test(client) && /^\d+$/.test(props.slot));
const initialized = ref(false);

function loadScript() {
    const existing = document.querySelector('script[data-yieldloom-adsense]');
    if (existing) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.dataset.yieldloomAdsense = 'true';
        script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
        script.addEventListener('load', resolve, { once: true });
        script.addEventListener('error', reject, { once: true });
        document.head.append(script);
    });
}

onMounted(async () => {
    if (!enabled.value) return;
    try {
        await loadScript();
        await nextTick();
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
        initialized.value = true;
    } catch {
        initialized.value = false;
    }
});
</script>

<template>
    <aside v-if="enabled" class="ad-slot" :aria-label="label" :data-ready="initialized">
        <span>광고</span>
        <ins class="adsbygoogle" style="display:block" :data-ad-client="client" :data-ad-slot="slot" data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
</template>

<style scoped>
.ad-slot{margin:24px 0;padding:10px 12px;border:1px solid var(--app-border-subtle);border-radius:10px;background:var(--app-surface);min-height:90px}.ad-slot>span{display:block;margin-bottom:6px;color:var(--app-muted);font-size:11px}
</style>
