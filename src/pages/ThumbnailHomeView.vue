<script setup>
import { computed, onMounted, ref } from 'vue';
import { useHead } from '@vueuse/head';
import { getDataUrl, getR2Url } from '@/utils/dataUrl';
const query = ref('');
const selectedCompany = ref('');
const rows = ref([]);
const loading = ref(true);
const error = ref('');
useHead({ title: '배당 썸네일 종목 선택' });
const companyKey = row => row.company?.trim().toLowerCase() || '__other__';
const companies = computed(() => {
    const groups = new Map();
    for (const row of rows.value) {
        const key = companyKey(row);
        if (!groups.has(key)) groups.set(key, { key, name: row.company?.trim() || '기타 종목', count: 0 });
        groups.get(key).count++;
    }
    return [...groups.values()].sort((a, b) => {
        if (a.key === '__other__') return 1;
        if (b.key === '__other__') return -1;
        return a.name.localeCompare(b.name);
    });
});
const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return rows.value.filter(row =>
        (selectedCompany.value === '' || companyKey(row) === selectedCompany.value) &&
        [row.symbol, row.koName, row.company].some(value => String(value ?? '').toLowerCase().includes(needle))
    );
});
const visibleGroups = computed(() => {
    const groups = new Map(companies.value.map(company => [company.key, { ...company, rows: [] }]));
    for (const row of filtered.value) groups.get(companyKey(row)).rows.push(row);
    return [...groups.values()].filter(group => group.rows.length);
});
async function load() {
    loading.value = true; error.value = '';
    try {
        let response = await fetch(getDataUrl('ticker-index.json')).catch(() => null);
        if (!response?.ok) {
            const fallback = getR2Url('ticker-index.json');
            if (!fallback || fallback === getDataUrl('ticker-index.json')) throw new Error('종목 목록을 불러오지 못했습니다.');
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
            <div class="company-filter">
                <label for="company-filter">ETF 운용사</label>
                <select id="company-filter" v-model="selectedCompany">
                    <option value="">전체 운용사 ({{ rows.length }})</option>
                    <option v-for="company in companies" :key="company.key" :value="company.key">{{ company.name }} ({{ company.count }})</option>
                </select>
            </div>
            <p role="status">{{ visibleGroups.length }}개 그룹 · {{ filtered.length }}개 종목</p>
            <p v-if="!filtered.length">선택한 운용사에 해당하는 검색 결과가 없습니다.</p>
            <section v-for="group in visibleGroups" :key="group.key" class="company-group">
                <h2>{{ group.name }} <span>{{ group.rows.length }}개 종목</span></h2>
                <ul><li v-for="row in group.rows" :key="row.symbol">
                    <router-link :to="{ name: 'ticker-thumbnail', params: { ticker: row.symbol } }"><strong>{{ row.symbol }}</strong><span>{{ row.koName || row.company }}</span></router-link>
                </li></ul>
            </section>
        </template>
    </section>
</template>
<style scoped>
.picker { max-width: 1000px; margin: 2rem auto; }
label { display: block; margin-bottom: .5rem; }
input { width: 100%; box-sizing: border-box; padding: .8rem; font: inherit; border: 1px solid #8090a5; border-radius: .5rem; background: transparent; color: inherit; }
.company-filter { margin-top: 1rem; }
select { width: 100%; box-sizing: border-box; padding: .8rem; font: inherit; border: 1px solid #8090a5; border-radius: .5rem; background: transparent; color: inherit; }
option { background: #f4f6f8; color: #172033; }
.company-group { margin-top: 2rem; }
h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: .75rem; font-size: 1.2rem; padding-bottom: .65rem; border-bottom: 1px solid #8090a540; }
h2 span { font-weight: 400; opacity: .75; }
a:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid #b86b00; outline-offset: 3px; }
ul { padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: .75rem; }
a { display: flex; flex-direction: column; gap: .4rem; padding: 1rem; border: 1px solid #8090a550; border-radius: .5rem; color: inherit; text-decoration: none; }
a:hover { border-color: #b86b00; } span { font-size: .85rem; }
</style>
