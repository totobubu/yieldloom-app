<script setup>
    import { computed, ref, watch, onScopeDispose, useId } from 'vue';
    import Button from 'primevue/button';
    import Checkbox from 'primevue/checkbox';
    import Column from 'primevue/column';
    import DataTable from 'primevue/datatable';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import StitchSymbol from './StitchSymbol.vue';
    import TossPdfImportReview from './TossPdfImportReview.vue';
    import GenericImportReviewCards from './GenericImportReviewCards.vue';
    import ImportReviewStatusSummary from './ImportReviewStatusSummary.vue';
    import GenericImportReviewTable from './GenericImportReviewTable.vue';
    import { reviewCurrencyBreakdown } from '@/services/importReviewCurrency.js';
    import { validCalendarDate } from '@/services/portfolioCalendar.js';
    import { importReviewGroups } from '@/services/tossImportReview.js';
    import {
        reviewDividendSummary,
        reviewMoney,
        reviewSecurityLabel,
    } from '@/services/importReviewPresentation.js';

    const props = defineProps({
        review: { type: Object, required: true },
        accountLabel: { type: String, required: true },
        busy: Boolean,
        saveDisabled: Boolean,
    });
    const emit = defineEmits(['update-row', 'commit', 'cancel']);
    const agreement = ref(false);
    const supplementaryTarget = `review-supplementary-${useId()}`;
    watch(
        () => [props.review.reviewId, props.accountLabel],
        () => {
            agreement.value = false;
        }
    );
    function updateRow(change) {
        agreement.value = false;
        emit('update-row', change);
    }
    function commitReview() {
        if (
            agreement.value &&
            !props.busy &&
            !props.saveDisabled &&
            props.review.rows.length
        )
            emit('commit');
    }
    const compactQuery =
        typeof window === 'undefined'
            ? null
            : window.matchMedia('(max-width: 640px)');
    const compactReview = ref(compactQuery?.matches || false);
    const updateCompactReview = (event) => {
        compactReview.value = event.matches;
    };
    compactQuery?.addEventListener('change', updateCompactReview);
    onScopeDispose(() =>
        compactQuery?.removeEventListener('change', updateCompactReview)
    );
    const pageSize = ref(50);
    const heading = ref(null);
    function focusHeading() {
        heading.value?.focus({ preventScroll: true });
        heading.value?.scrollIntoView({ block: 'center' });
    }
    defineExpose({ focusHeading });
    const search = ref('');
    const sortOrder = ref('oldest');
    const sortOptions = [
        { label: '오래된 순', value: 'oldest' },
        { label: '최신 순', value: 'newest' },
        { label: '원본 순', value: 'source' },
    ];
    const category = ref('all');
    const symbol = ref('');
    const onlyIssues = ref(false);
    const first = ref(0);
    const filterKey = computed(() =>
        JSON.stringify([
            search.value,
            category.value,
            symbol.value,
            onlyIssues.value,
            sortOrder.value,
        ])
    );
    watch(filterKey, () => {
        first.value = 0;
    });
    const isHoldings = computed(() => props.review.kind === 'holdings');
    const groups = computed(() =>
        importReviewGroups(props.review.rows, props.review.errors)
    );
    const issueIndices = computed(
        () => new Set(groups.value.unresolved.map((item) => item.index))
    );
    const symbols = computed(() => [
        { label: '전체 종목', value: '' },
        ...[
            ...new Set(
                props.review.rows.map((row) => row.symbol).filter(Boolean)
            ),
        ]
            .sort()
            .map((value) => ({
                label: reviewSecurityLabel(
                    props.review.rows.find((row) => row.symbol === value) || {
                        symbol: value,
                    }
                ),
                value,
            })),
    ]);
    const counts = computed(() => ({
        all: props.review.rows.length,
        dividend: props.review.rows.filter(
            (row) => row.type === 'dividend' || row.type === 'dividend_reversal'
        ).length,
        buy: props.review.rows.filter((row) => row.type === 'buy').length,
        sell: props.review.rows.filter((row) => row.type === 'sell').length,
        unresolved: groups.value.unresolved.length,
        cash: groups.value.cash.length,
    }));
    const filters = computed(() =>
        isHoldings.value
            ? [
                  { value: 'all', label: '전체' },
                  { value: 'unresolved', label: '검토 필요' },
              ]
            : [
                  { value: 'all', label: '전체' },
                  { value: 'dividend', label: '배당·취소' },
                  { value: 'buy', label: '주식 매수' },
                  { value: 'sell', label: '주식 매도' },
                  { value: 'cash', label: '현금·환전' },
                  { value: 'unresolved', label: '검토 필요' },
              ]
    );
    const filteredRows = computed(() => {
        const query = search.value.trim().toLocaleLowerCase();
        const result = groups.value.all.filter(
            ({ row, index }) =>
                (!symbol.value || row.symbol === symbol.value) &&
                (!onlyIssues.value || issueIndices.value.has(index)) &&
                (category.value === 'all' ||
                    (category.value === 'cash'
                        ? row.symbol === 'CASH'
                        : category.value === 'unresolved'
                          ? issueIndices.value.has(index)
                          : category.value === 'dividend'
                            ? ['dividend', 'dividend_reversal'].includes(
                                  row.type
                              )
                            : row.type === category.value)) &&
                (!query ||
                    [
                        row.symbol,
                        row.securityName,
                        row.rawType,
                        row.type,
                        row.date,
                        row.originalCode,
                        row.externalId,
                    ].some((value) =>
                        String(value ?? '')
                            .toLocaleLowerCase()
                            .includes(query)
                    ))
        );
        if (
            props.review.source === 'toss-pdf' ||
            isHoldings.value ||
            sortOrder.value === 'source'
        )
            return result;
        return result.sort((a, b) => {
            const av = validCalendarDate(a.row.date),
                bv = validCalendarDate(b.row.date);
            if (!av || !bv) return av ? -1 : bv ? 1 : a.index - b.index;
            return (
                a.row.date.localeCompare(b.row.date) *
                    (sortOrder.value === 'newest' ? -1 : 1) || a.index - b.index
            );
        });
    });
    const period = computed(() => {
        const dates = props.review.rows
            .map((row) => row.date)
            .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || ''))
            .sort();
        return dates.length
            ? `${dates[0]} ~ ${dates.at(-1)}`
            : '날짜를 확인해 주세요';
    });
    const sortCaption = computed(() => {
        const [begin, end] = period.value.split(' ~ ');
        const context =
            props.review.rows.every((row) => validCalendarDate(row.date)) &&
            begin &&
            end
                ? begin.slice(0, 7) === end.slice(0, 7)
                    ? begin.slice(0, 7)
                    : period.value
                : '날짜 확인 필요';
        return `정렬: ${sortOptions.find((option) => option.value === sortOrder.value)?.label} (${context})`;
    });
    const currencies = computed(
        () =>
            [
                ...new Set(
                    props.review.rows.map((row) => row.currency).filter(Boolean)
                ),
            ].join(' · ') || '통화 확인 필요'
    );
    const batches = computed(() => props.review.batches?.length || 1);
    const columns = computed(() => [
        { field: 'date', label: '거래일 / 기준일' },
        { field: 'symbol', label: '종목 코드' },
        { field: 'quantity', label: '수량' },
        {
            field: 'amount',
            label: isHoldings.value ? '기준일 평가액' : '거래 금액',
        },
        ...(!isHoldings.value ? [{ field: 'type', label: '거래 유형' }] : []),
    ]);
    const genericTransactions = computed(
        () => !isHoldings.value && props.review.source !== 'toss-pdf'
    );
    const currencyBreakdown = computed(() =>
        reviewCurrencyBreakdown(props.review.rows)
    );
    const dividendSummary = computed(() =>
        reviewDividendSummary(props.review.rows)
    );
    const chartCurrency = ref('');
    const chartSummary = computed(
        () =>
            dividendSummary.value.totals.find(
                (total) => total.currency === chartCurrency.value
            ) || dividendSummary.value.totals[0]
    );
    const chartMaximum = computed(() =>
        Math.max(1, ...(chartSummary.value?.months || []).map(Math.abs))
    );
    const symbolChips = computed(() => {
        const counts = new Map();
        props.review.rows.forEach((row) => {
            if (row.symbol)
                counts.set(row.symbol, (counts.get(row.symbol) || 0) + 1);
        });
        const values = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6);
        if (symbol.value && !values.some(([value]) => value === symbol.value))
            values.push([symbol.value, counts.get(symbol.value) || 0]);
        return values.map(([value, count]) => ({
            value,
            count,
            label: reviewSecurityLabel(
                props.review.rows.find((row) => row.symbol === value) || {
                    symbol: value,
                }
            ),
        }));
    });
    const cashCount = computed(
        () => props.review.rows.filter((row) => row.symbol === 'CASH').length
    );
    function resetFilters() {
        sortOrder.value = 'oldest';
        search.value = '';
        category.value = 'all';
        symbol.value = '';
        onlyIssues.value = false;
    }
</script>

<template>
    <div
        id="portfolio-import-review"
        class="import-review"
        :class="{ 'import-review--generic': genericTransactions }">
        <header class="review-heading">
            <div class="review-heading-copy">
                <div class="review-meta">
                    <span class="review-import-badge"
                        ><StitchSymbol
                            name="sync_alt"
                            class="review-sync-tablet" /><StitchSymbol
                            name="cloud_sync"
                            class="review-sync-mobile" />데이터 가져오기 및
                        등록</span
                    >
                    <span class="review-kind-badge">{{
                        isHoldings ? '보유 잔고' : '거래 내역'
                    }}</span>
                    <span v-if="!genericTransactions" class="account-capsule"
                        ><span />{{ accountLabel }}</span
                    >
                </div>
                <div class="review-title-line">
                    <h2 ref="heading" tabindex="-1">
                        증권 데이터 검토 및 확정
                    </h2>
                </div>
                <div v-if="review.statementFiles?.length" class="review-files">
                    <span
                        v-for="(file, index) in review.statementFiles"
                        :key="index"
                        ><i class="pi pi-file" aria-hidden="true" />{{
                            file.fileName
                        }}</span
                    >
                </div>
                <p v-if="genericTransactions">
                    업로드된 데이터 파싱 결과를 최종 확인하고 배당달력
                    포트폴리오에 안전하게 반영합니다.
                </p>
                <p v-else>
                    업로드된 자료 {{ counts.all.toLocaleString() }}건을 최종
                    확인하고 포트폴리오에 반영합니다. 확인이 필요한 내용은 저장
                    전에 수정하세요.
                </p>
                <h3 class="review-source">검토 · {{ review.source }}</h3>
            </div>
            <ol class="review-steps" aria-label="자료 등록 진행 단계">
                <li>
                    <b class="completed-step-number"
                        ><StitchSymbol name="check" /></b
                    ><span><small>완료 (Step 1)</small>파일 업로드</span>
                </li>
                <li aria-current="step">
                    <b>2</b><span><small>진행 중</small>데이터 검토</span>
                </li>
                <li>
                    <b>3</b><span><small>대기 (Step 3)</small>저장 결과</span>
                </li>
            </ol>
        </header>
        <ImportReviewStatusSummary
            v-if="genericTransactions && compactReview"
            :counts="counts"
            :summary="currencyBreakdown"
            :busy="busy"
            class="review-mobile-summary" />
        <!-- Keep the existing bindings in the reference guide, without duplicate forms. -->
        <Teleport
            :to="`#${supplementaryTarget}`"
            :disabled="!genericTransactions"
            defer>
            <details class="review-extra-metrics" :open="!genericTransactions">
                <summary>
                    {{
                        isHoldings
                            ? '잔고 상세 요약'
                            : '추출 배당·거래 상세 요약'
                    }}
                </summary>
                <div class="review-metrics">
                    <article class="metric-card">
                        <span
                            >총 추출 건수<i
                                class="pi pi-calculator"
                                aria-hidden="true" /></span
                        ><strong
                            >{{ counts.all.toLocaleString()
                            }}<small>건</small></strong
                        >
                        <p>
                            {{
                                review.fileCount
                                    ? `파일 ${review.fileCount}개`
                                    : isHoldings
                                      ? '전체 잔고 스냅샷'
                                      : '저장 전 추출 자료'
                            }}<b>{{ currencies }}</b>
                        </p>
                    </article>
                    <article class="metric-card">
                        <span
                            >{{ isHoldings ? '보유 종목' : '추출 배당 금액'
                            }}<i
                                class="pi pi-wallet"
                                aria-hidden="true" /></span
                        ><strong v-if="isHoldings"
                            >{{ symbols.length - 1 }}<small>개</small></strong
                        ><strong v-else class="dividend-total">{{
                            dividendSummary.totals.length
                                ? reviewMoney(
                                      dividendSummary.totals[0].amount,
                                      dividendSummary.totals[0].currency
                                  )
                                : '—'
                        }}</strong>
                        <p v-if="!isHoldings">
                            {{
                                dividendSummary.totals[1]
                                    ? reviewMoney(
                                          dividendSummary.totals[1].amount,
                                          dividendSummary.totals[1].currency
                                      )
                                    : '원문 거래금액 · 취소 차감'
                            }}<span v-if="dividendSummary.missing"
                                >금액 미확인
                                {{ dividendSummary.missing }}건</span
                            >
                        </p>
                        <p v-else>현금 CASH를 포함한 종목 코드 기준</p>
                    </article>
                    <article class="metric-card trade-metric">
                        <span
                            >{{ isHoldings ? '자료 기준일' : '주요 거래 요약'
                            }}<i
                                class="pi pi-arrow-right-arrow-left"
                                aria-hidden="true" /></span
                        ><strong v-if="isHoldings" class="metric-date">{{
                            review.asOf || '확인 필요'
                        }}</strong>
                        <div v-else class="trade-counts">
                            <div>
                                <small class="buy-label">매수</small
                                ><b
                                    >{{ counts.buy.toLocaleString()
                                    }}<em>건</em></b
                                >
                            </div>
                            <div>
                                <small class="sell-label">매도</small
                                ><b
                                    >{{ counts.sell.toLocaleString()
                                    }}<em>건</em></b
                                >
                            </div>
                            <div>
                                <small>현금·환전</small
                                ><b
                                    >{{ cashCount.toLocaleString()
                                    }}<em>건</em></b
                                >
                            </div>
                        </div>
                        <p class="period-label">조회 기간: {{ period }}</p>
                    </article>
                    <article class="metric-card issue-metric">
                        <span
                            ><span
                                ><i
                                    class="pi pi-exclamation-triangle"
                                    aria-hidden="true" />이상치 및 검토
                                필요</span
                            ><em>확인 요망</em></span
                        ><strong
                            >{{ counts.unresolved }}<small>건</small></strong
                        >
                        <p>
                            <span>추출 시 오류 · 미식별 거래</span
                            ><button
                                type="button"
                                :disabled="busy"
                                @click="category = 'unresolved'">
                                바로 보기
                            </button>
                        </p>
                    </article>
                </div>
                <p v-if="genericTransactions" class="review-extra-note">
                    추출 결과와 원문을 확인한 뒤 저장해 주세요. 필터와 관계없이
                    전체 행을 검증하며 오류가 남으면 저장되지 않습니다. 추출 후
                    1시간 이내 검토해 주세요.
                </p>
            </details>
        </Teleport>
        <div v-if="!genericTransactions" class="review-assurance">
            <span class="assurance-icon"
                ><i class="pi pi-verified" aria-hidden="true"
            /></span>
            <div>
                <strong>추출 결과와 원문을 확인한 뒤 저장해 주세요</strong>
                <p>
                    종목·거래 유형·금액을 직접 확인합니다. 오류가 남으면
                    저장되지 않으며, 필터와 관계없이 전체 행을 검증합니다.
                </p>
            </div>
            <span class="review-expiry">추출 후 1시간 이내 검토</span>
        </div>
        <details
            v-if="review.source === 'toss-pdf'"
            class="identity-disclosure"
            :open="saveDisabled">
            <summary>
                <i class="pi pi-id-card" aria-hidden="true" />거래내역서
                명의·계좌 확인<span>{{
                    saveDisabled ? '확인 필요' : '확인 완료'
                }}</span>
            </summary>
            <slot name="identity-review" />
        </details>
        <slot name="holdings-warning" />
        <div
            class="review-grid"
            :class="{ 'review-grid--generic': genericTransactions }">
            <div class="review-main">
                <article
                    class="review-toolbar"
                    :class="{ 'review-toolbar--generic': genericTransactions }">
                    <div class="filter-top-line">
                        <div
                            class="filter-categories"
                            role="group"
                            aria-label="거래 유형 필터">
                            <button
                                v-for="filter in filters"
                                :key="filter.value"
                                type="button"
                                :class="{
                                    active: category === filter.value,
                                    'issue-filter':
                                        filter.value === 'unresolved',
                                }"
                                :aria-pressed="category === filter.value"
                                :aria-label="`${filter.label} ${counts[filter.value]}`"
                                :disabled="busy"
                                @click="category = filter.value">
                                {{
                                    genericTransactions
                                        ? {
                                              dividend: '배당/배당취소',
                                              buy: '매수',
                                              sell: '매도',
                                              cash: '현금',
                                              unresolved: '확인 필요 이슈',
                                          }[filter.value] || filter.label
                                        : filter.label
                                }}<b>{{
                                    genericTransactions
                                        ? `(${counts[filter.value]})`
                                        : counts[filter.value]
                                }}</b>
                            </button>
                        </div>
                        <label v-if="!genericTransactions" class="issues-toggle"
                            ><input
                                v-model="onlyIssues"
                                type="checkbox"
                                :disabled="busy" /><span
                                class="toggle-track"
                                aria-hidden="true" />검토 필요 항목만
                            모아보기</label
                        >
                    </div>
                    <div class="review-filter-tools">
                        <div class="review-search">
                            <label class="search-field"
                                ><i
                                    class="pi pi-search"
                                    aria-hidden="true" /><InputText
                                    v-model="search"
                                    aria-label="추출 결과 검색"
                                    placeholder="종목명/코드/고유번호 검색..."
                                    :disabled="busy"
                                    size="small" /></label
                            ><Select
                                v-if="!genericTransactions"
                                v-model="symbol"
                                :options="symbols"
                                option-label="label"
                                option-value="value"
                                aria-label="추출 종목 필터"
                                :filter-fields="['label', 'value']"
                                placeholder="전체 종목 (모든 추출건)"
                                :disabled="busy"
                                filter
                                size="small" /><Button
                                v-if="!genericTransactions"
                                label="필터 초기화"
                                type="button"
                                text
                                size="small"
                                :disabled="busy"
                                @click="resetFilters" />
                        </div>
                        <div
                            v-if="genericTransactions"
                            class="review-sort-line">
                            <StitchSymbol v-if="compactReview" name="sort" />
                            <span>정렬 방식:</span
                            ><span
                                v-if="compactReview"
                                class="review-sort-label"
                                >{{
                                    sortOptions.find(
                                        (option) => option.value === sortOrder
                                    )?.label
                                }}</span
                            ><Select
                                v-else
                                v-model="sortOrder"
                                :options="sortOptions"
                                option-label="label"
                                option-value="value"
                                aria-label="거래 내역 정렬"
                                size="small"
                                :disabled="busy" />
                        </div>
                        <details
                            v-if="genericTransactions"
                            class="review-advanced-filters"
                            :open="!!symbol || onlyIssues">
                            <summary>
                                추가 필터{{
                                    symbol || onlyIssues ? ' · 적용 중' : ''
                                }}
                            </summary>
                            <div class="review-advanced-controls">
                                <label class="issues-toggle"
                                    ><input
                                        v-model="onlyIssues"
                                        type="checkbox"
                                        :disabled="busy" /><span
                                        class="toggle-track"
                                        aria-hidden="true" />검토 필요 항목만
                                    모아보기</label
                                ><Select
                                    v-model="symbol"
                                    :options="symbols"
                                    option-label="label"
                                    option-value="value"
                                    aria-label="추출 종목 필터"
                                    :filter-fields="['label', 'value']"
                                    placeholder="전체 종목 (모든 추출건)"
                                    :disabled="busy"
                                    filter
                                    size="small" /><Button
                                    label="필터 초기화"
                                    type="button"
                                    text
                                    size="small"
                                    :disabled="busy"
                                    @click="resetFilters" /><label
                                    v-if="compactReview"
                                    >정렬 방식<Select
                                        v-model="sortOrder"
                                        :options="sortOptions"
                                        option-label="label"
                                        option-value="value"
                                        aria-label="거래 내역 정렬"
                                        size="small"
                                        :disabled="busy"
                                /></label>
                            </div>
                            <div
                                class="symbol-chips"
                                role="group"
                                aria-label="주요 종목">
                                <span
                                    ><i
                                        class="pi pi-sliders-h"
                                        aria-hidden="true" />주요 종목:</span
                                ><button
                                    type="button"
                                    :class="{ active: !symbol }"
                                    :disabled="busy"
                                    @click="symbol = ''">
                                    전체</button
                                ><button
                                    v-for="chip in symbolChips"
                                    :key="chip.value"
                                    type="button"
                                    :class="{ active: symbol === chip.value }"
                                    :disabled="busy"
                                    :aria-label="`${chip.label} ${chip.count}건 보기`"
                                    @click="symbol = chip.value">
                                    {{ chip.label }}<b>{{ chip.count }}</b>
                                </button>
                            </div>
                        </details>
                    </div>
                    <div
                        v-if="!genericTransactions"
                        class="symbol-chips"
                        role="group"
                        aria-label="주요 종목">
                        <span
                            ><i
                                class="pi pi-sliders-h"
                                aria-hidden="true" />주요 종목:</span
                        ><button
                            type="button"
                            :class="{ active: !symbol }"
                            :disabled="busy"
                            @click="symbol = ''">
                            전체</button
                        ><button
                            v-for="chip in symbolChips"
                            :key="chip.value"
                            type="button"
                            :class="{ active: symbol === chip.value }"
                            :disabled="busy"
                            :aria-label="`${chip.label} ${chip.count}건 보기`"
                            @click="symbol = chip.value">
                            {{ chip.label }}<b>{{ chip.count }}</b>
                        </button>
                    </div>
                </article>
                <details v-if="review.errors?.length" class="review-errors">
                    <summary>
                        <i
                            class="pi pi-exclamation-triangle"
                            aria-hidden="true" />추출 시 확인된 항목
                        {{ review.errors.length }}건 · 수정 후 재검증
                    </summary>
                    <ul>
                        <li
                            v-for="(problem, index) in review.errors"
                            :key="index">
                            행 {{ problem.row }}: {{ problem.error }}
                        </li>
                    </ul>
                </details>
                <p
                    v-if="!compactReview || review.source === 'toss-pdf'"
                    class="review-scroll-cue">
                    <StitchSymbol name="swipe" />가로로 스크롤하여 세부 금액 및
                    원본 대조 열을 확인할 수 있습니다.
                </p>
                <div class="review-table-card">
                    <div
                        v-if="
                            review.source !== 'toss-pdf' &&
                            !compactReview &&
                            !genericTransactions
                        "
                        class="table-caption">
                        <strong>{{
                            isHoldings ? '보유 잔고 검토' : '거래 내역 검토'
                        }}</strong
                        ><span
                            >전체 {{ counts.all }}건 중
                            {{ filteredRows.length }}건 표시</span
                        >
                    </div>
                    <TossPdfImportReview
                        v-if="review.source === 'toss-pdf'"
                        :rows="review.rows"
                        :errors="review.errors"
                        :mapping-warning="review.mappingWarning"
                        :visible-indices="
                            filteredRows.map((item) => item.index)
                        "
                        :busy="busy"
                        :filter-key="filterKey"
                        :selected-symbol="symbol"
                        :cash-only="category === 'cash' || symbol === 'CASH'"
                        @update-row="updateRow($event)" />
                    <GenericImportReviewCards
                        v-else-if="compactReview"
                        v-model:first="first"
                        v-model:page-size="pageSize"
                        :rows="filteredRows"
                        :columns="columns"
                        :issue-indices="issueIndices"
                        :scope-key="review.reviewId"
                        :sort-label="genericTransactions ? sortCaption : ''"
                        :is-holdings="isHoldings"
                        :busy="busy"
                        @update-row="updateRow" />
                    <GenericImportReviewTable
                        v-else-if="genericTransactions"
                        v-model:first="first"
                        v-model:page-size="pageSize"
                        :rows="filteredRows"
                        :columns="columns"
                        :issue-indices="issueIndices"
                        :scope-key="review.reviewId"
                        :busy="busy"
                        @update-row="updateRow" />
                    <DataTable
                        v-else
                        v-model:first="first"
                        v-model:rows="pageSize"
                        :value="filteredRows"
                        data-key="index"
                        paginator
                        :rows-per-page-options="[25, 50, 100, 200]"
                        scrollable
                        scroll-height="600px"
                        striped-rows
                        table-style="min-width: 760px"
                        :row-class="
                            (data) =>
                                issueIndices.has(data.index)
                                    ? 'review-issue-row'
                                    : ''
                        ">
                        <template #empty
                            >표시할 자료가 없습니다. 검색어와 필터를
                            확인하세요.</template
                        >
                        <Column header="행" style="width: 4rem"
                            ><template #body="{ data }">{{
                                data.index + 1
                            }}</template></Column
                        >
                        <Column
                            v-for="column in columns"
                            :key="column.field"
                            :header="column.label"
                            ><template #body="{ data }"
                                ><div
                                    v-if="column.field === 'amount'"
                                    class="generic-money-input">
                                    <Select
                                        :model-value="data.row.currency"
                                        :options="[
                                            { label: '$', value: 'USD' },
                                            { label: '₩', value: 'KRW' },
                                        ]"
                                        option-label="label"
                                        option-value="value"
                                        :aria-label="`${data.index + 1}행 currency`"
                                        :disabled="busy"
                                        @update:model-value="
                                            updateRow({
                                                index: data.index,
                                                field: 'currency',
                                                value: $event,
                                            })
                                        " />
                                    <InputText
                                        :model-value="data.row.amount"
                                        :aria-label="`${data.index + 1}행 amount`"
                                        :disabled="busy"
                                        @update:model-value="
                                            updateRow({
                                                index: data.index,
                                                field: 'amount',
                                                value: $event,
                                            })
                                        " />
                                </div>
                                <InputText
                                    v-else
                                    :model-value="data.row[column.field]"
                                    :aria-label="`${data.index + 1}행 ${column.field}`"
                                    :disabled="busy"
                                    @update:model-value="
                                        updateRow({
                                            index: data.index,
                                            field: column.field,
                                            value: $event,
                                        })
                                    " /></template
                        ></Column>
                    </DataTable>
                </div>
                <article
                    v-if="genericTransactions"
                    class="review-example-guide"
                    :class="{ 'review-example-guide--mobile': compactReview }">
                    <header class="review-example-heading">
                        <h3>
                            <StitchSymbol
                                :name="
                                    compactReview ? 'help_outline' : 'info'
                                " />{{
                                compactReview
                                    ? '예시 검토 결과 안내'
                                    : '가상 예시 이슈 점검 가이드 (참고용 가이드)'
                            }}
                        </h3>
                        <details class="review-supplementary-disclosure">
                            <summary title="기존 검토 상세 정보 펼치기">
                                {{
                                    compactReview
                                        ? '참고용 가이드'
                                        : '원문 미지원 · 안내'
                                }}
                            </summary>
                            <div
                                :id="supplementaryTarget"
                                class="review-supplementary-info" />
                        </details>
                    </header>
                    <template v-if="compactReview">
                        <p class="review-example-explanation">
                            안내: 이 내용은 추가 업로드에서 발생할 수 있는 예시
                            오류(미등록 종목코드, 통화 코드 누락)에 대한 참고
                            안내이며 현재 자료의 검증 결과가 아닙니다.
                        </p>
                        <div class="review-example-code">
                            <span>[결측 예시 참고 데이터]</span
                            ><code
                                >20260307, 신규미식별종목, 매수, 10, ,
                                100000</code
                            >
                        </div>
                        <div class="review-example-instruction">
                            <StitchSymbol name="info" /><span
                                ><strong>점검 지침:</strong> 통화 누락 시 원문
                                확인 후 수정</span
                            >
                        </div>
                    </template>
                    <div v-else class="review-example-desktop-body">
                        <p>
                            이 내용은 추가 업로드에서 발생할 수 있는 예시
                            오류(미등록 종목코드, 통화 코드 누락)에 대한 참고
                            안내입니다. 행별 파일 원문은 미지원이므로 업로드
                            파일을 직접 대조해 주세요.
                        </p>
                        <div class="review-example-desktop-code">
                            <span>결측 예시 참고 데이터:</span
                            ><code
                                >20260307, 신규미식별종목, 매수, 10, , 100000 →
                                점검 지침: 통화 누락 시 수정 후 저장</code
                            >
                        </div>
                    </div>
                </article>
            </div>
            <aside class="review-sidebar" aria-label="추출 자료 확인 안내">
                <ImportReviewStatusSummary
                    v-if="genericTransactions && !compactReview"
                    :counts="counts"
                    :summary="currencyBreakdown"
                    :busy="busy" />
                <!-- Keep the existing bindings in the reference guide, without duplicate forms. -->
                <Teleport
                    :to="`#${supplementaryTarget}`"
                    :disabled="!genericTransactions"
                    defer>
                    <details
                        class="review-existing-guidance"
                        :open="!genericTransactions">
                        <summary>배당 기록·저장 상세 안내</summary>
                        <article class="review-side-card dividend-preview">
                            <h3>
                                <i
                                    class="pi pi-chart-line"
                                    aria-hidden="true" />배당 기록 미리보기<span
                                    class="preview-badge"
                                    >추출 자료 기준</span
                                >
                            </h3>
                            <p>
                                이번에 추출된 배당 거래의 금액과 월별
                                분포입니다. 저장 전 자료이며 세전·세후 기준은
                                원문에서 확인하세요.
                            </p>
                            <div
                                v-if="dividendSummary.totals.length > 1"
                                class="preview-currency">
                                <button
                                    v-for="total in dividendSummary.totals"
                                    :key="total.currency"
                                    type="button"
                                    :class="{
                                        active:
                                            chartSummary?.currency ===
                                            total.currency,
                                    }"
                                    :disabled="busy"
                                    @click="chartCurrency = total.currency">
                                    {{ total.currency }}
                                </button>
                            </div>
                            <div class="preview-metric">
                                <span>추출 배당 금액 (취소 차감)</span
                                ><strong>{{
                                    chartSummary
                                        ? reviewMoney(
                                              chartSummary.amount,
                                              chartSummary.currency
                                          )
                                        : '금액 미확인'
                                }}</strong>
                            </div>
                            <div class="preview-metric">
                                <span>배당 거래 기록</span
                                ><strong
                                    >{{ counts.dividend
                                    }}<small>건</small></strong
                                >
                            </div>
                            <div class="preview-metric">
                                <span>금액이 확인된 배당 기록</span
                                ><strong
                                    >{{ chartSummary?.count || 0
                                    }}<small
                                        >건 ·
                                        {{
                                            chartSummary?.currency ||
                                            '통화 미확인'
                                        }}</small
                                    ></strong
                                >
                            </div>
                            <div class="chart-heading">
                                <strong>월별 배당금 합계</strong
                                ><span>{{
                                    chartSummary?.currency || '—'
                                }}</span>
                            </div>
                            <div
                                class="dividend-bars"
                                role="img"
                                :aria-label="`추출 배당 기록의 월별 금액 분포 (${chartSummary?.currency || '자료 없음'})`">
                                <div
                                    v-for="(
                                        amount, month
                                    ) in chartSummary?.months ||
                                    Array(12).fill(0)"
                                    :key="month"
                                    :title="`${month + 1}월 ${reviewMoney(amount, chartSummary?.currency)}`">
                                    <span
                                        :class="{ negative: amount < 0 }"
                                        :style="{
                                            height: `${Math.max(3, (Math.abs(amount) / chartMaximum) * 78)}px`,
                                        }" /><small>{{ month + 1 }}월</small>
                                </div>
                            </div>
                            <p class="chart-note">
                                여러 해의 같은 월은 합산합니다. 기록이 없는 달은
                                추출된 배당 기록이 없는 달입니다.
                            </p>
                        </article>
                        <article class="review-side-card">
                            <h3>
                                <i
                                    class="pi pi-shield"
                                    aria-hidden="true" />안전 저장 및 검토 안내
                            </h3>
                            <ul class="save-guidance">
                                <li>
                                    <i
                                        class="pi pi-server"
                                        aria-hidden="true" />
                                    <div>
                                        <strong>{{
                                            batches > 1
                                                ? `200행 단위 · ${batches}개 묶음 저장`
                                                : '전체 행 검증 후 저장'
                                        }}</strong>
                                        <p>
                                            모든 자료를 먼저 검증합니다. 분할
                                            저장 중 실패하면 같은 미리보기에서
                                            다시 시도할 수 있습니다.
                                        </p>
                                    </div>
                                </li>
                                <li>
                                    <i
                                        class="pi pi-check-square"
                                        aria-hidden="true" />
                                    <div>
                                        <strong>{{
                                            isHoldings
                                                ? '전체 잔고 확인'
                                                : '거래 고유번호로 중복 확인'
                                        }}</strong>
                                        <p>
                                            {{
                                                isHoldings
                                                    ? '기준일의 전체 잔고를 입력합니다. 빠진 종목은 새 잔고에서 제외됩니다.'
                                                    : '같은 계좌의 동일 거래 고유번호를 확인합니다. 기존 거래를 자동으로 덮어쓰지 않습니다.'
                                            }}
                                        </p>
                                    </div>
                                </li>
                                <li>
                                    <i
                                        class="pi pi-filter"
                                        aria-hidden="true" />
                                    <div>
                                        <strong
                                            >필터는 표시할 거래만 변경</strong
                                        >
                                        <p>
                                            검색 결과와 관계없이 전체
                                            {{
                                                counts.all.toLocaleString()
                                            }}건이 검증·저장 대상입니다.
                                        </p>
                                    </div>
                                </li>
                            </ul>
                        </article>
                    </details>
                </Teleport>

                <article
                    v-if="genericTransactions && !compactReview"
                    class="review-pending-guide">
                    <StitchSymbol name="verified" />
                    <div>
                        <h3>저장 전 상태 안내</h3>
                        <p>
                            총 {{ counts.all }}건의 거래 자료는 최종 검증
                            전입니다. 필수 동의 후 전체 검증·저장을 진행해
                            주세요.
                        </p>
                    </div>
                </article>
                <article class="review-side-card review-save-bar">
                    <h3 v-if="!genericTransactions || !compactReview">
                        <StitchSymbol
                            v-if="genericTransactions"
                            name="task_alt" />최종 반영 동의 및 저장
                    </h3>
                    <div class="review-save-account">
                        <span>대상 계좌</span
                        ><strong>{{ accountLabel }}</strong>
                    </div>
                    <div class="review-agreement">
                        <Checkbox
                            v-model="agreement"
                            input-id="import-review-agreement"
                            binary
                            :pt="
                                genericTransactions
                                    ? {
                                          root: {
                                              style: {
                                                  width: '16px',
                                                  height: '16px',
                                              },
                                          },
                                          box: {
                                              style: {
                                                  width: '16px',
                                                  height: '16px',
                                              },
                                          },
                                      }
                                    : undefined
                            "
                            :disabled="busy" />
                        <label for="import-review-agreement"
                            ><strong>[필수]</strong> 원본 파일 대조 및 선택 계좌
                            거래·잔고 반영에 동의합니다.</label
                        >
                    </div>
                    <p
                        v-if="!agreement || saveDisabled"
                        class="review-agreement-required">
                        <StitchSymbol
                            v-if="genericTransactions"
                            name="info"
                            class="review-save-note-icon" />
                        {{
                            saveDisabled
                                ? '자료의 명의 확인과 반영 동의가 필요합니다.'
                                : '원본 대조 및 반영 동의를 확인해 주세요.'
                        }}
                    </p>
                    <Button
                        v-if="!genericTransactions"
                        type="button"
                        :label="
                            review.source === 'manual-holdings-v1'
                                ? '입력 다시 작성'
                                : '1단계: 파일 다시 선택하기'
                        "
                        icon="pi pi-arrow-left"
                        severity="secondary"
                        :text="!genericTransactions"
                        :outlined="genericTransactions"
                        :disabled="busy"
                        @click="emit('cancel')"
                        ><template v-if="genericTransactions" #icon
                            ><StitchSymbol
                                name="arrow_forward"
                                class="review-back-icon" /></template
                    ></Button>
                    <p v-if="!genericTransactions">
                        <i class="pi pi-info-circle" aria-hidden="true" />검토
                        필요 <strong>{{ counts.unresolved }}건</strong> · 저장
                        시 전체 {{ counts.all.toLocaleString() }}건을 다시
                        검증합니다.
                    </p>
                    <div class="review-save-actions">
                        <Button
                            v-if="!genericTransactions"
                            type="button"
                            label="취소"
                            severity="secondary"
                            :disabled="busy"
                            @click="emit('cancel')" /><Button
                            type="button"
                            :label="
                                genericTransactions
                                    ? '배당달력 포트폴리오에 저장 및 반영'
                                    : '수정 내용 검증·저장'
                            "
                            icon="pi pi-arrow-right"
                            icon-pos="right"
                            :loading="busy"
                            :disabled="
                                busy ||
                                saveDisabled ||
                                !counts.all ||
                                !agreement
                            "
                            @click="commitReview"
                            ><template v-if="genericTransactions" #icon
                                ><StitchSymbol
                                    :name="
                                        compactReview
                                            ? 'cloud_done'
                                            : 'cloud_upload'
                                    "
                                    class="review-save-icon" /></template
                        ></Button>
                        <Button
                            v-if="genericTransactions"
                            type="button"
                            class="review-return-button"
                            label="1단계: 파일 다시 선택하기"
                            severity="secondary"
                            outlined
                            :disabled="busy"
                            @click="emit('cancel')">
                            <template #icon
                                ><StitchSymbol
                                    name="arrow_forward"
                                    class="review-back-icon"
                            /></template>
                        </Button>
                    </div>
                </article>
            </aside>
        </div>
    </div>
</template>

<style scoped>
    .import-review {
        --review-tint: color-mix(
            in srgb,
            var(--app-accent) 6%,
            var(--app-surface)
        );
        --review-strong-tint: color-mix(
            in srgb,
            var(--app-accent) 12%,
            var(--app-surface)
        );
        --review-line: color-mix(
            in srgb,
            var(--app-accent) 10%,
            var(--app-surface)
        );
        min-width: 0;
        max-width: 834px;
        margin-inline: auto;
        scroll-margin-top: 90px;
        font-size: 13px;
        color: var(--app-text);
    }
    p {
        margin: 0;
    }
    .review-breadcrumb {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--app-muted);
        font-size: 11px;
        margin-bottom: 16px;
    }
    .review-breadcrumb i {
        font-size: 10px;
    }
    .review-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 28px;
    }
    .review-heading-copy {
        min-width: 0;
        flex: 1;
    }
    .review-title-line {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .review-title-line h2 {
        margin: 0;
        font-size: 23px;
        line-height: 1.4;
        color: var(--app-text);
        letter-spacing: -0.03em;
    }
    .account-capsule {
        max-width: 100%;
        min-width: 0;
        overflow-wrap: anywhere;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 2px 8px;
        border-radius: 20px;
        background: var(--review-strong-tint);
        font-size: 10px;
        font-weight: 650;
    }
    .account-capsule > span {
        flex-shrink: 0;
        width: 6px;
        height: 6px;
        background: var(--app-accent);
        border-radius: 50%;
    }
    .review-heading p {
        margin-top: 10px;
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.7;
        max-width: 760px;
    }
    .review-files {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 8px;
    }
    .review-files > span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 7px;
        border-radius: 6px;
        background: var(--review-tint);
        color: var(--app-muted);
        font-size: 10px;
        overflow-wrap: anywhere;
    }
    .review-source {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }
    .review-steps {
        display: flex;
        gap: 5px;
        list-style: none;
        padding: 6px;
        margin: 0;
        border-radius: 12px;
        background: var(--review-tint);
        flex-shrink: 0;
    }
    .review-steps li {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        font-size: 11px;
        line-height: 1.45;
        color: var(--app-muted);
    }
    .review-steps li:first-child {
        background: var(--app-surface);
        border-radius: 8px;
    }
    .review-steps li:first-child > i {
        color: #059669;
        font-size: 18px;
    }
    .review-steps li[aria-current] {
        color: var(--app-accent-contrast);
        background: var(--app-accent);
        border-radius: 8px;
        font-weight: 650;
    }
    .review-steps b {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--review-strong-tint);
        color: var(--app-muted);
    }
    .review-steps li[aria-current] b {
        background: var(--app-accent-contrast);
        color: var(--app-accent);
    }
    .review-steps .completed-step-number {
        display: none;
    }
    .review-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 24px;
    }
    .metric-card {
        min-width: 0;
        padding: 20px;
        background: var(--app-surface);
        border-radius: 12px;
        box-shadow: 0 1px 2px rgb(20 30 60 / 5%);
    }
    .metric-card > span {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        color: var(--app-muted);
        font-size: 12px;
    }
    .metric-card > span > i {
        color: var(--app-accent);
        font-size: 16px;
    }
    .metric-card > strong {
        display: block;
        margin: 8px 0 12px;
        line-height: 1.3;
        font-size: 32px;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.035em;
        overflow-wrap: anywhere;
    }
    .metric-card > strong small {
        margin-left: 7px;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0;
    }
    .metric-card p {
        display: flex;
        justify-content: space-between;
        gap: 5px;
        color: var(--app-muted);
        font-size: 11px;
        line-height: 1.5;
    }
    .metric-card p b {
        color: #059669;
        font-weight: 600;
    }
    .metric-card .dividend-total {
        font-size: clamp(21px, 2.3vw, 32px);
    }
    .metric-card .metric-date {
        font-size: 24px;
    }
    .trade-counts {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 10px 0 18px;
    }
    .trade-counts > div {
        min-width: 0;
    }
    .trade-counts > div + div {
        border-left: 1px solid var(--review-line);
        padding-left: 8px;
    }
    .trade-counts small {
        display: block;
        font-size: 10px;
        font-weight: 600;
        color: var(--app-muted);
        white-space: nowrap;
    }
    .trade-counts .buy-label {
        color: #e11d48;
    }
    .trade-counts .sell-label {
        color: var(--app-accent);
    }
    .trade-counts b {
        display: block;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        font-size: 18px;
        line-height: 1.5;
    }
    .trade-counts em {
        margin-left: 2px;
        font-size: 11px;
        font-style: normal;
    }
    .metric-card .period-label {
        font-size: 10px;
    }
    .issue-metric {
        background: color-mix(
            in srgb,
            var(--p-yellow-400) 9%,
            var(--app-surface)
        );
        color: var(--p-orange-700);
    }
    .issue-metric > span {
        flex-wrap: wrap;
        color: inherit;
        font-weight: 650;
    }
    .issue-metric > span > span {
        display: flex;
        align-items: center;
        gap: 5px;
    }
    .issue-metric em {
        padding: 1px 6px;
        border-radius: 5px;
        background: color-mix(
            in srgb,
            var(--p-yellow-400) 30%,
            var(--app-surface)
        );
        font-style: normal;
        font-size: 9px;
        white-space: nowrap;
    }
    .issue-metric p {
        flex-wrap: wrap;
        align-items: baseline;
        color: inherit;
        word-break: keep-all;
    }
    .issue-metric button {
        flex-shrink: 0;
        white-space: nowrap;
        border: 0;
        background: transparent;
        padding: 0;
        font: inherit;
        color: inherit;
        font-weight: 650;
        text-decoration: underline;
        cursor: pointer;
    }
    .review-assurance {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 17px 20px;
        border-radius: 12px;
        background: var(--app-surface);
        margin-bottom: 24px;
    }
    .assurance-icon {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        border-radius: 8px;
        background: var(--review-strong-tint);
        color: var(--app-accent);
        font-size: 18px;
    }
    .review-assurance strong {
        font-size: 14px;
    }
    .review-assurance p {
        margin-top: 2px;
        font-size: 11px;
        color: var(--app-muted);
    }
    .review-expiry {
        margin-left: auto;
        flex-shrink: 0;
        font-size: 11px;
        color: var(--app-muted);
    }
    .identity-disclosure {
        border: 1px solid var(--review-line);
        background: var(--app-surface);
        border-radius: 10px;
        margin-bottom: 20px;
        padding: 10px 16px;
        font-size: 12px;
    }
    .identity-disclosure > summary {
        display: flex;
        align-items: center;
        gap: 7px;
        cursor: pointer;
        font-weight: 600;
    }
    .identity-disclosure > summary > span {
        margin-left: auto;
        padding: 1px 7px;
        border-radius: 12px;
        background: var(--review-tint);
        color: var(--app-accent);
        font-size: 10px;
    }
    .review-grid {
        display: grid;
        grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
        align-items: start;
        gap: 16px;
    }
    .review-main,
    .review-sidebar {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        min-width: 0;
    }
    .review-toolbar {
        padding: 16px;
        border-radius: 12px;
        background: var(--app-surface);
    }
    .filter-top-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
    }
    .filter-categories {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
    }
    .filter-categories button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 18px;
        border: 0;
        background: var(--review-tint);
        color: var(--app-muted);
        font: inherit;
        font-size: 11px;
        line-height: 1.6;
        cursor: pointer;
    }
    .filter-categories b {
        font-size: 10px;
    }
    .filter-categories .active {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        font-weight: 650;
    }
    .filter-categories .issue-filter:not(.active) {
        background: color-mix(
            in srgb,
            var(--p-yellow-400) 20%,
            var(--app-surface)
        );
        color: #a16207;
    }
    .issues-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        position: relative;
        color: var(--app-muted);
        font-size: 11px;
        cursor: pointer;
    }
    .issues-toggle input {
        position: absolute;
        width: 32px;
        height: 18px;
        margin: 0;
        opacity: 0;
        cursor: pointer;
    }
    .toggle-track {
        display: inline-block;
        width: 32px;
        height: 18px;
        padding: 3px;
        background: var(--review-strong-tint);
        border-radius: 12px;
    }
    .toggle-track::before {
        content: '';
        display: block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--app-surface);
        transition: transform 0.15s;
    }
    .issues-toggle input:checked + .toggle-track {
        background: var(--app-accent);
    }
    .issues-toggle input:checked + .toggle-track::before {
        transform: translateX(14px);
    }
    .issues-toggle input:focus-visible + .toggle-track {
        outline: 2px solid var(--app-accent);
        outline-offset: 2px;
    }
    .review-search {
        display: grid;
        grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr) auto;
        gap: 8px;
        margin-top: 16px;
    }
    .search-field {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-left: 12px;
        background: var(--review-tint);
        border-radius: 7px;
        min-width: 0;
    }
    .search-field i {
        font-size: 13px;
        color: var(--app-muted);
    }
    .search-field .p-inputtext {
        min-width: 0;
        width: 100%;
        background: transparent;
        border: 0;
        box-shadow: none;
        font-size: 11px;
        padding: 10px 8px;
    }
    .review-search .p-select {
        min-width: 0;
        background: var(--review-tint);
        border: 0;
        border-radius: 7px;
        font-size: 11px;
    }
    .review-search .p-button {
        padding: 7px;
        font-size: 11px;
        background: var(--review-tint);
    }
    .symbol-chips {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px;
        margin-top: 16px;
        font-size: 10px;
    }
    .symbol-chips > span {
        display: flex;
        align-items: center;
        gap: 5px;
        color: var(--app-muted);
        margin-right: 3px;
    }
    .symbol-chips i {
        color: var(--app-accent);
    }
    .symbol-chips button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 0;
        padding: 3px 8px;
        background: var(--review-tint);
        border-radius: 14px;
        color: var(--app-text);
        font: inherit;
        cursor: pointer;
    }
    .symbol-chips b {
        color: var(--app-accent);
        font-size: 10px;
    }
    .symbol-chips .active {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .symbol-chips .active b {
        color: inherit;
    }
    .review-errors {
        padding: 9px 12px;
        border-radius: 8px;
        background: color-mix(
            in srgb,
            var(--p-yellow-400) 10%,
            var(--app-surface)
        );
        color: #a16207;
        font-size: 11px;
    }
    .review-errors summary {
        cursor: pointer;
    }
    .review-errors ul {
        padding-left: 20px;
        margin: 8px 0;
    }
    .review-table-card {
        min-width: 0;
    }
    .generic-money-input {
        display: flex;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface);
        min-width: 150px;
    }
    .generic-money-input .p-select {
        width: 60px;
        border: 0;
        box-shadow: none;
        background: transparent;
        flex-shrink: 0;
    }
    .generic-money-input .p-inputtext {
        width: 100%;
        min-width: 0;
        border: 0;
        box-shadow: none;
        background: transparent;
    }
    .generic-money-input :deep(.p-select-dropdown) {
        width: 20px;
    }
    .table-caption {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        padding: 12px;
        background: var(--app-surface);
        font-size: 12px;
    }
    .table-caption span {
        font-size: 11px;
        color: var(--app-muted);
    }
    .review-side-card {
        padding: 20px;
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 2px rgb(20 30 60 / 5%);
    }
    .review-side-card h3 {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 0 0 22px;
        font-size: 15px;
        letter-spacing: -0.02em;
    }
    .review-side-card h3 > i {
        color: var(--app-accent);
    }
    .review-side-card > p {
        margin-bottom: 16px;
        font-size: 12px;
        color: var(--app-muted);
        line-height: 1.65;
    }
    .preview-badge {
        margin-left: auto;
        padding: 2px 6px;
        border-radius: 12px;
        background: color-mix(in srgb, #10b981 13%, var(--app-surface));
        color: #047857;
        font-size: 9px;
        white-space: nowrap;
    }
    .preview-currency {
        display: flex;
        gap: 4px;
        margin: 10px 0;
    }
    .preview-currency button {
        border: 0;
        padding: 3px 10px;
        border-radius: 10px;
        background: var(--review-tint);
        color: var(--app-muted);
        font: inherit;
        font-size: 10px;
        cursor: pointer;
    }
    .preview-currency .active {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .preview-metric {
        padding: 14px;
        border-radius: 9px;
        background: var(--review-tint);
        margin-top: 10px;
    }
    .preview-metric > span {
        display: block;
        font-size: 11px;
        color: var(--app-muted);
    }
    .preview-metric > strong {
        display: block;
        text-align: right;
        margin-top: 7px;
        font-size: 19px;
        line-height: 1.4;
        font-variant-numeric: tabular-nums;
    }
    .preview-metric:first-of-type > strong {
        color: var(--app-accent);
    }
    .preview-metric small {
        font-size: 11px;
        margin-left: 4px;
    }
    .chart-heading {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 28px;
        font-size: 11px;
    }
    .chart-heading > span {
        color: var(--app-muted);
    }
    .dividend-bars {
        display: flex;
        align-items: flex-end;
        gap: 5px;
        height: 114px;
        padding-top: 18px;
    }
    .dividend-bars > div {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        height: 100%;
        min-width: 0;
    }
    .dividend-bars span {
        display: block;
        min-height: 3px;
        border-radius: 4px 4px 0 0;
        background: var(--review-strong-tint);
    }
    .dividend-bars > div:nth-child(3n) span {
        background: var(--app-accent);
    }
    .dividend-bars span.negative {
        background: #e11d48;
    }
    .dividend-bars small {
        display: block;
        text-align: center;
        font-size: 8px;
        color: var(--app-muted);
        margin-top: 5px;
        white-space: nowrap;
    }
    .review-side-card .chart-note {
        margin: 12px 0 0;
        font-size: 10px;
    }
    .save-guidance {
        padding: 0;
        margin: 0;
        list-style: none;
        display: grid;
        gap: 17px;
    }
    .save-guidance li {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        font-size: 12px;
        line-height: 1.5;
    }
    .save-guidance li > i {
        color: var(--app-accent);
        margin-top: 2px;
        font-size: 12px;
    }
    .save-guidance strong {
        font-size: 12px;
    }
    .save-guidance p {
        margin-top: 4px;
        color: var(--app-muted);
        font-size: 11px;
    }
    .review-save-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        position: sticky;
        bottom: 0;
        z-index: 20;
        margin-top: 30px;
        padding: 14px 18px;
        border-top: 1px solid var(--review-line);
        background: var(--app-surface);
        box-shadow: 0 -4px 20px rgb(20 30 60 / 4%);
    }
    .review-save-bar > .p-button {
        font-size: 11px;
        padding: 8px 0;
    }
    .review-save-bar > p {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px 12px;
        border-radius: 20px;
        background: color-mix(
            in srgb,
            var(--p-yellow-400) 9%,
            var(--app-surface)
        );
        color: var(--app-muted);
        font-size: 11px;
    }
    .review-save-actions {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
    }
    .review-save-actions .p-button {
        font-size: 12px;
        padding: 10px 14px;
    }
    button:focus-visible,
    summary:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    .p-dark .issue-metric {
        color: #fcd34d;
    }
    .p-dark .preview-badge {
        color: #6ee7b7;
    }
    @media (max-width: 1200px) {
        .review-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 1023px) {
        .review-heading {
            flex-direction: column;
            align-items: stretch;
        }
        .review-steps {
            align-self: flex-start;
        }
        .review-grid {
            grid-template-columns: minmax(0, 1fr);
        }
        .review-sidebar {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
        }
        .review-expiry {
            display: none;
        }
    }
    @media (max-width: 767px) {
        .review-steps {
            width: 100%;
        }
        .review-steps li {
            flex: 1 1 0;
            min-width: 0;
            flex-direction: column;
            padding: 10px 6px;
            gap: 6px;
            text-align: center;
            word-break: keep-all;
        }
        .review-steps .step-prefix,
        .review-steps li:first-child > i {
            display: none;
        }
        .review-steps .completed-step-number {
            display: grid;
            color: #059669;
        }
    }
    @media (max-width: 700px) {
        .review-breadcrumb {
            font-size: 10px;
        }
        .review-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .metric-card {
            padding: 14px;
        }
        .trade-metric,
        .issue-metric {
            grid-column: 1 / -1;
        }
        .metric-card > strong {
            font-size: 26px;
        }
        .metric-card .dividend-total {
            font-size: 22px;
        }
        .review-title-line h2 {
            font-size: 21px;
        }
        .review-search {
            grid-template-columns: minmax(0, 1fr) auto;
        }
        .review-search .search-field {
            grid-column: 1 / -1;
        }
        .symbol-chips {
            gap: 5px;
        }
        .review-sidebar {
            grid-template-columns: minmax(0, 1fr);
        }
        .review-assurance {
            padding: 14px;
        }
        .review-assurance strong {
            font-size: 12px;
        }
        .review-save-bar {
            position: static;
            flex-wrap: wrap;
            gap: 10px;
            padding: 14px;
        }
        .review-save-bar > p {
            order: 3;
            width: 100%;
        }
        .review-save-actions {
            margin-left: auto;
        }
    }
    @media (max-width: 360px) {
        .review-metrics {
            grid-template-columns: minmax(0, 1fr);
        }
    }
    .review-scroll-cue {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        margin: 0 0 12px;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-accent);
        background: var(--review-tint);
        border: 1px solid var(--review-line);
        border-radius: 8px;
    }
    /* Final reviewed import header; source body/financial panels remain under review. */
    .review-heading {
        display: block;
        padding: 20px;
        margin-bottom: 20px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        box-shadow: 0 1px 3px rgb(23 32 51 / 4%);
    }
    .review-meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
    }
    .review-import-badge,
    .review-kind-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 999px;
        padding: 4px 10px;
        font-size: 11px;
        line-height: 16px;
        background: var(--review-strong-tint);
        color: var(--app-accent);
    }
    .review-import-badge .stitch-symbol {
        font-size: 14px;
    }
    .review-import-badge .review-sync-mobile {
        display: none;
    }
    .review-kind-badge {
        background: var(--app-bg);
        color: var(--app-muted);
    }
    .review-title-line h2 {
        font-size: 24px;
        line-height: 32px;
        color: var(--app-brand-brown);
    }
    .review-heading p {
        margin-top: 4px;
        font-size: 14px;
        line-height: 20px;
    }
    .review-steps {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        width: 100%;
        padding: 16px 0 0;
        margin: 20px 0 0;
        border-top: 1px solid var(--app-border);
        border-radius: 0;
        background: transparent;
    }
    .review-steps li {
        display: flex;
        flex-direction: row;
        padding: 6px 0;
        gap: 10px;
        font-size: 13px;
        line-height: 18px;
        text-align: left;
    }
    .review-steps li:first-child {
        background: transparent;
    }
    .review-steps li[aria-current] {
        padding: 6px 10px;
        color: var(--app-accent);
        background: var(--review-tint);
        border: 1px solid var(--review-line);
    }
    .review-steps b,
    .review-steps .completed-step-number {
        display: grid;
        flex: 0 0 28px;
        width: 28px;
        height: 28px;
        border: 1px solid var(--app-border);
        font-size: 12px;
        color: var(--app-muted);
        background: var(--app-bg);
    }
    .review-steps .completed-step-number {
        color: var(--app-accent);
        background: var(--review-strong-tint);
    }
    .review-steps b .stitch-symbol {
        font-size: 16px;
    }
    .review-steps li[aria-current] b {
        color: var(--app-accent-contrast);
        background: var(--app-accent);
        border-color: var(--app-accent);
    }
    .review-steps li > span {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .review-steps small {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
        font-weight: 400;
    }
    @media (max-width: 640px) {
        .import-review {
            max-width: 358px;
        }
        .review-meta {
            margin-bottom: 12px;
        }
        .review-import-badge {
            border: 1px solid var(--review-line);
            font-size: 11px;
            line-height: 20px;
        }
        .review-import-badge .review-sync-tablet {
            display: none;
        }
        .review-import-badge .review-sync-mobile {
            display: inline-block;
        }
        .review-heading {
            padding: 0;
            background: transparent;
            border: 0;
            box-shadow: none;
        }
        .review-title-line h2 {
            font-size: 20px;
            line-height: 28px;
        }
        .review-heading p {
            font-size: 14px;
            line-height: 22.75px;
        }
        .review-steps {
            padding: 12px;
            margin-top: 12px;
            background: var(--app-surface);
            border: 1px solid var(--app-border);
            border-radius: 12px;
            gap: 8px;
        }
        .review-steps li,
        .review-steps li[aria-current] {
            padding: 0;
            gap: 6px;
            font-size: 12px;
            line-height: 16px;
            word-break: normal;
            border: 0;
            background: transparent;
        }
        .review-steps small {
            display: none;
        }
        .review-steps b,
        .review-steps .completed-step-number {
            flex-basis: 24px;
            width: 24px;
            height: 24px;
        }
    }
    .review-sidebar .review-save-bar {
        display: grid;
        align-items: stretch;
        justify-content: stretch;
        grid-template-columns: minmax(0, 1fr);
        position: static;
        margin-top: 0;
        padding: 16px;
        gap: 14px;
        box-shadow: 0 1px 2px rgb(23 32 51 / 6%);
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    .review-save-account {
        display: grid;
        gap: 4px;
        padding: 10px;
        border-radius: 8px;
        background: var(--app-bg);
        font-size: 11px;
        overflow-wrap: anywhere;
    }
    .review-save-account span {
        color: var(--app-muted);
    }
    .review-agreement {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 8px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
    }
    .review-agreement label {
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
    }
    .review-agreement label strong {
        color: var(--app-danger, #ba1a1a);
    }
    .review-sidebar .review-agreement-required {
        font-size: 11px;
        line-height: 18px;
        border-radius: 8px;
        justify-content: flex-start;
    }
    .review-sidebar .review-save-bar > p {
        order: initial;
        margin: 0;
        border-radius: 8px;
        justify-content: flex-start;
    }
    .review-save-bar > .p-button {
        order: 4;
    }
    .review-save-bar .review-save-actions {
        width: 100%;
        margin-left: 0;
        order: 3;
        display: grid;
        gap: 8px;
    }
    .review-save-bar .review-save-actions .p-button {
        width: 100%;
        min-height: 36px;
    }
    .review-table-card:has(.generic-review-cards) {
        background: transparent;
        border: 0;
        box-shadow: none;
    }
    .import-review--generic .review-existing-guidance {
        order: 10;
    }
    .review-extra-note {
        padding: 12px;
        font-size: 11px;
        line-height: 18px;
        color: var(--app-muted);
    }
    .review-mobile-summary {
        margin-bottom: 16px;
    }
    .import-review--generic {
        display: flex;
        flex-direction: column;
    }
    .import-review--generic > .review-extra-metrics {
        order: 2;
        margin-top: 16px;
    }
    .review-pending-guide {
        padding: 16px;
        border-radius: 12px;
        background: var(--app-warning-light);
        border: 1px solid
            color-mix(in srgb, var(--app-warning-text) 25%, var(--app-border));
    }
    .review-pending-guide h3 {
        margin: 0 0 8px;
        font-size: 14px;
        line-height: 20px;
    }
    .review-pending-guide p {
        font-size: 12px;
        line-height: 20px;
        color: var(--app-muted);
    }
    .review-grid--generic {
        grid-template-columns: minmax(0, 1fr);
    }
    @media (min-width: 1024px) {
        .review-grid--generic {
            grid-template-columns: repeat(12, minmax(0, 1fr));
        }
        .review-grid--generic > .review-main {
            grid-column: span 7;
        }
        .review-grid--generic > .review-sidebar {
            grid-column: span 5;
        }
    }
    @media (max-width: 640px) {
        .import-review--generic .review-toolbar--generic {
            padding: 0;
            border: 0;
            background: transparent;
        }
    }
    .review-extra-metrics {
        margin-bottom: 16px;
    }
    .review-extra-metrics > summary,
    .review-existing-guidance > summary {
        padding: 10px 12px;
        font-size: 11px;
        line-height: 18px;
        cursor: pointer;
        color: var(--app-accent);
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface);
    }
    .review-existing-guidance {
        min-width: 0;
    }
    .review-example-guide {
        padding: 14px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        font-size: 11px;
        line-height: 18px;
    }
    .review-example-guide h3 {
        font-size: 13px;
        line-height: 20px;
        margin: 0 0 10px;
    }
    .review-example-guide p {
        color: var(--app-muted);
        margin-bottom: 10px;
    }
    .review-example-guide code {
        display: block;
        padding: 10px;
        border-radius: 8px;
        background: var(--app-bg);
        overflow-wrap: anywhere;
    }
    .review-example-guide small {
        display: block;
        margin-top: 10px;
        color: var(--app-muted);
    }
    .review-toolbar--generic {
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    .review-toolbar--generic .filter-categories {
        flex-wrap: nowrap;
        overflow-x: auto;
        max-width: 100%;
        padding-bottom: 4px;
    }
    .review-toolbar--generic .filter-categories button {
        white-space: nowrap;
        flex-shrink: 0;
    }
    .review-toolbar--generic .filter-top-line {
        min-width: 0;
    }
    .review-toolbar--generic .review-search {
        grid-template-columns: minmax(0, 1fr);
    }
    .review-toolbar--generic .search-field {
        min-width: 0;
    }
    .review-toolbar--generic .search-field .p-inputtext {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 8px;
    }
    .review-sort-line {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        line-height: 18px;
        margin: 8px 0;
        color: var(--app-muted);
    }
    .review-sort-label {
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--review-tint);
        color: var(--app-accent);
        font-weight: 600;
    }
    .review-sort-line :deep(.p-select) {
        font-size: 12px;
    }
    .review-advanced-filters {
        font-size: 11px;
        line-height: 18px;
        border-top: 1px solid var(--app-border);
        margin-top: 8px;
    }
    .review-advanced-filters > summary {
        padding: 8px 0;
        cursor: pointer;
        color: var(--app-muted);
    }
    .review-advanced-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }
    .review-advanced-controls > label {
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .review-advanced-controls .issues-toggle {
        margin: 0;
    }
    .review-advanced-controls :deep(.p-select) {
        max-width: 100%;
        font-size: 11px;
    }
    .import-review--generic {
        font-family:
            ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji',
            'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
    }
    html:not(.p-dark) .import-review--generic .review-heading p {
        color: #3e4947;
    }
    .import-review--generic .review-toolbar--generic .search-field {
        display: block;
        position: relative;
        background: transparent;
    }
    .import-review--generic .review-toolbar--generic .search-field i {
        position: absolute;
        left: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 16px;
    }
    .import-review--generic
        .review-toolbar--generic
        .search-field
        .p-inputtext {
        padding-left: 32px;
        width: 100%;
    }
    .import-review--generic .review-save-bar {
        gap: 14px;
    }
    .import-review--generic .review-save-bar h3 {
        margin: 0;
        padding-bottom: 8px;
        border-bottom: 1px solid var(--app-border);
        font-size: 14px;
        line-height: 20px;
    }
    .import-review--generic .review-save-actions .p-button {
        min-height: 44px;
    }
    @media (min-width: 641px) {
        .import-review--generic .review-toolbar--generic {
            display: grid;
            grid-template-columns: 192px max-content minmax(0, 1fr);
            gap: 10px 8px;
        }
        .import-review--generic .filter-top-line {
            grid-column: 1/-1;
        }
        .import-review--generic .review-search {
            display: block;
            margin: 0;
            padding-top: 8px;
            border-top: 1px solid var(--app-border);
        }
        .import-review--generic .review-sort-line {
            margin: 0;
            gap: 4px;
            align-self: end;
            min-height: 32px;
            font-size: 12px;
        }
        .import-review--generic .review-sort-line :deep(.p-select) {
            height: 32px;
            min-width: 0;
            font-size: 12px;
        }
        .import-review--generic .review-sort-line :deep(.p-select-label) {
            padding: 4px 8px;
        }
        .import-review--generic .review-sort-line :deep(.p-select-dropdown) {
            width: 24px;
        }
        .import-review--generic .review-advanced-filters {
            margin: 0;
            border: 0;
            justify-self: end;
            align-self: end;
            min-width: 0;
        }
        .import-review--generic .review-advanced-filters[open] {
            grid-column: 1/-1;
            justify-self: stretch;
        }
        .import-review--generic .review-advanced-filters > summary {
            padding: 6px 0;
        }
        .import-review--generic
            .review-toolbar--generic
            .search-field
            .p-inputtext {
            height: 32px;
            font-size: 12px;
        }
        .import-review--generic .filter-categories {
            gap: 6px;
        }
        .import-review--generic .filter-categories button {
            white-space: normal;
            flex-shrink: 1;
            border-radius: 8px;
            font-size: 13px;
            line-height: 18px;
            padding: 6px 10px;
        }
    }
    @media (max-width: 640px) {
        .import-review--generic .review-toolbar--generic {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 10px;
        }
        .import-review--generic .filter-top-line,
        .import-review--generic .review-search {
            grid-column: 1/-1;
        }
        .import-review--generic .review-search {
            margin: 0;
        }
        .import-review--generic .review-sort-line {
            margin: 0;
        }
        .import-review--generic .review-advanced-filters {
            margin: 0;
            border: 0;
            align-self: center;
        }
        .import-review--generic .review-advanced-filters[open] {
            grid-column: 1/-1;
        }
        .import-review--generic .review-advanced-filters > summary {
            padding: 0;
        }
        .import-review--generic
            .review-toolbar--generic
            .search-field
            .p-inputtext {
            height: 44px;
        }
        .import-review--generic .review-save-account {
            display: flex;
            justify-content: space-between;
            align-items: start;
            gap: 12px;
            padding: 0 0 16px;
            border-bottom: 1px solid var(--app-border);
            border-radius: 0;
            background: transparent;
            font-size: 13px;
            line-height: 20px;
        }
        .import-review--generic .review-save-account strong {
            text-align: right;
        }
    }
    .import-review--generic .filter-categories button {
        display: block;
    }
    .import-review--generic .filter-categories b {
        margin-left: 4px;
        font: inherit;
    }
    .import-review--generic .review-toolbar--generic .search-field {
        padding-left: 0;
    }
    @media (max-width: 640px) {
        .review-mobile-summary {
            margin-bottom: 20px;
        }
        .review-grid--generic,
        .review-grid--generic .review-main,
        .review-grid--generic .review-sidebar {
            gap: 20px;
        }
    }
    .import-review--generic .review-scroll-cue {
        margin: 0;
    }
    @media (min-width: 641px) {
        .review-grid--generic .review-main,
        .review-grid--generic .review-sidebar {
            gap: 14px;
        }
        .import-review--generic .filter-categories {
            padding-bottom: 2px;
        }
        .import-review--generic
            .review-toolbar--generic
            .search-field
            .p-inputtext,
        .import-review--generic .review-sort-line :deep(.p-select) {
            min-height: 32px;
        }
    }
    @media (max-width: 640px) {
        .import-review--generic .filter-categories {
            padding: 2px 0;
            gap: 6px;
        }
        .import-review--generic .filter-categories button {
            font-size: 12px;
            line-height: 20px;
            padding: 6px 12px;
            border: 1px solid var(--app-border);
        }
        .import-review--generic .filter-categories button.active {
            border: 0;
        }
        .import-review--generic .review-sort-line {
            padding: 2px 4px;
        }
        .import-review--generic .review-sort-label {
            line-height: 20px;
        }
    }
    .review-filter-tools {
        display: contents;
    }
    .review-supplementary-info {
        display: grid;
        gap: 8px;
        margin-top: 10px;
    }
    .review-supplementary-info > details {
        margin: 0;
    }
    .review-supplementary-info > details > summary {
        padding: 4px 0;
        border: 0;
        background: transparent;
    }
    @media (max-width: 640px) {
        .import-review--generic .review-toolbar--generic {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .import-review--generic .review-filter-tools {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px 10px;
        }
        .import-review--generic .review-save-bar {
            gap: 16px;
        }
        .import-review--generic .review-save-account {
            padding-bottom: 12px;
            font-size: 12px;
        }
        .import-review--generic .review-save-account strong {
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            font-size: 13px;
        }
        .import-review--generic .review-agreement {
            padding: 0;
            border: 0;
            background: transparent;
        }
        .import-review--generic .review-agreement label {
            font-size: 12px;
            line-height: 16.5px;
        }
        .import-review--generic .review-agreement-required {
            padding: 10px;
            border: 1px solid var(--app-border);
            line-height: 20px;
        }
        .import-review--generic .review-save-actions .p-button {
            min-height: 48px;
        }
        html:not(.p-dark) .import-review--generic .review-agreement-required {
            border-color: #fed7aa;
            background: #fff7ed;
            color: #9a3412;
        }
    }
    .review-example-guide {
        padding: 16px;
    }
    .review-example-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
    }
    .review-example-heading h3 {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        font-size: 13px;
        line-height: 18px;
        margin: 0;
    }
    .review-example-heading .stitch-symbol {
        color: var(--app-accent);
        font-size: 18px;
    }
    .review-supplementary-disclosure {
        max-width: 45%;
        font-size: 12px;
        line-height: 16px;
    }
    .review-supplementary-disclosure > summary {
        list-style: none;
        cursor: pointer;
        padding: 2px 8px;
        border-radius: 4px;
        border: 1px solid var(--app-border);
        color: var(--app-accent);
        background: var(--app-accent-light);
    }
    .review-supplementary-disclosure > summary::-webkit-details-marker {
        display: none;
    }
    .review-supplementary-disclosure[open] {
        flex: 1 0 100%;
        max-width: 100%;
    }
    .review-example-desktop-body {
        padding: 12px;
        border-radius: 8px;
        background: var(--app-bg);
        border: 1px solid var(--app-border);
        font-size: 12px;
        line-height: 19.5px;
    }
    .review-example-desktop-body p {
        margin: 0 0 4px;
    }
    .review-example-desktop-code {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border: 1px solid var(--app-border);
        border-radius: 4px;
        font:
            11px/17.875px ui-monospace,
            SFMono-Regular,
            Menlo,
            monospace;
        background: var(--app-surface);
    }
    .review-example-desktop-code > span {
        color: var(--app-warning-text);
        font-weight: 600;
    }
    .review-example-desktop-code code {
        flex: 1;
        min-width: 0;
        padding: 0;
        margin: 0;
        border: 0;
        background: transparent;
        font: inherit;
    }
    .review-pending-guide {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 14px;
    }
    .review-pending-guide > .stitch-symbol {
        flex-shrink: 0;
        font-size: 20px;
        margin-top: 2px;
        color: var(--app-accent);
    }
    .review-pending-guide h3 {
        font-size: 13px;
        line-height: 18px;
        margin-bottom: 4px;
    }
    .review-pending-guide p {
        line-height: 19.5px;
    }
    html:not(.p-dark) .review-pending-guide {
        background: #fffbeb;
        border-color: #fef08a;
    }
    .review-sort-line > .stitch-symbol {
        font-size: 16px;
    }
    .import-review--generic .review-save-bar h3 {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        line-height: 18px;
    }
    .import-review--generic .review-save-bar h3 .stitch-symbol {
        font-size: 18px;
        color: var(--app-accent);
    }
    @media (max-width: 640px) {
        .review-example-guide {
            padding: 14px;
        }
        .review-example-heading {
            margin-bottom: 10px;
        }
        .review-example-heading h3 {
            font-size: 13px;
            line-height: 20px;
        }
        .review-example-heading .stitch-symbol {
            color: #f59e0b;
            font-size: 20px;
        }
        .review-supplementary-disclosure {
            font-size: 11px;
            line-height: 20px;
        }
        .review-supplementary-disclosure > summary {
            border: 0;
            border-radius: 999px;
            color: var(--app-muted);
            background: var(--app-bg);
            font-weight: 600;
        }
        .review-example-explanation {
            font-size: 12px;
            line-height: 16.5px;
            padding: 10px;
            border: 1px solid var(--app-border);
            border-radius: 8px;
            margin: 0 0 10px;
        }
        .review-example-code {
            background: #1e293b;
            border-radius: 8px;
            padding: 10px;
            overflow-x: auto;
            font:
                11px/17.875px ui-monospace,
                SFMono-Regular,
                Menlo,
                monospace;
            margin-bottom: 10px;
        }
        .review-example-code > span {
            display: block;
            color: #f59e0b;
            font-size: 10px;
            line-height: 16.25px;
            padding-bottom: 4px;
            font-weight: 600;
        }
        .review-example-code code {
            display: block;
            padding: 0;
            margin: 0;
            background: transparent;
            color: #e2e8f0;
            font: inherit;
            white-space: nowrap;
            overflow-wrap: normal;
        }
        .review-example-instruction {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 8px;
            border: 1px solid var(--app-border);
            border-radius: 8px;
            background: var(--app-bg);
            font-size: 11px;
            line-height: 15.125px;
            color: var(--app-muted);
        }
        .review-example-instruction > .stitch-symbol {
            font-size: 16px;
            flex-shrink: 0;
            margin-top: 2px;
        }
        .review-example-instruction strong {
            color: var(--app-text);
            font-weight: 600;
        }
        html:not(.p-dark) .review-example-explanation {
            background: #fff7ed;
            border-color: #fed7aa;
            color: #475569;
        }
    }
    .review-save-icon {
        font-size: 16px;
    }
    .review-back-icon {
        font-size: 14px;
        transform: rotate(180deg);
    }
    .review-save-note-icon {
        font-size: 15px;
    }
    .import-review--generic .review-save-actions .p-button {
        gap: 6px;
    }
    .import-review--generic .review-save-actions .p-button:disabled {
        opacity: 0.5;
    }
    .import-review--generic .review-save-bar > .p-button {
        gap: 4px;
    }
    @media (max-width: 640px) {
        .review-save-icon {
            font-size: 24px;
        }
        .review-back-icon {
            font-size: 18px;
        }
        .review-save-note-icon {
            font-size: 20px;
        }
        .import-review--generic .review-save-actions .p-button {
            gap: 8px;
            font-size: 14px;
            font-weight: 700;
            line-height: 20px;
        }
        .import-review--generic .review-agreement-required {
            gap: 8px;
        }
    }
    @media (min-width: 641px) {
        .import-review--generic .review-save-account {
            gap: 0;
            border: 1px solid var(--app-border);
            font-size: 11px;
            line-height: 16.5px;
        }
        .import-review--generic .review-save-account strong {
            font:
                700 12px/16px ui-monospace,
                SFMono-Regular,
                Menlo,
                monospace;
        }
        .import-review--generic .review-agreement label {
            line-height: 15px;
        }
        .import-review--generic .review-agreement-required {
            padding: 6px 10px;
            border: 1px solid var(--app-border);
            font-size: 12px;
            line-height: 16px;
        }
        .import-review--generic .review-save-bar > .p-button {
            min-height: 36px;
            height: 36px;
        }
    }
    html:not(.p-dark) .import-review--generic .review-scroll-cue {
        background: #f0fdfa;
        border-color: #99f3e4;
        color: #005048;
    }
    .import-review--generic .review-save-actions {
        padding-top: 4px;
    }
    .import-review--generic .review-save-actions .review-return-button {
        min-height: 36px;
        height: 36px;
        gap: 4px;
    }
    @media (max-width: 640px) {
        .import-review--generic .review-save-actions {
            padding-top: 0;
            gap: 16px;
        }
        .import-review--generic .review-save-actions .review-return-button {
            min-height: 44px;
            height: 44px;
        }
    }
</style>
