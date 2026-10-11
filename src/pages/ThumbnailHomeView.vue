<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useHead } from '@vueuse/head';
import { getDataUrl, getR2Url } from '@/utils/dataUrl';
import { normalizeFrequency } from '@/services/thumbnail/frequency';
useHead({ title: 'ETF·주식 검색' });
const query = ref(''), company = ref(''), securityType = ref(''), frequency = ref(''), sort = ref('symbol');
const page = ref(1), rows = ref([]), distributions = ref({}), loading = ref(true), error = ref('');
const pageSize = 25;
const frequencyOptions = [{ value: '', label: '전체' }, { value: 'weekly', label: '주배당' }, { value: 'monthly', label: '월배당' }, { value: 'quarterly', label: '분기배당' }, { value: 'semiannual', label: '반기배당' }, { value: 'annual', label: '연배당' }];
const frequencyName = value => frequencyOptions.find(option => option.value === normalizeFrequency(value))?.label ?? '—';
const companies = computed(() => [...new Set(rows.value.map(row => row.company?.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
const filtered = computed(() => {
    const needle = query.value.trim().toLowerCase();
    return rows.value.filter(row => (!company.value || row.company?.trim() === company.value)
        && (!securityType.value || row.securityType === securityType.value)
        && (!frequency.value || normalizeFrequency(row.frequency) === frequency.value)
        && [row.symbol, row.koName, row.company, row.underlying].some(value => String(value ?? '').toLowerCase().includes(needle)))
        .sort((a, b) => sort.value === 'ipoDate' ? String(b.ipoDate ?? '').localeCompare(String(a.ipoDate ?? '')) : String(a[sort.value] ?? '').localeCompare(String(b[sort.value] ?? ''), 'ko'));
});
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const filterCount = computed(() => [company.value, securityType.value, frequency.value, query.value.trim()].filter(Boolean).length);
watch([query, company, securityType, frequency, sort], () => { page.value = 1; });
function reset() { query.value = ''; company.value = ''; securityType.value = ''; frequency.value = ''; }
function amount(row) {
    const event = distributions.value[row.symbol], value = event?.distribution_per_share;
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${event.currency === 'USD' ? '$' : event.currency ? event.currency + ' ' : ''}${Number(value).toLocaleString('en-US', { maximumFractionDigits: 6 })}`;
}
async function fetchJson(path) {
    const local = getDataUrl(path);
    let response = await fetch(local).catch(() => null);
    if (!response?.ok) {
        const fallback = getR2Url(path);
        if (!fallback || fallback === local) throw new Error('데이터를 불러오지 못했습니다.');
        response = await fetch(fallback);
    }
    if (!response.ok) throw new Error('데이터를 불러오지 못했습니다.');
    return response.json();
}
async function load() {
    loading.value = true; error.value = '';
    const [index, dividend] = await Promise.allSettled([fetchJson('ticker-index.json'), fetchJson('content-studio/distribution-index.json')]);
    if (index.status === 'fulfilled') rows.value = (index.value.nav ?? []).filter(row => row.dataPaths?.[0]);
    else error.value = '종목 목록을 불러오지 못했습니다. 다시 시도해 주세요.';
    if (dividend.status === 'fulfilled') distributions.value = Object.fromEntries((dividend.value.tickers ?? []).map(row => [row.ticker, row.latest]));
    loading.value = false;
}
onMounted(load);
</script>

<template>
    <section class="search-page">
        <div class="breadcrumb">배당 스튜디오 <span>/</span> 종목 검색</div>
        <header class="page-title"><div><p>DIVIDEND EXPLORER</p><h1>ETF·주식 검색</h1><span>관심 있는 종목을 찾고, 배당 콘텐츠를 만들어 보세요.</span></div><span class="universe-count">{{ rows.length.toLocaleString() }}<small>등록 종목</small></span></header>
        <section class="filter-panel" aria-label="종목 검색 필터">
            <label class="search-box" for="ticker-search"><i class="pi pi-search" aria-hidden="true" /><input id="ticker-search" v-model="query" type="search" placeholder="종목명, 티커 또는 운용사를 검색하세요" /></label>
            <div class="filter-row"><span class="filter-label">상품 유형</span><div class="chips"><button v-for="option in [{ value: '', label: '전체 종목' }, { value: 'etf', label: 'ETF' }, { value: 'stock', label: '주식' }]" :key="option.value" :aria-pressed="securityType === option.value" :class="{ active: securityType === option.value }" @click="securityType = option.value">{{ option.label }}</button></div></div>
            <div class="filter-row"><span class="filter-label">배당 주기</span><div class="chips"><button v-for="option in frequencyOptions" :key="option.value" :aria-pressed="frequency === option.value" :class="{ active: frequency === option.value }" @click="frequency = option.value">{{ option.label }}</button></div></div>
            <div class="filter-row provider-row"><label class="filter-label" for="company-filter">운용사</label><select id="company-filter" v-model="company"><option value="">전체 운용사</option><option v-for="name in companies" :key="name" :value="name">{{ name }}</option></select><button class="reset" @click="reset"><i class="pi pi-refresh" aria-hidden="true" /> 필터 초기화<span v-if="filterCount"> ({{ filterCount }})</span></button></div>
        </section>
        <div v-if="loading" class="empty" role="status">종목 목록을 불러오는 중입니다.</div>
        <div v-else-if="error" class="empty" role="alert">{{ error }} <button @click="load">다시 시도</button></div>
        <template v-else>
            <div class="results-toolbar"><h2>검색 결과 <b>{{ filtered.length.toLocaleString() }}</b><small>개 종목</small></h2><label for="sort-order">정렬 <select id="sort-order" v-model="sort"><option value="symbol">티커순</option><option value="company">운용사순</option><option value="ipoDate">최근 상장순</option></select></label></div>
            <div class="table-wrap" tabindex="0" role="region" aria-label="종목 검색 결과 표">
                <table><thead><tr><th scope="col">종목명 / 티커</th><th scope="col">운용사</th><th scope="col">배당 주기</th><th scope="col" class="numeric">최근 주당 배당금</th><th scope="col">최근 배당락일</th><th scope="col">상장일</th><th scope="col"><span class="sr-only">콘텐츠 제작</span></th></tr></thead>
                    <tbody><tr v-for="row in visible" :key="row.symbol"><td><router-link class="ticker-link" :to="{ name: 'ticker-thumbnail', params: { ticker: row.symbol } }"><strong>{{ row.symbol }}</strong><span>{{ row.koName || row.symbol }}</span></router-link><small v-if="row.underlying" class="underlying">{{ row.underlying }} 기반</small></td><td>{{ row.company || '—' }}</td><td><span class="frequency" :class="normalizeFrequency(row.frequency)">{{ frequencyName(row.frequency) }}</span></td><td class="numeric dividend">{{ amount(row) }}</td><td>{{ distributions[row.symbol]?.ex_date || '—' }}</td><td>{{ row.ipoDate || '—' }}</td><td><router-link class="create-link" :to="{ name: 'ticker-thumbnail', params: { ticker: row.symbol } }" :aria-label="`${row.symbol} 카드 제작`">카드 제작 <i class="pi pi-arrow-right" aria-hidden="true" /></router-link></td></tr></tbody>
                </table>
                <p v-if="!filtered.length" class="empty">검색 결과가 없습니다. 검색어나 필터를 변경해 주세요.</p>
            </div>
            <div class="results-footer"><p>배당금·배당락일은 저장된 최근 이력 기준입니다. ‘—’는 제공된 데이터가 없는 항목입니다.</p><nav class="pagination" aria-label="검색 결과 페이지"><button :disabled="page === 1" @click="page--" aria-label="이전 페이지">‹</button><span>{{ page }} / {{ pages }}</span><button :disabled="page === pages" @click="page++" aria-label="다음 페이지">›</button></nav></div>
        </template>
    </section>
</template>

<style scoped>
.search-page{--surface:#fff;--line:#e5e9f0;--muted:#697589;--text:#172033;--tint:#f6f8fb;max-width:1440px;margin:20px auto 60px;color:var(--text);min-width:0}
:global(.p-dark) .search-page{--surface:#111d30;--line:#2c3b50;--muted:#a2afc2;--text:#edf2fa;--tint:#17253a}
.breadcrumb{font-size:12px;color:var(--muted);margin-bottom:28px}.breadcrumb span{margin:0 12px;color:#a2afc2}.page-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}.page-title p{font-size:11px;font-weight:800;letter-spacing:.16em;color:#2563eb;margin:0 0 10px}.page-title h1{font-size:34px;letter-spacing:-.05em;margin:0 0 10px}.page-title>div>span{color:var(--muted);font-size:14px}.universe-count{font-size:28px;font-weight:800;letter-spacing:-.03em}.universe-count small{display:block;font-size:11px;font-weight:500;text-align:right;color:var(--muted);margin-top:4px}
.filter-panel{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:28px 32px}.search-box{display:flex;gap:14px;align-items:center;padding:16px 20px;background:var(--tint);border:1px solid var(--line);border-radius:12px;margin-bottom:26px}.search-box i{color:#2563eb;font-size:20px}.search-box input{width:100%;min-width:0;border:0;outline:0;background:transparent;font:inherit;color:inherit}.search-box:focus-within{outline:2px solid #2563eb;outline-offset:2px}.filter-row{display:flex;align-items:center;gap:18px;margin-top:18px}.filter-label{flex:0 0 74px;font-size:13px;font-weight:700}.chips{display:flex;flex-wrap:wrap;gap:8px}button,select{font:inherit;color:inherit}button{cursor:pointer}.chips button{border:1px solid var(--line);background:var(--surface);border-radius:7px;padding:8px 16px;font-size:13px;color:var(--muted)}.chips button.active{background:#2563eb;border-color:#2563eb;color:white;font-weight:700}.provider-row{border-top:1px solid var(--line);padding-top:20px;margin-top:22px}.provider-row select{max-width:310px;width:100%;min-width:0}.reset{margin-left:auto;white-space:nowrap;background:transparent;border:0;color:var(--muted);font-size:12px}.reset i{font-size:11px}.results-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:32px 0 16px}.results-toolbar h2{font-size:18px;margin:0}.results-toolbar h2 b{color:#2563eb;margin-left:8px}.results-toolbar small{font-weight:400;font-size:13px;margin-left:4px}.results-toolbar label{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}select{padding:9px 12px;border:1px solid var(--line);border-radius:7px;background:var(--surface);font-size:13px}
.table-wrap{max-width:100%;overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;white-space:nowrap;font-size:12px;text-align:left}th{font-size:11px;color:var(--muted);background:var(--tint);font-weight:600;padding:16px}td{padding:17px 16px;border-top:1px solid var(--line)}tbody tr:hover{background:var(--tint)}.numeric{text-align:right}.ticker-link{display:flex;flex-direction:column;gap:5px;text-decoration:none;color:inherit}.ticker-link strong{font-size:17px;letter-spacing:-.02em}.ticker-link span{max-width:260px;overflow:hidden;text-overflow:ellipsis;color:var(--muted);font-size:11px}.underlying{display:inline-block;margin-top:6px;color:var(--muted);font-size:10px}.frequency{display:inline-block;padding:5px 8px;border-radius:5px;background:var(--tint);color:var(--muted);font-size:11px}.frequency.monthly{color:#2563eb;background:#2563eb12}.frequency.weekly{color:#7c3aed;background:#7c3aed12}.dividend{font-weight:700;font-variant-numeric:tabular-nums}.create-link{color:#2563eb;text-decoration:none;font-size:11px;white-space:nowrap}.create-link i{font-size:10px}.results-footer{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px}.results-footer p{font-size:11px;color:var(--muted);line-height:1.6}.pagination{display:flex;align-items:center;gap:14px;white-space:nowrap;font-size:12px}.pagination button{background:var(--surface);border:1px solid var(--line);border-radius:6px;width:32px;height:32px;font-size:22px}.pagination button:disabled{opacity:.3;cursor:default}.empty{text-align:center;padding:42px 16px;color:var(--muted);font-size:14px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}a:focus-visible,button:focus-visible,select:focus-visible,.table-wrap:focus-visible{outline:2px solid #2563eb;outline-offset:3px}
@media(max-width:700px){.search-page{margin:12px auto 32px}.breadcrumb{margin-bottom:20px}.page-title h1{font-size:27px}.page-title>div>span{font-size:12px}.universe-count{display:none}.filter-panel{padding:20px 16px;border-radius:12px}.search-box{padding:13px 12px;margin-bottom:20px;font-size:13px}.filter-row{align-items:flex-start;gap:10px;flex-direction:column}.filter-label{flex-basis:auto}.chips button{padding:7px 12px;font-size:12px}.provider-row{flex-direction:row;align-items:center;flex-wrap:wrap}.provider-row select{flex:1;width:auto;max-width:none}.reset{margin-top:5px}.results-toolbar{margin-top:26px}.results-toolbar label{font-size:0}.results-toolbar select{max-width:125px}.results-footer{align-items:flex-start;flex-direction:column}.pagination{align-self:center}td,th{padding:13px 12px}.ticker-link span{max-width:190px}}
</style>
