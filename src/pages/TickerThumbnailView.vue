<script setup>
    import { corporateActionReviewForPeriod } from '../../lib/corporate-action-review.js';
    import { inferSecurityType } from '../../lib/security-filters.js';
    import { isDelisted } from '../../lib/security-status.js';
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
    import SelectButton from 'primevue/selectbutton';
    import Select from 'primevue/select';
    import Checkbox from 'primevue/checkbox';
    import Tag from 'primevue/tag';
    import Message from 'primevue/message';
    import { useToast } from 'primevue/usetoast';
    import DividendSummaryThumbnail from '@/components/thumbnail/DividendSummaryThumbnail.vue';
    import DividendComparisonThumbnail from '@/components/thumbnail/DividendComparisonThumbnail.vue';
    import TossCommunityCopy from '@/components/thumbnail/TossCommunityCopy.vue';
    import RivalThumbnail from '@/components/thumbnail/RivalThumbnail.vue';
    import DividendCalendarThumbnail from '@/components/thumbnail/DividendCalendarThumbnail.vue';
    import DividendEntryEfficiencyThumbnail from '@/components/thumbnail/DividendEntryEfficiencyThumbnail.vue';
    import TrailingDividendThumbnail from '@/components/thumbnail/TrailingDividendThumbnail.vue';
    import { trailingDividendSummary } from '@/services/thumbnail/trailingDividendSummary.js';
    import ThumbnailPreview from '@/components/thumbnail/ThumbnailPreview.vue';
    import InfoHelp from '@/components/common/InfoHelp.vue';
    import StockDividendTrend from '@/components/stock/StockDividendTrend.vue';
    import StockDividendMetrics from '@/components/stock/StockDividendMetrics.vue';
    import StockFeedbackForm from '@/components/stock/StockFeedbackForm.vue';
    import StockPriceHistory from '@/components/stock/StockPriceHistory.vue';
    import AdminStockCollection from '@/components/stock/AdminStockCollection.vue';
    import StockIssuerAnnouncements from '@/components/stock/StockIssuerAnnouncements.vue';
    import StockCandlestickChart from '@/components/stock/StockCandlestickChart.vue';
    import {
        dividendMarketDate,
        shareMonthlyDividends,
    } from '@/services/thumbnail/monthlyDividends.js';
    import DividendReviewPrompt from '@/components/stock/DividendReviewPrompt.vue';
    import DividendRocHistory from '@/components/stock/DividendRocHistory.vue';
    import SecurityInsights from '@/components/thumbnail/SecurityInsights.vue';
    import OfficialFundData from '@/components/stock/OfficialFundData.vue';
    import { isOfficialFundConfigured } from '@/services/officialFundData.js';
    import { seedStockReference } from '@/services/dividendLedger.js';
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
    import { firebaseUser } from '@/services/firebaseClient.js';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
    import { dividendAvailability } from '../../lib/dividend-availability.js';
    import {
        artworkFilename,
        artworkSuffix,
        cardDimensions,
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
    const securityType = computed(() =>
        inferSecurityType(selectedInfo.value || {})
    );
    const candleState = ref(null);
    const historyCandleState = computed(() =>
        candleState.value?.symbol === selectedInfo.value?.symbol
            ? candleState.value
            : null
    );
    const selectedData = ref(null);
    const archived = computed(() => isDelisted(selectedInfo.value));
    const loading = ref(true);
    useFullscreenLoading(loading, '종목 정보를 불러오고 있습니다.');
    const error = ref('');
    const rivals = ref([]);
    const draftRivals = ref([]);
    const rivalPickerOpen = ref(false);
    const exporting = ref('');
    const exportError = ref('');
    const schedule = ref(null);
    // Legacy preset dimensions remain stored, while this screen always exports square cards.
    const selectedPresentation = computed(() => normalizeCardPresentation());
    const outputDimensions = computed(() =>
        cardDimensions(selectedPresentation.value)
    );
    const maxRivals = 3;
    const shareCopyReady = ref(false);
    const lastCopiedKind = ref('summary');
    const dataStatus = ref('fresh');
    const selectedTone = ref('informative');
    const packaging = ref(false);
    const outputBusy = computed(() => !!exporting.value || packaging.value);
    const presets = ref(loadLocalPresets());
    const selectedPresetId = ref('');
    const selectedPreset = computed(() =>
        presets.value.find((item) => item.id === selectedPresetId.value)
    );
    watch(
        presets,
        (items) => {
            if (!items.some((item) => item.id === selectedPresetId.value))
                selectedPresetId.value = items[0]?.id || '';
        },
        { immediate: true }
    );
    const inlineRival = ref('');

    const selectedCardKinds = ref(['summary']);
    const previewCardKind = ref('summary');
    const previewAllCards = ref(false);
    const shareDividendReady = computed(
        () =>
            dividendState.value === 'available' &&
            thumbnailData.value.hasDividend &&
            thumbnailData.value.currentDividendAmount > 0
    );
    const availableCards = computed(() =>
        archived.value || !shareDividendReady.value
            ? []
            : [
                  {
                      kind: 'summary',
                      label: '배당 요약',
                      description: '최신 1건 · 배당락일 기준',
                  },
                  {
                      kind: 'ttm-summary',
                      label: '12개월 배당 요약',
                      description: '12개월 합계 · 세전 연 배당률',
                  },
                  {
                      kind: 'comparison',
                      label: '배당 비교',
                      description: '같은 종목 · 직전·최신 배당 1건 비교',
                      disabled: Boolean(
                          thumbnailData.value.comparisonUnavailableReason
                      ),
                      disabledReason:
                          thumbnailData.value.comparisonUnavailableReason,
                  },
                  {
                      kind: 'rival',
                      label: '기초자산·종목 비교',
                      description: '공통 기간 · 배당 재투자 총수익 비교',
                      disabled:
                          !selectedInfo.value?.underlying || !comparison.value,
                      disabledReason: !selectedInfo.value?.underlying
                          ? '기초자산 연결 자료 없음'
                          : comparisonReviewMessage.value ||
                            '비교 데이터 확인 필요',
                  },
                  {
                      kind: 'calendar',
                      label: '배당 일정',
                      description: '배당락 · 지급 일정',
                  },
                  {
                      kind: 'entry-efficiency',
                      label: '과거 매수 시점별 배당률',
                      description: '표본별 기간 · 세후 배당금/매수가',
                  },
              ]
    );
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
        !archived.value &&
        shareDividendReady.value &&
        activeTab.value === 'share' &&
        (previewAllCards.value
            ? selectedCardKinds.value.includes(kind)
            : previewCardKind.value === kind) &&
        availableCards.value.some(
            (card) => card.kind === kind && !card.disabled
        );
    const today = () => new Date().toISOString().slice(0, 10);
    const nextDividend = computed(() => {
        if (archived.value) return null;
        const confirmed = schedule.value?.history
            ?.filter((event) => event.exDate >= today())
            .sort((a, b) => a.exDate.localeCompare(b.exDate))[0];
        if (confirmed) return { date: confirmed.exDate, confirmed: true };
        const forecast = schedule.value?.forecastExDate;
        return forecast && forecast >= today()
            ? { date: forecast, confirmed: false }
            : null;
    });
    const currentScheduleAmount = computed(() => {
        const event = schedule.value?.current;
        const value = event?.amount;
        if (value == null || value === '' || !Number.isFinite(Number(value)))
            return '미확인';
        return `${value} ${event.currency || selectedInfo.value?.currency || '통화 미확인'}`;
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
                stock_reference: 'Yahoo Finance · 참고',
                unavailable: '미확인',
            })[selectedData.value?.sourceStatus?.price] || '수집 시세'
    );
    const statusLabel = computed(() =>
        archived.value
            ? '상장폐지 · 과거 자료'
            : dataStatus.value === 'fresh'
              ? '최근 데이터'
              : dataStatus.value === 'stale'
                ? '갱신 지연 · 기준일 확인'
                : '일부 데이터 미확인'
    );
    const tabs = computed(() => [
        { id: 'details', label: '상세정보' },
        { id: 'prices', label: '시세정보' },
        ...(dividendState.value === 'none'
            ? []
            : [{ id: 'dividends', label: '배당정보' }]),
        ...(!archived.value ? [{ id: 'share', label: '공유정보' }] : []),
    ]);
    const activeTab = computed(() =>
        tabs.value.some((tab) => tab.id === route.query.tab)
            ? route.query.tab
            : 'details'
    );
    const selectTab = (id) =>
        router.replace({ query: { ...route.query, tab: id } });
    const openDividendFeedback = () => {
        document.getElementById('stock-feedback')?.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
        });
        window.setTimeout(
            () => document.getElementById('feedback-message')?.focus(),
            350
        );
    };
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
    const dividendReviewRows = computed(() =>
        (selectedData.value?.backtestData ?? [])
            .filter((row) => row.verificationStatus === 'needs_review')
            .sort((a, b) => b.date.localeCompare(a.date))
    );
    const dividendState = computed(() =>
        dividendAvailability({
            security: selectedInfo.value || {},
            sourceStatus: selectedData.value?.sourceStatus || {},
            history: historyRows.value,
        })
    );
    const dividendUnavailable = computed(
        () => dividendState.value === 'unavailable'
    );
    const trailingSummary = computed(() =>
        trailingDividendSummary(selectedData.value, selectedInfo.value, {
            today: dividendMarketDate(new Date(), selectedInfo.value?.currency),
        })
    );
    const trailingDividend = computed(() => trailingSummary.value.amount);
    const displayNumber = (value, digits = 2) =>
        value != null && Number.isFinite(Number(value))
            ? Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: digits,
              })
            : '미확인';
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

    const thumbnailData = computed(() => {
        const rows = dividendRows(selectedData.value?.backtestData);
        const current = rows.at(-1);
        const previous = rows.at(-2);
        const reviewBasis = Boolean(
            selectedData.value?.sourceStatus?.corporateActionReview
        );
        const comparisonReview = corporateActionReviewForPeriod(
            selectedData.value?.sourceStatus,
            previous?.date,
            current?.date,
            { includeStart: false }
        );
        const comparisonUnavailableReason = comparisonReview
            ? '분할·병합 보정 확인 필요'
            : !previous
              ? '직전 배당 데이터 확인 필요'
              : '';
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
        return {
            symbol:
                selectedInfo.value?.symbol ?? normalize(route.params.ticker),
            hasDividend: Boolean(current),
            referenceData: Boolean(current?.isReference),
            exDate: current?.date ?? null,
            previousExDate: previous?.date ?? null,
            currentDividendAmount: currentAmount,
            previousDividendAmount: previous ? previousAmount : null,
            comparisonUnavailableReason,
            dividendDifference:
                previous && !comparisonReview
                    ? currentAmount - previousAmount
                    : null,
            dividendChangePercent:
                previousAmount > 0 && !comparisonReview
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
            exDividendYield:
                validClose && !reviewBasis
                    ? (currentAmount / exClose) * 100
                    : null,
            previousExDividendYield:
                validPreviousClose && !reviewBasis
                    ? (previousAmount / prevClose) * 100
                    : null,
            afterTaxDividendYield:
                validClose && !reviewBasis
                    ? ((currentAmount * 0.85) / exClose) * 100
                    : null,
            previousAfterTaxDividendYield:
                validPreviousClose && !reviewBasis
                    ? ((previousAmount * 0.85) / prevClose) * 100
                    : null,
            monthlyTotals: shareMonthlyDividends(
                rows,
                dividendMarketDate(new Date(), selectedInfo.value?.currency),
                3
            ).map((row) => ({
                month: `${row.month.slice(2, 4)}.${row.month.slice(5, 7)}`,
                total: row.total,
                partial: row.partial,
            })),
        };
    });
    const stockShareText = computed(
        () =>
            `${selectedInfo.value?.symbol || ''} 종목 정보 · 최근 시세 ${displayNumber(selectedInfo.value?.price, 4)} ${selectedInfo.value?.currency || ''} · 기준 ${selectedData.value?.sourceStatus?.priceDate || '미확인'} · 토또부부 배당 스튜디오`
    );
    const shareText = computed(() =>
        archived.value
            ? `${selectedInfo.value.symbol} 상장폐지 · 과거 시세와 배당 이력 열람`
            : shareDividendReady.value
              ? createShareText(thumbnailData.value)
              : stockShareText.value
    );
    const cardMetricDefinition = (kind) =>
        ({
            summary:
                '최근 배당 1건 · 세후 금액은15% 원천징수 가정 · 해당 회차 기준 주가',
            'ttm-summary':
                '최근12개월 주당 세전 합계/기준 시세 · 전체 기간 완전성 확인',
            comparison:
                '같은 종목의 직전·최신 배당1건 비교 · 예상 세후는15% 원천징수 가정 · 연환산/TTM 지표 아님',
            rival: '동일 기초자산·공통 기간 · 초기$10,000·배당 재투자 총수익 비교',
            calendar: '배당락·지급·국내 입금 예상 일정 · 확정/추정/미확인 구분',
            'entry-efficiency': entryEfficiency.value?.available
                ? entryEfficiency.value.basis === 'since_launch'
                    ? '각 표본의 출시 이후 누적 세후 배당금/매수가 · 표본별 기간이 다르며 연환산하지 않음'
                    : '각 가상 매수일 직전12개월 세후 배당금/당시 종가 · 각 표본의 기간 기준'
                : '표본별 세후 배당금/매수가 · 기간/자료 완전성 미확인으로 수치 미표시',
        })[kind] || '지표 정의 미확인';
    const cardShareText = (kind) => {
        if (!shareDividendReady.value) return stockShareText.value;
        const text = createCardShareText(
            kind,
            kind === 'ttm-summary'
                ? trailingSummary.value
                : thumbnailData.value,
            {
                tone: selectedTone.value,
                sourceStatus: dataStatus.value,
                asOfDate: ['summary', 'ttm-summary'].includes(kind)
                    ? (selectedData.value?.sourceStatus?.priceDate ?? null)
                    : null,
            }
        );
        if (['summary', 'ttm-summary'].includes(kind)) return text;
        const priceDate =
            selectedData.value?.sourceStatus?.priceDate || '미확인';
        const period =
            kind === 'comparison'
                ? `배당락일: ${thumbnailData.value.previousExDate || '미확인'} → ${thumbnailData.value.exDate || '미확인'}`
                : kind === 'calendar'
                  ? `일정 화면 기준일: ${new Date().toISOString().slice(0, 10)}`
                  : kind === 'entry-efficiency'
                    ? `분석 기준일: ${entryEfficiency.value?.asOfDate || '미확인'} · 표본별 집계기간은 카드에 표시`
                    : `공통 비교기간: ${comparison.value?.startDate || '미확인'} ~ ${comparison.value?.endDate || '미확인'}`;
        return `${text}\n지표 기준: ${cardMetricDefinition(kind)}\n${period}\n가격 자료 기준일: ${priceDate}`;
    };
    const shareTitle = computed(() =>
        selectedInfo.value
            ? `${selectedInfo.value.symbol} 주식 상세정보 · 시세와 배당 | 토또부부 배당 스튜디오`
            : '토또부부 배당 스튜디오'
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
                content: computed(() =>
                    archived.value
                        ? ''
                        : `${apiOrigin || (typeof window === 'undefined' ? '' : window.location.origin)}/api/thumbnail-og?ticker=${encodeURIComponent(selectedInfo.value?.symbol ?? normalize(route.params.ticker))}`
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
        archived.value
            ? null
            : calculateEntryIncomeEfficiency(selectedData.value, {
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
    const comparisonReviewMessage = ref('');
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

    const addInlineRival = async () => {
        if (
            outputBusy.value ||
            rivals.value.length >= maxRivals ||
            !rivalOptions.value.some(
                (option) => option.value === inlineRival.value
            ) ||
            rivals.value.includes(inlineRival.value)
        )
            return;
        draftRivals.value = [...rivals.value, inlineRival.value];
        inlineRival.value = '';
        await confirmRivals();
    };
    const removeInlineRival = async (symbol) => {
        if (outputBusy.value) return;
        draftRivals.value = rivals.value.filter((rival) => rival !== symbol);
        await confirmRivals();
    };
    watch(
        () => selectedInfo.value?.symbol,
        () => {
            inlineRival.value = '';
        }
    );

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
        comparisonReviewMessage.value = '';
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
            seedStockReference(payload.ticker);
            selectedData.value = payload.ticker;
            dataStatus.value =
                payload.dataStatus ??
                payload.ticker.sourceStatus?.freshness ??
                'partial';
            trackAggregate('card_open', 'summary');
            const calculatedComparison =
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
            comparison.value = calculatedComparison?.available
                ? calculatedComparison
                : null;
            comparisonReviewMessage.value =
                calculatedComparison?.available === false
                    ? '분할·병합 보정 또는 데이터 충돌 확인 필요'
                    : '';
            const loadedSchedule = archived.value
                ? null
                : await loadDividendSchedule(
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
    function applyCollectedData(payload) {
        if (payload.ticker?.symbol !== selectedInfo.value?.symbol) return;
        seedStockReference(payload.ticker);
        selectedData.value = payload.ticker;
        selectedInfo.value = {
            ...selectedInfo.value,
            ...payload.ticker.tickerInfo,
        };
        dataStatus.value = payload.dataStatus;
        comparison.value = null;
        comparisonReviewMessage.value = '';
        candleState.value = null;
        schedule.value = null;
        loadDividendSchedule(selectedInfo.value.symbol, undefined, {
            force: true,
        })
            .then((value) => {
                if (payload.ticker.symbol === selectedInfo.value?.symbol)
                    schedule.value = value;
            })
            .catch(() => {});
    }
    const prepareExportDocument = (document, dimensions) => {
        document
            .querySelectorAll('.thumbnail-preview-artboard')
            .forEach((element) => {
                element.style.transform = 'none';
            });
        document.querySelectorAll('.thumbnail-preview').forEach((element) => {
            element.style.width = `${dimensions.width}px`;
            element.style.setProperty(
                'max-width',
                `${dimensions.width}px`,
                'important'
            );
            element.style.height = `${dimensions.height}px`;
        });
    };
    const captureArtwork = (element, presentation) => {
        const dimensions = cardDimensions(presentation);
        return html2canvas(element, {
            onclone: (document) => {
                prepareExportDocument(document, dimensions);
                // Reveal only the cloned panel so unchecked cards can be exported
                // without changing the viewer's selection or visible previews.
                const panel = document
                    .querySelector(
                        `[data-thumbnail-kind="${element.dataset.thumbnailKind}"]`
                    )
                    ?.closest('.artwork-panel');
                if (panel) panel.style.display = 'block';
            },
            useCORS: true,
            backgroundColor: '#ffffff',
            scale: 1,
            width: dimensions.width,
            height: dimensions.height,
            windowWidth: Math.max(1280, dimensions.width),
        });
    };
    const downloadArtwork = async (kind) => {
        if (
            archived.value ||
            !shareDividendReady.value ||
            outputBusy.value ||
            !availableCards.value.some(
                (card) => card.kind === kind && !card.disabled
            )
        )
            return;
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
                if (sequence === loadSequence) {
                    lastCopiedKind.value = kind;
                    shareCopyReady.value = true;
                }
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
    const copyShareText = async (kind = previewCardKind.value) => {
        try {
            await navigator.clipboard.writeText(cardShareText(kind));
            lastCopiedKind.value = kind;
            shareCopyReady.value = true;
            trackAggregate('share_copy', kind);
        } catch {
            exportError.value =
                '문구를 복사하지 못했습니다. 게시 문구에서 직접 선택해 복사해 주세요.';
        }
    };
    const downloadPublishPackage = async () => {
        if (archived.value || !shareDividendReady.value || outputBusy.value)
            return;
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
                    ...(kind === 'ttm-summary'
                        ? {
                              measurement: {
                                  kind: 'trailing-12-months',
                                  start: trailingSummary.value.start,
                                  end: trailingSummary.value.end,
                                  coverage: trailingSummary.value.status,
                                  currency: trailingSummary.value.currency,
                                  amount: trailingSummary.value.amount,
                                  yieldPercent:
                                      trailingSummary.value.yieldPercent,
                                  price: trailingSummary.value.price,
                                  priceDate: trailingSummary.value.priceDate,
                                  basis: 'ex-date; before-tax; no annualization',
                              },
                          }
                        : {}),
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
        presetError.value = '';
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
        if (archived.value || !shareDividendReady.value || outputBusy.value)
            return;
        selectedTone.value = preset.tone || 'informative';
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
    watch(availableCards, (cards) => {
        if (
            !cards.some(
                (card) => card.kind === previewCardKind.value && !card.disabled
            )
        )
            previewCardKind.value =
                cards.find((card) => !card.disabled)?.kind || 'summary';
    });
</script>

<template>
    <section class="ticker-thumbnail-page" :data-stitch-view="activeTab">
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
            <div class="stock-top-action-bar">
                <Button
                    label="검색으로 돌아가기"
                    icon="pi pi-arrow-left"
                    severity="secondary"
                    outlined
                    @click="backToSearch" />
            </div>
            <div class="stock-summary-card">
                <header class="page-header">
                    <div>
                        <div class="stock-identity">
                            <div>
                                <div class="stock-ticker-line">
                                    <h1>{{ selectedInfo.symbol }}</h1>
                                    <span class="stock-type-badge">{{
                                        securityType === 'etf'
                                            ? 'ETF'
                                            : '일반 주식'
                                    }}</span
                                    ><span class="stock-currency-badge">{{
                                        selectedInfo.currency || '통화 미확인'
                                    }}</span>
                                </div>
                                <p class="stock-full-name">
                                    {{
                                        selectedInfo.longName ||
                                        selectedInfo.koName
                                    }}<template v-if="securityType === 'etf'">
                                        ·
                                        {{
                                            selectedInfo.company ||
                                            '운용사 미확인'
                                        }}
                                        (ETF)</template
                                    >
                                </p>
                            </div>
                        </div>
                    </div>
                    <AdminStockCollection
                        v-if="!archived && isPortfolioAdmin(firebaseUser)"
                        :symbol="selectedInfo.symbol"
                        @collected="applyCollectedData" />
                    <Button
                        v-else-if="!archived && activeTab !== 'share'"
                        label="공유 카드 만들기"
                        icon="pi pi-share-alt"
                        severity="secondary"
                        outlined
                        @click="selectTab('share')" />
                </header>
                <Message v-if="archived" severity="warn" :closable="false">
                    <strong>상장폐지 · 과거 이력 열람</strong>
                    <p>신규 배당 추정·비교·카드 출력을 제공하지 않습니다.</p>
                    <p>{{ selectedInfo.listingStatus.reason }}</p>
                    <p>
                        {{
                            selectedInfo.listingStatus.officialVerified
                                ? '공식 공시 확인'
                                : '사용자 확인 · 공식 공시 미확인'
                        }}
                        · 확인일 {{ selectedInfo.listingStatus.checkedOn }}
                    </p>
                    <p v-if="selectedInfo.listingStatus.delistedOn">
                        상장폐지일 {{ selectedInfo.listingStatus.delistedOn }}
                    </p>
                    <p v-if="selectedInfo.listingStatus.lastTradingOn">
                        최종 거래일
                        {{ selectedInfo.listingStatus.lastTradingOn }}
                    </p>
                    <p v-if="selectedInfo.listingStatus.tradingHaltedOn">
                        거래중단일
                        {{ selectedInfo.listingStatus.tradingHaltedOn }}
                    </p>
                    <p v-if="selectedInfo.listingStatus.liquidatedOn">
                        청산일 {{ selectedInfo.listingStatus.liquidatedOn }}
                    </p>
                    <p v-if="selectedInfo.listingStatus.delistedOnNote">
                        {{ selectedInfo.listingStatus.delistedOnNote }}
                    </p>
                    <a
                        v-if="selectedInfo.listingStatus.source.url"
                        :href="selectedInfo.listingStatus.source.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ selectedInfo.listingStatus.source.reference }}</a
                    >
                    <p v-else>
                        {{ selectedInfo.listingStatus.source.reference }}
                    </p>
                </Message>
                <section class="stock-overview" aria-label="종목 핵심 지표">
                    <article>
                        <span
                            >{{ archived ? '마지막 보관 가격' : '최근 시세' }} ·
                            {{ selectedInfo.currency || '통화 미확인' }}</span
                        ><strong>{{
                            selectedInfo.price == null
                                ? '자료 없음'
                                : displayNumber(selectedInfo.price, 4)
                        }}</strong>
                        <small v-if="archived"
                            >기준일
                            {{
                                selectedData.sourceStatus?.priceDate || '미확인'
                            }}</small
                        >
                    </article>
                    <article>
                        <span>{{
                            archived ? '이전 보관 종가 대비' : '전일 종가 대비'
                        }}</span
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
                    <article v-if="!archived && dividendState === 'available'">
                        <span>최근 12개월 주당 배당금</span
                        ><strong>{{
                            trailingDividend == null
                                ? '전체 이력 확인 필요'
                                : displayNumber(trailingDividend, 4)
                        }}</strong
                        ><small
                            >{{ selectedInfo.currency }} ·
                            {{
                                trailingDividend == null
                                    ? '전체 이력 확인 필요'
                                    : '완전한 12개월 집계치'
                            }}</small
                        >
                    </article>
                    <article v-if="!archived && dividendState === 'available'">
                        <span>최근 12개월 배당률 · 세전</span
                        ><strong>{{
                            trailingDividend != null && selectedInfo.price > 0
                                ? `${displayNumber((trailingDividend / selectedInfo.price) * 100)}%`
                                : '전체 이력 확인 필요'
                        }}</strong>
                    </article>
                </section>
                <div class="stock-data-banner">
                    <span :class="dataStatus">{{ statusLabel }}</span
                    ><span
                        >시세 기준
                        {{ selectedData.sourceStatus?.priceDate || '미확인' }} ·
                        {{ sourceLabel }}</span
                    ><span v-if="dividendState !== 'none'"
                        >배당 기준 {{ historyRows[0]?.date || '미확인' }} · 공개
                        배당 원장</span
                    >
                    <button
                        v-if="!archived && dividendState === 'available'"
                        class="next-dividend"
                        @click="selectTab('dividends')">
                        <span
                            >다음 배당락일
                            <em v-if="nextDividend">{{
                                nextDividend.confirmed
                                    ? '공시 확정'
                                    : '주기 추정'
                            }}</em></span
                        ><strong
                            >{{
                                nextDividend?.date || '차기 공시 대기'
                            }}
                            →</strong
                        >
                    </button>
                    <button
                        type="button"
                        class="data-help-button"
                        aria-label="시세와 배당 데이터 안내"
                        aria-describedby="stock-data-help"
                        v-tooltip.top="{
                            value: '시세와 배당은 기준일이 다를 수 있으며 실시간 가격이 아닐 수 있습니다. 미확인은 0이 아닙니다. 12개월 전체 이력을 확인하지 못하면 연간 지표를 표시하지 않으며, 공시 전 일정은 최근 주기를 바탕으로 한 추정입니다.',
                            showDelay: 150,
                        }">
                        <i class="pi pi-question-circle" aria-hidden="true" />
                    </button>
                    <span id="stock-data-help" class="studio-sr-only">
                        시세와 배당은 기준일이 다를 수 있으며 실시간 가격이 아닐
                        수 있습니다. 미확인은 0이 아닙니다. 연간 지표는 12개월
                        전체 이력이 확인될 때만 표시합니다.
                    </span>
                </div>
            </div>
            <StockIssuerAnnouncements
                :announcements="selectedData?.issuerAnnouncements || []"
                :result="selectedData?.stockCollection || null" />
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
                        <div class="stock-detail-layout">
                            <div class="stock-detail-main">
                                <section
                                    v-if="activeTab === 'details'"
                                    class="stock-section">
                                    <h2>개요 및 기본 정보</h2>
                                    <p class="hint">
                                        시세 기준
                                        {{
                                            selectedData.sourceStatus
                                                .priceDate || '미확인'
                                        }}
                                        · 수집된 실제 이력 기준
                                    </p>
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
                                        <div v-if="securityType === 'etf'">
                                            <dt>운용사</dt>
                                            <dd>
                                                {{
                                                    selectedInfo.company ||
                                                    '미확인'
                                                }}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>시장 / 통화</dt>
                                            <dd>
                                                {{
                                                    selectedInfo.market ||
                                                    '미확인'
                                                }}
                                                /
                                                {{
                                                    selectedInfo.currency ||
                                                    '미확인'
                                                }}
                                            </dd>
                                        </div>
                                        <div v-if="securityType === 'etf'">
                                            <dt>기초자산</dt>
                                            <dd>
                                                {{
                                                    selectedInfo.underlying ||
                                                    '미확인'
                                                }}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>수집 시세 범위</dt>
                                            <dd>
                                                {{
                                                    priceRows.at(-1)?.date ||
                                                    '미확인'
                                                }}
                                                ~
                                                {{
                                                    priceRows[0]?.date ||
                                                    '미확인'
                                                }}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>시가총액</dt>
                                            <dd>
                                                {{
                                                    selectedInfo.marketCap ==
                                                    null
                                                        ? '미확인 (자료 확인 중)'
                                                        : displayNumber(
                                                              selectedInfo.marketCap,
                                                              0
                                                          )
                                                }}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>순자산가치 (NAV)</dt>
                                            <dd>
                                                미확인 · 공식 자료 확인 필요
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>총보수 (운용수수료)</dt>
                                            <dd>
                                                미확인 · 공식 자료 확인 필요
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>총 운용자산 (AUM)</dt>
                                            <dd>
                                                미확인 · 공식 자료 확인 필요
                                            </dd>
                                        </div>
                                    </dl>
                                    <p class="hint">
                                        수집 이력은 실제 보유 기간과 다를 수
                                        있습니다. 미확인 수치는 0으로 간주하지
                                        않습니다.
                                    </p>
                                </section>
                                <OfficialFundData
                                    v-if="
                                        activeTab === 'details' &&
                                        isOfficialFundConfigured()
                                    "
                                    :symbol="normalize(route.params.ticker)" />
                                <div
                                    v-if="!isOfficialFundConfigured()"
                                    class="stock-official-pending">
                                    <h3>공식 공시 및 운용 보고서</h3>
                                    <article>
                                        <strong>발행사 공식 공시 자료</strong>
                                        <p>
                                            공식 운용 자료 연결이 설정되지
                                            않았습니다. 등록된 공시와 수집
                                            상태는 상단 공시 안내에서 확인할 수
                                            있습니다.
                                        </p>
                                        <span
                                            >공식 공시 원문 확인 진입 · 자료
                                            연결 필요</span
                                        >
                                    </article>
                                    <article>
                                        <strong
                                            >ETF 포트폴리오 구성 및 보유
                                            자산</strong
                                        >
                                        <p>
                                            공식 운용 정보 및 보유자산 자료의
                                            연결을 확인하지 못했습니다.
                                        </p>
                                        <span
                                            >보유자산 요약 정보 · 자료 연결
                                            필요</span
                                        >
                                    </article>
                                </div>
                            </div>
                            <StockFeedbackForm
                                v-if="activeTab === 'details'"
                                :symbol="selectedInfo.symbol" />
                        </div> </TabPanel
                    ><TabPanel value="prices">
                        <section
                            v-if="activeTab === 'prices'"
                            class="stock-section">
                            <StockCandlestickChart
                                v-if="!archived"
                                :key="`${selectedInfo.symbol}:${selectedData.sourceStatus?.asOf || ''}`"
                                :symbol="selectedInfo.symbol"
                                :currency="selectedInfo.currency || ''"
                                :events="stockEvents"
                                @prices-state="candleState = $event" />
                            <div class="price-history">
                                <StockPriceHistory
                                    :symbol="selectedInfo.symbol"
                                    :events="[
                                        ...stockEvents,
                                        ...(historyCandleState?.payload
                                            ?.events || []),
                                    ]"
                                    :rows="priceRows"
                                    :candles="
                                        historyCandleState?.payload?.candles ||
                                        []
                                    "
                                    :loading="
                                        historyCandleState?.loading || false
                                    "
                                    :error="historyCandleState?.error || ''"
                                    :currency="selectedInfo.currency || 'USD'"
                                    :adjustment-basis="
                                        selectedData.sourceStatus
                                            ?.adjustmentBasis || ''
                                    " />
                            </div>
                        </section> </TabPanel
                    ><TabPanel value="dividends">
                        <section
                            v-if="activeTab === 'dividends'"
                            class="stock-section">
                            <Message
                                v-if="!archived && dividendUnavailable"
                                severity="warn"
                                :closable="false"
                                class="dividend-data-notice">
                                배당 정보 확인 중이며, 관련 사항을 의견으로 남겨
                                주시면 감사합니다.
                                <Button
                                    label="익명 요청·한마디 남기기"
                                    icon="pi pi-comment"
                                    text
                                    size="small"
                                    @click="openDividendFeedback" />
                            </Message>
                            <div
                                v-if="
                                    !archived && dividendState === 'available'
                                "
                                class="dividend-next">
                                <div class="section-heading">
                                    <div class="schedule-title">
                                        <h2>배당 일정</h2>
                                        <InfoHelp
                                            label="배당 일정 안내"
                                            text="공시 전 일정은 최근 주기를 바탕으로 한 추정치입니다. 증권사 입금일은 다를 수 있으며, 개인별 수령액은 보유 수량과 세금에 따라 다릅니다." />
                                    </div>
                                    <small>확인된 공시와 주기 추정 구분</small>
                                </div>
                                <div class="dividend-schedule-panels">
                                    <article
                                        class="recent-dividend-panel"
                                        aria-label="최근 확인 공시 배당">
                                        <Tag
                                            :value="
                                                schedule?.current
                                                    ? '최근 확인 공시'
                                                    : '확인된 공시 없음'
                                            "
                                            :severity="
                                                schedule?.current
                                                    ? 'success'
                                                    : 'secondary'
                                            " />
                                        <dl>
                                            <div>
                                                <dt>공시 배당락일</dt>
                                                <dd>
                                                    {{
                                                        schedule?.current
                                                            ?.exDate || '미확인'
                                                    }}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>주당 배당금 · 세전</dt>
                                                <dd
                                                    class="schedule-current-amount">
                                                    {{ currentScheduleAmount }}
                                                </dd>
                                            </div>
                                            <div>
                                                <dt>지급일</dt>
                                                <dd>
                                                    {{
                                                        schedule?.current
                                                            ?.payableDate ||
                                                        '미확인'
                                                    }}
                                                </dd>
                                            </div>
                                        </dl>
                                    </article>
                                    <article
                                        class="next-dividend-panel"
                                        aria-label="다음 배당 일정">
                                        <Tag
                                            :value="
                                                nextDividend?.confirmed
                                                    ? '다음 공시 확정'
                                                    : nextDividend
                                                      ? '다음 주기 추정'
                                                      : '다음 일정 미확인'
                                            "
                                            :severity="
                                                nextDividend?.confirmed
                                                    ? 'success'
                                                    : 'warn'
                                            " />
                                        <div>
                                            <span>다음 배당락일</span
                                            ><strong>{{
                                                nextDividend?.date ||
                                                '공시 대기'
                                            }}</strong>
                                        </div>
                                        <p>
                                            {{
                                                nextDividend?.confirmed
                                                    ? '확인된 공시 일정입니다. 실제 입금 처리 시점은 다를 수 있습니다.'
                                                    : nextDividend
                                                      ? '최근 주기로 추정한 배당락일이며 확정된 지급일이 아닙니다. 미래 배당금은 추정하지 않습니다.'
                                                      : '확인된 미래 공시나 유효한 주기 추정 일정이 없습니다. 미확인은 배당 0회를 뜻하지 않습니다.'
                                            }}
                                        </p>
                                    </article>
                                </div>
                                <p class="dividend-schedule-notice">
                                    공시 지급일과 증권사 입금 처리 시점은 다를
                                    수 있습니다.
                                </p>
                            </div>
                            <StockDividendTrend
                                v-if="dividendState === 'available'"
                                :rows="selectedData.backtestData || []"
                                :as-of="
                                    selectedData.sourceStatus?.priceDate ||
                                    today()
                                "
                                :currency="selectedInfo.currency || 'USD'" />
                        </section>
                        <DividendReviewPrompt
                            v-if="
                                activeTab === 'dividends' &&
                                isPortfolioAdmin(firebaseUser)
                            "
                            :symbol="selectedInfo.symbol"
                            :rows="dividendReviewRows"
                            :currency="selectedInfo.currency || 'USD'" />
                        <div
                            v-if="activeTab === 'dividends'"
                            class="stock-insights">
                            <SecurityInsights
                                :symbol="normalize(route.params.ticker)"
                                :security-type="securityType">
                                <template #summary="{ metrics }"
                                    ><StockDividendMetrics
                                        :metrics="metrics"
                                        :trailing="trailingSummary"
                                        :currency="selectedInfo.currency || ''"
                                /></template>
                                <template
                                    #history="{
                                        observations,
                                        loading: insightsLoading,
                                        failed,
                                    }">
                                    <DividendRocHistory
                                        :key="normalize(route.params.ticker)"
                                        :history="historyRows"
                                        :observations="observations"
                                        :currency="
                                            selectedInfo.currency || 'USD'
                                        "
                                        :loading="insightsLoading"
                                        :failed="failed" />
                                </template>
                            </SecurityInsights>
                        </div> </TabPanel
                    ><TabPanel v-if="!archived" value="share">
                        <DividendReviewPrompt
                            v-if="isPortfolioAdmin(firebaseUser)"
                            :symbol="selectedInfo.symbol"
                            :rows="dividendReviewRows"
                            :currency="selectedInfo.currency || 'USD'" />
                        <section class="share-workspace stock-section">
                            <Message
                                v-if="!shareDividendReady"
                                severity="info"
                                :closable="false">
                                <template v-if="dividendState === 'none'">
                                    무배당으로 확인된 종목입니다. 배당 카드는
                                    제공하지 않습니다.
                                </template>
                                <template v-else>
                                    표시할 배당 이력이 아직 연결되지 않았습니다.
                                    무배당을 의미하지 않습니다.
                                </template>
                                시세와 기본정보는 아래 종목 요약에서 확인할 수
                                있습니다.
                            </Message>
                            <article
                                v-if="!shareDividendReady"
                                class="stock-overview-share-card">
                                <span>{{
                                    selectedInfo.exchange || '거래소 미확인'
                                }}</span>
                                <h3>{{ selectedInfo.name }}</h3>
                                <strong>{{ selectedInfo.symbol }}</strong>
                                <dl>
                                    <div>
                                        <dt>최근 시세</dt>
                                        <dd>
                                            {{
                                                displayNumber(
                                                    selectedInfo.price,
                                                    4
                                                )
                                            }}
                                            {{ selectedInfo.currency }}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>전일 대비</dt>
                                        <dd>
                                            {{
                                                priceChange
                                                    ? `${priceChange.percent >= 0 ? '+' : ''}${displayNumber(priceChange.percent)}%`
                                                    : '미확인'
                                            }}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>시세 기준</dt>
                                        <dd>
                                            {{
                                                selectedData.sourceStatus
                                                    ?.priceDate || '미확인'
                                            }}
                                        </dd>
                                    </div>
                                </dl>
                                <Button
                                    label="종목 정보 문구 복사"
                                    icon="pi pi-copy"
                                    outlined
                                    @click="copyShareText()" />
                            </article>
                            <div class="share-editor">
                                <div class="share-preview-column">
                                    <section
                                        v-if="
                                            activeTab === 'share' &&
                                            shareDividendReady
                                        "
                                        class="share-selector">
                                        <div class="share-selector-heading">
                                            <h2>공유 카드 유형 선택</h2>
                                            <span
                                                >총
                                                {{ availableCards.length }}개
                                                템플릿</span
                                            >
                                        </div>
                                        <p class="hint">
                                            미리보기는 한 장, 체크박스는 ZIP
                                            포함 여부입니다. 다운로드는 개별
                                            저장합니다. 개인 보유 정보는
                                            포함하지 않습니다.
                                        </p>
                                        <fieldset>
                                            <legend>포함할 카드</legend>
                                            <div
                                                v-for="card in availableCards"
                                                :key="card.kind"
                                                class="card-choice"
                                                :class="{
                                                    unavailable: card.disabled,
                                                    'preview-selected':
                                                        !previewAllCards &&
                                                        previewCardKind ===
                                                            card.kind,
                                                }">
                                                <Button
                                                    class="card-preview-select"
                                                    :aria-label="`${card.label} 미리보기`"
                                                    :aria-pressed="
                                                        !previewAllCards &&
                                                        previewCardKind ===
                                                            card.kind
                                                    "
                                                    :disabled="
                                                        card.disabled ||
                                                        outputBusy
                                                    "
                                                    text
                                                    severity="secondary"
                                                    @click="
                                                        previewAllCards = false;
                                                        previewCardKind =
                                                            card.kind;
                                                    ">
                                                    <span
                                                        class="card-choice-title"
                                                        >{{ card.label }}
                                                        <small
                                                            class="card-choice-description"
                                                            >{{
                                                                card.description
                                                            }}</small
                                                        >
                                                        <small
                                                            v-if="card.disabled"
                                                            >{{
                                                                card.disabledReason ||
                                                                '비교 데이터 확인 필요'
                                                            }}</small
                                                        >
                                                    </span>
                                                </Button>
                                                <label
                                                    class="card-zip-toggle"
                                                    :for="`share-card-${card.kind}`">
                                                    <Checkbox
                                                        v-model="
                                                            selectedCardKinds
                                                        "
                                                        :input-id="`share-card-${card.kind}`"
                                                        :value="card.kind"
                                                        :aria-label="card.label"
                                                        :disabled="
                                                            outputBusy ||
                                                            card.disabled
                                                        " />
                                                    <span>ZIP</span>
                                                </label>
                                                <Button
                                                    v-tooltip.top="
                                                        `${card.label} PNG 다운로드`
                                                    "
                                                    :aria-label="`${card.label} PNG 다운로드`"
                                                    :title="`${card.label} PNG 다운로드`"
                                                    icon="pi pi-download"
                                                    class="card-download"
                                                    severity="secondary"
                                                    text
                                                    :loading="
                                                        exporting === card.kind
                                                    "
                                                    :disabled="
                                                        outputBusy ||
                                                        card.disabled
                                                    "
                                                    @click="
                                                        downloadArtwork(
                                                            card.kind
                                                        )
                                                    " />
                                            </div>
                                        </fieldset>
                                        <p
                                            v-if="!selectedExportKinds.length"
                                            class="hint">
                                            미리 볼 카드를 선택하세요.
                                        </p>
                                    </section>
                                    <section
                                        v-if="shareDividendReady"
                                        v-show="activeTab === 'share'"
                                        class="artwork-grid"
                                        :class="{
                                            'dividend-view':
                                                activeTab === 'dividends',
                                        }">
                                        <header class="share-preview-heading">
                                            <h2>카드 프리뷰 (Square 1:1)</h2>
                                            <span>720 × 720 px</span>
                                            <label
                                                class="all-previews-toggle"
                                                for="share-preview-all"
                                                ><Checkbox
                                                    v-model="previewAllCards"
                                                    :disabled="outputBusy"
                                                    input-id="share-preview-all"
                                                    binary />
                                                선택한 카드 모두 보기</label
                                            >
                                        </header>
                                        <p
                                            v-if="
                                                previewAllCards &&
                                                !selectedExportKinds.length
                                            "
                                            class="studio-empty">
                                            선택한 카드가 없습니다. ZIP에 포함할
                                            카드를 선택하거나 카드의 미리보기를
                                            여세요.
                                        </p>
                                        <article
                                            v-show="showCard('summary')"
                                            class="artwork-panel">
                                            <ThumbnailPreview
                                                :presentation="
                                                    selectedPresentation
                                                "
                                                ><DividendSummaryThumbnail
                                                    :data="thumbnailData"
                                                    data-thumbnail-kind="summary"
                                            /></ThumbnailPreview>
                                        </article>
                                        <article
                                            v-show="showCard('ttm-summary')"
                                            class="artwork-panel">
                                            <ThumbnailPreview
                                                :presentation="
                                                    selectedPresentation
                                                "
                                                ><TrailingDividendThumbnail
                                                    :data="trailingSummary"
                                            /></ThumbnailPreview>
                                        </article>
                                        <article
                                            v-show="showCard('comparison')"
                                            class="artwork-panel">
                                            <ThumbnailPreview
                                                :presentation="
                                                    selectedPresentation
                                                "
                                                ><DividendComparisonThumbnail
                                                    :data="thumbnailData"
                                                    data-thumbnail-kind="comparison"
                                            /></ThumbnailPreview>
                                        </article>
                                        <article
                                            v-if="selectedInfo.underlying"
                                            v-show="showCard('rival')"
                                            class="artwork-panel">
                                            <ThumbnailPreview
                                                :presentation="
                                                    selectedPresentation
                                                "
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
                                                    data-thumbnail-kind="rival"
                                            /></ThumbnailPreview>
                                        </article>
                                        <article
                                            v-show="showCard('calendar')"
                                            class="artwork-panel">
                                            <ThumbnailPreview
                                                :presentation="
                                                    selectedPresentation
                                                "
                                                ><DividendCalendarThumbnail
                                                    :data="{
                                                        ...schedule,
                                                        symbol: selectedInfo.symbol,
                                                    }"
                                                    data-thumbnail-kind="calendar"
                                            /></ThumbnailPreview>
                                        </article>
                                        <article
                                            v-show="
                                                showCard('entry-efficiency')
                                            "
                                            class="artwork-panel">
                                            <ThumbnailPreview
                                                :presentation="
                                                    selectedPresentation
                                                "
                                                ><DividendEntryEfficiencyThumbnail
                                                    :data="{
                                                        ...entryEfficiency,
                                                        symbol: selectedInfo.symbol,
                                                    }"
                                                    data-thumbnail-kind="entry-efficiency"
                                            /></ThumbnailPreview>
                                        </article>
                                        <div class="share-preview-actions">
                                            <Button
                                                v-if="!previewAllCards"
                                                label="현재 카드 PNG 다운로드"
                                                icon="pi pi-download"
                                                :disabled="
                                                    outputBusy ||
                                                    !availableCards.some(
                                                        (card) =>
                                                            card.kind ===
                                                                previewCardKind &&
                                                            !card.disabled
                                                    )
                                                "
                                                :loading="
                                                    exporting ===
                                                    previewCardKind
                                                "
                                                @click="
                                                    downloadArtwork(
                                                        previewCardKind
                                                    )
                                                " />
                                            <Button
                                                v-if="shareDividendReady"
                                                :label="`선택 카드 ZIP (${selectedExportKinds.length})`"
                                                :disabled="
                                                    outputBusy ||
                                                    !selectedExportKinds.length
                                                "
                                                icon="pi pi-box"
                                                :loading="packaging"
                                                @click="
                                                    downloadPublishPackage
                                                " />
                                        </div>
                                    </section>
                                </div>
                                <div class="share-editor-settings">
                                    <div
                                        v-if="shareDividendReady"
                                        class="share-controls">
                                        <h2>문구 톤 선택</h2>
                                        <div class="studio-field">
                                            <span id="share-tone-label"
                                                >게시 문구 톤</span
                                            ><SelectButton
                                                v-model="selectedTone"
                                                aria-labelledby="share-tone-label"
                                                :allow-empty="false"
                                                :disabled="outputBusy"
                                                :options="toneOptions"
                                                option-label="label"
                                                option-value="value" />
                                        </div>
                                        <article
                                            v-if="
                                                previewCardKind ===
                                                'ttm-summary'
                                            "
                                            class="ttm-share-copy">
                                            <h2>12개월 요약 게시 문구</h2>
                                            <pre>{{
                                                cardShareText('ttm-summary')
                                            }}</pre>
                                            <Button
                                                label="12개월 요약 문구 복사"
                                                icon="pi pi-copy"
                                                @click="
                                                    copyShareText('ttm-summary')
                                                " />
                                        </article>
                                        <article
                                            v-else-if="
                                                shareDividendReady &&
                                                previewCardKind !== 'summary'
                                            "
                                            class="card-share-copy">
                                            <header>
                                                <h2>
                                                    {{
                                                        availableCards.find(
                                                            (card) =>
                                                                card.kind ===
                                                                previewCardKind
                                                        )?.label
                                                    }}
                                                    게시 문구
                                                </h2>
                                                <span
                                                    >{{
                                                        cardShareText(
                                                            previewCardKind
                                                        ).length
                                                    }}자</span
                                                >
                                            </header>
                                            <p
                                                v-if="previewAllCards"
                                                class="hint">
                                                문구는 현재 선택한
                                                {{
                                                    availableCards.find(
                                                        (card) =>
                                                            card.kind ===
                                                            previewCardKind
                                                    )?.label
                                                }}
                                                카드 기준입니다.
                                            </p>
                                            <pre>{{
                                                cardShareText(previewCardKind)
                                            }}</pre>
                                            <Button
                                                label="문구 복사"
                                                icon="pi pi-copy"
                                                :disabled="outputBusy"
                                                @click="
                                                    copyShareText(
                                                        previewCardKind
                                                    )
                                                " />
                                        </article>
                                        <TossCommunityCopy
                                            v-else-if="shareDividendReady"
                                            :data="thumbnailData"
                                            :tone="selectedTone" />
                                    </div>
                                    <section
                                        v-if="shareDividendReady"
                                        class="share-auxiliary-panel share-rival-settings">
                                        <header>
                                            <h2>비교 대상 종목 설정</h2>
                                            <span
                                                >{{ rivals.length }} /
                                                {{ maxRivals }}개 선택</span
                                            >
                                        </header>
                                        <p class="hint">
                                            같은 기초자산으로 등록된 후보만
                                            선택할 수 있습니다.
                                        </p>
                                        <div class="share-setting-row">
                                            <Select
                                                v-model="inlineRival"
                                                :options="
                                                    rivalOptions.filter(
                                                        (option) =>
                                                            !rivals.includes(
                                                                option.value
                                                            )
                                                    )
                                                "
                                                option-label="label"
                                                option-value="value"
                                                input-id="share-rival-candidate"
                                                append-to="self"
                                                :pt="{
                                                    overlay: {
                                                        style: {
                                                            minWidth: '100%',
                                                            maxWidth: '100%',
                                                        },
                                                    },
                                                }"
                                                aria-label="비교 종목 후보"
                                                placeholder="비교 종목 선택"
                                                :disabled="
                                                    outputBusy ||
                                                    !rivalOptions.length ||
                                                    rivals.length >= maxRivals
                                                " />
                                            <Button
                                                label="추가"
                                                :disabled="
                                                    outputBusy ||
                                                    !inlineRival ||
                                                    rivals.length >= maxRivals
                                                "
                                                @click="addInlineRival" />
                                        </div>
                                        <div
                                            v-if="rivals.length"
                                            class="selected-rivals">
                                            <span
                                                v-for="rival in rivals"
                                                :key="rival"
                                                class="share-rival-chip"
                                                >{{ rival
                                                }}<Button
                                                    :aria-label="`${rival} 비교 제외`"
                                                    icon="pi pi-times"
                                                    text
                                                    severity="secondary"
                                                    :disabled="outputBusy"
                                                    @click="
                                                        removeInlineRival(rival)
                                                    "
                                            /></span>
                                        </div>
                                        <p
                                            v-if="!rivalOptions.length"
                                            class="hint">
                                            {{
                                                selectedInfo.underlying
                                                    ? '같은 기초자산으로 등록된 비교 후보가 없습니다.'
                                                    : '연결된 기초자산 정보가 없어 비교 후보를 제공하지 않습니다.'
                                            }}
                                        </p>
                                        <Button
                                            v-if="
                                                selectedInfo.underlying &&
                                                rivalOptions.length
                                            "
                                            label="비교 종목 선택"
                                            icon="pi pi-sliders-h"
                                            outlined
                                            severity="secondary"
                                            :disabled="outputBusy"
                                            @click="openRivalPicker" />
                                    </section>
                                    <section
                                        v-if="shareDividendReady"
                                        class="share-auxiliary-panel share-export-settings">
                                        <header>
                                            <h2>카드 설정 프리셋</h2>
                                            <span>로컬 브라우저 저장</span>
                                        </header>
                                        <p class="hint">
                                            선택한 종목·카드·문구 톤을 이
                                            브라우저에 저장합니다.
                                        </p>
                                        <form
                                            class="share-setting-row"
                                            @submit.prevent="saveCurrentPreset">
                                            <InputText
                                                v-model="presetName"
                                                aria-label="프리셋 이름"
                                                maxlength="40"
                                                placeholder="프리셋 이름 (최대 40자)"
                                                :invalid="!!presetError"
                                                :disabled="outputBusy" />
                                            <Button
                                                type="submit"
                                                label="프리셋 저장"
                                                :disabled="outputBusy" />
                                        </form>
                                        <Message
                                            v-if="
                                                presetError && !presetDialogOpen
                                            "
                                            severity="warn"
                                            :closable="false"
                                            >{{ presetError }}</Message
                                        >
                                        <label for="share-preset-choice"
                                            >저장된 프리셋 불러오기</label
                                        >
                                        <div
                                            class="share-setting-row share-preset-load">
                                            <Select
                                                v-model="selectedPresetId"
                                                :options="presets"
                                                option-label="name"
                                                option-value="id"
                                                input-id="share-preset-choice"
                                                append-to="self"
                                                :pt="{
                                                    overlay: {
                                                        style: {
                                                            minWidth: '100%',
                                                            maxWidth: '100%',
                                                        },
                                                    },
                                                }"
                                                aria-label="저장된 프리셋 불러오기"
                                                placeholder="저장된 프리셋 없음"
                                                :disabled="
                                                    outputBusy ||
                                                    !presets.length
                                                " />
                                            <Button
                                                label="적용"
                                                :disabled="
                                                    outputBusy ||
                                                    !selectedPreset
                                                "
                                                @click="
                                                    selectedPreset &&
                                                    openPreset(selectedPreset)
                                                " />
                                            <Button
                                                icon="pi pi-trash"
                                                aria-label="선택한 프리셋 삭제"
                                                outlined
                                                severity="secondary"
                                                :disabled="
                                                    outputBusy ||
                                                    !selectedPreset
                                                "
                                                @click="
                                                    selectedPreset &&
                                                    deletePreset(selectedPreset)
                                                " />
                                        </div>
                                        <p class="hint">
                                            로컬 {{ presets.length }}건 · 자동
                                            저장 및 SNS 자동 게시 없음
                                        </p>
                                        <Button
                                            label="프리셋 저장 대화상자"
                                            text
                                            severity="secondary"
                                            :disabled="outputBusy"
                                            @click="openPresetDialog" />
                                        <p class="hint">
                                            출력 크기
                                            {{ outputDimensions.width }} ×
                                            {{ outputDimensions.height }}px ·
                                            정사각형 카드로 저장됩니다.
                                        </p>
                                    </section>
                                </div>
                            </div>
                        </section>

                        <p v-if="exportError" class="export-error" role="alert">
                            {{ exportError }}
                        </p>
                        <div v-if="shareCopyReady" class="share-copy-notice">
                            <span>{{
                                shareDividendReady
                                    ? '선택한 카드의 문구가 복사되었습니다. 토스·카카오톡에 바로 붙여넣으세요.'
                                    : '종목 정보 문구가 복사되었습니다.'
                            }}</span
                            ><button
                                type="button"
                                @click="copyShareText(lastCopiedKind)">
                                이미지 공유용 문구 복사
                            </button>
                        </div>
                        <section
                            v-if="activeTab === 'share' && shareDividendReady"
                            class="content-grid">
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
            <StockFeedbackForm
                v-if="activeTab !== 'details'"
                :symbol="selectedInfo.symbol" />
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
                        {{ selectedInfo.symbol }} · 정사각형 · 720 × 720px ·
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
    .share-editor {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 24px;
        align-items: start;
    }
    .share-editor-settings {
        min-width: 0;
    }
    @media (max-width: 900px) {
        .share-editor {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    .card-choice {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .card-choice label {
        flex: 1;
    }
    .card-download {
        min-width: 44px;
        min-height: 44px;
        flex-shrink: 0;
    }

    .schedule-title {
        display: flex;
        align-items: center;
        gap: 4px;
    }
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
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
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
    .data-help-button {
        display: inline-grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid var(--app-border);
        border-radius: 50%;
        color: var(--app-muted);
        background: var(--app-surface);
        cursor: help;
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
    .metric-grid.without-dividends {
        grid-template-columns: repeat(2, minmax(0, 1fr));
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
    .dividend-schedule-panels {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
    .dividend-schedule-panels article {
        min-width: 0;
        padding: 20px;
        background: var(--app-bg);
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .dividend-schedule-panels :deep(.p-tag) {
        align-self: flex-start;
        font-size: 11px;
    }
    .dividend-schedule-panels dl {
        margin: 0;
        display: grid;
        gap: 8px;
    }
    .dividend-schedule-panels dl > div {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding: 4px 0;
    }
    .dividend-schedule-panels dt,
    .next-dividend-panel span {
        font-size: 14px;
        color: var(--app-muted);
    }
    .dividend-schedule-panels dd {
        margin: 0;
        font-size: 13px;
        font-family: 'JetBrains Mono', monospace;
        overflow-wrap: anywhere;
        text-align: right;
    }
    .dividend-schedule-panels .schedule-current-amount {
        font-size: 20px;
        font-weight: 700;
        color: var(--app-accent);
    }
    .next-dividend-panel strong {
        display: block;
        font-size: 24px;
        line-height: 32px;
        margin-top: 8px;
        font-family: 'JetBrains Mono', monospace;
    }
    .next-dividend-panel p,
    .dividend-schedule-notice {
        margin: 0;
        font-size: 12px;
        line-height: 18px;
        color: var(--app-muted);
    }
    .dividend-schedule-notice {
        padding: 14px;
        border-radius: 8px;
        background: var(--app-surface-muted);
        margin-top: 20px;
    }
    @media (max-width: 767px) {
        .dividend-schedule-panels {
            grid-template-columns: 1fr;
        }
        .dividend-schedule-panels article {
            padding: 16px;
        }
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
    .stock-overview-share-card {
        display: grid;
        gap: 12px;
        max-width: 620px;
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 18px;
        background: var(--app-surface-soft);
    }
    .stock-overview-share-card h3,
    .stock-overview-share-card dl,
    .stock-overview-share-card dd {
        margin: 0;
    }
    .stock-overview-share-card > strong {
        font-size: 1.75rem;
    }
    .stock-overview-share-card dl {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
    }
    .stock-overview-share-card dl > div {
        padding: 12px;
        border-radius: 12px;
        background: var(--app-surface);
    }
    .stock-overview-share-card dt {
        color: var(--app-muted);
        font-size: 0.8rem;
    }
    .stock-overview-share-card dd {
        margin-top: 6px;
        font-weight: 700;
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
    .share-preview-heading {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .share-preview-heading h2 {
        margin: 0;
        font-size: 16px;
    }
    .share-preview-heading span {
        color: var(--app-accent);
        background: var(--app-accent-light);
        padding: 2px 8px;
        border-radius: 4px;
        font:
            11px 'JetBrains Mono',
            monospace;
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
        width: 100%;
        max-width: 520px !important;
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

    /* Common stock layout; original detail/price card and breakpoint rules are applied below. */
    .stock-top-action-bar {
        display: flex;
        justify-content: space-between;
        margin-bottom: 20px;
    }
    .stock-summary-card {
        display: flex;
        flex-direction: column;
        gap: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 20px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
        margin-bottom: 20px;
    }
    .stock-summary-card .page-header {
        margin: 0;
        gap: 14px;
        align-items: flex-start;
    }
    .stock-identity {
        gap: 0;
    }
    .stock-ticker-line {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
    }
    .stock-identity h1 {
        font-size: 26px;
        font-weight: 800;
        letter-spacing: -0.02em;
    }
    .stock-type-badge,
    .stock-currency-badge {
        padding: 3px 8px;
        font-size: 12px;
        font-weight: 600;
        border-radius: 8px;
        background: var(--app-surface-muted);
        color: var(--app-muted);
    }
    .stock-type-badge {
        background: var(--app-accent-light);
        color: var(--app-accent);
        border: 1px solid color-mix(in srgb, var(--app-accent) 20%, transparent);
    }
    .stock-full-name {
        font-size: 14px;
        margin: 4px 0 0;
    }
    .stock-summary-card .stock-overview {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        padding: 16px;
        border-radius: 8px;
        background: var(--app-bg);
        border: 1px solid var(--app-border);
        margin: 0;
    }
    .stock-overview article {
        gap: 4px;
    }
    .stock-overview span {
        font-size: 12px;
    }
    .stock-overview strong {
        font-size: 20px;
        font-weight: 700;
    }
    .stock-overview :is(.price-up, .price-down) {
        font-size: 15px;
        font-weight: 600;
    }
    .stock-overview small {
        font-size: 11px;
        color: var(--app-muted);
    }
    .stock-data-banner {
        margin: 0;
        border-top: 1px solid var(--app-border);
        padding-top: 10px;
        gap: 10px;
        font-size: 12px;
    }
    .stock-data-banner .next-dividend {
        display: inline-flex;
        flex-direction: row;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--app-warning-light);
        color: var(--app-warning-text);
    }
    .stock-data-banner .next-dividend span,
    .stock-data-banner .next-dividend strong {
        font-size: 12px;
        color: inherit;
    }
    .stock-tabs-root {
        --p-tabs-tablist-background: transparent;
        --p-tabs-tab-background: transparent;
        --p-tabs-tabpanel-background: transparent;
        --p-tabs-tabpanel-padding: 20px 0 0;
    }
    .stock-tabs :deep(.p-tab) {
        min-height: 44px;
        padding: 0 20px;
        font-size: 15px;
    }
    @media (max-width: 768px) {
        .stock-tabs :deep(.p-tab) {
            flex: 1 0 auto;
            padding: 0 10px;
            font-size: 14px;
            justify-content: center;
        }
    }
    .stock-detail-layout {
        display: grid;
        grid-template-columns: 2fr 1fr;
        gap: 20px;
        align-items: start;
    }
    .stock-detail-main {
        min-width: 0;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 20px;
        background: var(--app-surface);
    }
    .stock-detail-main .stock-section {
        padding: 0;
        border: 0;
        box-shadow: none;
        background: transparent;
    }
    .stock-facts {
        display: grid;
        grid-template-columns: 1fr;
    }
    .stock-facts > div {
        display: grid;
        grid-template-columns: 160px minmax(0, 1fr);
        padding: 12px 0;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .stock-facts dt {
        color: var(--app-muted);
        font-size: 13px;
        font-weight: 500;
    }
    .stock-facts dd {
        margin: 0;
        font-size: 14px;
    }
    .stock-official-pending {
        display: grid;
        gap: 12px;
        margin-top: 20px;
    }
    .stock-official-pending h3 {
        font-size: 15px;
        margin: 0;
    }
    .stock-official-pending article {
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 14px;
        font-size: 13px;
    }
    .stock-official-pending article p {
        margin: 8px 0;
        color: var(--app-muted);
    }
    .stock-official-pending article span {
        color: var(--app-muted);
        font-size: 12px;
    }
    @media (max-width: 1024px) {
        .stock-detail-layout {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 768px) {
        .stock-summary-card {
            padding: 16px;
        }
        .stock-summary-card .stock-overview {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .stock-identity h1 {
            font-size: 22px;
        }
        .stock-detail-main {
            padding: 16px;
        }
        .stock-facts > div {
            grid-template-columns: 120px minmax(0, 1fr);
        }
    }

    /* CONTENT / Stock Prices, Stock Dividends and Stock Share. */
    .ticker-thumbnail-page[data-stitch-view='prices'] .stock-section {
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .ticker-thumbnail-page[data-stitch-view='prices']
        :deep(.stock-candlestick) {
        padding: 0;
        border: 0;
        background: transparent;
    }
    .ticker-thumbnail-page[data-stitch-view='prices'] :deep(.chart-heading h2) {
        font-size: 18px;
    }
    .ticker-thumbnail-page[data-stitch-view='prices'] :deep(.candle-plot) {
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 12px;
        box-sizing: border-box;
    }
    .ticker-thumbnail-page[data-stitch-view='prices']
        :deep(.chart-event circle.split) {
        fill: var(--app-warning);
    }
    .ticker-thumbnail-page[data-stitch-view='prices']
        :deep(.chart-event circle.split + text) {
        fill: var(--app-brand-brown);
    }
    .ticker-thumbnail-page[data-stitch-view='dividends'] .stock-section {
        padding: 0;
        border: 0;
        background: transparent;
    }
    .ticker-thumbnail-page[data-stitch-view='dividends'] .dividend-next {
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .ticker-thumbnail-page[data-stitch-view='dividends']
        :deep(.dividend-trend) {
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        margin: 20px 0;
    }
    .ticker-thumbnail-page[data-stitch-view='dividends'] .stock-insights {
        padding: 0;
        border: 0;
        background: transparent;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-workspace {
        border: 0;
        background: transparent;
        padding: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-selector {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 16px;
        background: var(--app-surface);
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-selector fieldset {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        border: 0;
        padding: 0;
        margin: 16px 0 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-choice {
        position: relative;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 12px;
        min-width: 0;
        flex-wrap: wrap;
        background: var(--app-surface-muted);
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-choice label {
        font-size: 13px;
        min-width: 0;
        width: 100%;
        border: 0;
        padding: 0 32px 0 0;
        border-radius: 0;
        gap: 8px;
        align-items: flex-start;
        background: transparent;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice
        .card-download {
        position: absolute;
        right: 0;
        top: 0;
        width: 44px;
        min-width: 44px;
        height: 44px;
        padding: 10px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice.preview-selected {
        background: var(--app-accent);
        border-color: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice.preview-selected
        :is(.card-choice-description, .card-download) {
        color: inherit;
    }
    .card-preview-select {
        margin-top: 6px;
        padding: 4px 0;
        font-size: 12px;
    }
    .all-previews-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--app-muted);
        font-size: 12px;
    }
    .card-choice-title {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .ticker-thumbnail-page[data-stitch-view='share'] .artwork-panel {
        border-radius: 12px;
        padding: 16px;
    }
    @media (max-width: 768px) {
        .ticker-thumbnail-page[data-stitch-view='prices'] .stock-section,
        .ticker-thumbnail-page[data-stitch-view='dividends'] .dividend-next,
        .ticker-thumbnail-page[data-stitch-view='dividends']
            :deep(.dividend-trend),
        .ticker-thumbnail-page[data-stitch-view='share'] .share-workspace {
            padding: 16px;
        }
        .ticker-thumbnail-page[data-stitch-view='share']
            .share-selector
            fieldset {
            grid-template-columns: repeat(3, minmax(0, 1fr));
        }
    }

    .stock-facts dd {
        text-align: left;
    }

    .ticker-thumbnail-page[data-stitch-view='share'] .share-editor {
        grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
        gap: 24px;
    }
    .share-selector-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .share-selector-heading span {
        font:
            11px 'JetBrains Mono',
            monospace;
        color: var(--app-muted);
    }
    .card-choice-title {
        display: grid;
        gap: 4px;
    }
    .card-choice-description {
        font:
            11px/1.4 'JetBrains Mono',
            monospace;
        color: var(--app-muted);
    }
    @media (max-width: 639px) {
        .ticker-thumbnail-page[data-stitch-view='share']
            .share-selector
            fieldset {
            grid-template-columns: 1fr;
        }
    }
    .share-preview-column {
        min-width: 0;
        display: grid;
        gap: 16px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-editor-settings {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-controls {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-editor-settings
        > :deep(.toss-community-copy) {
        min-width: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .artwork-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
    }
    @media (max-width: 1024px) {
        .ticker-thumbnail-page[data-stitch-view='share'] .share-editor {
            grid-template-columns: minmax(0, 1fr);
        }
    }
    /* Original d33c8e.../87cd20...: card22px; metrics4/2/1; facts become labelled cards <=1024px. */
    .ticker-thumbnail-page:is(
            [data-stitch-view='details'],
            [data-stitch-view='prices']
        )
        .stock-summary-card,
    .ticker-thumbnail-page[data-stitch-view='details'] .stock-detail-main,
    .ticker-thumbnail-page[data-stitch-view='prices'] .stock-section {
        padding: 22px;
    }
    /* d33c8e... section headings retain independent source sizes. */
    .ticker-thumbnail-page[data-stitch-view='details'] .stock-section h2 {
        font-size: 16px;
        line-height: 24px;
        margin-bottom: 14px;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        .stock-official-pending
        h3 {
        line-height: 22.5px;
    }
    .ticker-thumbnail-page[data-stitch-view='details'] .stock-facts > div {
        grid-template-columns: 32% minmax(0, 1fr);
        gap: 0;
        padding: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        .stock-facts
        :is(dt, dd) {
        padding: 12px 14px;
        font-size: 14px;
        font-weight: 500;
    }
    .ticker-thumbnail-page[data-stitch-view='details'] .stock-facts dt {
        background: var(--app-bg);
    }
    .ticker-thumbnail-page[data-stitch-view='details'] :deep(.stock-feedback) {
        padding: 22px;
        gap: 12px;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback h2) {
        font-size: 16px;
        line-height: 24px;
        margin-bottom: 14px;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback form) {
        gap: 6px;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback form label) {
        font-size: 13px;
        font-weight: 600;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback form label:not(:first-child)) {
        margin-top: 6px;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback .p-select),
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback .p-button) {
        height: 44px;
        font-size: 14px;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback .p-button) {
        font-weight: 600;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback .p-select-label) {
        padding: 0 12px;
        align-content: center;
        font-size: 14px;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.feedback-character-count) {
        font-size: 11px;
        line-height: 16.5px;
    }
    .ticker-thumbnail-page[data-stitch-view='details'] :deep(#feedback-help) {
        font-size: 11px;
        line-height: 1.35;
    }
    .ticker-thumbnail-page[data-stitch-view='details']
        :deep(.stock-feedback textarea) {
        font-size: 14px;
        height: 100px;
        min-height: 100px;
        padding: 10px 12px;
        resize: vertical;
    }
    @media (max-width: 1024px) {
        .ticker-thumbnail-page:is(
                [data-stitch-view='details'],
                [data-stitch-view='prices']
            )
            .stock-overview {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .ticker-thumbnail-page[data-stitch-view='details'] .stock-facts > div {
            display: block;
            margin-bottom: 12px;
            padding: 10px 14px;
            background: var(--app-bg);
            border: 1px solid var(--app-border);
            border-radius: 8px;
        }
        .ticker-thumbnail-page[data-stitch-view='details'] .stock-facts dt {
            padding: 0 0 4px;
            font-size: 12px;
        }
        .ticker-thumbnail-page[data-stitch-view='details'] .stock-facts dd {
            padding: 0;
            font-size: 14px;
            font-weight: 600;
        }
    }
    @media (max-width: 768px) {
        .ticker-thumbnail-page:is(
                [data-stitch-view='details'],
                [data-stitch-view='prices']
            )
            .stock-summary-card,
        .ticker-thumbnail-page[data-stitch-view='details'] .stock-detail-main,
        .ticker-thumbnail-page[data-stitch-view='details']
            :deep(.stock-feedback),
        .ticker-thumbnail-page[data-stitch-view='prices'] .stock-section {
            padding: 16px;
        }
        .ticker-thumbnail-page:is(
                [data-stitch-view='details'],
                [data-stitch-view='prices']
            )
            .stock-overview {
            grid-template-columns: 1fr;
        }
        .ticker-thumbnail-page:is(
                [data-stitch-view='details'],
                [data-stitch-view='prices']
            )
            .page-header {
            flex-direction: column;
            align-items: stretch;
        }
        .ticker-thumbnail-page:is(
                [data-stitch-view='details'],
                [data-stitch-view='prices']
            )
            .page-header
            > :deep(.p-button) {
            width: 100%;
            justify-content: center;
        }
        .ticker-thumbnail-page:is(
                [data-stitch-view='details'],
                [data-stitch-view='prices']
            )
            .stock-data-banner {
            flex-direction: column;
            align-items: flex-start;
        }
    }
    .ttm-share-copy {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        min-width: 0;
    }
    .ttm-share-copy h2 {
        margin: 0 0 12px;
        font-size: 16px;
    }
    .ttm-share-copy pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
        font-size: 14px;
        line-height: 1.6;
        margin-bottom: 16px;
    }

    @media (max-width: 1023px) {
        .ticker-thumbnail-page:is(
                [data-stitch-view='dividends'],
                [data-stitch-view='share']
            )
            .stock-overview {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 767px) {
        .ticker-thumbnail-page:is(
                [data-stitch-view='dividends'],
                [data-stitch-view='share']
            )
            .stock-summary-card {
            padding: 16px;
        }
        .ticker-thumbnail-page:is(
                [data-stitch-view='dividends'],
                [data-stitch-view='share']
            )
            .stock-overview {
            grid-template-columns: 1fr;
        }
        .ticker-thumbnail-page:is(
                [data-stitch-view='dividends'],
                [data-stitch-view='share']
            )
            .page-header {
            flex-direction: column;
            align-items: flex-start;
        }
    }

    /* Tailwind originals bd619d/2b8b6a: four separate metric tiles, sm640/lg1024. */
    .ticker-thumbnail-page:is(
            [data-stitch-view='dividends'],
            [data-stitch-view='share']
        )
        .stock-overview {
        padding: 0;
        border: 0;
        background: transparent;
    }
    .ticker-thumbnail-page:is(
            [data-stitch-view='dividends'],
            [data-stitch-view='share']
        )
        .stock-overview
        article {
        padding: 16px;
        border-radius: 8px;
        background: var(--app-surface-muted);
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .stock-overview {
        gap: 8px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .stock-overview article {
        padding: 12px;
        min-height: 92px;
    }
    @media (min-width: 640px) and (max-width: 1023px) {
        .ticker-thumbnail-page:is(
                [data-stitch-view='dividends'],
                [data-stitch-view='share']
            )
            .stock-overview {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    /* Content originals use different headline scales for these two tabs.
       Keep the shared identity/data; match each source's typography. */
    .ticker-thumbnail-page[data-stitch-view='dividends'] .stock-identity h1 {
        font-size: 36px;
        line-height: 44px;
        font-weight: 700;
        letter-spacing: -0.025em;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .stock-identity h1 {
        font-size: 24px;
        line-height: 32px;
        font-weight: 600;
        letter-spacing: -0.025em;
    }

    /* Phase19: source share-generator panels are independent surfaces. */
    .ticker-thumbnail-page[data-stitch-view='share'] .share-workspace {
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 0;
        border: 0;
        background: transparent;
        box-shadow: none;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-workspace
        > .section-heading {
        order: 1;
        margin: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-selector,
    .ticker-thumbnail-page[data-stitch-view='share'] .share-controls,
    .ticker-thumbnail-page[data-stitch-view='share'] .share-export-settings {
        padding: 24px;
        border: 0;
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 5%);
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-selector-heading h2,
    .ticker-thumbnail-page[data-stitch-view='share'] .share-controls > h2 {
        margin: 0;
        font-size: 16px;
        line-height: 24px;
        font-weight: 600;
        letter-spacing: normal;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-selector > .hint {
        margin: 8px 0 16px;
        font-size: 14px;
        line-height: 20px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-selector fieldset {
        margin: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-choice {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 44px;
        align-items: start;
        gap: 4px;
        border: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-choice label {
        grid-column: 1 / -1;
        padding: 0;
        font-size: 14px;
        line-height: 20px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-choice-description {
        font:
            400 12px/16px 'Hanken Grotesk',
            sans-serif;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice
        .card-download {
        position: static;
        padding: 10px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-preview-select {
        justify-content: flex-start;
        margin: 0;
        min-height: 44px;
        min-width: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-preview-column,
    .ticker-thumbnail-page[data-stitch-view='share'] .share-editor-settings {
        gap: 24px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-controls {
        display: grid;
        gap: 16px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-controls
        .studio-field {
        min-width: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-controls
        :deep(.p-selectbutton) {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-controls
        :deep(.p-togglebutton) {
        min-width: 0;
        height: 44px;
        padding: 0 8px;
        border-radius: 8px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-controls
        :deep(.toss-copy) {
        border: 0;
        padding: 0;
        box-shadow: none;
        border-radius: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-export-settings {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
    }
    @media (max-width: 767px) {
        .ticker-thumbnail-page[data-stitch-view='share'] .share-selector,
        .ticker-thumbnail-page[data-stitch-view='share'] .share-controls,
        .ticker-thumbnail-page[data-stitch-view='share']
            .share-export-settings {
            padding: 16px;
        }
    }
    /* Original lg breakpoint is1024 inclusive; retain three choices from640px. */
    @media (min-width: 1024px) {
        .ticker-thumbnail-page[data-stitch-view='share'] .share-editor {
            grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
        }
    }

    .ticker-thumbnail-page[data-stitch-view='share'] .card-choice {
        display: block;
        padding: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-preview-select {
        display: flex;
        width: 100%;
        min-height: 88px;
        padding: 12px 48px 12px 12px;
        text-align: left;
        border-radius: 8px;
        white-space: normal;
        color: inherit;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .card-choice-title {
        font-size: 14px;
        line-height: 20px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice
        .card-zip-toggle {
        position: absolute;
        top: 0;
        right: 0;
        width: 44px;
        min-height: 44px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0;
        padding: 0;
    }
    .card-zip-toggle > span {
        font-size: 9px;
        line-height: 12px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice
        .card-download {
        position: absolute;
        top: auto;
        bottom: 0;
        right: 0;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .artwork-grid {
        padding: 24px;
        background: var(--app-surface);
        border-radius: 12px;
        box-shadow: 0 1px 3px rgb(0 0 0 / 5%);
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .artwork-panel {
        padding: 0;
        border: 0;
        background: transparent;
    }
    @media (max-width: 767px) {
        .ticker-thumbnail-page[data-stitch-view='share'] .artwork-grid {
            padding: 16px;
        }
    }

    /* Measured source tokens: space-lg16px, space-md12px, gutter-lg24px. */
    .ticker-thumbnail-page[data-stitch-view='share'] .share-selector,
    .ticker-thumbnail-page[data-stitch-view='share'] .share-controls,
    .ticker-thumbnail-page[data-stitch-view='share'] .share-export-settings,
    .ticker-thumbnail-page[data-stitch-view='share'] .artwork-grid {
        padding: 16px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-preview-column,
    .ticker-thumbnail-page[data-stitch-view='share'] .share-editor-settings {
        gap: 16px;
    }
    .share-preview-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
    }
    .share-preview-actions > .p-button {
        flex: 1 1 180px;
        min-height: 44px;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] #share-tone-label {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-controls
        :deep(.p-togglebutton) {
        font-size: 12px;
        line-height: 16px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-controls
        :deep(.toss-copy) {
        font-size: 12px;
        line-height: 20px;
    }
    .ticker-thumbnail-page[data-stitch-view='share']
        .share-controls
        :deep(.toss-copy h2) {
        font-size: 14px;
        line-height: 20px;
    }
    @media (max-width: 767px) {
        .ticker-thumbnail-page[data-stitch-view='share'] .share-selector,
        .ticker-thumbnail-page[data-stitch-view='share'] .share-controls,
        .ticker-thumbnail-page[data-stitch-view='share'] .share-export-settings,
        .ticker-thumbnail-page[data-stitch-view='share'] .artwork-grid {
            padding: 12px;
        }
    }

    .ticker-thumbnail-page[data-stitch-view='share'] .share-auxiliary-panel {
        display: grid;
        gap: 12px;
        min-width: 0;
        padding: 16px;
        border: 0;
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 5%);
    }
    .share-auxiliary-panel > header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .share-auxiliary-panel h2 {
        margin: 0;
        font:
            600 16px/24px 'Hanken Grotesk',
            sans-serif;
        letter-spacing: normal;
    }
    .share-auxiliary-panel > header > span,
    .share-auxiliary-panel > label {
        color: var(--app-muted);
        font-size: 12px;
    }
    .share-auxiliary-panel .hint {
        margin: 0;
        font-size: 12px;
        line-height: 18px;
    }
    .share-setting-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        min-width: 0;
    }
    .share-setting-row .p-inputtext,
    .share-setting-row .p-select {
        min-width: 0;
        width: 100%;
    }
    .share-preset-load {
        grid-template-columns: minmax(0, 1fr) auto auto;
    }
    .share-rival-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding-left: 12px;
        border-radius: 8px;
        background: var(--app-surface-muted);
    }
    .share-rival-chip .p-button {
        min-width: 36px;
        min-height: 36px;
        height: 36px;
        padding: 8px;
    }
    @media (max-width: 767px) {
        .ticker-thumbnail-page[data-stitch-view='share']
            .share-auxiliary-panel {
            padding: 12px;
        }
    }
    @media (min-width: 1024px) {
        .ticker-thumbnail-page[data-stitch-view='share'] .share-editor {
            grid-template-columns: repeat(12, minmax(0, 1fr));
        }
        .ticker-thumbnail-page[data-stitch-view='share'] .share-preview-column {
            grid-column: span 7;
        }
        .ticker-thumbnail-page[data-stitch-view='share']
            .share-editor-settings {
            grid-column: span 5;
        }
    }

    .card-share-copy {
        display: grid;
        gap: 12px;
    }
    .card-share-copy > header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .card-share-copy h2 {
        margin: 0;
        font-size: 14px;
        line-height: 20px;
        letter-spacing: normal;
    }
    .card-share-copy > header > span {
        color: var(--app-muted);
        font-size: 12px;
    }
    .card-share-copy pre {
        margin: 0;
        padding: 12px;
        border-radius: 12px;
        background: var(--app-surface-muted);
        color: var(--app-text);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font: inherit;
        font-size: 12px;
        line-height: 1.625;
    }
    .card-share-copy > .p-button {
        justify-self: end;
        min-height: 44px;
        padding: 0 20px;
        border: 0;
        background: var(--app-surface);
        color: var(--app-accent);
        box-shadow: 0 1px 3px rgb(0 0 0 / 5%);
    }
    /* The text-button hover surface must not cover the selected teal tile. */
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice.preview-selected
        .card-preview-select,
    .ticker-thumbnail-page[data-stitch-view='share']
        .card-choice.preview-selected
        .card-preview-select:is(:hover, :focus-visible, :active) {
        background: transparent;
        color: var(--app-accent-contrast);
        transition: none;
    }
    .ticker-thumbnail-page[data-stitch-view='share'] .share-preview-heading h2 {
        font-size: 16px;
        line-height: 24px;
        font-weight: 600;
    }
</style>
