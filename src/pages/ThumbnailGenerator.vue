<!-- src/pages/ThumbnailGenerator.vue -->
<script setup>
    import { ref, onMounted, computed, watch } from 'vue';
    import { useHead } from '@vueuse/head';
    import { useRouter } from 'vue-router';
    import html2canvas from 'html2canvas';
    import JSZip from 'jszip';
    import ThumbnailItem from '@/components/thumbnail/ThumbnailItem.vue';
    import GroupItem from '@/components/thumbnail/GroupItem.vue';
    import { useFilterState } from '@/composables/portfolio/useFilterState';

    import Button from 'primevue/button';
    import ProgressSpinner from 'primevue/progressspinner';
    import Checkbox from 'primevue/checkbox';
    import InputText from 'primevue/inputtext';
    import SelectButton from 'primevue/selectbutton';
    import { getAssetUrl, getDataUrl, getR2Url } from '@/utils/dataUrl';

    useHead({
        title: '썸네일 일괄 생성기',
        meta: [{ name: 'robots', content: 'noindex, nofollow' }],
        link: [
            { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
            {
                rel: 'preconnect',
                href: 'https://fonts.gstatic.com',
                crossorigin: true,
            },
            {
                href: 'https://fonts.googleapis.com/css2?family=Bungee&display=swap',
                rel: 'stylesheet',
            },
        ],
    });

    const { myBookmarks, isBookmarksLoading } = useFilterState(); // [수정] isBookmarksLoading 추가
    const router = useRouter();

    const allThumbnailsData = ref([]);
    // const selectedThumbnails = ref([]); // [삭제] 개별 선택 방식 제거
    // [수정] isLoading 초기값은 isBookmarksLoading과 연동되도록 설정
    const isLoading = ref(true);
    const isDownloading = ref(false);
    const isSyncing = ref(false); // [신규] 데이터 동기화 로딩 상태
    const includeChart = ref(true); // [신규] 차트 포함 여부 (기본값 true)
    const date = ref('');
    const groups = ref(['All']);
    const selectedGroup = ref('All');

    const backgroundOptions = ref([
        { name: 'Blue', path: '/thumbnail/blue.png', tickerColor: '#6ffc04' },
        { name: 'Gray', path: '/thumbnail/gray.png', tickerColor: '#ffd700' },
        { name: 'Red', path: '/thumbnail/red.png', tickerColor: '#ffd700' },
    ]);

    // [신규] 종목별 data 파일을 캐싱하기 위한 Map
    const tickerDataCache = new Map();
    // nav.json의 티커별 dataPath 캐싱
    const navDataCache = ref(null);

    const filteredThumbnails = computed(() => {
        if (selectedGroup.value === 'All') {
            return allThumbnailsData.value;
        }
        return allThumbnailsData.value.filter(
            (t) => t.group === selectedGroup.value
        );
    });

    /*
const isAllSelected = computed({
    get: () =>
        filteredThumbnails.value.length > 0 &&
        selectedThumbnails.value.length === filteredThumbnails.value.length,
    set: (value) => {
        const filteredSymbols = filteredThumbnails.value.map(
            (t) => t.symbol
        );
        if (value) {
            selectedThumbnails.value = [
                ...new Set([
                    ...selectedThumbnails.value,
                    ...filteredSymbols,
                ]),
            ];
        } else {
            selectedThumbnails.value = selectedThumbnails.value.filter(
                (s) => !filteredSymbols.includes(s)
            );
        }
    },
});

watch(selectedGroup, () => {
    isAllSelected.value = true;
});
*/

    // 차트 포함 옵션이 변경되면 데이터를 다시 동기화
    watch(includeChart, async () => {
        if (date.value) {
            await syncDividendData();
        }
    });

    const formatCurrentAmount = (amount) => {
        const amountStr = String(amount);
        const parts = amountStr.split('.');
        if (parts.length < 2) return Number(amountStr).toFixed(4);
        const decimalPart = parts[1];
        if (decimalPart.length < 4) return Number(amountStr).toFixed(4);
        return amountStr;
    };

    // [신규] YY. MM. DD 형식의 날짜를 YYYY-MM-DD로 변환하는 헬퍼 함수
    const parseDateInput = (input) => {
        const parts = input.split('.').map((s) => s.trim());
        if (parts.length !== 3) return null;
        const year = `20${parts[0]}`;
        const month = parts[1].padStart(2, '0');
        const day = parts[2].padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // nav.json 로드 및 캐싱
    const loadNavData = async () => {
        if (navDataCache.value) return navDataCache.value;
        try {
            const navUrl = getDataUrl('nav.json') + `?t=${new Date().getTime()}`;
            const navResponse = await fetch(navUrl);
            if (!navResponse.ok) {
                console.error('Failed to load nav.json');
                return null;
            }
            navDataCache.value = await navResponse.json();
            return navDataCache.value;
        } catch (e) {
            console.error('Failed to load nav.json', e);
            return null;
        }
    };

    // 티커 심볼로 dataPath 찾기
    const getDataPathForSymbol = (navData, symbol) => {
        if (!navData || !navData.nav) return null;
        const sanitizeTicker = (ticker) =>
            ticker ? ticker.replace(/\./g, '-').toLowerCase() : '';
        const sanitizedSymbol = sanitizeTicker(symbol);

        const navInfo = navData.nav.find(
            (item) =>
                sanitizeTicker(item.symbol) === sanitizedSymbol ||
                sanitizeTicker(item.yfSymbol || '') === sanitizedSymbol
        );

        return navInfo?.dataPaths?.[0] || null;
    };

    // [신규] 분할 정보를 바탕으로 과거 데이터 보정
    const applySplits = (backtestData, splits) => {
        if (!splits || splits.length === 0) return backtestData;

        // 원본 데이터 보존을 위해 깊은 복사
        let adjustedData = JSON.parse(JSON.stringify(backtestData));

        splits.forEach((split) => {
            const splitDate = new Date(split.date);
            const [numerator, denominator] = split.ratio.split(':').map(Number);
            // 1:10 (Reverse Split) -> factor = 10
            // 10:1 (Forward Split) -> factor = 0.1
            const factor = denominator / numerator;

            adjustedData.forEach((item) => {
                const itemDate = new Date(item.date);
                if (itemDate < splitDate) {
                    if (item.amount !== undefined) item.amount *= factor;
                    if (item.amountFixed !== undefined)
                        item.amountFixed *= factor;
                    if (item.open !== undefined) item.open *= factor;
                    if (item.high !== undefined) item.high *= factor;
                    if (item.low !== undefined) item.low *= factor;
                    if (item.close !== undefined) item.close *= factor;
                }
            });
        });

        return adjustedData;
    };

    // [핵심 기능] 날짜 기준으로 배당금 데이터를 동기화하는 함수
    const syncDividendData = async () => {
        // navDataCache가 없으면 실행하지 않음 (로드될 때까지 대기)
        if (!navDataCache.value) return;

        isSyncing.value = true;
        const targetDate = parseDateInput(date.value);
        if (!targetDate) {
            // alert('날짜 형식이 올바르지 않습니다. (예: 24. 10. 20)'); // 초기 자동실행 시 알림 방지
            isSyncing.value = false;
            return;
        }

        const navData = navDataCache.value;

        const updatedThumbnails = await Promise.all(
            allThumbnailsData.value.map(async (thumb) => {
                // Group 타입은 배당금 동기화 불필요
                if (thumb.type === 'Group') {
                    return { ...thumb };
                }

                const symbol = thumb.symbol;
                let cachedData = tickerDataCache.get(symbol);
                let backtestData = [];
                let tickerInfo = null;

                if (!cachedData) {
                    try {
                        // nav.json에서 dataPath 찾기
                        const dataPath = getDataPathForSymbol(navData, symbol);
                        if (!dataPath) {
                            console.warn(`No dataPath found for ${symbol}`);
                        } else {
                            // [수정] fetchWithFallback 함수를 내부 정의하거나 사용하여 로컬 실패 시 R2 시도
                            const fetchWithFallback = async (path) => {
                                const localUrl = getDataUrl(path) + `?t=${new Date().getTime()}`;
                                try {
                                    const res = await fetch(localUrl);
                                    if (res.ok) {
                                        // 응답이 왔지만 HTML(404페이지)일 수도 있으므로 clone해서 확인하거나 일단 json 파싱 시도
                                        const clonedRes = res.clone();
                                        try {
                                            const json = await res.json();
                                            return json;
                                        } catch (jsonErr) {
                                            // JSON 파싱 실패 -> 로컬 파일이 아닐 확률 높음 (HTML 반환 등)
                                            // throw 해서 catch 블록으로 이동
                                            console.warn(
                                                `Local fetch returned invalid JSON for ${path}, trying R2 fallback...`
                                            );
                                            throw new Error('Invalid JSON');
                                        }
                                    } else {
                                        throw new Error(
                                            `Local fetch failed: ${res.status}`
                                        );
                                    }
                                } catch (err) {
                                    // 로컬 실패 시 R2 시도
                                    const baseR2Url = getR2Url(path);
                                    const r2Url = baseR2Url ? baseR2Url + `?t=${new Date().getTime()}` : null;
                                    
                                    if (r2Url && baseR2Url !== getDataUrl(path)) {
                                        console.log(
                                            `Fetching from R2 fallback: ${r2Url}`
                                        );
                                        const r2Res = await fetch(r2Url);
                                        if (r2Res.ok) {
                                            return await r2Res.json();
                                        }
                                    }
                                    throw err; // R2도 실패하면 에러
                                }
                            };

                            const data = await fetchWithFallback(dataPath);
                            backtestData = data.backtestData || [];
                            tickerInfo = data.tickerInfo || null;
                            tickerDataCache.set(symbol, {
                                backtestData,
                                tickerInfo,
                            });
                        }
                    } catch (e) {
                        console.error(`Failed to fetch data for ${symbol}`, e);
                    }
                } else {
                    backtestData = cachedData.backtestData;
                    tickerInfo = cachedData.tickerInfo;
                }

                // [신규] 분할 정보가 있으면 데이터 보정
                if (tickerInfo?.events?.splits) {
                    backtestData = applySplits(
                        backtestData,
                        tickerInfo.events.splits
                    );
                }

                // NEW STRUCTURE: Filter dividends using new amount structure
                const allDividends = backtestData
                    .filter((d) => d.amountFixed != null || d.amount != null)
                    .sort((a, b) => new Date(a.date) - new Date(b.date));

                // [수정] 정확한 날짜 일치가 아니라, targetDate 이하 중 가장 최신 데이터를 찾음
                // 역순으로 검색하여 targetDate보다 작거나 같은 첫 번째 항목을 찾음
                let currentIndex = -1;
                for (let i = allDividends.length - 1; i >= 0; i--) {
                    if (
                        new Date(allDividends[i].date) <= new Date(targetDate)
                    ) {
                        currentIndex = i;
                        break;
                    }
                }

                // 찾은 배당 데이터의 실제 날짜 (없으면 요청한 날짜 유지 - 비어있는 상태 표시 위함)
                const foundDate =
                    currentIndex !== -1
                        ? allDividends[currentIndex].date
                        : targetDate;

                // 표시용 날짜 포맷 (YYYY-MM-DD -> YY. MM. DD)
                const formatDisplayDate = (dateStr) => {
                    const d = new Date(dateStr);
                    return `${String(d.getFullYear()).slice(-2)}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}`;
                };

                const displayDate = formatDisplayDate(foundDate);

                // NEW STRUCTURE: Use amountFixed as primary value (actual received amount)
                const currentDividend =
                    currentIndex !== -1
                        ? (allDividends[currentIndex].amountFixed ??
                          allDividends[currentIndex].amount)
                        : 0;
                const previousDividend =
                    currentIndex > 0
                        ? (allDividends[currentIndex - 1].amountFixed ??
                          allDividends[currentIndex - 1].amount)
                        : 0;

                const diff = currentDividend - previousDividend;
                const comparisonText = `LAST $ ${diff >= 0 ? '+' : ''}${Number(diff.toFixed(6))}`;

                // 차트용 배당 데이터: 최근 4개월치 배당만 필터링
                const fourMonthsAgo = new Date(targetDate);
                fourMonthsAgo.setMonth(fourMonthsAgo.getMonth() - 4);
                const chartDividends = allDividends.filter(
                    (d) =>
                        new Date(d.date) >= fourMonthsAgo &&
                        new Date(d.date) <= new Date(targetDate)
                );

                return {
                    ...thumb,
                    currentDividendAmount: currentDividend,
                    previousDividendAmount: previousDividend,
                    formattedCurrentAmount:
                        formatCurrentAmount(currentDividend),
                    comparisonText,
                    chartDividends: includeChart.value ? chartDividends : [],
                    targetDate: includeChart.value ? targetDate : null, // 차트용 타겟 날짜 (범위 필터링용)
                    // [신규] 개별 썸네일용 날짜 데이터
                    displayDate: displayDate,
                    foundDate: foundDate,
                };
            })
        ).then((results) => {
            // [수정] 날짜(foundDate) 기준 내림차순 정렬 (최신 배당이 위로 오도록)
            return results.sort((a, b) => {
                const dateA = new Date(a.foundDate);
                const dateB = new Date(b.foundDate);
                return dateB - dateA;
            });
        });

        allThumbnailsData.value = updatedThumbnails;
        isSyncing.value = false;
    };

    // Company Name에 따른 배경 선택 헬퍼
    const getBackgroundForCompany = (companyName) => {
        if (!companyName) return backgroundOptions.value[1]; // Default Gray

        const name = companyName.toLowerCase();
        if (name.includes('roundhill')) {
            return (
                backgroundOptions.value.find((b) => b.name === 'Blue') ||
                backgroundOptions.value[0]
            );
        } else if (name.includes('yieldmax')) {
            return (
                backgroundOptions.value.find((b) => b.name === 'Red') ||
                backgroundOptions.value[2]
            );
        }
        return (
            backgroundOptions.value.find((b) => b.name === 'Gray') ||
            backgroundOptions.value[1]
        );
    };

    // [신규] 초기 데이터 로드 및 반응형 업데이트 함수
    const updateThumbnailConfigs = async () => {
        // navData가 로드되지 않았으면 대기
        if (!navDataCache.value) {
            await loadNavData();
        }
        const navData = navDataCache.value;
        const bookmarks = myBookmarks.value;

        if (!navData || !bookmarks) {
            allThumbnailsData.value = [];
            return;
        }

        const thumbnailConfigs = Object.keys(bookmarks).map((isin) => {
            const stockInfo =
                navData.nav.find((item) => item.isin === isin) || {};
            const symbol = stockInfo.symbol || bookmarks[isin].symbol || isin;
            const companyName = stockInfo.company || 'Unknown';
            const group = stockInfo.group || 'Others';

            const background = getBackgroundForCompany(companyName);

            return {
                symbol: symbol,
                companyName: companyName,
                group: group,
                tickerColor: background.tickerColor,
                backgroundImageUrl: background.path,
                formattedCurrentAmount: '0.0000',
                comparisonText: 'LAST $ +0.000000',
            };
        });

        groups.value = [
            'All',
            ...new Set(thumbnailConfigs.map((c) => c.group).filter(Boolean)),
        ];

        allThumbnailsData.value = thumbnailConfigs;
        // 데이터 구성 후 배당 정보 동기화
        await syncDividendData();
    };

    onMounted(async () => {
        const today = new Date();
        // [수정] 오늘 날짜 + 2일로 설정
        today.setDate(today.getDate() + 2);

        date.value = `${String(today.getFullYear()).slice(-2)}. ${String(today.getMonth() + 1).padStart(2, '0')}. ${String(today.getDate()).padStart(2, '0')}`;

        // 1. Nav Data 로드 시작
        loadNavData().then(() => {
            // Nav Data 로드 완료 시 업데이트 시도
            updateThumbnailConfigs();
        });
    });

    // [중요] 북마크나 로딩 상태가 변경되면 업데이트 트리거
    watch(
        () => [myBookmarks.value, isBookmarksLoading.value, navDataCache.value],
        async ([newBookmarks, newLoading, newNav]) => {
            // 로딩 중이면 isLoading = true 유지
            // 단, navDataCache가 있고, bookmarksLoading이 false여야 로딩 완료로 간주
            if (newLoading || !newNav) {
                isLoading.value = true;
            } else {
                // 데이터 업데이트
                await updateThumbnailConfigs();
                isLoading.value = false;
            }
        },
        { immediate: true, deep: true }
    );

    const downloadImages = async () => {
        if (filteredThumbnails.value.length === 0) {
            alert('다운로드할 썸네일이 없습니다.');
            return;
        }
        isDownloading.value = true;
        const zip = new JSZip();
        const dateForFilename = date.value.replace(/[. ]/g, '');

        // [수정] selectedThumbnails 대신 filteredThumbnails 전체 대상
        const targets = filteredThumbnails.value;

        // Group item 제외하고 Symbol 있는 것만
        const symbols = targets
            .filter((t) => t.type !== 'Group' && t.symbol)
            .map((t) => t.symbol);

        for (const symbol of symbols) {
            const el = document.querySelector(
                `[data-symbol="${symbol}"] .thumbnail-container`
            );
            if (!el) continue;

            try {
                const canvas = await html2canvas(el, {
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: null,
                });
                const blob = await new Promise((resolve) =>
                    canvas.toBlob(resolve, 'image/png')
                );
                const chartSuffix = includeChart.value ? '_chart' : '';
                zip.file(
                    `${symbol.toLowerCase()}_${dateForFilename}${chartSuffix}.png`,
                    blob
                );
            } catch (error) {
                console.error(
                    `Failed to capture thumbnail for ${symbol}:`,
                    error
                );
            }
        }

        try {
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `thumbnails_${dateForFilename}.zip`;
            link.click();
            URL.revokeObjectURL(link.href);
        } catch (error) {
            console.error('Failed to generate zip file:', error);
        } finally {
            isDownloading.value = false;
        }
    };

    const goToBookmarkEdit = () => {
        router.push({ name: 'bookmark-edit' });
    };

    // [신규] 개별 다운로드 함수
    const downloadSingleThumbnail = async (symbol) => {
        if (!symbol) return;

        const el = document.querySelector(
            `[data-symbol="${symbol}"] .thumbnail-container`
        );
        if (!el) return;

        try {
            const customDate = date.value.replace(/[. ]/g, '');
            const chartSuffix = includeChart.value ? '_chart' : '';

            const canvas = await html2canvas(el, {
                useCORS: true,
                allowTaint: true,
                backgroundColor: null,
            });

            const link = document.createElement('a');
            link.download = `${symbol.toLowerCase()}_${customDate}${chartSuffix}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (error) {
            console.error(`Failed to download thumbnail for ${symbol}:`, error);
        }
    };
</script>

<template>
    <div class="thumbnail-batch-page">
        <header class="batch-header">
            <div class="flex align-items-center gap-3">
                <h1>({{ filteredThumbnails.length }})</h1>
            </div>
            <div class="flex align-items-center gap-3">
                <Button
                    label="북마크 관리"
                    icon="pi pi-pencil"
                    @click="goToBookmarkEdit"
                    severity="secondary" />
                <SelectButton
                    v-if="groups.length > 1"
                    v-model="selectedGroup"
                    :options="groups" />

                <!-- [신규] 차트 포함 옵션 -->
                <!-- [신규] 차트 포함 옵션 (항상 true로 고정) -->
                <!-- <div class="flex align-items-center gap-2">
                    <Checkbox v-model="includeChart" :binary="true" inputId="includeChart" />
                    <label for="includeChart" class="cursor-pointer">차트 포함</label>
                </div> -->

                <!-- [삭제] 날짜 입력 및 동기화 버튼 (사용자 요청으로 제거, 자동 처리됨) -->
                <!-- <InputText v-model="date" placeholder="YY. MM. DD" />
                <Button icon="pi pi-sync" @click="syncDividendData" :loading="isSyncing" /> -->

                <Button
                    icon="pi pi-download"
                    @click="downloadImages"
                    :loading="isDownloading"
                    :disabled="isLoading || filteredThumbnails.length === 0"
                    label="전체 다운로드" />
            </div>
        </header>

        <main class="preview-grid">
            <div v-if="isLoading" class="loading-spinner">
                <ProgressSpinner />
                <p>썸네일 데이터 로딩 중...</p>
            </div>

            <!-- [신규] 북마크 없음 안내 -->
            <div
                v-else-if="filteredThumbnails.length === 0"
                class="no-bookmarks">
                <p>북마크된 종목이 없습니다.</p>
                <Button
                    label="북마크 추가하러 가기"
                    icon="pi pi-plus"
                    @click="goToBookmarkEdit" />
            </div>

            <div
                v-else
                v-for="thumb in filteredThumbnails"
                :key="thumb.symbol || thumb.groupTitle"
                :data-symbol="thumb.symbol || thumb.groupTitle"
                class="thumbnail-wrapper">
                <!-- [수정] 개별 다운로드 버튼으로 변경 -->
                <Button
                    v-if="thumb.type !== 'Group'"
                    icon="pi pi-download"
                    class="thumbnail-download-btn p-button-rounded"
                    @click="downloadSingleThumbnail(thumb.symbol)"
                    style="
                        position: absolute;
                        top: 0.5rem;
                        left: 0.5rem;
                        z-index: 10;
                        background: rgba(255, 255, 255, 0.8);
                    " />

                <!-- Group Type -->
                <GroupItem
                    v-if="thumb.type === 'Group'"
                    :data="{
                        ...thumb,
                        date: thumb.displayDate || date,
                    }" />

                <!-- Regular Thumbnail Type -->
                <ThumbnailItem
                    v-else
                    :data="{
                        ...thumb,
                        date: thumb.displayDate || date,
                        showChart: includeChart,
                        targetDate: thumb.targetDate,
                    }" />
            </div>
        </main>
    </div>
</template>

<style lang="scss" scoped>
    @use '@/styles/pages/thumbnail-generator';
</style>
