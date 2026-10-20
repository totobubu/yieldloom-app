<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import { readPublicJson } from '@/services/publicJson.js';
    import { useHead } from '@vueuse/head';
    import { useRoute, useRouter } from 'vue-router';
    import html2canvas from 'html2canvas';
    import Button from 'primevue/button';
    import Skeleton from 'primevue/skeleton';
    import Tabs from 'primevue/tabs';
    import TabList from 'primevue/tablist';
    import Tab from 'primevue/tab';
    import TabPanels from 'primevue/tabpanels';
    import TabPanel from 'primevue/tabpanel';
    import Dialog from 'primevue/dialog';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import Checkbox from 'primevue/checkbox';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import { useToast } from 'primevue/usetoast';
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
    import { dividendPrice } from '@/services/thumbnail/dividendPrice';
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
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    import {
        artworkFilename,
        artworkSuffix,
        cardAspectRatios,
        cardDimensions,
        cardTemplates,
        normalizeCardPresentation,
    } from '@/services/thumbnail/cardPresentation';

    const route = useRoute();
    const router = useRouter();
    const toast = useToast();
    const presetDialogOpen = ref(false),
        presetName = ref(''),
        presetError = ref('');
    const toneOptions = [
        { label: '정보형', value: 'informative' },
        { label: '간결형', value: 'concise' },
        { label: '친근형', value: 'friendly' },
    ];
    const openPresetDialog = () => {
        presetName.value = `${selectedInfo.value.symbol} 콘텐츠`;
        presetError.value = '';
        presetDialogOpen.value = true;
    };
    const backToSearch = () => {
        const back = window.history.state?.back;
        if (back === '/' || back?.startsWith('/?')) router.back();
        else router.push('/');
    };
    const selectedInfo = ref(null);
    const selectedData = ref(null);
    const loading = ref(true);
    useFullscreenLoading(loading, '종목 정보를 불러오고 있습니다.');
    const error = ref('');
    const rivals = ref([]);
    const draftRivals = ref([]);
    const rivalPickerOpen = ref(false);
    const exporting = ref('');
    const exportError = ref('');
    const schedule = ref(null);
    const selectedAspectRatio = ref('square'),
        selectedTemplate = ref('classic');
    const selectedPresentation = computed(() =>
        normalizeCardPresentation({
            aspectRatio: selectedAspectRatio.value,
            template: selectedTemplate.value,
        })
    );
    const outputDimensions = computed(() =>
        cardDimensions(selectedPresentation.value)
    );
    const maxRivals = 3;
    const shareCopyReady = ref(false);
    const dataStatus = ref('fresh');
    const selectedTone = ref('informative');
    const packaging = ref(false);
    const outputBusy = computed(() => !!exporting.value || packaging.value);
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
        const referencePrice = dividendPrice(
            current,
            {
                price: selectedInfo.value?.price,
                date: selectedData.value?.sourceStatus?.priceDate,
            },
            priceRows.value
        );
        const exClose = referencePrice.price;
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
            usesLatestPrice: referencePrice.latest,
            referencePriceDate: referencePrice.date,
            referencePriceLabel: referencePrice.latest
                ? '최신 주가'
                : '배당락일 종가',
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
    };

    let loadSequence = 0;
    let loadController;
    onScopeDispose(() => {
        loadSequence++;
        loadController?.abort();
    });
    const load = async (
        rivalSymbols = route.query.rivals == null
            ? undefined
            : String(route.query.rivals).split(',').filter(Boolean),
        force = false
    ) => {
        const sequence = ++loadSequence;
        loadController?.abort();
        const controller = new AbortController();
        loadController = controller;
        loading.value = true;
        schedule.value = null;
        error.value = '';
        comparison.value = null;
        try {
            const requested = normalize(route.params.ticker);
            const payload = await readPublicJson(
                apiUrl(
                    `/api/thumbnail-data?ticker=${encodeURIComponent(requested)}${rivalSymbols == null ? '' : `&rivals=${encodeURIComponent(rivalSymbols.join(','))}`}`
                ),
                { signal: controller.signal, ttlMs: 60_000, force }
            );
            if (sequence !== loadSequence) return;
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
                selectedInfo.value.symbol,
                undefined,
                { signal: controller.signal, force }
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
                error.value =
                    e.status === 404
                        ? '해당 티커를 찾을 수 없습니다. 티커를 확인해 주세요.'
                        : e.status === 503
                          ? '시세 제공 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
                          : e.message || '종목 정보를 불러오지 못했습니다.';
            console.error(e);
        } finally {
            if (sequence === loadSequence) loading.value = false;
        }
    };
    const prepareExportDocument = (document, dimensions) => {
        document
            .querySelectorAll('.thumbnail-preview-artboard')
            .forEach((element) => {
                element.style.transform = 'none';
            });
        document.querySelectorAll('.thumbnail-preview').forEach((element) => {
            element.style.width = `${dimensions.width}px`;
            element.style.maxWidth = `${dimensions.width}px`;
            element.style.height = `${dimensions.height}px`;
        });
    };
    const captureArtwork = (element, presentation) => {
        const dimensions = cardDimensions(presentation);
        return html2canvas(element, {
            onclone: (document) => prepareExportDocument(document, dimensions),
            useCORS: true,
            backgroundColor: null,
            scale: 1,
            width: dimensions.width,
            height: dimensions.height,
            windowWidth: Math.max(1280, dimensions.width),
        });
    };
    const downloadArtwork = async (kind) => {
        if (outputBusy.value) return;
        const element = document.querySelector(
            `[data-thumbnail-kind="${kind}"]`
        );
        if (!element) return;
        const sequence = loadSequence,
            presentation = { ...selectedPresentation.value };
        const symbol = thumbnailData.value.symbol,
            text = cardShareText(kind);
        exportError.value = '';
        exporting.value = kind;
        try {
            const canvas = await captureArtwork(element, presentation);
            if (sequence !== loadSequence) return;
            const link = document.createElement('a');
            link.download = artworkFilename(symbol, kind, presentation);
            link.href = canvas.toDataURL('image/png');
            link.click();
            // The download is normally initiated from a user gesture, so immediately offer its matching post copy.
            try {
                await navigator.clipboard.writeText(text);
                if (sequence === loadSequence) shareCopyReady.value = true;
            } catch {
                shareCopyReady.value = false;
            }
            trackAggregate('png_download', kind);
        } catch (e) {
            if (sequence === loadSequence)
                exportError.value =
                    'PNG를 생성하지 못했습니다. 잠시 후 다시 시도하세요.';
            console.error('Thumbnail export failed', e);
        } finally {
            exporting.value = '';
        }
    };
    const copyShareText = async (kind = 'summary') => {
        try {
            await navigator.clipboard.writeText(cardShareText(kind));
            shareCopyReady.value = true;
            trackAggregate('share_copy', kind);
        } catch {
            exportError.value =
                '문구를 복사하지 못했습니다. 게시 문구에서 직접 선택해 복사해 주세요.';
        }
    };
    const downloadPublishPackage = async () => {
        if (outputBusy.value) return;
        const sequence = loadSequence,
            presentation = { ...selectedPresentation.value };
        const symbol = thumbnailData.value.symbol,
            tone = selectedTone.value,
            sourceStatus = dataStatus.value;
        const sourceUrl = selectedData.value?.sourceStatus?.dividendSourceUrl,
            asOfDate = selectedData.value?.sourceStatus?.priceDate;
        exportError.value = '';
        packaging.value = true;
        try {
            const kinds = selectedExportKinds.value;
            if (!kinds.length) return;
            const cards = [];
            for (const kind of kinds) {
                const element = document.querySelector(
                    `[data-thumbnail-kind="${kind}"]`
                );
                if (!element)
                    throw new Error('선택한 카드의 미리보기가 없습니다.');
                const text = cardShareText(kind);
                const canvas = await captureArtwork(element, presentation);
                if (sequence !== loadSequence) return;
                const png = await (
                    await fetch(canvas.toDataURL('image/png'))
                ).arrayBuffer();
                cards.push({
                    kind,
                    label:
                        availableCards.value.find((card) => card.kind === kind)
                            ?.label || kind,
                    filename: artworkFilename(symbol, kind, presentation),
                    png: new Uint8Array(png),
                    text,
                    sourceUrl,
                    asOfDate,
                });
            }
            if (sequence !== loadSequence) return;
            downloadBlob(
                createPublishPackage({
                    symbol,
                    tone,
                    cards,
                    sourceStatus,
                    presentation,
                }),
                `${symbol.toLowerCase()}_publish-package${artworkSuffix(presentation)}.zip`
            );
        } catch (reason) {
            if (sequence === loadSequence)
                exportError.value =
                    '게시 패키지를 생성하지 못했습니다. 잠시 후 다시 시도하세요.';
            console.error('Publish package failed', reason);
        } finally {
            packaging.value = false;
        }
    };
    const saveCurrentPreset = () => {
        const name = presetName.value.trim();
        if (!name) {
            presetError.value = '프리셋 이름을 입력해 주세요.';
            return;
        }
        try {
            const item = saveLocalPreset({
                id: crypto.randomUUID?.() ?? `${Date.now()}`,
                name,
                ticker: selectedInfo.value.symbol,
                rivals: rivals.value,
                tone: selectedTone.value,
                presentation: selectedPresentation.value,
                cardKinds: selectedCardKinds.value,
                updatedAt: new Date().toISOString(),
            });
            presets.value = [
                item,
                ...presets.value.filter((preset) => preset.id !== item.id),
            ];
            presetDialogOpen.value = false;
            toast.add({
                severity: 'success',
                summary: '프리셋을 저장했습니다',
                detail: '이 브라우저에서 다시 사용할 수 있습니다.',
                life: 3000,
            });
        } catch {
            presetError.value =
                '브라우저 저장 공간을 확인하고 다시 시도해 주세요.';
        }
    };
    const openPreset = async (preset) => {
        if (outputBusy.value) return;
        selectedTone.value = preset.tone || 'informative';
        const presentation = normalizeCardPresentation(preset.presentation);
        selectedAspectRatio.value = presentation.aspectRatio;
        selectedTemplate.value = presentation.template;
        selectedCardKinds.value = preset.cardKinds || ['summary'];
        await router.push({
            path: `/stock/${preset.ticker}`,
            query: {
                tab: 'share',
                ...(preset.rivals.length
                    ? { rivals: preset.rivals.join(',') }
                    : {}),
            },
        });
    };
    const deletePreset = (preset) => {
        removeLocalPreset(preset.id);
        presets.value = presets.value.filter((item) => item.id !== preset.id);
    };
    watch(
        [() => route.params.ticker, () => route.query.rivals],
        ([ticker], [previousTicker] = []) => {
            if (ticker !== previousTicker) rivalPickerOpen.value = false;
            load();
        },
        { immediate: true }
    );
</script>

<template>
    <section class="ticker-thumbnail-page">
        <div
            v-if="loading"
            class="stock-loading"
            role="status"
            aria-label="종목 정보를 불러오는 중">
            <Skeleton width="8rem" height="1rem" /><Skeleton
                width="60%"
                height="3rem" /><Skeleton
                height="8rem"
                border-radius="16px" /><Skeleton height="3rem" /><Skeleton
                height="20rem"
                border-radius="16px" />
            <p class="studio-muted">종목 정보를 불러오는 중…</p>
        </div>
        <div v-else-if="error" class="state">
            <h1>종목을 열 수 없습니다</h1>
            <p>{{ error }}</p>
            <Button label="다시 시도" @click="load(undefined, true)" />
        </div>
        <template v-else>
            <header class="page-header">
                <div>
                    <Button
                        label="종목 검색"
                        icon="pi pi-arrow-left"
                        text
                        severity="secondary"
                        @click="backToSearch" />
                    <div class="stock-identity">
                        <span class="stock-mark">{{
                            selectedInfo.symbol.slice(0, 1)
                        }}</span>
                        <div>
                            <h1>{{ selectedInfo.symbol }}</h1>
                            <p class="stock-full-name">
                                {{
                                    selectedInfo.longName || selectedInfo.koName
                                }}
                            </p>
                            <span class="studio-muted"
                                >{{ selectedInfo.company || '운용사 미확인' }} ·
                                {{
                                    selectedInfo.currency || '통화 미확인'
                                }}</span
                            >
                        </div>
                    </div>
                </div>
                <Button
                    v-if="activeTab !== 'share'"
                    label="공유 카드 만들기"
                    icon="pi pi-share-alt"
                    severity="secondary"
                    outlined
                    @click="selectTab('share')" />
            </header>
            <section class="stock-overview" aria-label="종목 핵심 지표">
                <article>
                    <span
                        >최근 시세 ·
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
            <Tabs
                :value="activeTab"
                @update:value="selectTab"
                class="stock-tabs-root">
                <TabList class="stock-tabs"
                    ><Tab v-for="tab in tabs" :key="tab.id" :value="tab.id">{{
                        tab.label
                    }}</Tab></TabList
                >
                <TabPanels>
                    <TabPanel value="details">
                        <section
                            v-if="activeTab === 'details'"
                            class="stock-section">
                            <h2>{{ selectedInfo.symbol }} 종목 개요</h2>
                            <p class="hint">
                                시세 기준
                                {{
                                    selectedData.sourceStatus.priceDate ||
                                    '미확인'
                                }}
                                · 수집된 실제 이력 기준
                            </p>
                            <div class="metric-grid">
                                <article>
                                    <span>최근 시세</span
                                    ><strong
                                        >{{
                                            displayNumber(selectedInfo.price, 4)
                                        }}
                                        <small>{{
                                            selectedInfo.currency
                                        }}</small></strong
                                    >
                                </article>
                                <article>
                                    <span>최근 12개월 주당 배당</span
                                    ><strong
                                        >{{
                                            displayNumber(trailingDividend, 4)
                                        }}
                                        <small>{{
                                            selectedInfo.currency
                                        }}</small></strong
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
                                    <dd>
                                        {{ selectedInfo.company || '미확인' }}
                                    </dd>
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
                                    <dd>
                                        {{
                                            selectedInfo.underlying || '미확인'
                                        }}
                                    </dd>
                                </div>
                                <div>
                                    <dt>수집 시세 범위</dt>
                                    <dd>
                                        {{ priceRows.at(-1)?.date || '미확인' }}
                                        ~
                                        {{ priceRows[0]?.date || '미확인' }}
                                    </dd>
                                </div>
                            </dl>
                            <p class="hint">
                                수집 이력은 실제 보유 기간과 다를 수 있습니다.
                                미확인 수치는 0으로 간주하지 않습니다.
                            </p>
                        </section>
                        <div
                            v-show="activeTab === 'details'"
                            class="stock-insights">
                            <SecurityInsights
                                :symbol="normalize(route.params.ticker)" />
                        </div> </TabPanel
                    ><TabPanel value="prices">
                        <section
                            v-if="activeTab === 'prices'"
                            class="stock-section">
                            <StockCandlestickChart
                                :symbol="selectedInfo.symbol"
                                :currency="selectedInfo.currency || ''"
                                :events="stockEvents" />
                            <details class="price-history">
                                <summary>일별 종가 표 보기</summary>
                                <h2>시세 이력</h2>
                                <p class="hint">
                                    최근 {{ Math.min(priceRows.length, 120) }}개
                                    실제 종가 · {{ selectedInfo.currency }} 기준
                                    · 가격 보정
                                    {{
                                        selectedData.sourceStatus
                                            .adjustmentBasis || '미확인'
                                    }}
                                </p>
                                <DataTable
                                    :value="priceRows.slice(0, 120)"
                                    class="stock-data-table"
                                    striped-rows
                                    scrollable
                                    scroll-height="420px"
                                    :table-props="{
                                        'aria-label': '일별 종가 이력',
                                    }"
                                    ><Column
                                        field="date"
                                        header="기준일" /><Column header="종가"
                                        ><template #body="{ data }"
                                            >{{ displayNumber(data.close, 4) }}
                                            {{
                                                selectedInfo.currency
                                            }}</template
                                        ></Column
                                    ></DataTable
                                >
                                <p v-if="!priceRows.length" class="hint">
                                    확인 가능한 실제 종가가 없습니다.
                                </p>
                            </details>
                        </section> </TabPanel
                    ><TabPanel value="dividends">
                        <section
                            v-if="activeTab === 'dividends'"
                            class="stock-section">
                            <div class="dividend-next">
                                <div class="section-heading">
                                    <h2>배당 일정</h2>
                                    <Tag
                                        :value="
                                            nextDividend?.confirmed
                                                ? '공시 확정'
                                                : nextDividend
                                                  ? '주기 추정'
                                                  : '공시 대기'
                                        "
                                        :severity="
                                            nextDividend?.confirmed
                                                ? 'success'
                                                : 'secondary'
                                        "
                                        rounded />
                                </div>
                                <div class="schedule-metrics">
                                    <div>
                                        <span>다음 배당락일</span
                                        ><strong>{{
                                            nextDividend?.date || '공시 대기'
                                        }}</strong>
                                    </div>
                                    <div>
                                        <span>최근 공시 주당 배당 · 세전</span
                                        ><strong>{{
                                            schedule?.current?.amount != null
                                                ? `${schedule.current.amount} ${selectedInfo.currency}`
                                                : '미확인'
                                        }}</strong>
                                    </div>
                                    <div>
                                        <span>최근 공시 지급일</span
                                        ><strong>{{
                                            schedule?.current?.payableDate ||
                                            '미확인'
                                        }}</strong>
                                    </div>
                                </div>
                                <p class="hint">
                                    공시 전 일정은 최근 주기를 바탕으로 한
                                    추정입니다. 증권사 입금일과 실제 수령액은
                                    다를 수 있습니다.
                                </p>
                            </div>
                            <StockDividendTrend
                                :rows="selectedData.backtestData || []"
                                :as-of="
                                    selectedData.sourceStatus?.priceDate ||
                                    today()
                                "
                                :currency="selectedInfo.currency || 'USD'" />
                            <h2>배당 이력</h2>
                            <p class="hint">
                                배당락일 기준 · 주당 세전
                                {{ selectedInfo.currency }} ·
                                {{ historyRows.length }}회 수집
                            </p>
                            <DataTable
                                :value="historyRows"
                                class="stock-data-table"
                                striped-rows
                                paginator
                                :rows="12"
                                :page-link-size="3"
                                paginator-template="PrevPageLink PageLinks NextPageLink"
                                :table-props="{ 'aria-label': '배당 이력' }"
                                ><Column
                                    field="date"
                                    header="배당락일" /><Column
                                    header="주당 배당금 · 세전"
                                    ><template #body="{ data }"
                                        >{{ displayNumber(amount(data), 6) }}
                                        {{ selectedInfo.currency }}</template
                                    ></Column
                                ></DataTable
                            >
                            <p v-if="!historyRows.length" class="hint">
                                확인 가능한 배당 이력이 없습니다.
                            </p>
                            <p class="hint">
                                공시 전 일정은 추정치입니다. 개인별 수령액은
                                보유 수량과 세금에 따라 다릅니다.
                            </p>
                        </section> </TabPanel
                    ><TabPanel value="share">
                        <section class="share-workspace stock-section">
                            <div class="section-heading">
                                <div>
                                    <span class="studio-eyebrow"
                                        >CONTENT STUDIO</span
                                    >
                                    <h2>내가 고른 정보, 한 장의 카드로.</h2>
                                    <p class="hint">
                                        개인 보유 정보가 포함되지 않는 공개 종목
                                        카드입니다.
                                    </p>
                                </div>
                                <Button
                                    :label="`선택 카드 ZIP (${selectedExportKinds.length})`"
                                    :disabled="
                                        outputBusy ||
                                        !selectedExportKinds.length
                                    "
                                    icon="pi pi-box"
                                    :loading="packaging"
                                    @click="downloadPublishPackage" />
                            </div>
                            <div class="share-controls">
                                <div class="studio-field">
                                    <label
                                        id="share-ratio-label"
                                        for="share-ratio"
                                        >출력 비율</label
                                    >
                                    <Select
                                        input-id="share-ratio"
                                        aria-labelledby="share-ratio-label"
                                        v-model="selectedAspectRatio"
                                        :options="cardAspectRatios"
                                        option-label="label"
                                        option-value="value"
                                        :disabled="outputBusy" />
                                </div>
                                <div class="studio-field">
                                    <label
                                        id="share-template-label"
                                        for="share-template"
                                        >카드 디자인</label
                                    >
                                    <Select
                                        input-id="share-template"
                                        aria-labelledby="share-template-label"
                                        v-model="selectedTemplate"
                                        :options="cardTemplates"
                                        option-label="label"
                                        option-value="value"
                                        :disabled="outputBusy" />
                                </div>
                                <div class="studio-field">
                                    <label for="share-tone">게시 문구 톤</label
                                    ><Select
                                        input-id="share-tone"
                                        v-model="selectedTone"
                                        :disabled="outputBusy"
                                        :options="toneOptions"
                                        option-label="label"
                                        option-value="value" />
                                </div>
                                <Button
                                    label="프리셋 저장"
                                    icon="pi pi-bookmark"
                                    severity="secondary"
                                    outlined
                                    :disabled="outputBusy"
                                    @click="openPresetDialog" /><Button
                                    v-if="
                                        selectedInfo.underlying &&
                                        rivalOptions.length
                                    "
                                    label="비교 종목 선택"
                                    :disabled="outputBusy"
                                    icon="pi pi-sliders-h"
                                    severity="secondary"
                                    outlined
                                    @click="openRivalPicker" />
                            </div>
                            <p class="hint">
                                출력 크기 {{ outputDimensions.width }} ×
                                {{ outputDimensions.height }}px · 선택한
                                디자인은 앱 테마와 별도로 이미지에 적용됩니다.
                            </p>
                            <div v-if="rivals.length" class="selected-rivals">
                                <span>비교 종목</span
                                ><Tag
                                    v-for="rival in rivals"
                                    :key="rival"
                                    :value="rival"
                                    severity="secondary" />
                            </div>
                            <div
                                v-if="presets.length"
                                class="preset-row"
                                aria-label="저장된 콘텐츠 프리셋">
                                <span>저장한 조합</span>
                                <div
                                    v-for="preset in presets"
                                    :key="preset.id"
                                    class="preset-item">
                                    <Button
                                        :label="preset.name"
                                        :disabled="outputBusy"
                                        severity="secondary"
                                        outlined
                                        size="small"
                                        @click="openPreset(preset)" /><Button
                                        icon="pi pi-times"
                                        severity="secondary"
                                        text
                                        :aria-label="`${preset.name} 삭제`"
                                        :disabled="outputBusy"
                                        @click="deletePreset(preset)" />
                                </div>
                            </div>
                        </section>
                        <section
                            v-if="activeTab === 'share'"
                            class="share-selector stock-section">
                            <h2>공유 카드 선택</h2>
                            <p class="hint">
                                필요한 카드만 선택해 미리 보고 PNG 또는 ZIP으로
                                저장하세요. 개인 보유 정보는 공유 카드에
                                포함하지 않습니다.
                            </p>
                            <fieldset>
                                <legend>포함할 카드</legend>
                                <label
                                    v-for="card in availableCards"
                                    :key="card.kind"
                                    :class="{ unavailable: card.disabled }"
                                    :for="`share-card-${card.kind}`"
                                    ><Checkbox
                                        v-model="selectedCardKinds"
                                        :input-id="`share-card-${card.kind}`"
                                        :value="card.kind"
                                        :disabled="
                                            outputBusy || card.disabled
                                        " />{{ card.label
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
                            v-show="activeTab === 'share'"
                            class="artwork-grid"
                            :class="{
                                'dividend-view': activeTab === 'dividends',
                                'wide-artwork': selectedAspectRatio === 'wide',
                            }">
                            <article
                                v-show="showCard('summary')"
                                class="artwork-panel">
                                <ThumbnailPreview
                                    :presentation="selectedPresentation"
                                    ><DividendSummaryThumbnail
                                        :data="thumbnailData"
                                        data-thumbnail-kind="summary" /></ThumbnailPreview
                                ><Button
                                    label="요약 PNG 다운로드"
                                    icon="pi pi-download"
                                    :loading="exporting === 'summary'"
                                    :disabled="outputBusy"
                                    @click="
                                        downloadArtwork('summary')
                                    " /><CardShareActions
                                    title="요약 카드"
                                    :text="cardShareText('summary')"
                                    :url="publicUrl" />
                            </article>
                            <article
                                v-show="showCard('comparison')"
                                class="artwork-panel">
                                <ThumbnailPreview
                                    :presentation="selectedPresentation"
                                    ><DividendComparisonThumbnail
                                        :data="thumbnailData"
                                        data-thumbnail-kind="comparison" /></ThumbnailPreview
                                ><Button
                                    label="비교 PNG 다운로드"
                                    icon="pi pi-download"
                                    :loading="exporting === 'comparison'"
                                    :disabled="outputBusy"
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
                                    :presentation="selectedPresentation"
                                    ><RivalThumbnail
                                        :data="
                                            comparison
                                                ? {
                                                      comparison,
                                                      underlying:
                                                          selectedInfo.underlying,
                                                      selectedTicker:
                                                          selectedInfo.symbol,
                                                  }
                                                : null
                                        "
                                        data-thumbnail-kind="rival" /></ThumbnailPreview
                                ><Button
                                    label="라이벌 PNG 다운로드"
                                    icon="pi pi-download"
                                    :disabled="outputBusy || !comparison"
                                    :loading="exporting === 'rival'"
                                    @click="
                                        downloadArtwork('rival')
                                    " /><CardShareActions
                                    title="라이벌 카드"
                                    :text="cardShareText('rival')"
                                    :url="publicUrl" />
                            </article>
                            <article
                                v-show="showCard('calendar')"
                                class="artwork-panel">
                                <ThumbnailPreview
                                    :presentation="selectedPresentation"
                                    ><DividendCalendarThumbnail
                                        :data="{
                                            ...schedule,
                                            symbol: selectedInfo.symbol,
                                        }"
                                        data-thumbnail-kind="calendar" /></ThumbnailPreview
                                ><Button
                                    label="일정 PNG 다운로드"
                                    icon="pi pi-download"
                                    :loading="exporting === 'calendar'"
                                    :disabled="outputBusy"
                                    @click="
                                        downloadArtwork('calendar')
                                    " /><CardShareActions
                                    title="일정 카드"
                                    :text="cardShareText('calendar')"
                                    :url="publicUrl" />
                            </article>
                            <article
                                v-show="showCard('entry-efficiency')"
                                class="artwork-panel">
                                <ThumbnailPreview
                                    :presentation="selectedPresentation"
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
                                    :disabled="outputBusy"
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
                                >PNG 공유용 문구가 복사되었습니다.
                                토스·카카오톡에 바로 붙여넣으세요.</span
                            ><button type="button" @click="copyShareText">
                                이미지 공유용 문구 복사
                            </button>
                        </div>
                        <section
                            v-show="activeTab === 'share'"
                            class="content-grid">
                            <TossCommunityCopy :data="thumbnailData" />
                            <section
                                v-if="selectedInfo.underlying"
                                class="rivals">
                                <p v-if="!rivalOptions.length" class="hint">
                                    같은 기초자산으로 등록된 비교 후보가
                                    없습니다.
                                </p>
                                <p v-else-if="!rivals.length" class="hint">
                                    비교 종목 선택에서 라이벌 후보를 최대
                                    {{ maxRivals }}종 선택하세요.
                                </p>
                                <p v-else-if="!comparison" class="hint">
                                    공통 가격 이력을 계산하는 중이거나 데이터가
                                    부족합니다.
                                </p>
                            </section>
                        </section>
                    </TabPanel></TabPanels
                >
            </Tabs>
            <Dialog
                v-model:visible="presetDialogOpen"
                modal
                header="프리셋 저장"
                :style="{ width: '440px' }"
                :breakpoints="{ '600px': '92vw' }">
                <form
                    id="preset-form"
                    class="preset-form"
                    @submit.prevent="saveCurrentPreset">
                    <div class="studio-field">
                        <label for="preset-name">프리셋 이름</label
                        ><InputText
                            id="preset-name"
                            v-model="presetName"
                            maxlength="40"
                            required
                            autofocus
                            fluid
                            :invalid="!!presetError" /><small
                            class="studio-muted"
                            >{{ presetName.length }}/40자 · 이 브라우저에
                            저장됩니다.</small
                        >
                    </div>
                    <p class="studio-muted">
                        {{ selectedInfo.symbol }} ·
                        {{
                            cardAspectRatios.find(
                                (item) => item.value === selectedAspectRatio
                            )?.label
                        }}
                        ·
                        {{
                            cardTemplates.find(
                                (item) => item.value === selectedTemplate
                            )?.label
                        }}
                        · {{ rivals.join(', ') || '비교 종목 없음' }} ·
                        {{
                            toneOptions.find(
                                (tone) => tone.value === selectedTone
                            )?.label
                        }}
                    </p>
                    <Message
                        v-if="presetError"
                        severity="error"
                        :closable="false"
                        >{{ presetError }}</Message
                    >
                </form>
                <template #footer
                    ><Button
                        label="취소"
                        severity="secondary"
                        text
                        @click="presetDialogOpen = false" /><Button
                        label="프리셋 저장"
                        type="submit"
                        form="preset-form"
                        icon="pi pi-bookmark"
                /></template>
            </Dialog>
            <Dialog
                v-model:visible="rivalPickerOpen"
                modal
                header="비교 종목 선택"
                :style="{ width: '520px' }"
                :breakpoints="{ '600px': '92vw' }">
                <p class="studio-muted">
                    {{ selectedInfo.underlying }} 기반 종목을 최대
                    {{ maxRivals }}개 선택하세요.
                </p>
                <div class="rival-dialog-options">
                    <Button
                        v-for="option in rivalOptions"
                        :key="option.value"
                        :label="option.label"
                        :severity="
                            draftRivals.includes(option.value)
                                ? undefined
                                : 'secondary'
                        "
                        :outlined="!draftRivals.includes(option.value)"
                        :aria-pressed="draftRivals.includes(option.value)"
                        :disabled="
                            !draftRivals.includes(option.value) &&
                            draftRivals.length >= maxRivals
                        "
                        @click="toggleRival(option.value)" />
                </div>
                <template #footer
                    ><span class="studio-muted"
                        >{{ draftRivals.length }}/{{ maxRivals }}개 선택</span
                    ><Button
                        label="취소"
                        severity="secondary"
                        text
                        @click="rivalPickerOpen = false" /><Button
                        label="선택 적용"
                        icon="pi pi-check"
                        @click="confirmRivals"
                /></template>
            </Dialog>
        </template>
    </section>
</template>

<style scoped>
    .ticker-thumbnail-page {
        color: var(--app-text);
        min-width: 0;
    }
    .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 24px;
    }
    .page-header > div > .p-button {
        margin: 0 0 12px -12px;
    }
    .stock-identity {
        display: flex;
        gap: 16px;
        align-items: center;
    }
    .stock-mark {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 56px;
        height: 56px;
        border: 1px solid var(--app-border);
        border-radius: 16px;
        background: var(--app-surface);
        color: var(--app-accent);
        font-size: 26px;
        font-weight: 750;
    }
    .stock-identity h1 {
        margin: 0;
        font-size: 32px;
    }
    .stock-full-name {
        margin: 4px 0;
        color: var(--app-muted);
        font-size: 15px;
    }
    .stock-identity .studio-muted {
        font-size: 13px;
    }
    .stock-overview {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 16px;
        padding: 20px;
        margin-bottom: 16px;
    }
    .stock-overview article,
    .next-dividend {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
    }
    .stock-overview span {
        font-size: 13px;
        color: var(--app-muted);
    }
    .stock-overview strong {
        font-size: 22px;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
    }
    .next-dividend {
        border: 0;
        text-align: left;
        background: var(--app-surface-muted);
        border-radius: 12px;
        padding: 12px;
        color: var(--app-text);
        cursor: pointer;
    }
    .next-dividend strong {
        font-size: 17px;
    }
    .next-dividend em {
        display: inline-block;
        font-size: 11px;
        font-style: normal;
        color: var(--app-accent);
        margin-left: 4px;
    }
    .price-up {
        color: var(--app-up);
    }
    .price-down {
        color: var(--app-down);
    }
    .stock-data-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px 16px;
        color: var(--app-muted);
        font-size: 12px;
        margin-bottom: 24px;
    }
    .stock-data-banner > span:first-child {
        border-radius: 6px;
        padding: 4px 8px;
        background: var(--app-surface-muted);
    }
    .stock-data-banner details {
        max-width: 100%;
    }
    .stock-data-banner summary {
        cursor: pointer;
    }
    .stock-data-banner p {
        max-width: 680px;
        line-height: 1.8;
    }
    .stock-tabs-root :deep(.p-tabpanels) {
        background: transparent;
        padding: 24px 0 0;
    }
    .stock-tabs-root :deep(.p-tablist-tab-list) {
        background: transparent;
    }
    .stock-tabs-root :deep(.p-tab) {
        padding: 16px 24px;
        min-height: 52px;
    }
    .stock-section {
        padding: 28px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 16px;
        margin-bottom: 24px;
        min-width: 0;
    }
    .stock-section h2 {
        font-size: 20px;
        margin: 0 0 16px;
    }
    .metric-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin: 24px 0;
    }
    .metric-grid article {
        display: grid;
        gap: 8px;
        background: var(--app-surface-muted);
        padding: 18px;
        border-radius: 12px;
        min-width: 0;
    }
    .metric-grid span,
    .metric-grid small {
        font-size: 13px;
        color: var(--app-muted);
    }
    .metric-grid strong {
        font-size: 22px;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
    }
    .stock-facts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0 24px;
        margin: 0 0 16px;
    }
    .stock-facts div {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 0;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .stock-facts dt {
        color: var(--app-muted);
        flex-shrink: 0;
    }
    .stock-facts dd {
        text-align: right;
        margin: 0;
        overflow-wrap: anywhere;
    }
    .hint {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.8;
        margin: 8px 0;
    }
    .price-history {
        margin-top: 24px;
        border-top: 1px solid var(--app-border);
        padding-top: 20px;
    }
    .price-history summary {
        cursor: pointer;
        font-weight: 650;
        margin-bottom: 16px;
    }
    .stock-data-table {
        margin-top: 20px;
        font-variant-numeric: tabular-nums;
    }
    .stock-data-table :deep(th) {
        background: var(--app-surface-muted);
        font-size: 13px;
    }
    .stock-data-table :deep(td) {
        font-size: 14px;
        padding: 14px;
    }
    .dividend-next {
        padding: 0 0 24px;
        margin-bottom: 24px;
        border-bottom: 1px solid var(--app-border);
    }
    .section-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 20px;
    }
    .section-heading h2 {
        margin: 8px 0;
    }
    .schedule-metrics {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        margin: 20px 0;
    }
    .schedule-metrics > div {
        display: grid;
        gap: 8px;
    }
    .schedule-metrics span {
        color: var(--app-muted);
        font-size: 13px;
    }
    .schedule-metrics strong {
        font-size: 20px;
        font-variant-numeric: tabular-nums;
    }
    .share-controls {
        display: flex;
        gap: 12px;
        align-items: flex-end;
        flex-wrap: wrap;
    }
    .share-controls .studio-field {
        min-width: 180px;
    }
    .selected-rivals {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        margin-top: 20px;
        font-size: 13px;
        color: var(--app-muted);
    }
    .share-selector fieldset {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        border: 0;
        padding: 8px 0;
        margin: 0;
    }
    .share-selector legend {
        position: absolute;
        clip-path: inset(50%);
        width: 1px;
        height: 1px;
        overflow: hidden;
    }
    .share-selector label {
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid var(--app-border);
        border-radius: 10px;
        padding: 12px;
        cursor: pointer;
        min-height: 48px;
        font-size: 14px;
    }
    .share-selector label:has(:checked) {
        border-color: var(--app-accent);
        background: var(--app-surface-muted);
    }
    .share-selector small {
        display: block;
        font-size: 12px;
        color: var(--app-muted);
    }
    .share-selector .unavailable {
        opacity: 0.65;
    }
    .artwork-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr));
        gap: 24px;
    }
    .artwork-panel {
        display: grid;
        gap: 12px;
        min-width: 0;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        padding: 16px;
        border-radius: 16px;
        align-content: start;
    }
    .artwork-panel :deep(.thumbnail-preview) {
        margin: auto;
    }
    .artwork-grid.wide-artwork {
        grid-template-columns: minmax(0, 1fr);
    }
    .artwork-panel > .p-button {
        justify-self: start;
    }
    .content-grid {
        margin-top: 24px;
        display: grid;
        gap: 20px;
    }
    .preset-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        margin-top: 20px;
        font-size: 13px;
    }
    .preset-row > span {
        color: var(--app-muted);
    }
    .preset-item {
        display: flex;
        align-items: center;
    }
    .preset-form {
        display: grid;
        gap: 12px;
    }
    .rival-dialog-options {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 20px 0;
    }
    .share-copy-notice {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        padding: 16px;
        border-radius: 12px;
        margin-top: 20px;
    }
    .share-copy-notice button {
        min-height: 44px;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        border: 0;
        border-radius: 8px;
        padding: 10px 14px;
        cursor: pointer;
    }
    .export-error {
        color: var(--p-red-600);
        margin-block: 20px;
    }
    .stock-loading {
        display: grid;
        gap: 20px;
    }
    .state {
        min-height: 50vh;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 16px;
        text-align: center;
    }
    @media (max-width: 900px) {
        .metric-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .stock-overview {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .stock-facts {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 767px) {
        .page-header {
            align-items: flex-start;
            gap: 12px;
            flex-direction: column;
        }
        .page-header > .p-button {
            width: 100%;
        }
        .stock-mark {
            width: 48px;
            height: 48px;
        }
        .stock-identity {
            gap: 12px;
        }
        .stock-identity h1 {
            font-size: 28px;
        }
        .stock-full-name {
            font-size: 14px;
        }
        .stock-overview {
            padding: 16px;
            gap: 20px 12px;
        }
        .stock-overview strong {
            font-size: 20px;
        }
        .stock-overview span {
            font-size: 12px;
        }
        .next-dividend {
            padding: 10px;
        }
        .next-dividend strong {
            font-size: 14px;
        }
        .stock-tabs-root :deep(.p-tab) {
            flex: 1;
            padding: 14px 8px;
            font-size: 14px;
        }
        .stock-section {
            padding: 20px 16px;
        }
        .stock-section h2 {
            font-size: 18px;
        }
        .metric-grid article {
            padding: 14px;
        }
        .metric-grid strong {
            font-size: 20px;
        }
        .stock-facts div {
            font-size: 14px;
        }
        .schedule-metrics {
            grid-template-columns: 1fr;
        }
        .schedule-metrics > div {
            display: flex;
            justify-content: space-between;
            gap: 16px;
        }
        .schedule-metrics strong {
            font-size: 16px;
        }
        .share-controls {
            align-items: stretch;
        }
        .share-controls .studio-field {
            width: 100%;
        }
        .share-selector label {
            width: 100%;
        }
        .section-heading > .p-button {
            width: 100%;
        }
        .artwork-panel {
            padding: 12px;
        }
        .stock-data-banner {
            font-size: 12px;
            gap: 8px;
        }
    }
</style>
