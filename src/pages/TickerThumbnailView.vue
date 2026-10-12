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
import DividendEntryEfficiencyThumbnail from '@/components/thumbnail/DividendEntryEfficiencyThumbnail.vue';
import HoldingDividendThumbnail from '@/components/thumbnail/HoldingDividendThumbnail.vue';
import CardShareActions from '@/components/thumbnail/CardShareActions.vue';
import { getAssetUrl } from '@/utils/dataUrl';
import { calculateRivalComparison } from '@/services/thumbnail/rivalComparison';
import { loadDividendSchedule } from '@/services/thumbnail/dividendSchedule';
import { calculateEntryIncomeEfficiency } from '@/services/thumbnail/entryIncomeEfficiency';
import { firebaseUser } from '@/services/firebaseClient';
import { loadPortfolioAsset } from '@/services/portfolio';
import { calculateHoldingDividend } from '@/services/thumbnail/holdingDividend';
import { createShareText } from '@/services/thumbnail/shareText';
import { createCardShareText } from '@/services/thumbnail/shareText';
import { createPublishPackage, downloadBlob } from '@/services/thumbnail/publishPackage';
import { loadLocalPresets, removePreset, savePreset, syncPresets } from '@/services/contentPresets';
import { trackAggregate } from '@/services/analytics';

const route = useRoute();
const router = useRouter();
const selectedInfo = ref(null);
const selectedData = ref(null);
const loading = ref(true);
const error = ref('');
const rivals = ref([]);
const exporting = ref('');
const schedule = ref(null);
const holdingAsset = ref(null);
const artworkSize = 720;
const maxRivals = 3;
const shareCopyReady = ref(false);
const dataStatus = ref('fresh');
const selectedTone = ref('informative');
const packaging = ref(false);
const presets = ref(loadLocalPresets());

const publicUrl = computed(() => typeof window === 'undefined' ? '' : `${window.location.origin}${route.fullPath}`);

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
const shareText = computed(() => createShareText(thumbnailData.value));
const cardShareText = (kind) => createCardShareText(kind, thumbnailData.value, { tone: selectedTone.value, sourceStatus: dataStatus.value, asOfDate: selectedData.value?.sourceStatus?.priceDate ?? null });
const shareTitle = computed(() => selectedInfo.value ? `${selectedInfo.value.symbol} 최신 배당 | Yieldloom` : 'Yieldloom 배당 콘텐츠');
useHead({
    title: shareTitle,
    meta: [
        { name: 'description', content: computed(() => shareText.value) },
        { property: 'og:title', content: shareTitle },
        { property: 'og:description', content: computed(() => shareText.value) },
        { property: 'og:image', content: computed(() => `${typeof window === 'undefined' ? '' : window.location.origin}/api/thumbnail-og?ticker=${encodeURIComponent(selectedInfo.value?.symbol ?? normalize(route.params.ticker))}`) },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { name: 'twitter:card', content: 'summary_large_image' },
    ],
    link: [{ rel: 'canonical', href: publicUrl }],
});
const entryEfficiency = computed(() =>
    calculateEntryIncomeEfficiency(selectedData.value, {
        asOfDate: new Date().toISOString().slice(0, 10),
    })
);
const holdingDividend = computed(() => calculateHoldingDividend(holdingAsset.value, schedule.value));

const rivalOptions = computed(() => {
    return (selectedInfo.value?.rivalOptions ?? []).map((symbol) => ({ label: symbol, value: symbol }));
});
const toggleRival = (symbol) => {
    if (rivals.value.includes(symbol)) {
        rivals.value = rivals.value.filter((rival) => rival !== symbol);
        return;
    }
    if (rivals.value.length < maxRivals) rivals.value = [...rivals.value, symbol];
};

const comparison = ref(null);
const refreshComparison = async () => {
    await load(rivals.value);
};
const syncRivalsToUrl = () => router.replace({ query: { ...route.query, rivals: rivals.value.length ? rivals.value.join(',') : undefined } });
watch(rivals, async () => { syncRivalsToUrl(); await refreshComparison(); }, { deep: true });

const load = async (requestedRivals = String(route.query.rivals ?? '').split(',').filter(Boolean)) => {
    loading.value = true; error.value = ''; comparison.value = null;
    try {
        const requested = normalize(route.params.ticker);
        const response = await fetch(`/api/thumbnail-data?ticker=${encodeURIComponent(requested)}&rivals=${encodeURIComponent(requestedRivals.join(','))}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? response.status);
        selectedInfo.value = { ...payload.catalog, ...payload.ticker.tickerInfo, symbol: payload.ticker.symbol, rivalOptions: payload.rivalOptions };
        selectedData.value = payload.ticker;
        dataStatus.value = payload.dataStatus ?? payload.ticker.sourceStatus?.freshness ?? 'partial';
        trackAggregate('card_open', 'summary');
        comparison.value = payload.catalog.underlying && payload.rivals.length && payload.series[payload.catalog.underlying] && payload.rivals.every((symbol) => payload.series[symbol]) ? calculateRivalComparison([payload.ticker, ...payload.rivals.map((symbol) => payload.series[symbol])], payload.series[payload.catalog.underlying], new Date().toISOString().slice(0, 10)) : null;
        schedule.value = await loadDividendSchedule(selectedInfo.value.symbol).catch((reason) => { console.warn('Dividend schedule could not load', reason); return null; });
        holdingAsset.value = firebaseUser.value ? await loadPortfolioAsset(firebaseUser.value.uid, selectedInfo.value.symbol).catch(() => null) : null;
        const requestedRivals = payload.rivals ?? [];
        if (requestedRivals.join(',') !== rivals.value.join(',')) rivals.value = requestedRivals;
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
        // The download is normally initiated from a user gesture, so immediately offer its matching post copy.
        await navigator.clipboard?.writeText(cardShareText(kind));
        shareCopyReady.value = true;
        trackAggregate('png_download', kind);
    } catch (e) {
        error.value = 'PNG를 생성하지 못했습니다. 잠시 후 다시 시도하세요.';
        console.error('Thumbnail export failed', e);
    } finally {
        exporting.value = '';
    }
};
const copyShareText = async (kind = 'summary') => {
    await navigator.clipboard.writeText(cardShareText(kind));
    shareCopyReady.value = true;
    trackAggregate('share_copy', kind);
};
const downloadPublishPackage = async () => {
    packaging.value = true;
    try {
        const kinds = ['summary', 'comparison', 'rival', 'calendar', 'holding-dividend', 'entry-efficiency'];
        const cards = await Promise.all(kinds.map(async (kind) => {
            const element = document.querySelector(`[data-thumbnail-kind="${kind}"]`);
            if (!element) return null;
            const canvas = await html2canvas(element, { useCORS: true, backgroundColor: null, scale: 1, width: artworkSize, height: artworkSize });
            const png = await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer();
            return { kind, label: kind, filename: `${thumbnailData.value.symbol.toLowerCase()}_${kind}.png`, png: new Uint8Array(png), text: cardShareText(kind), sourceUrl: selectedData.value?.sourceStatus?.dividendSourceUrl, asOfDate: selectedData.value?.sourceStatus?.priceDate };
        }));
        downloadBlob(createPublishPackage({ symbol: thumbnailData.value.symbol, tone: selectedTone.value, cards: cards.filter(Boolean), sourceStatus: dataStatus.value }), `${thumbnailData.value.symbol.toLowerCase()}_publish-package.zip`);
    } catch (reason) { error.value = '게시 패키지를 생성하지 못했습니다. 잠시 후 다시 시도하세요.'; console.error('Publish package failed', reason); }
    finally { packaging.value = false; }
};
const refreshPresets = async () => { presets.value = await syncPresets(firebaseUser.value?.uid); };
const saveCurrentPreset = async () => {
    const name = window.prompt('프리셋 이름을 입력하세요.', `${selectedInfo.value.symbol} 콘텐츠`);
    if (!name?.trim()) return;
    const item = await savePreset(firebaseUser.value?.uid, { id: crypto.randomUUID?.() ?? `${Date.now()}`, name, ticker: selectedInfo.value.symbol, rivals: rivals.value, tone: selectedTone.value, updatedAt: new Date().toISOString() });
    presets.value = [item, ...presets.value.filter((preset) => preset.id !== item.id)];
};
const openPreset = async (preset) => { selectedTone.value = preset.tone || 'informative'; await router.push({ path: `/thumbnail/${preset.ticker}`, query: preset.rivals.length ? { rivals: preset.rivals.join(',') } : {} }); };
const deletePreset = async (preset) => { await removePreset(firebaseUser.value?.uid, preset.id); presets.value = presets.value.filter((item) => item.id !== preset.id); };
onMounted(async () => { await refreshPresets(); await load(); }); watch(() => route.params.ticker, load);
watch(firebaseUser, async () => { await refreshPresets(); if (selectedInfo.value) load(rivals.value); });
</script>

<template>
    <main class="ticker-thumbnail-page">
        <div v-if="loading" class="state"><ProgressSpinner /><p>썸네일 데이터를 불러오는 중…</p></div>
        <div v-else-if="error" class="state"><h1>종목을 열 수 없습니다</h1><p>{{ error }}</p></div>
        <template v-else>
            <header class="page-header">
                <div><p>토토부부 배당 스튜디오</p><h1>{{ selectedInfo.symbol }} 배당 콘텐츠</h1></div>
                <div class="data-toolbar"><p class="data-status" :class="dataStatus">{{ dataStatus === 'fresh' ? '데이터 최신' : dataStatus === 'stale' ? '마지막 정상 데이터 · 갱신 지연' : '일부 데이터 확인 필요' }}</p><label>문구 톤 <select v-model="selectedTone"><option value="informative">정보형</option><option value="concise">간결형</option><option value="friendly">친근형</option></select></label><Button label="프리셋 저장" icon="pi pi-bookmark" @click="saveCurrentPreset" /><Button label="게시 패키지 ZIP" icon="pi pi-box" :loading="packaging" @click="downloadPublishPackage" /></div>
                <div v-if="presets.length" class="preset-row" aria-label="저장된 콘텐츠 프리셋"><span>저장한 조합</span><template v-for="preset in presets" :key="preset.id"><button type="button" @click="openPreset(preset)">{{ preset.name }}</button><button type="button" class="preset-delete" :aria-label="`${preset.name} 삭제`" @click="deletePreset(preset)">×</button></template></div>
                <section v-if="selectedInfo.underlying && rivalOptions.length" class="rival-candidate-picker" :aria-label="`${selectedInfo.symbol} 라이벌 카드 후보`">
                    <div class="candidate-heading"><p>라이벌 카드 후보</p><strong>{{ selectedInfo.underlying }} 기반 · 최대 {{ maxRivals }}종</strong></div>
                    <div class="candidate-buttons">
                        <button v-for="option in rivalOptions" :key="option.value" type="button" :class="{ selected: rivals.includes(option.value) }" :aria-pressed="rivals.includes(option.value)" :title="option.label" :disabled="!rivals.includes(option.value) && rivals.length >= maxRivals" @click="toggleRival(option.value)">{{ option.value }}</button>
                    </div>
                </section>
            </header>
            <section class="artwork-grid">
                <article class="artwork-panel"><DividendSummaryThumbnail :data="thumbnailData" data-thumbnail-kind="summary" /><Button label="요약 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'summary'" @click="downloadArtwork('summary')" /><CardShareActions title="요약 카드" :text="cardShareText('summary')" :url="publicUrl" /></article>
                <article class="artwork-panel"><DividendComparisonThumbnail :data="thumbnailData" data-thumbnail-kind="comparison" /><Button label="비교 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'comparison'" @click="downloadArtwork('comparison')" /><CardShareActions title="비교 카드" :text="cardShareText('comparison')" :url="publicUrl" /></article>
                <article v-if="selectedInfo.underlying" class="artwork-panel"><RivalThumbnail :data="comparison ? { comparison, underlying: selectedInfo.underlying, selectedTicker: selectedInfo.symbol } : null" data-thumbnail-kind="rival" /><Button label="라이벌 PNG 다운로드" icon="pi pi-download" :disabled="!comparison" :loading="exporting === 'rival'" @click="downloadArtwork('rival')" /><CardShareActions title="라이벌 카드" :text="cardShareText('rival')" :url="publicUrl" /></article>
                <article class="artwork-panel"><DividendCalendarThumbnail :data="{ ...schedule, symbol: selectedInfo.symbol }" data-thumbnail-kind="calendar" /><Button label="일정 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'calendar'" @click="downloadArtwork('calendar')" /><CardShareActions title="일정 카드" :text="cardShareText('calendar')" :url="publicUrl" /></article>
                <article v-if="holdingDividend.supported" class="artwork-panel"><HoldingDividendThumbnail :data="{ ...holdingDividend, symbol: selectedInfo.symbol }" data-thumbnail-kind="holding-dividend" /><Button label="보유 배당 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'holding-dividend'" @click="downloadArtwork('holding-dividend')" /><CardShareActions title="보유 배당 카드" :text="cardShareText('holding-dividend')" :url="publicUrl" /></article>
                <article class="artwork-panel"><DividendEntryEfficiencyThumbnail :data="{ ...entryEfficiency, symbol: selectedInfo.symbol }" data-thumbnail-kind="entry-efficiency" /><Button label="매수 효율 PNG 다운로드" icon="pi pi-download" :loading="exporting === 'entry-efficiency'" @click="downloadArtwork('entry-efficiency')" /><CardShareActions title="매수 효율 카드" :text="cardShareText('entry-efficiency')" :url="publicUrl" /></article>
            </section>
            <div v-if="shareCopyReady" class="share-copy-notice"><span>PNG 공유용 문구가 복사되었습니다. 토스·카카오톡에 바로 붙여넣으세요.</span><button type="button" @click="copyShareText">이미지 공유용 문구 복사</button></div>
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
.ticker-thumbnail-page{min-height:100vh;padding:32px;color:#17212b}.state{min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}.page-header{display:flex;justify-content:space-between;align-items:center;gap:20px;max-width:2208px;margin:0 auto 24px}.page-header p{margin:0;color:#0064ff;font-size:.75rem;font-weight:800;letter-spacing:.12em}.page-header h1{margin:5px 0 0}.rival-candidate-picker{min-width:340px;padding:14px 16px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;box-shadow:0 4px 14px #15212b0d}.candidate-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}.candidate-heading strong{color:#64748b;font-size:.72rem}.candidate-buttons{display:flex;flex-wrap:wrap;gap:7px}.candidate-buttons button{min-width:52px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#334155;font:800 .8rem/1 ui-monospace,monospace;cursor:pointer}.candidate-buttons button:hover:not(:disabled){border-color:#2563eb;color:#1d4ed8}.candidate-buttons button.selected{border-color:#2563eb;background:#2563eb;color:#fff;box-shadow:0 2px 6px #2563eb3d}.candidate-buttons button:disabled{opacity:.42;cursor:not-allowed}.artwork-grid{display:grid;grid-template-columns:repeat(auto-fit,720px);justify-content:center;gap:24px;max-width:2208px;margin:auto}.artwork-panel{display:grid;width:720px;gap:12px}.artwork-panel>button{justify-self:start}.share-copy-notice{position:sticky;bottom:16px;z-index:2;display:flex;justify-content:center;align-items:center;gap:12px;width:max-content;max-width:calc(100% - 32px);margin:24px auto;padding:12px 15px;border-radius:12px;background:#17212b;color:#fff;box-shadow:0 10px 28px #17212b40}.share-copy-notice button{border:0;border-radius:7px;background:#fee500;color:#191919;padding:8px 10px;font:700 .78rem inherit;cursor:pointer}.content-grid{display:grid;grid-template-columns:minmax(0,520px) minmax(360px,1fr);gap:24px;max-width:1520px;margin:32px auto 0;align-items:start}.rivals{padding:24px;border-radius:18px;background:#dfe8f2}.hint{margin:0;color:#526274}@media(max-width:1000px){.page-header{align-items:flex-start;flex-direction:column}.rival-candidate-picker{width:100%;min-width:0;box-sizing:border-box}.content-grid{grid-template-columns:1fr}.artwork-grid{justify-content:start;overflow-x:auto;padding-bottom:12px}}@media(max-width:600px){.ticker-thumbnail-page{padding:16px}.candidate-heading{align-items:flex-start;flex-direction:column;gap:3px}.share-copy-notice{align-items:flex-start;flex-direction:column}}
.ticker-thumbnail-page{color:var(--app-text)}.page-header p{color:var(--app-accent)}.data-toolbar{display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:10px}.data-toolbar label{font-size:.78rem;font-weight:700}.data-toolbar select{margin-left:5px;padding:7px;border:1px solid var(--app-border);border-radius:7px;background:var(--app-surface);color:var(--app-text)}.data-status{padding:8px 10px;border-radius:8px;background:var(--app-surface-muted);color:var(--app-muted)!important;letter-spacing:0!important}.data-status.stale,.data-status.partial{background:#fff7ed;color:#9a3412!important}.preset-row{display:flex;align-items:center;flex-wrap:wrap;gap:5px;max-width:2208px;margin:0 auto 18px;font-size:.75rem}.preset-row span{margin-right:5px;color:var(--app-muted);font-weight:700}.preset-row button{padding:6px 8px;border:1px solid var(--app-border);border-radius:7px;background:var(--app-surface);color:var(--app-text);cursor:pointer}.preset-row .preset-delete{margin-left:-6px;border-left:0;color:var(--app-muted)}.rival-candidate-picker{border-color:var(--app-border);background:var(--app-surface);box-shadow:none}.candidate-heading strong,.hint{color:var(--app-muted)}.candidate-buttons button{border-color:var(--app-border);background:var(--app-surface-muted);color:var(--app-text)}.candidate-buttons button:hover:not(:disabled){border-color:var(--app-accent);color:var(--app-accent)}.candidate-buttons button.selected{border-color:var(--app-accent);background:var(--app-accent);color:var(--app-accent-contrast);box-shadow:none}.share-copy-notice{background:var(--app-surface);color:var(--app-text);border:1px solid var(--app-border);box-shadow:0 10px 28px var(--app-overlay)}.share-copy-notice button{background:var(--app-accent);color:var(--app-accent-contrast)}.rivals{background:var(--app-surface-muted);border:1px solid var(--app-border-subtle)}
</style>
