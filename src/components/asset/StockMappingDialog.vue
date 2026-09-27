<!-- src/components/asset/StockMappingDialog.vue -->
<template>
    <ResponsiveDialog
        v-model:visible="isVisible"
        modal
        header="종목명 매핑"
        :dialogStyle="{ width: '900px', maxHeight: '90vh' }"
        :closable="!isProcessing">
        <div class="flex flex-column gap-4">
            <Message severity="info">
                <div class="flex flex-column gap-2">
                    <strong>종목명을 시스템 티커와 매핑해주세요</strong>
                    <p class="m-0">
                        토스증권의 종목명을 우리 시스템의 티커와 연결합니다.
                    </p>
                </div>
            </Message>

            <!-- 1. 수동 매핑이 필요한 종목 (검색 결과가 없거나 여러 개인 경우) -->
            <div v-if="manualMappingStocks.length > 0">
                <h3 class="text-lg font-bold mb-3">
                    수동 매핑 필요 ({{ manualMappingStocks.length }})
                </h3>
                <div
                    class="flex flex-column gap-3"
                    style="max-height: 40vh; overflow-y: auto">
                    <Card
                        v-for="stock in manualMappingStocks"
                        :key="stock.stock_name"
                        class="shadow-1">
                        <template #content>
                            <div class="flex flex-column gap-3">
                                <!-- 종목 정보 (가로 1줄) -->
                                <div
                                    class="flex justify-content-between align-items-center gap-3">
                                    <div
                                        class="flex align-items-center gap-3 flex-1">
                                        <h4 class="m-0">
                                            {{ stock.stock_name }}
                                        </h4>
                                        <div
                                            class="text-sm text-color-secondary flex gap-3">
                                            <span v-if="stock.ticker">
                                                ISIN: {{ stock.ticker }}
                                            </span>
                                            <span>
                                                거래 횟수: {{ stock.count }}회
                                            </span>
                                        </div>
                                    </div>
                                    <Tag
                                        v-if="stock.mappedTicker"
                                        value="매핑 완료"
                                        severity="success"
                                        icon="pi pi-check" />
                                    <Button
                                        v-else
                                        icon="pi pi-link"
                                        label="티커 매핑"
                                        size="small"
                                        :disabled="!stock.selectedTicker"
                                        @click="mapStock(stock)" />
                                </div>

                                <!-- 검색 결과 (SelectButton 스타일) -->
                                <div
                                    v-if="
                                        stock.searchResults &&
                                        stock.searchResults.length > 0 &&
                                        !stock.mappedTicker
                                    "
                                    class="flex flex-column gap-2">
                                    <div
                                        class="text-sm font-semibold text-color-secondary">
                                        검색 결과 ({{
                                            stock.searchResults.length
                                        }}개):
                                    </div>
                                    <div class="flex flex-column gap-2">
                                        <div
                                            v-for="result in stock.searchResults.slice(
                                                0,
                                                5
                                            )"
                                            :key="result.symbol"
                                            @click="selectTicker(stock, result)"
                                            class="p-3 border-round-md cursor-pointer transition-all transition-duration-200"
                                            :class="{
                                                'surface-100':
                                                    stock.selectedTicker !==
                                                    result.symbol,
                                                'bg-primary-500':
                                                    stock.selectedTicker ===
                                                    result.symbol,
                                            }"
                                            :style="{
                                                border:
                                                    stock.selectedTicker ===
                                                    result.symbol
                                                        ? '2px solid var(--primary-color)'
                                                        : '1px solid var(--surface-border)',
                                                boxShadow:
                                                    stock.selectedTicker ===
                                                    result.symbol
                                                        ? '0 0 0 1px var(--primary-color)'
                                                        : 'none',
                                            }">
                                            <div
                                                class="flex justify-content-between align-items-center">
                                                <div>
                                                    <div
                                                        class="font-semibold"
                                                        :class="{
                                                            'text-white':
                                                                stock.selectedTicker ===
                                                                result.symbol,
                                                        }">
                                                        {{ result.symbol }}
                                                    </div>
                                                    <div
                                                        class="text-sm"
                                                        :class="{
                                                            'text-white':
                                                                stock.selectedTicker ===
                                                                result.symbol,
                                                            'text-color-secondary':
                                                                stock.selectedTicker !==
                                                                result.symbol,
                                                        }">
                                                        {{ result.name }}
                                                    </div>
                                                </div>
                                                <i
                                                    v-if="
                                                        stock.selectedTicker ===
                                                        result.symbol
                                                    "
                                                    class="pi pi-check text-xl text-white"></i>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <!-- 기존 매핑 정보 표시 -->
                                <div
                                    v-if="stock.mappedTicker"
                                    class="surface-100 p-3 border-round">
                                    <div
                                        class="flex justify-content-between align-items-center">
                                        <div>
                                            <div class="font-semibold">
                                                {{ stock.mappedTicker }}
                                            </div>
                                            <div
                                                class="text-sm text-color-secondary">
                                                {{ stock.mappedInfo?.name }}
                                            </div>
                                        </div>
                                        <Button
                                            icon="pi pi-times"
                                            text
                                            rounded
                                            severity="danger"
                                            @click="unmapStock(stock)" />
                                    </div>
                                </div>
                            </div>
                        </template>
                    </Card>
                </div>
            </div>

            <!-- 2. 자동 매핑된 종목 (확실한 매핑) -->
            <div v-if="autoMatchedStocks.length > 0" class="mt-4">
                <h3 class="text-lg font-bold mb-3">
                    자동 매핑됨 ({{ autoMatchedStocks.length }})
                </h3>
                <DataTable
                    :value="autoMatchedStocks"
                    stripedRows
                    class="p-datatable-sm shadow-1"
                    scrollable
                    scrollHeight="50vh">
                    <Column field="ticker" header="ISIN"></Column>
                    <Column field="selectedTicker" header="티커"></Column>
                    <Column field="stock_name" header="종목명">
                        <template #body="slotProps">
                            <div class="flex flex-column">
                                <span class="font-semibold">{{
                                    slotProps.data.mappedInfo?.name ||
                                    slotProps.data.stock_name
                                }}</span>
                            </div>
                        </template>
                    </Column>
                    <Column field="count" header="거래횟수">
                        <template #body="slotProps">
                            {{ slotProps.data.count }} 회
                        </template>
                    </Column>
                </DataTable>
            </div>

            <div v-if="isLoading" class="flex flex-column gap-3">
                <Skeleton height="10rem" class="w-full" />
                <Skeleton height="10rem" class="w-full" />
            </div>
        </div>

        <template #footer>
            <div class="flex justify-content-between">
                <Button
                    label="나중에 하기"
                    severity="secondary"
                    @click="skipMapping"
                    :disabled="isProcessing" />
                <Button
                    label="완료"
                    @click="completeMapping"
                    :loading="isProcessing" />
            </div>
        </template>
    </ResponsiveDialog>
</template>

<script setup>
    import { ref, computed, watch } from 'vue';
    import ResponsiveDialog from '@/components/common/ResponsiveDialog.vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';
    import Tag from 'primevue/tag';
    import Chip from 'primevue/chip';
    import Skeleton from 'primevue/skeleton';
    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import {
        getStockMapping,
        saveStockMapping,
        deleteStockMapping,
        searchSymbol,
    } from '@/composables/data/useStockMapping';
    import { useLocalStockData } from '@/composables/data/useLocalStockData';
    import { user } from '@/store/auth';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        transactions: {
            type: Array,
            required: true,
        },
        brokerage: {
            type: String,
            required: true,
        },
    });

    const emit = defineEmits(['update:visible', 'mapping-complete']);

    const isVisible = computed({
        get: () => props.visible,
        set: (value) => emit('update:visible', value),
    });

    const isProcessing = ref(false);

    // 매핑되지 않은 종목 추출 및 구조화
    const unmappedStocks = ref([]);

    // 수동 매핑이 필요한 종목
    const manualMappingStocks = computed(() => {
        return unmappedStocks.value.filter((s) => !s.isAutoMatched);
    });

    // 자동 매핑된 종목
    const autoMatchedStocks = computed(() => {
        return unmappedStocks.value.filter((s) => s.isAutoMatched);
    });

    // 디바운스 유틸리티
    const debounce = (func, wait) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    };

    const isLoading = ref(false);
    const { fetchAllStockData, findStockByIsin } = useLocalStockData();

    // 거래내역에서 고유 종목 추출
    const extractUniqueStocks = async () => {
        isLoading.value = true;

        // 로컬 데이터 로드 (이미 로드되었으면 즉시 리턴됨)
        await fetchAllStockData();

        // 디버깅: 전체 거래 내역 확인
        console.log('=== 거래 내역 분석 ===');
        console.log('전체 거래 내역 수:', props.transactions.length);
        console.log(
            '수량이 있는 거래:',
            props.transactions.filter((t) => t.quantity && t.quantity > 0)
                .length
        );
        console.log(
            '수량이 없거나 0인 거래:',
            props.transactions.filter((t) => !t.quantity || t.quantity <= 0)
                .length
        );

        const stockMap = new Map();

        // 종목별로 그룹화
        props.transactions.forEach((t) => {
            // 수량이 없거나 0 이하면 스킵 (배당, 환전 등)
            if (!t.quantity || t.quantity <= 0) return;

            // 그룹 키: 티커가 있으면 티커(ISIN), 없으면 종목명
            const key = t.ticker || t.stock_name;

            // 디버깅: 그룹화 상세
            console.log(
                `Transaction: ${t.stock_name}, Ticker: ${t.ticker}, Key: ${key}`
            );

            if (!stockMap.has(key)) {
                stockMap.set(key, {
                    stock_name: t.stock_name, // 대표 이름 (가장 긴 것으로 업데이트)
                    originalNames: new Set([t.stock_name]), // 원본 이름들
                    ticker: t.ticker,
                    count: 0,
                    searchQuery: '',
                    searchResults: [],
                    selectedTicker: null,
                    mappedTicker: null,
                    mappedInfo: null,
                    isAutoMatched: false, // 자동 매칭 여부
                });
            }

            const group = stockMap.get(key);
            group.count++;
            group.originalNames.add(t.stock_name);

            // 더 긴 이름이 있으면 대표 이름 업데이트 (정보가 더 많을 확률 높음)
            if (t.stock_name.length > group.stock_name.length) {
                group.stock_name = t.stock_name;
            }
        });

        // 배열로 변환
        const stocks = Array.from(stockMap.values());

        // 기존 매핑 정보 로드 및 자동 매칭 시도
        for (const stock of stocks) {
            // 1. 기존 매핑 확인
            // 대표 이름으로 매핑 조회
            let mapping = await getStockMapping(
                props.brokerage,
                stock.stock_name
            );

            // 매핑이 없으면 다른 이름들도 시도
            if (!mapping && stock.originalNames.size > 1) {
                for (const name of stock.originalNames) {
                    if (name === stock.stock_name) continue;
                    mapping = await getStockMapping(props.brokerage, name);
                    if (mapping) break;
                }
            }

            if (mapping) {
                stock.mappedTicker = mapping.systemTicker;
                stock.mappedInfo = mapping.stockInfo;
                continue; // 이미 매핑됨
            }

            // 2. ISIN으로 자동 매칭 시도
            if (stock.ticker) {
                // 2-1. 로컬 데이터 검색
                const localStock = findStockByIsin(stock.ticker);
                if (localStock) {
                    stock.selectedTicker = localStock.symbol;
                    stock.mappedInfo = {
                        name:
                            localStock.koName ||
                            localStock.name ||
                            localStock.company,
                        exchange: localStock.market,
                    };
                    stock.isAutoMatched = true;
                    continue;
                }

                // 2-2. API 검색 (로컬에 없는 경우)
                try {
                    const searchResults = await searchSymbol(stock.ticker);
                    if (searchResults && searchResults.length > 0) {
                        // 검색 결과가 1개이거나, 첫 번째 결과가 ISIN과 일치하는 경우 (API가 ISIN 검색 지원한다고 가정)
                        // 또는 단순히 첫 번째 결과를 신뢰
                        const bestMatch = searchResults[0];
                        if (bestMatch) {
                            stock.selectedTicker = bestMatch.symbol;
                            stock.mappedInfo = {
                                name: bestMatch.name || bestMatch.company, // API 응답 구조에 따라 조정 필요
                                exchange: bestMatch.exchange,
                            };
                            stock.isAutoMatched = true;

                            // 검색 결과도 캐시에 추가하면 좋겠지만, 여기서는 패스
                        }
                    }
                } catch (e) {
                    console.warn('API Auto-match failed for', stock.ticker);
                }
            }
        }

        unmappedStocks.value = stocks;
        isLoading.value = false;

        // 디버깅: 전체 종목 수와 분류 확인
        console.log('=== 종목 매핑 디버깅 ===');
        console.log('전체 종목 수:', stocks.length);
        console.log(
            '자동 매핑된 종목:',
            stocks.filter((s) => s.isAutoMatched).length
        );
        console.log(
            '수동 매핑 필요:',
            stocks.filter((s) => !s.isAutoMatched).length
        );
        console.log(
            '이미 매핑됨:',
            stocks.filter((s) => s.mappedTicker).length
        );
        console.log(
            '상세:',
            stocks.map((s) => ({
                name: s.stock_name,
                isAutoMatched: s.isAutoMatched,
                mappedTicker: s.mappedTicker,
                selectedTicker: s.selectedTicker,
            }))
        );
    };

    // 티커 검색 (디바운스 적용)
    const onSearchTicker = async (stock) => {
        if (!stock.searchQuery || stock.searchQuery.length < 2) {
            stock.searchResults = [];
            return;
        }

        // 2. 매핑이 없고 ISIN이 있으면 로컬 데이터 확인 및 자동 검색 시도
        if (!stock.mappedTicker && stock.ticker) {
            // 2-1. 로컬 데이터에서 ISIN으로 검색
            const localStock = findStockByIsin(stock.ticker);
            if (localStock) {
                stock.selectedTicker = localStock.symbol;
                stock.mappedInfo = {
                    name:
                        localStock.koName ||
                        localStock.name ||
                        localStock.company,
                    exchange: localStock.market,
                };
                stock.isAutoMatched = true;
                return; // 다음 종목으로 이동
            }

            // 2-2. 로컬 데이터에 없으면 Yahoo Finance 검색 시도
            try {
                const results = await searchSymbol(stock.ticker);
                if (results && results.length > 0) {
                    const firstResult = results[0];
                    stock.selectedTicker = firstResult.symbol;
                    stock.mappedInfo = {
                        name: firstResult.name,
                        exchange: firstResult.exchange,
                    };
                    stock.isAutoMatched = true;
                    return; // 자동 매칭되었으므로 추가 검색 불필요
                }
            } catch (error) {
                console.warn(
                    `ISIN (${stock.ticker})으로 Yahoo Finance 검색 실패:`,
                    error
                );
                // 실패해도 계속 진행하여 searchQuery로 검색 시도
            }
        }

        try {
            const results = await searchSymbol(stock.searchQuery);
            stock.searchResults = results;
        } catch (error) {
            console.error('티커 검색 실패:', error);
            stock.searchResults = [];
        }
    };

    const debouncedSearch = debounce((stock) => onSearchTicker(stock), 500);

    // 티커 선택
    const selectTicker = (stock, result) => {
        stock.selectedTicker = result.symbol;
        stock.mappedInfo = {
            name: result.name,
            exchange: result.exchange,
        };
    };

    // 종목 매핑 (수동)
    const mapStock = async (stock) => {
        if (!stock.selectedTicker) return;

        if (!user.value?.uid) {
            console.error('로그인이 필요합니다.');
            return;
        }

        try {
            await saveStockMapping(
                props.brokerage,
                stock.stock_name,
                {
                    brokerageTicker: stock.ticker, // ISIN
                    systemTicker: stock.selectedTicker,
                    stockInfo: stock.mappedInfo,
                },
                user.value.uid
            );

            stock.mappedTicker = stock.selectedTicker;
            stock.searchQuery = '';
            stock.searchResults = [];
            stock.selectedTicker = null;
        } catch (error) {
            console.error('매핑 저장 실패:', error);
        }
    };

    // 매핑 해제
    const unmapStock = async (stock) => {
        try {
            await deleteStockMapping(props.brokerage, stock.stock_name);
            stock.mappedTicker = null;
            stock.mappedInfo = null;
        } catch (error) {
            console.error('매핑 해제 실패:', error);
        }
    };

    // 매핑 완료
    const completeMapping = async () => {
        // 매핑 정보를 거래내역에 적용
        const mappingMap = new Map();

        // 비동기 처리를 위해 Promise 배열 생성
        const savePromises = [];

        for (const stock of unmappedStocks.value) {
            let ticker = stock.mappedTicker;
            let info = stock.mappedInfo;

            // 자동 매핑된 경우 (아직 DB에 저장되지 않았을 수 있음)
            if (!ticker && stock.isAutoMatched && stock.selectedTicker) {
                ticker = stock.selectedTicker;
                // 자동 매핑된 정보도 DB에 저장하여 다음에 재사용
                savePromises.push(
                    saveStockMapping(
                        props.brokerage,
                        stock.stock_name,
                        {
                            brokerageTicker: stock.ticker,
                            systemTicker: ticker,
                            stockInfo: stock.mappedInfo,
                        },
                        user.value.uid
                    )
                );
            }

            if (ticker) {
                // 모든 원본 이름에 대해 매핑 정보 생성
                stock.originalNames.forEach((name) => {
                    mappingMap.set(name, {
                        systemTicker: ticker,
                        info: info,
                    });
                });
            }
        }

        // 변경된 매핑 정보 저장 대기
        if (savePromises.length > 0) {
            try {
                await Promise.all(savePromises);
                console.log(
                    `${savePromises.length}개의 자동 매핑 정보 저장 완료`
                );
            } catch (e) {
                console.error('자동 매핑 정보 저장 실패:', e);
            }
        }

        emit('mapping-complete', mappingMap);
        closeDialog();
    };

    // 나중에 하기
    const skipMapping = () => {
        closeDialog();
    };

    // 다이얼로그 닫기
    const closeDialog = () => {
        isVisible.value = false;
    };

    // visible 변경 시 데이터 로드
    watch(
        () => props.visible,
        (newVal) => {
            if (newVal) {
                extractUniqueStocks();
            }
        }
    );
</script>
