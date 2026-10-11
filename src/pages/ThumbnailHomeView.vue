<script setup>
import { computed, onMounted, ref } from 'vue';
import { useHead } from '@vueuse/head';
import { getDataUrl, getR2Url } from '@/utils/dataUrl';
const query = ref('');
const rows = ref([]);
const loading = ref(true);
const error = ref('');
useHead({ title: '배당 썸네일 종목 선택' });
const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return rows.value.filter(row => [row.symbol, row.koName, row.company].some(value => String(value ?? '').toLowerCase().includes(needle)));
});
async function load() {
    loading.value = true; error.value = '';
    try {
        let response = await fetch(getDataUrl('nav.json')).catch(() => null);
        if (!response?.ok) {
            const fallback = getR2Url('nav.json');
            if (!fallback || fallback === getDataUrl('nav.json')) throw new Error('종목 목록을 불러오지 못했습니다.');
            response = await fetch(fallback);
        }
        if (!response.ok) throw new Error('종목 목록을 불러오지 못했습니다.');
        const payload = await response.json();
        rows.value = (payload.nav ?? []).filter(row => row.dataPaths?.[0]).sort((a, b) => a.symbol.localeCompare(b.symbol));
    } catch (reason) { error.value = reason.message || '종목 목록을 불러오지 못했습니다.'; }
    finally { loading.value = false; }
}
onMounted(load);
</script>
<template>
    <section class="picker">
        <h1>배당 썸네일 제작</h1>
        <label for="ticker-search">티커·종목명·운용사 검색</label>
        <input id="ticker-search" v-model="query" type="search" placeholder="예: TSLY" />
        <p v-if="loading" role="status">종목 목록을 불러오는 중입니다.</p>
        <div v-else-if="error" role="alert"><p>{{ error }}</p><button @click="load">다시 시도</button></div>
        <template v-else>
            <p>{{ filtered.length }}개 종목</p><p v-if="!filtered.length">검색 결과가 없습니다.</p>
            <ul><li v-for="row in filtered" :key="row.symbol">
                <router-link :to="{ name: 'ticker-thumbnail', params: { ticker: row.symbol } }"><strong>{{ row.symbol }}</strong><span>{{ row.koName || row.company }}</span></router-link>
            </li></ul>
        </template>
    </section>
</template>
<style scoped>
.picker { max-width: 1000px; margin: 2rem auto; }
label { display: block; margin-bottom: .5rem; }
input { width: 100%; box-sizing: border-box; padding: .8rem; font: inherit; border: 1px solid #8090a5; border-radius: .5rem; background: transparent; color: inherit; }
ul { padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: .75rem; }
a { display: flex; flex-direction: column; gap: .4rem; padding: 1rem; border: 1px solid #8090a550; border-radius: .5rem; color: inherit; text-decoration: none; }
a:hover { border-color: #b86b00; } span { font-size: .85rem; }
</style>
