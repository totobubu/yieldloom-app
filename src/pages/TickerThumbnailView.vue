<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useHead } from '@vueuse/head';
import { useRoute, useRouter } from 'vue-router';
import html2canvas from 'html2canvas';
import Button from 'primevue/button';
import MultiSelect from 'primevue/multiselect';
import ProgressSpinner from 'primevue/progressspinner';
import DividendSummaryThumbnail from '@/components/thumbnail/DividendSummaryThumbnail.vue';
import DividendComparisonCard from '@/components/thumbnail/DividendComparisonCard.vue';
import TossCommunityCopy from '@/components/thumbnail/TossCommunityCopy.vue';
import RivalComparisonCard from '@/components/thumbnail/RivalComparisonCard.vue';
import { getAssetUrl, getDataUrl, getR2Url } from '@/utils/dataUrl';
import { calculateRivalComparison } from '@/services/thumbnail/rivalComparison';

const route = useRoute();
const router = useRouter();
const nav = ref([]);
const selectedInfo = ref(null);
const selectedData = ref(null);
const loading = ref(true);
const error = ref('');
const rivals = ref([]);
const cache = new Map();

useHead({ title: computed(() => selectedInfo.value ? `${selectedInfo.value.symbol} 배당 썸네일` : '배당 썸네일'), meta: [{ name: 'robots', content: 'noindex, nofollow' }] });

const normalize = (value) => String(value ?? '').trim().toUpperCase().replace(/\./g, '-');
const dividendRows = (rows) =>
    (rows ?? [])
        .filter(
            (row) =>
                !row.forecasted &&
                row.date &&
                (row.amountFixed != null || row.amount != null)
        )
        .sort((a, b) => a.date.localeCompare(b.date));
const amount = (row) => Number(row?.amountFixed ?? row?.amount ?? 0);
const formatMonth = (date) => `${date.slice(2, 4)}.${date.slice(5, 7)}`;

const thumbnailData = computed(() => {
    const rows = dividendRows(selectedData.value?.backtestData);
    const current = rows.at(-1);
    const previous = rows.at(-2);
    const currentAmount = amount(current);
    const previousAmount = amount(previous);
    const exClose = Number(current?.close);
    const prevClose = Number(previous?.close);
    const validClose = Number.isFinite(exClose) && exClose > 0;
    const validPreviousClose = Number.isFinite(prevClose) && prevClose > 0;
    const monthly = new Map();
    rows.slice(-50).forEach((row) => { const month = formatMonth(row.date); monthly.set(month, (monthly.get(month) ?? 0) + amount(row)); });
    const company = String(selectedInfo.value?.company ?? '').toLowerCase();
    const background = company.includes('roundhill') ? 'blue.png' : company.includes('yieldmax') ? 'red.png' : 'gray.png';
    return {
        symbol: selectedInfo.value?.symbol ?? normalize(route.params.ticker), hasDividend: Boolean(current), exDate: current?.date ?? null, previousExDate: previous?.date ?? null,
        currentDividendAmount: currentAmount, previousDividendAmount: previous ? previousAmount : null, dividendDifference: previous ? currentAmount - previousAmount : null,
        dividendChangePercent: previousAmount > 0 ? ((currentAmount - previousAmount) / previousAmount) * 100 : null,
        afterTaxDividendAmount: current ? currentAmount * 0.85 : null, previousAfterTaxDividendAmount: previous ? previousAmount * 0.85 : null,
        exDividendClose: validClose ? exClose : null, previousExDividendClose: validPreviousClose ? prevClose : null,
        exDividendYield: validClose ? (currentAmount / exClose) * 100 : null, previousExDividendYield: validPreviousClose ? (previousAmount / prevClose) * 100 : null,
        afterTaxDividendYield: validClose ? (currentAmount * 0.85 / exClose) * 100 : null, previousAfterTaxDividendYield: validPreviousClose ? (previousAmount * 0.85 / prevClose) * 100 : null,
        monthlyTotals: [...monthly.entries()].slice(-4).map(([month, total]) => ({ month, total })), backgroundImageUrl: getAssetUrl(`thumbnail/${background}`),
    };
});

const rivalOptions = computed(() => {
    const underlying = selectedInfo.value?.underlying;
    if (!underlying) return [];
    return nav.value.filter((item) => item.symbol !== selectedInfo.value.symbol && item.underlying === underlying && item.dataPaths?.[0]).map((item) => ({ label: `${item.symbol}${item.koName ? ` · ${item.koName}` : ''}`, value: item.symbol }));
});

const fetchJson = async (path) => {
    const local = getDataUrl(path);
    try { const response = await fetch(local); if (!response.ok) throw new Error(`${response.status}`); return await response.json(); }
    catch (localError) { const fallback = getR2Url(path); if (!fallback || fallback === local) throw localError; const response = await fetch(fallback); if (!response.ok) throw localError; return response.json(); }
};
const loadTicker = async (info) => {
    if (cache.has(info.symbol)) return cache.get(info.symbol);
    const loaded = await fetchJson(info.dataPaths[0]);
    const result = { symbol: info.symbol, tickerInfo: loaded.tickerInfo ?? info, backtestData: loaded.backtestData ?? [] };
    cache.set(info.symbol, result); return result;
};
const comparison = ref(null);
const refreshComparison = async () => {
    comparison.value = null;
    if (!selectedInfo.value?.underlying || !rivals.value.length) return;
    const target = nav.value.find((item) => normalize(item.symbol) === normalize(selectedInfo.value.underlying));
    const competitorInfo = rivals.value.map((symbol) => nav.value.find((item) => item.symbol === symbol)).filter(Boolean);
    if (!target || competitorInfo.length !== rivals.value.length) return;
    try { const [focal, ...loaded] = await Promise.all([loadTicker(selectedInfo.value), ...competitorInfo.map(loadTicker)]); const underlying = await loadTicker(target); comparison.value = calculateRivalComparison([focal, ...loaded], underlying, new Date().toISOString().slice(0, 10)); } catch (e) { console.warn('Rival comparison could not load', e); }
};
const syncRivalsToUrl = () => router.replace({ query: { ...route.query, rivals: rivals.value.length ? rivals.value.join(',') : undefined } });
watch(rivals, async () => { syncRivalsToUrl(); await refreshComparison(); }, { deep: true });

const load = async () => {
    loading.value = true; error.value = ''; comparison.value = null;
    try {
        const navData = await fetchJson('nav.json'); nav.value = navData.nav ?? [];
        const requested = normalize(route.params.ticker);
        selectedInfo.value = nav.value.find((item) => normalize(item.symbol) === requested || normalize(item.yfSymbol) === requested) ?? null;
        if (!selectedInfo.value?.dataPaths?.[0]) { error.value = `'${route.params.ticker}' 종목을 찾을 수 없거나 데이터 경로가 없습니다.`; return; }
        selectedData.value = await loadTicker(selectedInfo.value);
        const allowed = new Set(rivalOptions.value.map((item) => item.value));
        const requestedRivals = String(route.query.rivals ?? '').split(',').map(normalize).filter((symbol) => allowed.has(symbol)).slice(0, 3);
        rivals.value = requestedRivals;
    } catch (e) { error.value = '썸네일 데이터를 불러오지 못했습니다.'; console.error(e); } finally { loading.value = false; }
};
const download = async () => { const element = document.querySelector('[data-thumbnail-capture]'); if (!element) return; const canvas = await html2canvas(element, { useCORS: true, backgroundColor: null, scale: 1 }); const link = document.createElement('a'); link.download = `${thumbnailData.value.symbol.toLowerCase()}_dividend.png`; link.href = canvas.toDataURL('image/png'); link.click(); };
onMounted(load); watch(() => route.params.ticker, load);
</script>

<template>
    <main class="ticker-thumbnail-page"><div v-if="loading" class="state"><ProgressSpinner /><p>썸네일 데이터를 불러오는 중…</p></div><div v-else-if="error" class="state"><h1>종목을 열 수 없습니다</h1><p>{{ error }}</p></div><template v-else><header class="page-header"><div><p>DIVIDEND THUMBNAIL</p><h1>{{ selectedInfo.symbol }} 배당 콘텐츠</h1></div><Button label="PNG 다운로드" icon="pi pi-download" @click="download" /></header><section class="content-grid"><div><div data-thumbnail-capture><DividendSummaryThumbnail :data="thumbnailData" /></div><Button class="mobile-download" label="PNG 다운로드" icon="pi pi-download" @click="download" /></div><div class="side"><DividendComparisonCard :data="thumbnailData" /><TossCommunityCopy :data="thumbnailData" /></div></section><section v-if="selectedInfo.underlying" class="rivals"><header><div><p>같은 기초자산</p><h2>{{ selectedInfo.underlying }} 기반 ETF 라이벌 비교</h2></div><MultiSelect v-model="rivals" :options="rivalOptions" option-label="label" option-value="value" :max-selected-labels="3" :selection-limit="3" :disabled="!rivalOptions.length" placeholder="라이벌 1~3종 선택" class="rival-select" /></header><p v-if="!rivalOptions.length" class="hint">같은 기초자산으로 등록된 비교 후보가 없습니다.</p><p v-else-if="!rivals.length" class="hint">비교할 라이벌을 최대 3종 선택하세요.</p><RivalComparisonCard v-else :comparison="comparison" :focal-symbol="selectedInfo.symbol" :underlying="selectedInfo.underlying" /></section></template></main>
</template>

<style scoped>
.ticker-thumbnail-page{min-height:100vh;padding:32px;background:#edf2f8;color:#17212b}.state{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}.page-header,.rivals>header{display:flex;justify-content:space-between;align-items:center;gap:20px;max-width:1280px;margin:0 auto 24px}.page-header p,.rivals header p{margin:0;color:#0064ff;font-size:.75rem;font-weight:800;letter-spacing:.12em}.page-header h1,.rivals h2{margin:5px 0 0}.content-grid{display:grid;grid-template-columns:minmax(0,720px) minmax(360px,1fr);gap:24px;max-width:1280px;margin:auto;align-items:start}.side{display:grid;gap:24px}.mobile-download{display:none}.rivals{max-width:1280px;margin:32px auto 0;padding:24px;border-radius:18px;background:#dfe8f2}.rivals>header{margin-bottom:18px}.rival-select{min-width:320px}.hint{margin:0;color:#526274}@media(max-width:1000px){.content-grid{grid-template-columns:1fr}.summary-thumbnail{max-width:100%;height:auto;aspect-ratio:1}.page-header>button{display:none}.mobile-download{display:inline-flex;margin-top:12px}.rivals>header{align-items:flex-start;flex-direction:column}.rival-select{width:100%;min-width:0}}@media(max-width:600px){.ticker-thumbnail-page{padding:16px}}
</style>
