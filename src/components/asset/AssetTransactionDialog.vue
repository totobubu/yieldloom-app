<!-- src/components/asset/AssetTransactionDialog.vue -->
<template>
    <Drawer v-model:visible="isVisible" :header="title" position="full">
        <div v-if="isLoading" class="flex justify-content-center p-4">
            <ProgressSpinner />
        </div>

        <div
            v-else-if="displayTransactions.length === 0"
            class="text-center p-4">
            <p class="text-color-secondary">거래 내역이 없습니다.</p>
        </div>

        <div v-else class="asset-transaction-container">
            <!-- 년도별 배당 요약 버튼 -->
            <div
                class="year-buttons-section flex gap-2 flex-wrap align-items-center">
                <Button
                    @click="showChartModal = true"
                    icon="pi pi-chart-bar"
                    label="차트보기"
                    severity="primary"
                    size="large" />
                <div
                    v-for="yearData in yearlyDividendData"
                    :key="yearData.year"
                    class="relative">
                    <Button
                        :severity="
                            selectedYear === yearData.year
                                ? 'primary'
                                : 'secondary'
                        "
                        :outlined="yearData.isFuture"
                        @click="selectYear(yearData.year)"
                        class="year-summary-button relative overflow-visible">
                        <div class="flex flex-column align-items-start gap-1">
                            <div class="flex align-items-center gap-2">
                                <div class="font-bold text-lg">
                                    {{ yearData.year }}년
                                    <span
                                        v-if="yearData.isFuture"
                                        class="text-sm font-normal text-color-secondary">
                                        (예상)
                                    </span>
                                </div>
                                <!-- 마이너스 버튼 (가장 미래 년도만) -->
                                <Button
                                    v-if="yearData.isLastFuture"
                                    icon="pi pi-minus"
                                    severity="danger"
                                    text
                                    rounded
                                    size="small"
                                    class="w-1rem h-1rem p-0 ml-1"
                                    @click.stop="
                                        removeFutureYear(yearData.year)
                                    "></Button>
                            </div>
                            <div class="text-sm">
                                <div>
                                    세후배당금: {{ yearData.totalDividend }}
                                </div>
                                <div>원화과표: {{ yearData.totalKrwTax }}</div>
                            </div>
                        </div>
                    </Button>
                </div>

                <!-- 플러스 버튼 (년도 추가) -->
                <Button
                    icon="pi pi-plus"
                    severity="secondary"
                    outlined
                    @click="addFutureYear"
                    class="h-full"
                    style="height: 86px; width: 50px" />
            </div>

            <!-- 필터 영역 -->
            <div class="filter-section py-2">
                <div class="flex gap-3 align-items-center">
                    <!-- 거래타입 필터 -->
                    <div class="flex flex-column">
                        <SelectButton
                            v-model="selectedTransactionType"
                            :options="transactionTypes"
                            optionLabel="label"
                            optionValue="value" />
                    </div>

                    <!-- 필터 초기화 버튼 -->
                    <Button
                        severity="danger"
                        icon="pi pi-filter-slash"
                        size="small"
                        @click="resetFilters" />

                    <!-- 재투자 여부 버튼 -->
                    <div class="flex flex-column gap-1">
                        <ToggleButton
                            v-model="isReinvestmentEnabled"
                            onLabel="재투자 포함"
                            offLabel="배당만 수령"
                            onIcon="pi pi-refresh"
                            offIcon="pi pi-dollar"
                            size="small"
                            class="reinvestment-toggle" />
                    </div>

                    <!-- 배당 기준 설정 버튼 -->
                    <div class="flex flex-column gap-1">
                        <SelectButton
                            v-model="dividendBasis"
                            :options="dividendBasisOptions"
                            optionLabel="label"
                            optionValue="value"
                            size="small" />
                    </div>

                    <!-- 결과 표시 -->
                    <div class="ml-auto mt-4 text-sm text-color-secondary">
                        <span v-if="selectedYear" class="font-semibold"
                            >{{ selectedYear }}년 |
                        </span>
                        총 {{ filteredTransactions.length }}개
                    </div>
                </div>
            </div>

            <DataTable
                :value="filteredTransactions"
                class="asset-transaction-table"
                :scrollable="true"
                scrollHeight="calc(100vh - 260px)"
                scrollDirection="both"
                stripedRows>
                <!-- 날짜 (Frozen) -->
                <Column
                    field="날짜"
                    header="날짜"
                    :frozen="true"
                    :style="{ minWidth: '120px', width: '120px' }">
                    <template #body="slotProps">
                        <div
                            v-if="isSummaryRow(slotProps.data)"
                            class="summary-row">
                            {{ formatDate(slotProps.data['날짜']) }}
                        </div>
                        <div
                            v-else-if="hasDividend(slotProps.data)"
                            class="dividend-row flex flex-column gap-1">
                            <div class="flex align-items-center gap-2">
                                <i class="pi pi-calendar-clock" />
                                <span class="text-xs text-color-secondary">{{
                                    slotProps.data['배당락일']
                                }}</span>
                            </div>
                            <div class="flex align-items-center gap-2">
                                <i class="pi pi-gift" />
                                <span class="text-sm font-medium">{{
                                    slotProps.data['배당지급일']
                                }}</span>
                            </div>
                        </div>
                        <div v-else>
                            {{ formatDate(slotProps.data['날짜']) }}
                        </div>
                    </template>
                </Column>

                <!-- 평단 -->
                <Column
                    v-if="shouldShowColumn('평단')"
                    field="평단"
                    header="평단"
                    :style="{ minWidth: '100px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['평단'] }}
                        </div>
                    </template>
                </Column>

                <!-- 보유량 -->
                <Column
                    v-if="shouldShowColumn('보유량')"
                    field="보유량"
                    header="보유량"
                    :style="{ minWidth: '100px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['보유량'] }}
                        </div>
                    </template>
                </Column>

                <!-- 거래(수량) -->
                <Column
                    v-if="shouldShowColumn('거래(수량)')"
                    field="거래(수량)"
                    header="거래(수량)"
                    :style="{ minWidth: '110px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['거래(수량)'] }}
                        </div>
                    </template>
                </Column>

                <!-- 거래(달러) -->
                <Column
                    v-if="shouldShowColumn('거래(달러)')"
                    field="거래(달러)"
                    header="거래(달러)"
                    :style="{ minWidth: '110px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['거래(달러)'] }}
                        </div>
                    </template>
                </Column>

                <!-- 거래(원화) -->
                <Column
                    v-if="shouldShowColumn('거래(원화)')"
                    field="거래(원화)"
                    header="거래(원화)"
                    :style="{ minWidth: '110px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['거래(원화)'] }}
                        </div>
                    </template>
                </Column>

                <!-- 배당기준 -->
                <Column
                    v-if="shouldShowColumn('배당기준')"
                    field="배당기준"
                    header="배당기준"
                    :style="{ minWidth: '100px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['배당기준'] }}
                        </div>
                    </template>
                </Column>

                <!-- 세후배당금($) -->
                <Column
                    v-if="shouldShowColumn('세후배당금($)')"
                    field="세후배당금($)"
                    header="세후배당금($)"
                    :style="{ minWidth: '130px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['세후배당금($)'] }}
                        </div>
                    </template>
                </Column>

                <!-- 외화과표 -->
                <Column
                    v-if="shouldShowColumn('외화과표')"
                    field="외화과표"
                    header="외화과표"
                    :style="{ minWidth: '110px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['외화과표'] }}
                        </div>
                    </template>
                </Column>

                <!-- 원화과표 -->
                <Column
                    v-if="shouldShowColumn('원화과표')"
                    field="원화과표"
                    header="원화과표"
                    :style="{ minWidth: '130px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['원화과표'] }}
                        </div>
                    </template>
                </Column>

                <!-- 세후배당금(원화) -->
                <Column
                    v-if="shouldShowColumn('세후배당금(원화)')"
                    field="세후배당금(원화)"
                    header="세후배당금(원화)"
                    :style="{ minWidth: '150px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['세후배당금(원화)'] }}
                        </div>
                    </template>
                </Column>

                <!-- 환율 -->
                <Column
                    v-if="shouldShowColumn('환율')"
                    field="환율"
                    header="환율"
                    :style="{ minWidth: '100px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['환율'] }}
                        </div>
                    </template>
                </Column>

                <!-- 지급기준 -->
                <Column
                    v-if="shouldShowColumn('지급기준')"
                    field="지급기준"
                    header="지급기준"
                    :style="{ minWidth: '100px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['지급기준'] }}
                        </div>
                    </template>
                </Column>

                <!-- 원금회수율 -->
                <Column
                    v-if="shouldShowColumn('원금회수율')"
                    field="원금회수율"
                    header="원금회수율"
                    :style="{ minWidth: '110px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['원금회수율'] }}
                        </div>
                    </template>
                </Column>

                <!-- 누적배당 -->
                <Column
                    v-if="shouldShowColumn('누적배당')"
                    field="누적배당"
                    header="누적배당"
                    :style="{ minWidth: '110px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['누적배당'] }}
                        </div>
                    </template>
                </Column>

                <!-- 누적TR -->
                <Column
                    v-if="shouldShowColumn('누적TR')"
                    field="누적TR"
                    header="누적TR"
                    :style="{ minWidth: '110px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['누적TR'] }}
                        </div>
                    </template>
                </Column>

                <!-- 당일종가 -->
                <Column
                    field="당일종가"
                    header="당일종가"
                    :style="{ minWidth: '100px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['당일종가'] }}
                        </div>
                    </template>
                </Column>

                <!-- 당일 평단 -->
                <Column
                    field="당일 평단"
                    header="당일 평단"
                    :style="{ minWidth: '100px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['당일 평단'] }}
                        </div>
                    </template>
                </Column>

                <!-- 당일평가액 -->
                <Column
                    field="당일평가액"
                    header="당일평가액"
                    :style="{ minWidth: '120px' }">
                    <template #body="slotProps">
                        <div
                            :class="{
                                'summary-row': isSummaryRow(slotProps.data),
                                'dividend-row': hasDividend(slotProps.data),
                            }">
                            {{ slotProps.data['당일평가액'] }}
                        </div>
                    </template>
                </Column>
            </DataTable>
        </div>

        <!-- 차트 모달 -->
        <Dialog
            v-model:visible="showChartModal"
            header="자산 차트"
            :style="{ width: '90vw' }"
            :modal="true"
            :dismissableMask="true"
            :contentStyle="{ height: '80vh' }">
            <div class="chart-modal-container">
                <v-chart
                    class="chart-content"
                    :option="chartOption"
                    autoresize />
            </div>
        </Dialog>
    </Drawer>
</template>

<script setup>
    import { ref, computed, watch, provide } from 'vue';
    import Drawer from 'primevue/drawer';
    import Dialog from 'primevue/dialog';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import ProgressSpinner from 'primevue/progressspinner';
    import SelectButton from 'primevue/selectbutton';
    import Button from 'primevue/button';
    import ToggleButton from 'primevue/togglebutton';
    import extractedData from './extracted_transactions.json';

    // ECharts
    import { use } from 'echarts/core';
    import { CanvasRenderer } from 'echarts/renderers';
    import { LineChart, CustomChart } from 'echarts/charts';
    import {
        GridComponent,
        TooltipComponent,
        LegendComponent,
        DataZoomComponent,
        MarkLineComponent,
    } from 'echarts/components';
    import VChart, { THEME_KEY } from 'vue-echarts';

    use([
        CanvasRenderer,
        LineChart,
        CustomChart,
        GridComponent,
        TooltipComponent,
        LegendComponent,
        DataZoomComponent,
        MarkLineComponent,
    ]);

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        title: {
            type: String,
            default: '자산별 거래 내역',
        },
        transactions: {
            type: Array,
            default: () => [],
        },
        isLoading: {
            type: Boolean,
            default: false,
        },
    });

    const emit = defineEmits(['update:visible']);

    const isVisible = computed({
        get: () => props.visible,
        set: (value) => emit('update:visible', value),
    });

    // 차트 모달 상태
    const showChartModal = ref(false);

    // Google Sheets에서 추출한 원본 데이터 (직접 import)
    const sampleData = ref(extractedData);
    console.log('✅ Loaded sample data:', sampleData.value.length, 'rows');

    // UI 개발을 위해 무조건 샘플 데이터 사용
    const displayTransactions = computed(() => {
        // UI 개발 중이므로 무조건 샘플 데이터 사용
        return sampleData.value;
    });

    // 필터 상태
    const currentYear = new Date().getFullYear().toString(); // "2025"
    const selectedYear = ref(currentYear); // 기본값: 올해
    const selectedTransactionType = ref('all');
    const isReinvestmentEnabled = ref(false); // 재투자 여부 (기본: 배당만 수령)
    const dividendBasis = ref('latest'); // 배당 기준 (기본: 최신)

    // 배당 기준 옵션
    const dividendBasisOptions = ref([
        { label: '최신 배당', value: 'latest' },
        { label: '최근 5회 최대', value: 'max5' },
        { label: '최근 5회 평균', value: 'avg5' },
        { label: '최근 5회 최소', value: 'min5' },
    ]);

    // 선택된 년도가 미래인지 판별
    const isSelectedYearFuture = computed(() => {
        if (!selectedYear.value) return false;
        const yearNum = parseInt(selectedYear.value);
        const currentYearNum = parseInt(currentYear);
        return yearNum > currentYearNum;
    });

    // 모달 열릴 때 올해로 초기화
    watch(
        () => props.visible,
        (newVal) => {
            if (newVal) {
                selectedYear.value = currentYear;
                selectedTransactionType.value = 'all';
                isReinvestmentEnabled.value = false; // 재투자 옵션 초기화
                dividendBasis.value = 'latest'; // 배당 기준 초기화
            }
        }
    );

    // 년도 변경 시 재투자 옵션 초기화 (과거 데이터로 전환 시)
    watch(selectedYear, (newYear) => {
        const yearNum = parseInt(newYear);
        const currentYearNum = parseInt(currentYear);
        if (yearNum <= currentYearNum) {
            isReinvestmentEnabled.value = false;
            dividendBasis.value = 'latest';
        }
    });

    // 오늘 날짜 기준 (2025-12-12) 보유량과 평단 조회
    const getCurrentHoldings = computed(() => {
        const today = new Date('2025-12-12');

        // 오늘 날짜 이전의 모든 거래 데이터를 시간순으로 정렬
        const pastTransactions = displayTransactions.value
            .map((row) => {
                const dateStr = row['날짜'];
                if (!dateStr || dateStr.includes('년')) return null;

                // 날짜 파싱 (YY. MM. DD. 형식)
                const parts = dateStr.trim().split(/\s+/);
                if (parts.length >= 3) {
                    const year = parseInt('20' + parts[0].replace('.', ''));
                    const month = parseInt(parts[1].replace('.', ''));
                    const day = parseInt(parts[2].replace('.', ''));
                    const rowDate = new Date(year, month - 1, day);

                    if (rowDate <= today) {
                        return { row, date: rowDate };
                    }
                }
                return null;
            })
            .filter((item) => item !== null)
            .sort((a, b) => a.date - b.date); // Date 객체로 직접 정렬

        // 가장 최근 거래의 보유량과 평단
        if (pastTransactions.length > 0) {
            const latest = pastTransactions[pastTransactions.length - 1].row;
            return {
                shares: latest['보유량'] || '0 주',
                avgPrice: latest['평단'] || '$0',
            };
        }

        return { shares: '0 주', avgPrice: '$0' };
    });

    // 과거 배당 내역 분석 (오늘 날짜 이전 데이터만)
    const historicalDividends = computed(() => {
        const today = new Date('2025-12-12');

        // 배당 데이터만 필터링 (오늘 이전)
        const dividends = displayTransactions.value
            .filter((row) => {
                const paymentDate = row['배당지급일'];
                if (!paymentDate || paymentDate.trim() === '') return false;

                // 배당지급일 파싱
                const parts = paymentDate.trim().split(/\s+/);
                if (parts.length >= 3) {
                    const year = parseInt('20' + parts[0].replace('.', ''));
                    const month = parseInt(parts[1].replace('.', ''));
                    const day = parseInt(parts[2].replace('.', ''));
                    const divDate = new Date(year, month - 1, day);
                    return divDate <= today;
                }
                return false;
            })
            .map((row) => ({
                paymentDate: row['배당지급일'],
                amount: parseNumber(row['세후배당금($)']),
                shares: parseNumber(row['배당기준']), // "240 주" -> 240
            }))
            .filter((div) => div.amount > 0)
            .sort((a, b) => b.paymentDate.localeCompare(a.paymentDate)); // 최신순

        return dividends;
    });

    // 배당 기준값 계산
    const dividendBasisValue = computed(() => {
        const divs = historicalDividends.value;
        if (divs.length === 0) return 0;

        const last5 = divs.slice(0, 5);

        let perShareDividend = 0;
        switch (dividendBasis.value) {
            case 'latest':
                perShareDividend = divs[0].amount / divs[0].shares; // 주당 배당금
                break;
            case 'max5':
                perShareDividend = Math.max(
                    ...last5.map((d) => d.amount / d.shares)
                );
                break;
            case 'avg5':
                perShareDividend =
                    last5.reduce((sum, d) => sum + d.amount / d.shares, 0) /
                    last5.length;
                break;
            case 'min5':
                perShareDividend = Math.min(
                    ...last5.map((d) => d.amount / d.shares)
                );
                break;
            default:
                perShareDividend = 0;
        }

        console.log('📊 배당 분석:', {
            기준: dividendBasis.value,
            주당배당금: perShareDividend,
            과거배당횟수: divs.length,
            최근5회: last5.map((d) => ({
                날짜: d.paymentDate,
                주당: (d.amount / d.shares).toFixed(4),
            })),
        });

        return perShareDividend;
    });

    // 현재 보유량 변경 시 로깅
    watch(
        getCurrentHoldings,
        (newVal) => {
            console.log('💼 현재 보유 현황 (2025-12-12 기준):', newVal);
        },
        { immediate: true }
    );

    // 배당지급일에서 년도 추출 함수
    const extractYearFromPaymentDate = (paymentDate) => {
        if (!paymentDate || paymentDate.trim() === '') return null;
        // "28. 12. 29" 형식에서 년도 추출
        const parts = paymentDate.trim().split(/\s+/);
        if (parts.length >= 1) {
            const yearStr = parts[0].replace('.', ''); // "28" -> "28"
            return `20${yearStr}`; // "2028"
        }
        return null;
    };

    // 숫자 문자열에서 숫자만 추출 ("$1,234.56" -> 1234.56)
    const parseNumber = (str) => {
        if (!str || str.trim() === '') return 0;
        const cleaned = str.replace(/[^0-9.-]/g, '');
        return parseFloat(cleaned) || 0;
    };

    // 숫자를 통화 형식으로 포맷
    const formatCurrency = (value, currency = '$') => {
        if (value === 0) return `${currency}0`;
        const formatted = Math.abs(value).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
        return `${currency}${formatted}`;
    };

    // 미래 년도 관리
    const futureYears = ref(['2026', '2027', '2028']);

    // 년도별 배당 데이터 집계 (배당지급일 기준)
    const yearlyDividendData = computed(() => {
        // 의존성 명시적 참조 (변경 시 재계산 트리거)
        const _dividendBasis = dividendBasis.value;
        const _isReinvestment = isReinvestmentEnabled.value;

        const yearMap = new Map();
        const currentDate = new Date(); // 오늘 날짜
        const currentYearNum = currentDate.getFullYear();

        // 과거/현재 데이터만 집계 (미래 JSON 데이터 제외)
        displayTransactions.value.forEach((row) => {
            const paymentDate = row['배당지급일'];
            if (!paymentDate || paymentDate.trim() === '') return;

            const year = extractYearFromPaymentDate(paymentDate);
            if (!year) return;

            const yearNum = parseInt(year);
            // 미래 년도 데이터는 집계에서 제외
            if (yearNum > currentYearNum) return;

            const dividend = parseNumber(row['세후배당금($)']);
            const krwTax = parseNumber(row['원화과표']);

            if (!yearMap.has(year)) {
                yearMap.set(year, {
                    year,
                    totalDividend: 0,
                    totalKrwTax: 0,
                });
            }

            const yearData = yearMap.get(year);
            yearData.totalDividend += dividend;
            yearData.totalKrwTax += krwTax;
        });

        // Map을 배열로 변환
        const result = Array.from(yearMap.values()).map((data) => {
            const yearNum = parseInt(data.year);
            const isFuture = yearNum > currentYearNum;

            return {
                year: data.year,
                totalDividend: formatCurrency(data.totalDividend, '$'),
                totalKrwTax: formatCurrency(data.totalKrwTax, '₩'),
                isFuture,
            };
        });

        // 미래 년도 버튼 추가 및 계산
        // reactive futureYears 참조
        const currentHoldings = getCurrentHoldings.value;
        let runningShares = parseNumber(currentHoldings.shares);
        const currentAvgPrice = parseNumber(currentHoldings.avgPrice);
        const perShareDividend = dividendBasisValue.value;

        // 배당 주기 분석 (generateFutureTransactions와 동일한 로직)
        const divs = historicalDividends.value;
        let dividendIntervalDays = 90; // 기본값: 분기
        if (divs.length >= 2) {
            const intervals = [];
            for (let i = 0; i < Math.min(10, divs.length - 1); i++) {
                const date1 = parseDateString(divs[i].paymentDate);
                const date2 = parseDateString(divs[i + 1].paymentDate);
                if (date1 && date2) {
                    const diffDays = Math.abs(
                        (date1 - date2) / (1000 * 60 * 60 * 24)
                    );
                    intervals.push(diffDays);
                }
            }
            if (intervals.length > 0) {
                dividendIntervalDays = Math.round(
                    intervals.reduce((a, b) => a + b) / intervals.length
                );
            }
        }

        futureYears.value.forEach((year) => {
            let totalDividendAmount = 0;
            let totalKrwTaxAmount = 0;

            if (runningShares > 0 && perShareDividend > 0) {
                const yearNum = parseInt(year);
                const startDate = new Date(yearNum, 0, 1);
                const endDate = new Date(yearNum, 11, 31);

                // 첫 배당일 추정: 마지막 배당일 + 주기
                let lastPaymentDate =
                    divs.length > 0
                        ? parseDateString(divs[0].paymentDate)
                        : new Date();
                // 시뮬레이션 시작 전, yearNum의 1월 1일 이전까지 날짜를 밀어줌
                while (lastPaymentDate < startDate) {
                    lastPaymentDate.setDate(
                        lastPaymentDate.getDate() + dividendIntervalDays
                    );
                }
                let currentDate = new Date(lastPaymentDate);

                // 해당 년도 내에서 시뮬레이션
                while (currentDate <= endDate) {
                    if (currentDate >= startDate) {
                        const dividendAmount = runningShares * perShareDividend;
                        totalDividendAmount += dividendAmount;

                        // 원화과표 (환율 1400원, 세후/0.85 * 1400)
                        const pretaxDividend = dividendAmount / 0.85;
                        totalKrwTaxAmount += pretaxDividend * 1400;

                        if (
                            isReinvestmentEnabled.value &&
                            currentAvgPrice > 0
                        ) {
                            const sharesToBuy =
                                dividendAmount / currentAvgPrice;
                            runningShares += sharesToBuy;
                        }
                    }
                    currentDate.setDate(
                        currentDate.getDate() + dividendIntervalDays
                    );
                }
            }

            result.push({
                year,
                totalDividend:
                    totalDividendAmount > 0
                        ? formatCurrency(totalDividendAmount, '$')
                        : '$0.00',
                totalKrwTax:
                    totalKrwTaxAmount > 0
                        ? formatCurrency(totalKrwTaxAmount, '₩')
                        : '₩0.00',
                isFuture: true,
            });
        });

        // 년도 오름차순 정렬 (오래된 순)
        result.sort((a, b) => a.year.localeCompare(b.year));

        // 가장 마지막 미래 년도 찾기
        const futureYearsList = result.filter((r) => r.isFuture);
        const lastFutureYear =
            futureYearsList.length > 0
                ? futureYearsList[futureYearsList.length - 1].year
                : null;

        // isLastFuture 플래그 추가
        result.forEach((item) => {
            item.isLastFuture = item.isFuture && item.year === lastFutureYear;
        });

        return result;
    });

    // 년도 선택 함수
    const selectYear = (year) => {
        if (selectedYear.value === year) {
            selectedYear.value = null; // 토글
        } else {
            selectedYear.value = year;
        }
    };

    // 거래타입 옵션
    const transactionTypes = ref([
        { label: '전체', value: 'all' },
        { label: '거래', value: 'trade' },
        { label: '배당', value: 'dividend' },
    ]);

    // 날짜 포맷팅 함수 (구글 시트 깨진 데이터 처리 포함)
    const formatDate = (value) => {
        if (!value) return '';
        const valStr = String(value).trim();
        if (valStr.includes('년')) return valStr; // Summary row (e.g., "2028년")

        // 1. 이미 포맷된 문자열 ("YY. MM. DD.") 확인
        // 정규식: 두 자리 숫자 + 점 + 공백 + 한두 자리 숫자 + 점 + 공백 + 한두 자리 숫자 + 점
        if (/^\d{2}\.\s\d{1,2}\.\s\d{1,2}\.$/.test(valStr)) {
            return valStr;
        }

        // 2. 엑셀 시리얼 넘버 (숫자 형태)
        // 1900-01-01 기준 (약 45000 등의 숫자)
        const serial = parseFloat(value);
        if (!isNaN(serial) && serial > 20000) {
            // 20000일은 대략 1954년. 그 이상이면 날짜 시리얼로 간주
            const excelBaseDate = new Date(1899, 11, 30); // 1899-12-30
            const date = new Date(
                excelBaseDate.getTime() + serial * 24 * 60 * 60 * 1000
            );
            return formatJsDate(date);
        }

        // 3. Date 파싱 시도 (ISO string, etc)
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
            return formatJsDate(date);
        }

        // 4. 처리 불가는 원본 반환
        return valStr;
    };

    // JS Date 객체를 "YY. M. D." 형식으로 변환
    const formatJsDate = (date) => {
        const year = date.getFullYear().toString().slice(2); // 2028 -> 28
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${year}. ${month}. ${day}.`;
    };

    // 미래 거래 데이터 생성 함수
    const generateFutureTransactions = (targetYear) => {
        const transactions = [];
        const currentHoldings = getCurrentHoldings.value;
        let currentShares = parseNumber(currentHoldings.shares);
        let currentAvgPrice = parseNumber(currentHoldings.avgPrice);
        const perShareDividend = dividendBasisValue.value;
        if (currentShares === 0 || perShareDividend === 0) {
            return [];
        }

        // 과거 배당 내역에서 배당 주기 분석
        const divs = historicalDividends.value;
        let dividendIntervalDays = 90; // 기본값: 분기(90일)

        const intervals = [];

        if (divs.length >= 2) {
            // 최근 배당 간격 계산
            console.log(
                '🔍 배당 간격 분석 시작:',
                divs.slice(0, 6).map((d) => d.paymentDate)
            );

            for (let i = 0; i < Math.min(10, divs.length - 1); i++) {
                const date1 = parseDateString(divs[i].paymentDate);
                const date2 = parseDateString(divs[i + 1].paymentDate);
                if (date1 && date2) {
                    const diffDays = Math.abs(
                        (date1 - date2) / (1000 * 60 * 60 * 24)
                    );
                    intervals.push(diffDays);
                    console.log(
                        `  ${divs[i].paymentDate} → ${divs[i + 1].paymentDate}: ${diffDays.toFixed(1)}일`
                    );
                }
            }
            if (intervals.length > 0) {
                dividendIntervalDays = Math.round(
                    intervals.reduce((a, b) => a + b) / intervals.length
                );
            }
        }

        console.log('📊 배당 주기 분석 결과:', {
            평균간격일수: dividendIntervalDays,
            과거배당횟수: divs.length,
            예상연간횟수: Math.round(365 / dividendIntervalDays),
            계산된간격들: intervals,
        });

        // 1년간 배당 일정 생성
        const year = parseInt(targetYear);
        const startDate = new Date(year, 0, 1); // 1월 1일
        const endDate = new Date(year, 11, 31); // 12월 31일

        let currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            // 배당락일 (지급일 -1일)
            const payDate = new Date(currentDate);
            const exDate = new Date(currentDate);
            exDate.setDate(exDate.getDate() - 1);

            // 배당금 계산
            const dividendAmount = currentShares * perShareDividend;
            const pretaxDividend = dividendAmount / 0.85;
            const exchangeRate = 1400;
            const krwTax = pretaxDividend * exchangeRate;

            // 배당 레코드
            const dividendRecord = {
                날짜: formatJsDate(payDate),
                평단: `$${currentAvgPrice.toFixed(2)}`,
                보유량: `${currentShares.toFixed(0)} 주`,
                '거래(수량)': '',
                '거래(달러)': '',
                '거래(원화)': '',
                배당락일: formatJsDate(exDate),
                배당지급일: formatJsDate(payDate),
                배당기준: `${currentShares.toFixed(0)} 주`,
                '세후배당금($)': `$${dividendAmount.toFixed(2)}`,
                외화과표: `$${pretaxDividend.toFixed(2)}`,
                원화과표: `₩${Math.round(krwTax).toLocaleString()}`,
                '세후배당금(원화)': `₩${Math.round(dividendAmount * exchangeRate).toLocaleString()}`,
                환율: `₩${exchangeRate.toFixed(1)}`,
                지급기준: `$${perShareDividend.toFixed(4)}`,
                원금회수율: '',
                누적배당: '',
                누적TR: '',
                당일종가: `$${currentAvgPrice.toFixed(2)}`,
                '당일 평단': `$${currentAvgPrice.toFixed(2)}`,
                당일평가액: `$${(currentShares * currentAvgPrice).toFixed(2)}`,
            };

            transactions.push(dividendRecord);

            // 재투자 포함 시: 배당금으로 주식 매수
            if (isReinvestmentEnabled.value) {
                const sharesToBuy = dividendAmount / currentAvgPrice;
                const newShares = currentShares + sharesToBuy;

                // 거래 레코드 (배당금 재투자)
                const tradeRecord = {
                    날짜: formatJsDate(payDate),
                    평단: `$${currentAvgPrice.toFixed(2)}`,
                    보유량: `${newShares.toFixed(2)} 주`,
                    '거래(수량)': `+${sharesToBuy.toFixed(2)} 주`,
                    '거래(달러)': `$${dividendAmount.toFixed(2)}`,
                    '거래(원화)': `₩${Math.round(dividendAmount * exchangeRate).toLocaleString()}`,
                    배당락일: '',
                    배당지급일: '',
                    배당기준: '',
                    '세후배당금($)': '',
                    외화과표: '',
                    원화과표: '',
                    '세후배당금(원화)': '',
                    환율: `₩${exchangeRate.toFixed(1)}`,
                    지급기준: '',
                    원금회수율: '',
                    누적배당: '',
                    누적TR: '',
                    당일종가: `$${currentAvgPrice.toFixed(2)}`,
                    '당일 평단': `$${currentAvgPrice.toFixed(2)}`,
                    당일평가액: `$${(newShares * currentAvgPrice).toFixed(2)}`,
                };

                transactions.push(tradeRecord);
                currentShares = newShares; // 보유량 업데이트
            }

            // 다음 배당일로 이동
            currentDate.setDate(currentDate.getDate() + dividendIntervalDays);
        }

        console.log(`📅 ${targetYear}년 미래 데이터 생성:`, {
            레코드수: transactions.length,
            재투자여부: isReinvestmentEnabled.value,
            최종보유량: currentShares.toFixed(2),
            배당횟수: transactions.filter((t) => t['배당지급일']).length,
        });

        return transactions;
    };

    // 날짜 문자열 파싱 헬퍼 함수
    const parseDateString = (dateStr) => {
        if (!dateStr) return null;
        const parts = dateStr.trim().split(/\s+/);
        if (parts.length >= 3) {
            const year = parseInt('20' + parts[0].replace('.', ''));
            const month = parseInt(parts[1].replace('.', ''));
            const day = parseInt(parts[2].replace('.', ''));
            return new Date(year, month - 1, day);
        }
        return null;
    };

    // 필터링된 데이터
    const filteredTransactions = computed(() => {
        let filtered = [...displayTransactions.value];

        // 미래 년도 JSON 데이터 제외 (2026-2028년 데이터는 계산으로 대체)
        const currentYearNum = parseInt(currentYear);
        filtered = filtered.filter((row) => {
            const paymentDate = row['배당지급일'];
            if (paymentDate) {
                const year = extractYearFromPaymentDate(paymentDate);
                if (year) {
                    const yearNum = parseInt(year);
                    // 미래 년도 데이터는 JSON에서 제외 (계산으로 대체 예정)
                    if (yearNum > currentYearNum) {
                        return false;
                    }
                }
            }
            return true;
        });

        // 년도 필터 (배당지급일 기준)
        if (selectedYear.value) {
            const selectedYearNum = parseInt(selectedYear.value);

            // 미래 년도 선택 시: 계산된 데이터 생성
            if (selectedYearNum > currentYearNum) {
                filtered = generateFutureTransactions(selectedYear.value);
            } else {
                // 과거/현재 년도: JSON 데이터 필터링
                filtered = filtered.filter((row) => {
                    const paymentDate = row['배당지급일'];
                    if (!paymentDate) {
                        // 배당지급일이 없는 경우, 날짜 필드로 필터링
                        const dateStr = formatDate(row['날짜']);
                        const shortYear = selectedYear.value.slice(2); // "2025" -> "25"
                        return (
                            dateStr &&
                            (dateStr.startsWith(shortYear + '.') ||
                                dateStr.includes(selectedYear.value))
                        );
                    }
                    const year = extractYearFromPaymentDate(paymentDate);
                    return year === selectedYear.value;
                });
            }
        }

        // 혼합된 데이터(거래 + 배당) 분리 로직
        const splitFiltered = [];
        filtered.forEach((row) => {
            const hasTrade =
                (row['거래(수량)'] && row['거래(수량)'].trim() !== '') ||
                (row['거래(달러)'] && row['거래(달러)'].trim() !== '') ||
                (row['거래(원화)'] && row['거래(원화)'].trim() !== '');
            const hasDividend =
                (row['배당락일'] && row['배당락일'].trim() !== '') ||
                (row['배당지급일'] && row['배당지급일'].trim() !== '');

            // Summary 행(년도 표시)은 분리하지 않음
            const isSummary = row['날짜'] && String(row['날짜']).includes('년');

            if (hasTrade && hasDividend && !isSummary) {
                // 1. 배당 행 생성
                const divRow = { ...row };
                divRow['거래(수량)'] = '';
                divRow['거래(달러)'] = '';
                divRow['거래(원화)'] = '';
                splitFiltered.push(divRow);

                // 2. 거래 행 생성
                const tradeRow = { ...row };
                tradeRow['배당락일'] = '';
                tradeRow['배당지급일'] = '';
                tradeRow['배당기준'] = '';
                tradeRow['세후배당금($)'] = '';
                tradeRow['외화과표'] = '';
                tradeRow['원화과표'] = '';
                tradeRow['세후배당금(원화)'] = '';
                tradeRow['환율'] = '';
                tradeRow['지급기준'] = '';
                tradeRow['원금회수율'] = '';
                tradeRow['누적배당'] = '';
                tradeRow['누적TR'] = '';
                splitFiltered.push(tradeRow);
            } else {
                splitFiltered.push(row);
            }
        });
        filtered = splitFiltered;

        // 거래타입 필터
        if (selectedTransactionType.value === 'trade') {
            // 거래만 (배당락 ~ 누적 TR 컬럼 숨김, 거래 데이터가 있는 행만)
            filtered = filtered.filter(
                (row) =>
                    row['거래(수량)'] || row['거래(달러)'] || row['거래(원화)']
            );
        } else if (selectedTransactionType.value === 'dividend') {
            // 배당만 (배당락일 또는 배당지급일 컬럼에 값이 있는 행만)
            filtered = filtered.filter(
                (row) => row['배당락일'] || row['배당지급일']
            );
        }

        return filtered;
    });

    // 필터 초기화
    const resetFilters = () => {
        selectedYear.value = currentYear; // 올해로 초기화
        selectedTransactionType.value = 'all';
    };

    // 요약 행 판별 (첫 번째 행: "2028년")
    const isSummaryRow = (data) => {
        const dateStr = formatDate(data['날짜']);
        return dateStr && dateStr.includes('년');
    };

    // 배당 있는 행 판별 (배당락일 또는 배당지급일 컬럼에 값이 있으면)
    const hasDividend = (data) => {
        return (
            (data['배당락일'] && data['배당락일'].trim() !== '') ||
            (data['배당지급일'] && data['배당지급일'].trim() !== '')
        );
    };

    // 거래타입에 따라 컬럼 표시 여부 결정
    const shouldShowColumn = (columnName) => {
        if (selectedTransactionType.value === 'trade') {
            // 거래: 배당락일 ~ 누적 TR 숨김
            const hiddenCols = [
                '배당락일',
                '배당지급일',
                '배당기준',
                '세후배당금($)',
                '외화과표',
                '원화과표',
                '세후배당금(원화)',
                '환율',
                '지급기준',
                '원금회수율',
                '누적배당',
                '누적TR',
            ];
            return !hiddenCols.includes(columnName);
        } else if (selectedTransactionType.value === 'dividend') {
            // 배당: 평단 ~ 거래(원화) 숨김
            const hiddenCols = [
                '평단',
                '보유량',
                '거래(수량)',
                '거래(달러)',
                '거래(원화)',
            ];
            return !hiddenCols.includes(columnName);
        }
        return true; // 전체는 모든 컬럼 표시
    };
    // Chart Series Data
    const chartOption = computed(() => {
        const data = chartTransactions.value;
        if (data.length === 0) return {};

        const dates = data.map((d) => d['배당락일']);

        // 데이터 파싱
        const cumulativeDividend = data.map((d) => parseNumber(d['누적배당']));
        const cumulativeTR = data.map((d) => parseNumber(d['누적TR']));
        const avgPrice = data.map((d) => parseNumber(d['평단']));
        const recoveryRate = data.map((d) => parseNumber(d['원금회수율']));

        return {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
            },
            legend: {
                data: ['누적 배당금', '토탈 리턴', '평균단가', '원금 회수율'],
                top: 0,
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '3%',
                containLabel: true,
            },
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: dates,
                axisLabel: {
                    formatter: (value) => {
                        // "25. 11. 20." -> "25. 11. 20"
                        return value.replace(/\.$/, '');
                    },
                },
            },
            yAxis: [
                {
                    type: 'value',
                    name: '금액 ($)',
                    position: 'left',
                    axisLabel: {
                        formatter: '${value}',
                    },
                },
                {
                    type: 'value',
                    name: '회수율 (%)',
                    position: 'right',
                    axisLabel: {
                        formatter: '{value}%',
                    },
                },
            ],
            series: [
                {
                    name: '누적 배당금',
                    type: 'line',
                    step: 'start', // 계단식
                    symbol: 'rect',
                    symbolSize: 8,
                    itemStyle: { color: '#3b82f6' },
                    areaStyle: {
                        opacity: 0.2,
                        color: '#3b82f6',
                    },
                    data: cumulativeDividend,
                },
                {
                    name: '토탈 리턴',
                    type: 'line',
                    symbol: 'cross',
                    symbolSize: 8,
                    itemStyle: { color: '#ef4444' },
                    data: cumulativeTR,
                },
                {
                    name: '평균단가',
                    type: 'line',
                    symbol: 'circle',
                    symbolSize: 8,
                    itemStyle: { color: '#f97316' }, // Orange
                    data: avgPrice,
                },
                {
                    name: '원금 회수율',
                    type: 'line',
                    yAxisIndex: 1, // 오른쪽 Y축 사용
                    symbol: 'circle', // pentagon not standard in simple names, circle is fine or custom
                    symbolSize: 8,
                    itemStyle: { color: '#22c55e' }, // Green
                    data: recoveryRate,
                },
            ],
            dataZoom: [
                {
                    type: 'inside',
                    start: 0,
                    end: 100,
                },
                {
                    type: 'slider',
                    start: 0,
                    end: 100,
                },
            ],
        };
    });

    const addFutureYear = () => {
        const lastYear =
            futureYears.value.length > 0
                ? parseInt(futureYears.value[futureYears.value.length - 1])
                : new Date().getFullYear();
        futureYears.value.push((lastYear + 1).toString());
    };

    const removeFutureYear = (year) => {
        futureYears.value = futureYears.value.filter((y) => y !== year);
        // 만약 선택된 년도가 삭제되면 초기화
        if (selectedYear.value === year) {
            selectedYear.value = currentYear;
        }
    };

    // 차트용 데이터 생성 (전체 과거 + 활성화된 모든 미래)
    const chartTransactions = computed(() => {
        // 1. 과거 데이터 중 배당락일이 있는 데이터만 추출 및 정렬 (오래된 순)
        const history = displayTransactions.value
            .filter((row) => row['배당락일'] && row['배당락일'].trim() !== '')
            .map((row) => {
                // 날짜 파싱을 위해 Date 객체 추가
                const date = parseDateString(row['배당락일']);
                return { ...row, _date: date };
            })
            .sort((a, b) => a._date - b._date);

        if (history.length === 0) return [];

        // 2. 마지막 과거 데이터에서 누적 값 추출 (초기값)
        const lastHistory = history[history.length - 1];

        // 원금(InvestedCapital) 역산:
        // 누적TR = (Val + CumulativeDiv - Invested)
        // Invested = Val + CumulativeDiv - 누적TR
        const currentShares = parseNumber(lastHistory['보유량']);
        const currentPrice = parseNumber(lastHistory['당일종가']); // 종가가 없으면 평단 사용?
        // 데이터에 당일종가가 있지만 비어있을 수 있음. 없으면 평단사용
        const valPrice =
            currentPrice > 0 ? currentPrice : parseNumber(lastHistory['평단']);

        const lastValuation = currentShares * valPrice;
        const lastCumulativeDiv = parseNumber(lastHistory['누적배당']);
        const lastCumulativeTR = parseNumber(lastHistory['누적TR']);

        let initialInvestedCapital =
            lastValuation + lastCumulativeDiv - lastCumulativeTR;
        if (initialInvestedCapital <= 0) initialInvestedCapital = lastValuation; // Fallback

        // 미래 데이터 생성 루프
        let runningShares = currentShares;
        let runningAvgPrice = parseNumber(lastHistory['평단']);
        let runningCumulativeDiv = lastCumulativeDiv;
        // let runningInvested = initialInvestedCapital; // 원금은 추가 투입 없으면 고정 (재투자는 배당으로 사는 것이므로 원금 불변? 관점에 따라 다름. 여기선 단순화)
        // 재투자 시: 배당금 -> 주식. 내 주머니에서 나간 돈(원금)은 그대로.
        // 하지만 TR 계산 시 분모(Invested)는 그대로여야 수익률이 복리로 나옴.

        let runningTransactions = [];

        // 배당 주기 등 파라미터 계산 (generateFutureTransactions 로직 재사용)
        const perShareDividend = dividendBasisValue.value;
        const divs = historicalDividends.value;
        let dividendIntervalDays = 90;
        if (divs.length >= 2) {
            const intervals = [];
            for (let i = 0; i < Math.min(10, divs.length - 1); i++) {
                const d1 = parseDateString(divs[i].paymentDate);
                const d2 = parseDateString(divs[i + 1].paymentDate);
                if (d1 && d2)
                    intervals.push(Math.abs((d1 - d2) / (1000 * 60 * 60 * 24)));
            }
            if (intervals.length > 0)
                dividendIntervalDays = Math.round(
                    intervals.reduce((a, b) => a + b) / intervals.length
                );
        }

        // 미래 데이터 순차 생성
        let lastDate = history[history.length - 1]._date;

        futureYears.value.forEach((year) => {
            const yearNum = parseInt(year);
            const startDate = new Date(yearNum, 0, 1);
            const endDate = new Date(yearNum, 11, 31);

            // lastDate를 startDate 직전까지 밀기 (주기 유지)
            while (lastDate < startDate) {
                lastDate.setDate(lastDate.getDate() + dividendIntervalDays);
            }
            // 이미 startDate를 지났을 수 있으므로 조정 (간단히 year loop 안에서는 매번 체크)
            if (lastDate.getFullYear() < yearNum) {
                // 아직도 작으면 (gap이 크면) 맞춤.
                // 여기서는 간단히: lastDate + interval이 startDate보다 크거나 같을때까지
            }

            let currDate = new Date(lastDate);
            // 해당 년도 시작부터 채우기. currDate가 startDate보다 작으면 interval 더하기
            while (currDate < startDate) {
                currDate.setDate(currDate.getDate() + dividendIntervalDays);
            }

            while (currDate <= endDate) {
                // 배당락일 = 지급일 - 1일 가정 (데이터 일관성 위함)
                const exDate = new Date(currDate);
                exDate.setDate(exDate.getDate() - 1);

                if (exDate.getFullYear() === yearNum) {
                    // 해당 년도만
                    const divAmount = runningShares * perShareDividend;
                    runningCumulativeDiv += divAmount;

                    const currentValuation = runningShares * runningAvgPrice; // 가격 변동 없음 가정
                    const currentTR =
                        currentValuation +
                        runningCumulativeDiv -
                        initialInvestedCapital;
                    const recoveryRate =
                        initialInvestedCapital > 0
                            ? (runningCumulativeDiv / initialInvestedCapital) *
                              100
                            : 0;

                    const row = {
                        배당락일: formatJsDate(exDate),
                        배당지급일: formatJsDate(currDate),
                        누적배당: `$${runningCumulativeDiv.toFixed(2)}`,
                        누적TR: `$${currentTR.toFixed(2)}`,
                        평단: `$${runningAvgPrice.toFixed(2)}`,
                        원금회수율: `${recoveryRate.toFixed(2)}%`,
                        // 기타 필드...
                    };
                    runningTransactions.push(row);

                    if (isReinvestmentEnabled.value) {
                        const sharesToBuy = divAmount / runningAvgPrice;
                        runningShares += sharesToBuy;
                        // 평단은 그대로 (시장가 매수 가정 시 평단은 변하지만, 현재가=평단 가정하므로 불변)
                    }
                }
                currDate.setDate(currDate.getDate() + dividendIntervalDays);
            }
            lastDate = new Date(currDate); // 다음 년도 이어가기 위해
            // lastDate.setDate(lastDate.getDate() - dividendIntervalDays); // loop 마지막에 더해진거 취소? 아니지, year loop 밖에서 이어받아야함
            lastDate.setDate(lastDate.getDate() - dividendIntervalDays);
        });

        return [...history, ...runningTransactions];
    });
</script>

<style lang="scss" scoped>
    .asset-transaction-container {
        height: calc(100vh - 100px);
        padding: 0;

        .year-summary-button {
            min-width: 180px;
            height: auto;
            padding: 12px 16px;
            transition: all 0.2s ease;

            :deep(.p-button-label) {
                width: 100%;
            }

            // 미래 데이터 버튼 스타일
            &:deep(.p-button-outlined) {
                border-style: dashed;
                opacity: 0.85;

                &:hover {
                    opacity: 1;
                }
            }
        }

        :deep(.asset-transaction-table) {
            font-size: 12px;

            .p-datatable-wrapper {
                border: 1px solid #e0e0e0;
            }

            .p-datatable-thead > tr > th {
                background: #f3f3f3;
                color: #000;
                font-weight: 600;
                padding: 8px 12px;
                border: 1px solid #e0e0e0;
                text-align: center;
                white-space: nowrap;
            }

            .p-datatable-tbody > tr > td {
                padding: 6px 12px;
                border: 1px solid #e0e0e0;
                white-space: nowrap;

                > div {
                    &.summary-row {
                        background-color: #f8f9fa;
                        font-weight: 600;
                        padding: 4px 8px;
                        border-radius: 4px;
                    }

                    &.dividend-row {
                        background-color: #fff3cd;
                        padding: 4px 8px;
                        border-radius: 4px;
                    }
                }
            }

            // Frozen 컬럼 스타일
            .p-frozen-column {
                background: #fff;
                font-weight: 500;
            }

            // Striped rows
            .p-datatable-tbody > tr:nth-child(even) {
                background-color: #fafafa;
            }
        }
    }

    .chart-modal-container {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;

        .chart-content {
            width: 100%;
            height: 100%;
            min-height: 500px;
        }
    }
</style>
