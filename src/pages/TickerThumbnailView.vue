<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useHead } from '@vueuse/head';
import { useRoute, useRouter } from 'vue-router';
import html2canvas from 'html2canvas';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import DividendSummaryThumbnail from '@/components/thumbnail/DividendSummaryThumbnail.vue';
import DividendComparisonThumbnail from '@/components/thumbnail/DividendComparisonThumbnail.vue';
import TossCommunityCopy from '@/components/thumbnail/TossCommunityCopy.vue';
import RivalThumbnail from '@/components/thumbnail/RivalThumbnail.vue';
import DividendCalendarThumbnail from '@/components/thumbnail/DividendCalendarThumbnail.vue';
import { getAssetUrl, getDataUrl, getR2Url } from '@/utils/dataUrl';
import { calculateRivalComparison } from '@/services/thumbnail/rivalComparison';
import { loadDividendSchedule } from '@/services/thumbnail/dividendSchedule';

const route = useRoute();
const router = useRouter();
const nav = ref([]);
const selectedInfo = ref(null);
const selectedData = ref(null);
const loading = ref(true);
const error = ref('');
const rivals = ref([]);
const cache = new Map();
const exporting = ref('');
const schedule = ref(null);
const artworkSize = 720;
const maxRivals = 3;

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
const toggleRival = (symbol) => {
    if (rivals.value.includes(symbol)) {
        rivals.value = rivals.value.filter((rival) => rival !== symbol);
        return;
    }
    if (rivals.value.length < maxRivals) rivals.value = [...rivals.value, symbol];
};

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
        schedule.value = await loadDividendSchedule(selectedInfo.value.symbol).catch((reason) => { console.warn('Dividend schedule could not load', reason); return null; });
        const allowed = new Set(rivalOptions.value.map((item) => item.value));
        const requestedRivals = String(route.query.rivals ?? '').split(',').map(normalize).filter((symbol) => allowed.has(symbol)).slice(0, 3);
        rivals.value = requestedRivals;
    } catch (e) { error.value = '썸네일 데이터를 불러오지 못했습니다.'; console.error(e); } finally { loading.value = false; }
};
const downloadArtwork = async (kind) => {
    const element = document.querySelector(`[data-thumbnail-kind="${kind}"]`);
    if (!element) return;
    exporting.value = kind;
    try {
        const canvas = await html2canvas(element, {
            useCORS: true,
            backgroundColor: null,
            scale: 1,
            width: artworkSize,
            height: artworkSize,
        });
        const link = document.createElement('a');
        link.download = `${thumbnailData.value.symbol.toLowerCase()}_${kind}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (e) {
        error.value = 'PNG를 생성하지 못했습니다. 잠시 후 다시 시도하세요.';
        console.error('Thumbnail export failed', e);
    } finally {
        exporting.value = '';
    }
};
onMounted(load); watch(() => route.params.ticker, load);
</script>

<template>
    <main class="ticker-thumbnail-page">
        <div v-if="loading" class="state"><ProgressSpinner /><p>썸네일 데이터를 불러오는 중…</p></div>
        <div v-else-if="error" class="state"><h1>종목을 열 수 없습니다</h1><p>{{ error }}</p></div>
        <template v-else>
            <header class="page-header">
                <div><p>토토부부 배당 스튜디오</p><h1>{{ selectedInfo.symbol }} 배당 콘텐츠</h1></div>
                <section v-if="selectedInfo.underlying && rivalOptions.length" class="rival-candidate-picker" :aria-label="`${selectedInfo.symbol} 라이벌 카드 후보`">
                    <div class="candidate-heading"><p>라이벌 카드 후보</p><strong>{{ selectedInfo.underlying }} 기반 · 최대 {{ maxRivals }}종</strong></div>
                    <div class="candidate-buttons">
                        <button v-for="option in rivalOptions" :key="option.value" type="button" :class="{ selected: rivals.includes(option.value) }" :aria-pressed="rivals.includes(option.value)" :title="option.label" :disabled="!rivals.includes(option.value) && rivals.length >= maxRivals" @click="toggleRival(option.value)">{{ option.value }}</button>
                    </div>
                </section>
            </header>
            <section class="artwork-grid">
                <article class="artwork-panel"><DividendSummaryThumbnail :data="thumbnailData" data-thumbnail-kind="summary" /><Button label="요약 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'summary'" @click="downloadArtwork('summary')" /></article>
                <article class="artwork-panel"><DividendComparisonThumbnail :data="thumbnailData" /><Button label="비교 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'comparison'" @click="downloadArtwork('comparison')" /></article>
                <article v-if="selectedInfo.underlying" class="artwork-panel"><RivalThumbnail :data="comparison ? { comparison, underlying: selectedInfo.underlying, selectedTicker: selectedInfo.symbol } : null" /><Button label="라이벌 PNG 다운로드" icon="pi pi-download" :disabled="!comparison" :loading="exporting === 'rival'" @click="downloadArtwork('rival')" /></article>
                <article class="artwork-panel"><DividendCalendarThumbnail :data="{ ...schedule, symbol: selectedInfo.symbol }" /><Button label="일정 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'calendar'" @click="downloadArtwork('calendar')" /></article>
            </section>
            <section class="content-grid">
                <TossCommunityCopy :data="thumbnailData" />
                <section v-if="selectedInfo.underlying" class="rivals">
                    <p v-if="!rivalOptions.length" class="hint">같은 기초자산으로 등록된 비교 후보가 없습니다.</p>
                    <p v-else-if="!rivals.length" class="hint">페이지 헤더에서 라이벌 후보를 최대 {{ maxRivals }}종 선택하세요.</p>
                    <p v-else-if="!comparison" class="hint">공통 가격 이력을 계산하는 중이거나 데이터가 부족합니다.</p>
                </section>
            </section>
        </template>
    </main>
</template>

<style scoped>
.ticker-thumbnail-page{min-height:100vh;padding:32px;background:#edf2f8;color:#17212b}.state{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}.page-header{display:flex;justify-content:space-between;align-items:center;gap:20px;max-width:2208px;margin:0 auto 24px}.page-header p{margin:0;color:#0064ff;font-size:.75rem;font-weight:800;letter-spacing:.12em}.page-header h1{margin:5px 0 0}.rival-candidate-picker{min-width:340px;padding:14px 16px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;box-shadow:0 4px 14px #15212b0d}.candidate-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}.candidate-heading strong{color:#64748b;font-size:.72rem}.candidate-buttons{display:flex;flex-wrap:wrap;gap:7px}.candidate-buttons button{min-width:52px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#334155;font:800 .8rem/1 ui-monospace,monospace;cursor:pointer}.candidate-buttons button:hover:not(:disabled){border-color:#2563eb;color:#1d4ed8}.candidate-buttons button.selected{border-color:#2563eb;background:#2563eb;color:#fff;box-shadow:0 2px 6px #2563eb3d}.candidate-buttons button:disabled{opacity:.42;cursor:not-allowed}.artwork-grid{display:grid;grid-template-columns:repeat(auto-fit,720px);justify-content:center;gap:24px;max-width:2208px;margin:auto}.artwork-panel{display:grid;width:720px;gap:12px}.artwork-panel>button{justify-self:start}.content-grid{display:grid;grid-template-columns:minmax(0,520px) minmax(360px,1fr);gap:24px;max-width:1520px;margin:32px auto 0;align-items:start}.rivals{padding:24px;border-radius:18px;background:#dfe8f2}.hint{margin:0;color:#526274}@media(max-width:1000px){.page-header{align-items:flex-start;flex-direction:column}.rival-candidate-picker{width:100%;min-width:0;box-sizing:border-box}.content-grid{grid-template-columns:1fr}.artwork-grid{justify-content:start;overflow-x:auto;padding-bottom:12px}}@media(max-width:600px){.ticker-thumbnail-page{padding:16px}.candidate-heading{align-items:flex-start;flex-direction:column;gap:3px}}
</style>
