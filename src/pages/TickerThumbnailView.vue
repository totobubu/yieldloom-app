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
    import ThumbnailPreview from '@/components/thumbnail/ThumbnailPreview.vue';
    import StockDividendTrend from '@/components/stock/StockDividendTrend.vue';
    import StockHoldingPanel from '@/components/stock/StockHoldingPanel.vue';
    import StockCandlestickChart from '@/components/stock/StockCandlestickChart.vue';
    import SecurityInsights from '@/components/thumbnail/SecurityInsights.vue';
    import CardShareActions from '@/components/thumbnail/CardShareActions.vue';
    import { getAssetUrl } from '@/utils/dataUrl';
    import { calculateRivalComparison } from '@/services/thumbnail/rivalComparison';
    import { loadDividendSchedule } from '@/services/thumbnail/dividendSchedule';
    import { calculateEntryIncomeEfficiency } from '@/services/thumbnail/entryIncomeEfficiency';
    import { createShareText } from '@/services/thumbnail/shareText';
    import { createCardShareText } from '@/services/thumbnail/shareText';
    import {
        createPublishPackage,
        downloadBlob,
    } from '@/services/thumbnail/publishPackage';
    import {
        loadLocalPresets,
        removeLocalPreset,
        saveLocalPreset,
    } from '@/services/contentPresets';
    import { trackAggregate } from '@/services/analytics';
    import { apiOrigin, apiUrl } from '@/services/apiUrl';

    const route = useRoute();
    const router = useRouter();
    const selectedInfo = ref(null);
    const selectedData = ref(null);
    const loading = ref(true);
    const error = ref('');
    const rivals = ref([]);
    const draftRivals = ref([]);
    const rivalPickerOpen = ref(true);
    const exporting = ref('');
    const exportError = ref('');
    const schedule = ref(null);
    const artworkSize = 720;
    const maxRivals = 3;
    const shareCopyReady = ref(false);
    const dataStatus = ref('fresh');
    const selectedTone = ref('informative');
    const packaging = ref(false);
    const presets = ref(loadLocalPresets());

    const selectedCardKinds = ref(['summary']);
    const availableCards = computed(() => [
        { kind: 'summary', label: '배당 요약' },
        { kind: 'comparison', label: '배당 비교' },
        ...(selectedInfo.value?.underlying
            ? [
                  {
                      kind: 'rival',
                      label: '기초자산·종목 비교',
                      disabled: !comparison.value,
                  },
              ]
            : []),
        { kind: 'calendar', label: '배당 일정' },
        { kind: 'entry-efficiency', label: '과거 매수 시점별 배당률' },
    ]);
    const selectedExportKinds = computed(() =>
        availableCards.value
            .filter(
                (card) =>
                    selectedCardKinds.value.includes(card.kind) &&
                    !card.disabled
            )
            .map((card) => card.kind)
    );
    const showCard = (kind) =>
        activeTab.value === 'share'
            ? selectedCardKinds.value.includes(kind)
            : ['calendar', 'entry-efficiency'].includes(kind);
    const today = () => new Date().toISOString().slice(0, 10);
    const nextDividend = computed(() => {
        const confirmed = schedule.value?.history
            ?.filter((event) => event.exDate >= today())
            .sort((a, b) => a.exDate.localeCompare(b.exDate))[0];
        if (confirmed) return { date: confirmed.exDate, confirmed: true };
        const forecast = schedule.value?.forecastExDate;
        return forecast && forecast >= today()
            ? { date: forecast, confirmed: false }
            : null;
    });
    const priceChange = computed(() => {
        const date = selectedData.value?.sourceStatus?.priceDate;
        const previous = priceRows.value.find((row) => row.date < date);
        const price = Number(selectedInfo.value?.price);
        return previous &&
            price > 0 &&
            (Date.parse(date) - Date.parse(previous.date)) / 86400000 <= 4
            ? {
                  amount: price - Number(previous.close),
                  percent: (price / Number(previous.close) - 1) * 100,
              }
            : null;
    });
    const stockEvents = computed(() =>
        historyRows.value.map((row) => ({
            date: row.date,
            kind: 'dividend',
            label: `배당락 · 주당 ${amount(row)} ${selectedInfo.value?.currency || ''}`,
        }))
    );
    const sourceLabel = computed(
        () =>
            ({
                thumbnail_projection: '수집 시세',
                r2_projection: '수집 시세',
                yahoo_quote: 'Yahoo Finance',
                unavailable: '미확인',
            })[selectedData.value?.sourceStatus?.price] || '수집 시세'
    );
    const statusLabel = computed(() =>
        dataStatus.value === 'fresh'
            ? '최근 데이터'
            : dataStatus.value === 'stale'
              ? '갱신 지연 · 기준일 확인'
              : '일부 데이터 미확인'
    );
    const tabs = [
        { id: 'details', label: '상세정보' },
        { id: 'prices', label: '시세정보' },
        { id: 'dividends', label: '배당정보' },
        { id: 'share', label: '공유정보' },
    ];
    const activeTab = computed(() =>
        tabs.some((tab) => tab.id === route.query.tab)
            ? route.query.tab
            : 'details'
    );
    const selectTab = (id) =>
        router.replace({ query: { ...route.query, tab: id } });
    const priceRows = computed(() =>
        (selectedData.value?.backtestData ?? [])
            .filter(
                (row) =>
                    !row.forecasted &&
                    row.date <= new Date().toISOString().slice(0, 10) &&
                    Number(row.close) > 0
            )
            .sort((a, b) => b.date.localeCompare(a.date))
    );
    const historyRows = computed(() =>
        dividendRows(selectedData.value?.backtestData)
            .filter((row) => row.date <= new Date().toISOString().slice(0, 10))
            .reverse()
    );
    const trailingDividend = computed(() => {
        const end = selectedData.value?.sourceStatus?.priceDate;
        if (!end) return null;
        const cutoff = new Date(`${end}T12:00:00Z`);
        cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
        if (
            !historyRows.value.length ||
            historyRows.value.at(-1).date > cutoff.toISOString().slice(0, 10) ||
            selectedData.value?.sourceStatus?.dividends === 'unavailable' ||
            !priceRows.value.length ||
            priceRows.value.at(-1).date > cutoff.toISOString().slice(0, 10)
        )
            return null;
        return historyRows.value
            .filter(
                (row) =>
                    row.date > cutoff.toISOString().slice(0, 10) &&
                    row.date <= end
            )
            .reduce((total, row) => total + amount(row), 0);
    });
    const displayNumber = (value, digits = 2) =>
        value != null && Number.isFinite(Number(value))
            ? Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: digits,
              })
            : '미확인';
    const publicUrl = computed(() =>
        typeof window === 'undefined'
            ? ''
            : `${window.location.origin}${route.fullPath}`
    );

    const normalize = (value) =>
        String(value ?? '')
            .trim()
            .toUpperCase();
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
        rows.slice(-50).forEach((row) => {
            const month = formatMonth(row.date);
            monthly.set(month, (monthly.get(month) ?? 0) + amount(row));
        });
        const company = String(selectedInfo.value?.company ?? '').toLowerCase();
        const background = company.includes('roundhill')
            ? 'blue.png'
            : company.includes('yieldmax')
              ? 'red.png'
              : 'gray.png';
        return {
            symbol:
                selectedInfo.value?.symbol ?? normalize(route.params.ticker),
            hasDividend: Boolean(current),
            exDate: current?.date ?? null,
            previousExDate: previous?.date ?? null,
            currentDividendAmount: currentAmount,
            previousDividendAmount: previous ? previousAmount : null,
            dividendDifference: previous
                ? currentAmount - previousAmount
                : null,
            dividendChangePercent:
                previousAmount > 0
                    ? ((currentAmount - previousAmount) / previousAmount) * 100
                    : null,
            afterTaxDividendAmount: current ? currentAmount * 0.85 : null,
            previousAfterTaxDividendAmount: previous
                ? previousAmount * 0.85
                : null,
            exDividendClose: validClose ? exClose : null,
            previousExDividendClose: validPreviousClose ? prevClose : null,
            exDividendYield: validClose
                ? (currentAmount / exClose) * 100
                : null,
            previousExDividendYield: validPreviousClose
                ? (previousAmount / prevClose) * 100
                : null,
            afterTaxDividendYield: validClose
                ? ((currentAmount * 0.85) / exClose) * 100
                : null,
            previousAfterTaxDividendYield: validPreviousClose
                ? ((previousAmount * 0.85) / prevClose) * 100
                : null,
            monthlyTotals: [...monthly.entries()]
                .slice(-4)
                .map(([month, total]) => ({ month, total })),
            backgroundImageUrl: getAssetUrl(`thumbnail/${background}`),
        };
    });
    const shareText = computed(() => createShareText(thumbnailData.value));
    const cardShareText = (kind) =>
        createCardShareText(kind, thumbnailData.value, {
            tone: selectedTone.value,
            sourceStatus: dataStatus.value,
            asOfDate: selectedData.value?.sourceStatus?.priceDate ?? null,
        });
    const shareTitle = computed(() =>
        selectedInfo.value
            ? `${selectedInfo.value.symbol} 주식 상세정보 · 시세와 배당 | Yieldloom`
            : 'Yieldloom 배당 콘텐츠'
    );
    useHead({
        title: shareTitle,
        meta: [
            { name: 'description', content: computed(() => shareText.value) },
            { property: 'og:title', content: shareTitle },
            {
                property: 'og:description',
                content: computed(() => shareText.value),
            },
            {
                property: 'og:image',
                content: computed(
                    () =>
                        `${apiOrigin || (typeof window === 'undefined' ? '' : window.location.origin)}/api/thumbnail-og?ticker=${encodeURIComponent(selectedInfo.value?.symbol ?? normalize(route.params.ticker))}`
                ),
            },
            { property: 'og:image:width', content: '1200' },
            { property: 'og:image:height', content: '630' },
            { name: 'twitter:card', content: 'summary_large_image' },
        ],
        link: [
            {
                rel: 'canonical',
                href: computed(() =>
                    typeof window === 'undefined'
                        ? ''
                        : `${window.location.origin}/stock/${encodeURIComponent(normalize(route.params.ticker))}`
                ),
            },
        ],
    });
    const entryEfficiency = computed(() =>
        calculateEntryIncomeEfficiency(selectedData.value, {
            asOfDate: new Date().toISOString().slice(0, 10),
        })
    );
    const rivalOptions = computed(() => {
        return (selectedInfo.value?.rivalOptions ?? []).map((symbol) => ({
            label: symbol,
            value: symbol,
        }));
    });
    const toggleRival = (symbol) => {
        if (draftRivals.value.includes(symbol)) {
            draftRivals.value = draftRivals.value.filter(
                (rival) => rival !== symbol
            );
            return;
        }
        if (draftRivals.value.length < maxRivals)
            draftRivals.value = [...draftRivals.value, symbol];
    };

    const comparison = ref(null);
    const openRivalPicker = () => {
        draftRivals.value = [...rivals.value];
        rivalPickerOpen.value = true;
    };
    const confirmRivals = async () => {
        const selection = [...draftRivals.value];
        rivalPickerOpen.value = false;
        await router.replace({
            query: { ...route.query, rivals: selection.join(',') },
        });
        if (selection.join(',') !== rivals.value.join(','))
            await load(selection);
    };

    let loadSequence = 0;
    const load = async (
        rivalSymbols = route.query.rivals == null
            ? undefined
            : String(route.query.rivals).split(',').filter(Boolean)
    ) => {
        const sequence = ++loadSequence;
        loading.value = true;
        schedule.value = null;
        error.value = '';
        comparison.value = null;
        try {
            const requested = normalize(route.params.ticker);
            const response = await fetch(
                apiUrl(
                    `/api/thumbnail-data?ticker=${encodeURIComponent(requested)}${rivalSymbols == null ? '' : `&rivals=${encodeURIComponent(rivalSymbols.join(','))}`}`
                ),
                { cache: 'no-store' }
            );
            const payload = await response.json();
            if (sequence !== loadSequence) return;
            if (!response.ok)
                throw new Error(
                    response.status === 404
                        ? '해당 티커를 찾을 수 없습니다. 티커를 확인해 주세요.'
                        : response.status === 503
                          ? '시세 제공 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
                          : (payload.error ??
                            '종목 데이터를 불러오지 못했습니다.')
                );
            selectedInfo.value = {
                ...payload.catalog,
                ...payload.ticker.tickerInfo,
                symbol: payload.ticker.symbol,
                rivalOptions: payload.rivalOptions,
            };
            selectedData.value = payload.ticker;
            dataStatus.value =
                payload.dataStatus ??
                payload.ticker.sourceStatus?.freshness ??
                'partial';
            trackAggregate('card_open', 'summary');
            comparison.value =
                !Object.values({
                    ...payload.series,
                    primary: payload.ticker,
                }).some(
                    (value) => value?.sourceStatus?.corporateActionReview
                ) &&
                payload.catalog.underlying &&
                payload.rivals.length &&
                payload.series[payload.catalog.underlying] &&
                payload.rivals.every((symbol) => payload.series[symbol])
                    ? calculateRivalComparison(
                          [
                              payload.ticker,
                              ...payload.rivals.map(
                                  (symbol) => payload.series[symbol]
                              ),
                          ],
                          payload.series[payload.catalog.underlying],
                          new Date().toISOString().slice(0, 10)
                      )
                    : null;
            const loadedSchedule = await loadDividendSchedule(
                selectedInfo.value.symbol
            ).catch((reason) => {
                console.warn('Dividend schedule could not load', reason);
                return null;
            });
            if (sequence !== loadSequence) return;
            schedule.value = loadedSchedule;
            const loadedRivals = payload.rivals ?? [];
            rivals.value = loadedRivals;
            draftRivals.value = [...loadedRivals];
        } catch (e) {
            if (sequence === loadSequence)
                error.value = e.message || '종목 정보를 불러오지 못했습니다.';
            console.error(e);
        } finally {
            if (sequence === loadSequence) loading.value = false;
        }
    };
    const prepareExportDocument = (document) => {
        document
            .querySelectorAll('.thumbnail-preview-artboard')
            .forEach((element) => {
                element.style.transform = 'none';
            });
        document.querySelectorAll('.thumbnail-preview').forEach((element) => {
            element.style.width = '720px';
            element.style.maxWidth = '720px';
        });
    };
    const downloadArtwork = async (kind) => {
        const element = document.querySelector(
            `[data-thumbnail-kind="${kind}"]`
        );
        if (!element) return;
        exportError.value = '';
        exporting.value = kind;
        try {
            const canvas = await html2canvas(element, {
                onclone: prepareExportDocument,
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
            exportError.value =
                'PNG를 생성하지 못했습니다. 잠시 후 다시 시도하세요.';
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
        exportError.value = '';
        packaging.value = true;
        try {
            const kinds = selectedExportKinds.value;
            if (!kinds.length) return;
            const cards = await Promise.all(
                kinds.map(async (kind) => {
                    const element = document.querySelector(
                        `[data-thumbnail-kind="${kind}"]`
                    );
                    if (!element) return null;
                    const canvas = await html2canvas(element, {
                        onclone: prepareExportDocument,
                        useCORS: true,
                        backgroundColor: null,
                        scale: 1,
                        width: artworkSize,
                        height: artworkSize,
                    });
                    const png = await (
                        await fetch(canvas.toDataURL('image/png'))
                    ).arrayBuffer();
                    return {
                        kind,
                        label:
                            availableCards.value.find(
                                (card) => card.kind === kind
                            )?.label || kind,
                        filename: `${thumbnailData.value.symbol.toLowerCase()}_${kind}.png`,
                        png: new Uint8Array(png),
                        text: cardShareText(kind),
                        sourceUrl:
                            selectedData.value?.sourceStatus?.dividendSourceUrl,
                        asOfDate: selectedData.value?.sourceStatus?.priceDate,
                    };
                })
            );
            downloadBlob(
                createPublishPackage({
                    symbol: thumbnailData.value.symbol,
                    tone: selectedTone.value,
                    cards: cards.filter(Boolean),
                    sourceStatus: dataStatus.value,
                }),
                `${thumbnailData.value.symbol.toLowerCase()}_publish-package.zip`
            );
        } catch (reason) {
            exportError.value =
                '게시 패키지를 생성하지 못했습니다. 잠시 후 다시 시도하세요.';
            console.error('Publish package failed', reason);
        } finally {
            packaging.value = false;
        }
    };
    const saveCurrentPreset = async () => {
        const name = window.prompt(
            '프리셋 이름을 입력하세요.',
            `${selectedInfo.value.symbol} 콘텐츠`
        );
        if (!name?.trim()) return;
        const item = saveLocalPreset({
            id: crypto.randomUUID?.() ?? `${Date.now()}`,
            name,
            ticker: selectedInfo.value.symbol,
            rivals: rivals.value,
            tone: selectedTone.value,
            updatedAt: new Date().toISOString(),
        });
        presets.value = [
            item,
            ...presets.value.filter((preset) => preset.id !== item.id),
        ];
    };
    const openPreset = async (preset) => {
        selectedTone.value = preset.tone || 'informative';
        await router.push({
            path: `/stock/${preset.ticker}`,
            query: preset.rivals.length
                ? { rivals: preset.rivals.join(',') }
                : {},
        });
    };
    const deletePreset = (preset) => {
        removeLocalPreset(preset.id);
        presets.value = presets.value.filter((item) => item.id !== preset.id);
    };
    onMounted(load);
    watch(
        () => route.params.ticker,
        () => {
            rivalPickerOpen.value = true;
            load();
        }
    );
</script>

<template>
    <main class="ticker-thumbnail-page">
        <div v-if="loading" class="state">
            <ProgressSpinner />
            <p>종목 정보를 불러오는 중…</p>
        </div>
        <div v-else-if="error" class="state">
            <h1>종목을 열 수 없습니다</h1>
            <p>{{ error }}</p>
            <Button label="다시 시도" @click="load()" />
        </div>
        <template v-else>
            <header class="page-header">
                <div>
                    <p>토토부부 배당 스튜디오</p>
                    <h1>
                        {{ selectedInfo.symbol }}
                        <small class="stock-name">{{
                            selectedInfo.longName || selectedInfo.koName
                        }}</small>
                    </h1>
                    <p v-if="selectedInfo.price != null" class="latest-price">
                        최근 시세 {{ selectedInfo.currency }}
                        {{
                            Number(selectedInfo.price).toLocaleString(
                                undefined,
                                { maximumFractionDigits: 4 }
                            )
                        }}
                        · {{ selectedData.sourceStatus.priceDate }}
                    </p>
                </div>
                <div v-show="activeTab === 'share'" class="data-toolbar">
                    <p class="data-status" :class="dataStatus">
                        {{
                            dataStatus === 'fresh'
                                ? '데이터 최신'
                                : dataStatus === 'stale'
                                  ? '마지막 정상 데이터 · 갱신 지연'
                                  : '일부 데이터 확인 필요'
                        }}
                    </p>
                    <label
                        >문구 톤
                        <select v-model="selectedTone">
                            <option value="informative">정보형</option>
                            <option value="concise">간결형</option>
                            <option value="friendly">친근형</option>
                        </select></label
                    ><Button
                        label="프리셋 저장"
                        icon="pi pi-bookmark"
                        @click="saveCurrentPreset" /><Button
                        :label="`선택 카드 ZIP (${selectedExportKinds.length})`"
                        :disabled="!selectedExportKinds.length"
                        icon="pi pi-box"
                        :loading="packaging"
                        @click="downloadPublishPackage" />
                </div>
                <div
                    v-if="presets.length"
                    v-show="activeTab === 'share'"
                    class="preset-row"
                    aria-label="저장된 콘텐츠 프리셋">
                    <span>저장한 조합</span
                    ><template v-for="preset in presets" :key="preset.id"
                        ><button type="button" @click="openPreset(preset)">
                            {{ preset.name }}</button
                        ><button
                            type="button"
                            class="preset-delete"
                            :aria-label="`${preset.name} 삭제`"
                            @click="deletePreset(preset)">
                            ×
                        </button></template
                    >
                </div>
                <section
                    v-if="selectedInfo.underlying && rivalOptions.length"
                    v-show="activeTab === 'share'"
                    class="rival-candidate-picker"
                    :aria-label="`${selectedInfo.symbol} 라이벌 카드 후보`">
                    <div class="candidate-heading">
                        <p>라이벌 카드 후보</p>
                        <strong
                            >{{ selectedInfo.underlying }} 기반 · 최대
                            {{ maxRivals }}종</strong
                        ><Button
                            label="추가"
                            icon="pi pi-plus"
                            :aria-expanded="rivalPickerOpen"
                            aria-controls="rival-candidates"
                            @click="openRivalPicker" />
                    </div>
                    <p v-if="!rivalPickerOpen" class="hint">
                        선택한 라이벌:
                        {{ rivals.length ? rivals.join(', ') : '없음' }}
                    </p>
                    <div
                        v-if="rivalPickerOpen"
                        id="rival-candidates"
                        class="candidate-buttons">
                        <button
                            v-for="option in rivalOptions"
                            :key="option.value"
                            type="button"
                            :class="{
                                selected: draftRivals.includes(option.value),
                            }"
                            :aria-pressed="draftRivals.includes(option.value)"
                            :title="option.label"
                            :disabled="
                                !draftRivals.includes(option.value) &&
                                draftRivals.length >= maxRivals
                            "
                            @click="toggleRival(option.value)">
                            {{ option.value }}
                        </button>
                    </div>
                    <div v-if="rivalPickerOpen" class="candidate-actions">
                        <span class="hint"
                            >{{ draftRivals.length }}/{{ maxRivals }}종 선택 ·
                            확인 후 반영됩니다.</span
                        ><Button
                            label="확인"
                            icon="pi pi-check"
                            @click="confirmRivals" />
                    </div>
                </section>
            </header>
            <section class="stock-overview" aria-label="종목 핵심 지표">
                <article>
                    <span
                        >현재가 ·
                        {{ selectedInfo.currency || '통화 미확인' }}</span
                    ><strong>{{ displayNumber(selectedInfo.price, 4) }}</strong>
                </article>
                <article>
                    <span>전일 종가 대비</span
                    ><strong
                        :class="
                            priceChange
                                ? priceChange.amount >= 0
                                    ? 'price-up'
                                    : 'price-down'
                                : ''
                        "
                        >{{
                            priceChange
                                ? `${priceChange.amount >= 0 ? '+' : ''}${displayNumber(priceChange.amount, 4)} (${priceChange.percent >= 0 ? '+' : ''}${displayNumber(priceChange.percent)}%)`
                                : '미확인'
                        }}</strong
                    >
                </article>
                <article>
                    <span>최근 12개월 배당률 · 세전</span
                    ><strong>{{
                        trailingDividend != null && selectedInfo.price > 0
                            ? `${displayNumber((trailingDividend / selectedInfo.price) * 100)}%`
                            : '전체 이력 확인 필요'
                    }}</strong>
                </article>
                <button class="next-dividend" @click="selectTab('dividends')">
                    <span
                        >다음 배당락일
                        <em v-if="nextDividend">{{
                            nextDividend.confirmed ? '공시 확정' : '주기 추정'
                        }}</em></span
                    ><strong
                        >{{ nextDividend?.date || '차기 공시 대기' }} →</strong
                    >
                </button>
            </section>
            <div class="stock-data-banner">
                <span :class="dataStatus">{{ statusLabel }}</span
                ><span
                    >시세 기준
                    {{ selectedData.sourceStatus?.priceDate || '미확인' }} ·
                    {{ sourceLabel }}</span
                ><span
                    >배당 기준 {{ historyRows[0]?.date || '미확인' }} · 공개
                    배당 원장</span
                >
                <details>
                    <summary>데이터 안내</summary>
                    <p>
                        시세와 배당은 기준일이 다를 수 있으며 실시간 가격이 아닐
                        수 있습니다. 미확인은 0이 아닙니다. 12개월 전체
                        시세·배당 이력을 확인하지 못하면 연간 지표를 표시하지
                        않습니다. 공시 전 일정은 최근 주기를 바탕으로 한
                        추정입니다.
                    </p>
                </details>
            </div>
            <nav class="stock-tabs" aria-label="종목 정보">
                <button
                    v-for="tab in tabs"
                    :key="tab.id"
                    type="button"
                    :aria-current="activeTab === tab.id ? 'page' : undefined"
                    :class="{ selected: activeTab === tab.id }"
                    @click="selectTab(tab.id)">
                    {{ tab.label }}
                </button>
            </nav>
            <section v-if="activeTab === 'details'" class="stock-section">
                <h2>{{ selectedInfo.symbol }} 종목 개요</h2>
                <p class="hint">
                    시세 기준
                    {{ selectedData.sourceStatus.priceDate || '미확인' }} ·
                    수집된 실제 이력 기준
                </p>
                <div class="metric-grid">
                    <article>
                        <span>최근 시세</span
                        ><strong
                            >{{ displayNumber(selectedInfo.price, 4) }}
                            <small>{{ selectedInfo.currency }}</small></strong
                        >
                    </article>
                    <article>
                        <span>최근 12개월 주당 배당</span
                        ><strong
                            >{{ displayNumber(trailingDividend, 4) }}
                            <small>{{ selectedInfo.currency }}</small></strong
                        ><small v-if="trailingDividend == null"
                            >12개월 전체 이력 확인 필요</small
                        >
                    </article>
                    <article>
                        <span>최근 12개월 배당수익률</span
                        ><strong
                            >{{
                                displayNumber(
                                    trailingDividend != null &&
                                        selectedInfo.price > 0
                                        ? (trailingDividend /
                                              selectedInfo.price) *
                                              100
                                        : null
                                )
                            }}%</strong
                        ><small>최근 시세 대비 · 세전</small>
                    </article>
                    <article>
                        <span>시가총액</span
                        ><strong>{{
                            displayNumber(selectedInfo.marketCap, 0)
                        }}</strong>
                    </article>
                </div>
                <StockHoldingPanel
                    :symbol="selectedInfo.symbol"
                    :price="
                        selectedInfo.price != null
                            ? Number(selectedInfo.price)
                            : null
                    "
                    :currency="selectedInfo.currency || 'USD'"
                    :next="schedule?.current" />
                <h2>종목 기본정보</h2>
                <dl class="stock-facts">
                    <div>
                        <dt>종목명</dt>
                        <dd>
                            {{
                                selectedInfo.longName ||
                                selectedInfo.koName ||
                                selectedInfo.symbol
                            }}
                        </dd>
                    </div>
                    <div>
                        <dt>운용사</dt>
                        <dd>{{ selectedInfo.company || '미확인' }}</dd>
                    </div>
                    <div>
                        <dt>시장 / 통화</dt>
                        <dd>
                            {{ selectedInfo.market || '미확인' }} /
                            {{ selectedInfo.currency || '미확인' }}
                        </dd>
                    </div>
                    <div>
                        <dt>기초자산</dt>
                        <dd>{{ selectedInfo.underlying || '미확인' }}</dd>
                    </div>
                    <div>
                        <dt>수집 시세 범위</dt>
                        <dd>
                            {{ priceRows.at(-1)?.date || '미확인' }} ~
                            {{ priceRows[0]?.date || '미확인' }}
                        </dd>
                    </div>
                </dl>
                <p class="hint">
                    수집 이력은 실제 보유 기간과 다를 수 있습니다. 미확인 수치는
                    0으로 간주하지 않습니다.
                </p>
            </section>
            <div v-show="activeTab === 'details'" class="stock-insights">
                <SecurityInsights :symbol="normalize(route.params.ticker)" />
            </div>
            <section v-if="activeTab === 'prices'" class="stock-section">
                <StockCandlestickChart
                    :symbol="selectedInfo.symbol"
                    :currency="selectedInfo.currency || ''"
                    :events="stockEvents" />
                <details class="price-history">
                    <summary>일별 종가 표 보기</summary>
                    <h2>시세 이력</h2>
                    <p class="hint">
                        최근 {{ Math.min(priceRows.length, 120) }}개 실제 종가 ·
                        {{ selectedInfo.currency }} 기준 · 가격 보정
                        {{
                            selectedData.sourceStatus.adjustmentBasis ||
                            '미확인'
                        }}
                    </p>
                    <div class="stock-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>기준일</th>
                                    <th>종가</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in priceRows.slice(0, 120)"
                                    :key="row.date">
                                    <td>{{ row.date }}</td>
                                    <td>{{ displayNumber(row.close, 4) }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p v-if="!priceRows.length" class="hint">
                        확인 가능한 실제 종가가 없습니다.
                    </p>
                </details>
            </section>
            <section v-if="activeTab === 'dividends'" class="stock-section">
                <StockDividendTrend
                    :rows="selectedData.backtestData || []"
                    :as-of="selectedData.sourceStatus?.priceDate || today()"
                    :currency="selectedInfo.currency || 'USD'" />
                <h2>배당 이력</h2>
                <p class="hint">
                    배당락일 기준 · 주당 세전 {{ selectedInfo.currency }} ·
                    {{ historyRows.length }}회 수집
                </p>
                <div class="stock-table">
                    <table>
                        <thead>
                            <tr>
                                <th>배당락일</th>
                                <th>주당 배당금</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in historyRows" :key="row.date">
                                <td>{{ row.date }}</td>
                                <td>{{ displayNumber(amount(row), 6) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-if="!historyRows.length" class="hint">
                    확인 가능한 배당 이력이 없습니다.
                </p>
                <p class="hint">
                    공시 전 일정은 추정치입니다. 개인별 수령액은 보유 수량과
                    세금에 따라 다릅니다.
                </p>
            </section>
            <section
                v-if="activeTab === 'share'"
                class="share-selector stock-section">
                <h2>공유 카드 선택</h2>
                <p class="hint">
                    필요한 카드만 선택해 미리 보고 PNG 또는 ZIP으로 저장하세요.
                    개인 보유 정보는 공유 카드에 포함하지 않습니다.
                </p>
                <fieldset>
                    <legend>포함할 카드</legend>
                    <label
                        v-for="card in availableCards"
                        :key="card.kind"
                        :class="{ unavailable: card.disabled }"
                        ><input
                            v-model="selectedCardKinds"
                            type="checkbox"
                            :value="card.kind"
                            :disabled="card.disabled" />{{ card.label
                        }}<small v-if="card.disabled"
                            >비교 데이터 확인 필요</small
                        ></label
                    >
                </fieldset>
                <p v-if="!selectedExportKinds.length" class="hint">
                    미리 볼 카드를 선택하세요.
                </p>
            </section>
            <section
                v-show="activeTab === 'dividends' || activeTab === 'share'"
                class="artwork-grid"
                :class="{ 'dividend-view': activeTab === 'dividends' }">
                <article v-show="showCard('summary')" class="artwork-panel">
                    <ThumbnailPreview
                        ><DividendSummaryThumbnail
                            :data="thumbnailData"
                            data-thumbnail-kind="summary" /></ThumbnailPreview
                    ><Button
                        label="요약 PNG 다운로드"
                        icon="pi pi-download"
                        :loading="exporting === 'summary'"
                        @click="downloadArtwork('summary')" /><CardShareActions
                        title="요약 카드"
                        :text="cardShareText('summary')"
                        :url="publicUrl" />
                </article>
                <article v-show="showCard('comparison')" class="artwork-panel">
                    <ThumbnailPreview
                        ><DividendComparisonThumbnail
                            :data="thumbnailData"
                            data-thumbnail-kind="comparison" /></ThumbnailPreview
                    ><Button
                        label="비교 PNG 다운로드"
                        icon="pi pi-download"
                        :loading="exporting === 'comparison'"
                        @click="
                            downloadArtwork('comparison')
                        " /><CardShareActions
                        title="비교 카드"
                        :text="cardShareText('comparison')"
                        :url="publicUrl" />
                </article>
                <article
                    v-if="selectedInfo.underlying"
                    v-show="showCard('rival')"
                    class="artwork-panel">
                    <ThumbnailPreview
                        ><RivalThumbnail
                            :data="
                                comparison
                                    ? {
                                          comparison,
                                          underlying: selectedInfo.underlying,
                                          selectedTicker: selectedInfo.symbol,
                                      }
                                    : null
                            "
                            data-thumbnail-kind="rival" /></ThumbnailPreview
                    ><Button
                        label="라이벌 PNG 다운로드"
                        icon="pi pi-download"
                        :disabled="!comparison"
                        :loading="exporting === 'rival'"
                        @click="downloadArtwork('rival')" /><CardShareActions
                        title="라이벌 카드"
                        :text="cardShareText('rival')"
                        :url="publicUrl" />
                </article>
                <article v-show="showCard('calendar')" class="artwork-panel">
                    <ThumbnailPreview
                        ><DividendCalendarThumbnail
                            :data="{ ...schedule, symbol: selectedInfo.symbol }"
                            data-thumbnail-kind="calendar" /></ThumbnailPreview
                    ><Button
                        label="일정 PNG 다운로드"
                        icon="pi pi-download"
                        :loading="exporting === 'calendar'"
                        @click="downloadArtwork('calendar')" /><CardShareActions
                        title="일정 카드"
                        :text="cardShareText('calendar')"
                        :url="publicUrl" />
                </article>
                <article
                    v-show="showCard('entry-efficiency')"
                    class="artwork-panel">
                    <ThumbnailPreview
                        ><DividendEntryEfficiencyThumbnail
                            :data="{
                                ...entryEfficiency,
                                symbol: selectedInfo.symbol,
                            }"
                            data-thumbnail-kind="entry-efficiency" /></ThumbnailPreview
                    ><Button
                        label="과거 매수 배당률 PNG 다운로드"
                        icon="pi pi-download"
                        :loading="exporting === 'entry-efficiency'"
                        @click="
                            downloadArtwork('entry-efficiency')
                        " /><CardShareActions
                        title="과거 매수 시점별 배당률 카드"
                        :text="cardShareText('entry-efficiency')"
                        :url="publicUrl" />
                </article>
            </section>
            <p v-if="exportError" class="export-error" role="alert">
                {{ exportError }}
            </p>
            <div v-if="shareCopyReady" class="share-copy-notice">
                <span
                    >PNG 공유용 문구가 복사되었습니다. 토스·카카오톡에 바로
                    붙여넣으세요.</span
                ><button type="button" @click="copyShareText">
                    이미지 공유용 문구 복사
                </button>
            </div>
            <section v-show="activeTab === 'share'" class="content-grid">
                <TossCommunityCopy :data="thumbnailData" />
                <section v-if="selectedInfo.underlying" class="rivals">
                    <p v-if="!rivalOptions.length" class="hint">
                        같은 기초자산으로 등록된 비교 후보가 없습니다.
                    </p>
                    <p v-else-if="!rivals.length" class="hint">
                        페이지 헤더에서 라이벌 후보를 최대 {{ maxRivals }}종
                        선택하세요.
                    </p>
                    <p v-else-if="!comparison" class="hint">
                        공통 가격 이력을 계산하는 중이거나 데이터가 부족합니다.
                    </p>
                </section>
            </section>
        </template>
    </main>
</template>

<style scoped>
    .export-error {
        max-width: 1520px;
        margin: 16px auto;
        color: #dc2626;
    }
    .stock-overview {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        max-width: 1520px;
        margin: 0 auto 12px;
        position: sticky;
        top: 0;
        z-index: 5;
        background: var(--app-surface);
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        box-shadow: 0 4px 12px #00000008;
    }
    .stock-overview article,
    .stock-overview button {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        min-width: 0;
        text-align: left;
    }
    .stock-overview span {
        font-size: 0.75rem;
        color: var(--app-muted);
    }
    .stock-overview strong {
        font-size: 1.1rem;
        overflow-wrap: anywhere;
    }
    .next-dividend {
        border: 0;
        border-radius: 9px;
        background: var(--app-surface-muted);
        color: var(--app-text);
        cursor: pointer;
    }
    .next-dividend em {
        font-style: normal;
        font-size: 0.65rem;
        color: var(--app-accent);
        margin-left: 5px;
    }
    .price-up {
        color: #ef4444;
    }
    .price-down {
        color: #3b82f6;
    }
    .stock-data-banner {
        max-width: 1520px;
        margin: 0 auto 12px;
        display: flex;
        align-items: center;
        gap: 8px 18px;
        flex-wrap: wrap;
        color: var(--app-muted);
        font-size: 0.72rem;
        line-height: 1.6;
    }
    .stock-data-banner > span:first-child {
        padding: 4px 8px;
        border-radius: 6px;
        background: var(--app-surface-muted);
    }
    .stock-data-banner .stale,
    .stock-data-banner .partial {
        color: #b45309;
    }
    .stock-data-banner details {
        max-width: 100%;
    }
    .stock-data-banner summary {
        cursor: pointer;
    }
    .stock-data-banner p {
        max-width: 680px;
    }
    .share-selector fieldset {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        border: 0;
        padding: 18px 0 0;
        margin: 0;
    }
    .share-selector legend {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }
    .share-selector label {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--app-border);
        padding: 10px 14px;
        border-radius: 9px;
        font-size: 0.85rem;
        cursor: pointer;
    }
    .share-selector label:has(input:checked) {
        border-color: var(--app-accent);
        background: var(--app-surface-muted);
    }
    .share-selector .unavailable {
        opacity: 0.6;
    }
    .share-selector small {
        font-size: 0.65rem;
    }
    .share-selector input {
        accent-color: var(--app-accent);
    }
    @media (max-width: 800px) {
        .stock-overview {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            position: static;
            padding: 8px;
            gap: 4px;
        }
        .stock-overview strong {
            font-size: 0.95rem;
        }
        .stock-data-banner {
            font-size: 0.7rem;
        }
        .share-selector fieldset {
            gap: 8px;
        }
    }

    .price-history {
        margin-top: 24px;
        border-top: 1px solid var(--app-border);
        padding-top: 20px;
    }
    .price-history summary {
        cursor: pointer;
        font-weight: 700;
        margin-bottom: 16px;
    }
    .stock-insights {
        max-width: 1520px;
        margin: 0 auto;
    }
    .stock-tabs {
        display: flex;
        gap: 8px;
        max-width: 1520px;
        margin: 0 auto 24px;
        border-bottom: 1px solid var(--app-border);
        overflow-x: auto;
    }
    .stock-tabs button {
        white-space: nowrap;
        background: transparent;
        color: var(--app-muted);
        border: 0;
        border-bottom: 3px solid transparent;
        padding: 16px 22px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
    }
    .stock-tabs button.selected {
        color: var(--app-accent);
        border-bottom-color: var(--app-accent);
    }
    .stock-section {
        max-width: 1520px;
        margin: 0 auto 24px;
        padding: 28px;
        border: 1px solid var(--app-border);
        border-radius: 18px;
        background: var(--app-surface);
    }
    .stock-section h2 {
        font-size: 1.15rem;
        margin: 0 0 16px;
    }
    .stock-name {
        display: block;
        font-size: 0.95rem;
        font-weight: 500;
        color: var(--app-muted);
        margin-top: 8px;
    }
    .metric-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin: 24px 0 32px;
    }
    .metric-grid article {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 20px;
        border-radius: 12px;
        background: var(--app-surface-muted);
        min-width: 0;
    }
    .metric-grid span,
    .metric-grid small {
        font-size: 0.8rem;
        color: var(--app-muted);
    }
    .metric-grid strong {
        font-size: 1.5rem;
        overflow-wrap: anywhere;
    }
    .stock-facts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 24px;
        margin: 0 0 24px;
    }
    .stock-facts div {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 0;
        border-bottom: 1px solid var(--app-border);
    }
    .stock-facts dt {
        color: var(--app-muted);
        flex-shrink: 0;
    }
    .stock-facts dd {
        margin: 0;
        text-align: right;
        overflow-wrap: anywhere;
    }
    .stock-table {
        max-height: 480px;
        overflow: auto;
        margin-top: 20px;
    }
    .stock-table table {
        width: 100%;
        border-collapse: collapse;
    }
    .stock-table th,
    .stock-table td {
        padding: 14px;
        text-align: left;
        border-bottom: 1px solid var(--app-border);
    }
    .stock-table th {
        position: sticky;
        top: 0;
        background: var(--app-surface-muted);
    }
    .stock-table td:last-child,
    .stock-table th:last-child {
        text-align: right;
    }
    .dividend-view :deep(.card-share-actions),
    .dividend-view .artwork-panel > button {
        display: none;
    }
    @media (max-width: 800px) {
        .metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .stock-facts {
            grid-template-columns: 1fr;
        }
        .stock-section {
            padding: 18px;
        }
        .stock-tabs button {
            padding: 14px 8px;
            flex: 1;
            font-size: 0.9rem;
        }
    }
    @media (max-width: 400px) {
        .metric-grid {
            grid-template-columns: 1fr;
        }
    }

    .candidate-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
    }
    .candidate-actions .hint {
        font-size: 0.75rem;
    }
    .ticker-thumbnail-page {
        min-height: 100vh;
        padding: 32px;
        color: #17212b;
    }
    .state {
        min-height: 60vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
    }
    .page-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        max-width: 2208px;
        margin: 0 auto 24px;
    }
    .page-header p {
        margin: 0;
        color: #0064ff;
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.12em;
    }
    .page-header h1 {
        margin: 5px 0 0;
    }
    .rival-candidate-picker {
        min-width: 340px;
        padding: 14px 16px;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 4px 14px #15212b0d;
    }
    .candidate-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
    }
    .candidate-heading strong {
        color: #64748b;
        font-size: 0.72rem;
    }
    .candidate-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
    }
    .candidate-buttons button {
        min-width: 52px;
        padding: 8px 10px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        background: #f8fafc;
        color: #334155;
        font:
            800 0.8rem/1 ui-monospace,
            monospace;
        cursor: pointer;
    }
    .candidate-buttons button:hover:not(:disabled) {
        border-color: #2563eb;
        color: #1d4ed8;
    }
    .candidate-buttons button.selected {
        border-color: #2563eb;
        background: #2563eb;
        color: #fff;
        box-shadow: 0 2px 6px #2563eb3d;
    }
    .candidate-buttons button:disabled {
        opacity: 0.42;
        cursor: not-allowed;
    }
    .artwork-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, 720px);
        justify-content: center;
        gap: 24px;
        max-width: 2208px;
        margin: auto;
    }
    .artwork-panel {
        display: grid;
        width: 720px;
        gap: 12px;
    }
    .artwork-panel > button {
        justify-self: start;
    }
    .share-copy-notice {
        position: sticky;
        bottom: 16px;
        z-index: 2;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 12px;
        width: max-content;
        max-width: calc(100% - 32px);
        margin: 24px auto;
        padding: 12px 15px;
        border-radius: 12px;
        background: #17212b;
        color: #fff;
        box-shadow: 0 10px 28px #17212b40;
    }
    .share-copy-notice button {
        border: 0;
        border-radius: 7px;
        background: #fee500;
        color: #191919;
        padding: 8px 10px;
        font: 700 0.78rem inherit;
        cursor: pointer;
    }
    .content-grid {
        display: grid;
        grid-template-columns: minmax(0, 520px) minmax(360px, 1fr);
        gap: 24px;
        max-width: 1520px;
        margin: 32px auto 0;
        align-items: start;
    }
    .rivals {
        padding: 24px;
        border-radius: 18px;
        background: #dfe8f2;
    }
    .hint {
        margin: 0;
        color: #526274;
    }
    @media (max-width: 1000px) {
        .page-header {
            align-items: flex-start;
            flex-direction: column;
        }
        .rival-candidate-picker {
            width: 100%;
            min-width: 0;
            box-sizing: border-box;
        }
        .content-grid {
            grid-template-columns: 1fr;
        }
        .artwork-grid {
            justify-content: start;
            overflow-x: auto;
            padding-bottom: 12px;
        }
    }
    @media (max-width: 600px) {
        .ticker-thumbnail-page {
            padding: 16px;
        }
        .candidate-heading {
            align-items: flex-start;
            flex-direction: column;
            gap: 3px;
        }
        .share-copy-notice {
            align-items: flex-start;
            flex-direction: column;
        }
    }
    .ticker-thumbnail-page {
        color: var(--app-text);
    }
    .page-header p {
        color: var(--app-accent);
    }
    .data-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
    }
    .data-toolbar label {
        font-size: 0.78rem;
        font-weight: 700;
    }
    .data-toolbar select {
        margin-left: 5px;
        padding: 7px;
        border: 1px solid var(--app-border);
        border-radius: 7px;
        background: var(--app-surface);
        color: var(--app-text);
    }
    .data-status {
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--app-surface-muted);
        color: var(--app-muted) !important;
        letter-spacing: 0 !important;
    }
    .data-status.stale,
    .data-status.partial {
        background: #fff7ed;
        color: #9a3412 !important;
    }
    .preset-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 5px;
        max-width: 2208px;
        margin: 0 auto 18px;
        font-size: 0.75rem;
    }
    .preset-row span {
        margin-right: 5px;
        color: var(--app-muted);
        font-weight: 700;
    }
    .preset-row button {
        padding: 6px 8px;
        border: 1px solid var(--app-border);
        border-radius: 7px;
        background: var(--app-surface);
        color: var(--app-text);
        cursor: pointer;
    }
    .preset-row .preset-delete {
        margin-left: -6px;
        border-left: 0;
        color: var(--app-muted);
    }
    .rival-candidate-picker {
        border-color: var(--app-border);
        background: var(--app-surface);
        box-shadow: none;
    }
    .candidate-heading strong,
    .hint {
        color: var(--app-muted);
    }
    .candidate-buttons button {
        border-color: var(--app-border);
        background: var(--app-surface-muted);
        color: var(--app-text);
    }
    .candidate-buttons button:hover:not(:disabled) {
        border-color: var(--app-accent);
        color: var(--app-accent);
    }
    .candidate-buttons button.selected {
        border-color: var(--app-accent);
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        box-shadow: none;
    }
    .share-copy-notice {
        background: var(--app-surface);
        color: var(--app-text);
        border: 1px solid var(--app-border);
        box-shadow: 0 10px 28px var(--app-overlay);
    }
    .share-copy-notice button {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .rivals {
        background: var(--app-surface-muted);
        border: 1px solid var(--app-border-subtle);
    }
    .artwork-grid {
        grid-template-columns: repeat(
            auto-fit,
            minmax(min(100%, 720px), 720px)
        );
        overflow-x: visible;
        max-width: 1520px;
    }
    .artwork-panel {
        width: 100%;
        min-width: 0;
    }
</style>
