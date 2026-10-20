<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Column from 'primevue/column';
    import DataTable from 'primevue/datatable';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';
    import Select from 'primevue/select';
    import TossPdfImportReview from './TossPdfImportReview.vue';
    import { importReviewGroups } from '@/services/tossImportReview.js';

    const props = defineProps({
        review: { type: Object, required: true },
        accountLabel: { type: String, required: true },
        busy: Boolean,
        saveDisabled: Boolean,
    });
    const emit = defineEmits(['update-row', 'commit', 'cancel']);
    const search = ref('');
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
            .map((value) => ({ label: value, value })),
    ]);
    const counts = computed(() => ({
        all: props.review.rows.length,
        dividend: props.review.rows.filter(
            (row) => row.type === 'dividend' || row.type === 'dividend_reversal'
        ).length,
        buy: props.review.rows.filter((row) => row.type === 'buy').length,
        sell: props.review.rows.filter((row) => row.type === 'sell').length,
        unresolved: groups.value.unresolved.length,
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
                  { value: 'unresolved', label: '검토 필요' },
              ]
    );
    const filteredRows = computed(() => {
        const query = search.value.trim().toLocaleLowerCase();
        return groups.value.all.filter(
            ({ row, index }) =>
                (!symbol.value || row.symbol === symbol.value) &&
                (!onlyIssues.value || issueIndices.value.has(index)) &&
                (category.value === 'all' ||
                    (category.value === 'unresolved'
                        ? issueIndices.value.has(index)
                        : category.value === 'dividend'
                          ? ['dividend', 'dividend_reversal'].includes(row.type)
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
        { field: 'currency', label: '통화' },
        ...(!isHoldings.value ? [{ field: 'type', label: '거래 유형' }] : []),
    ]);
    function resetFilters() {
        search.value = '';
        category.value = 'all';
        symbol.value = '';
        onlyIssues.value = false;
    }
</script>

<template>
    <div id="portfolio-import-review" class="import-review">
        <div class="review-heading">
            <div>
                <span class="review-eyebrow">IMPORT REVIEW · 2 / 3</span>
                <h2>추출 결과 미리보기 · 저장 전 검토</h2>
                <p>
                    <i class="pi pi-wallet" aria-hidden="true" />{{
                        accountLabel
                    }}
                </p>
                <h3 class="review-source">검토 · {{ review.source }}</h3>
            </div>
            <ol class="review-steps" aria-label="자료 등록 진행 단계">
                <li>
                    <i class="pi pi-check-circle" aria-hidden="true" />파일 입력
                </li>
                <li aria-current="step"><span>2</span>결과 검토</li>
                <li><span>3</span>최종 저장</li>
            </ol>
        </div>
        <div class="review-metrics">
            <article class="metric-card">
                <span
                    >총 추출 건수<i
                        class="pi pi-database"
                        aria-hidden="true" /></span
                ><strong
                    >{{ counts.all.toLocaleString() }}<small>건</small></strong
                >
                <p>
                    {{ review.fileCount ? `파일 ${review.fileCount}개 · ` : ''
                    }}{{
                        isHoldings ? '전체 잔고 스냅샷' : '저장 전 추출 자료'
                    }}
                </p>
            </article>
            <article class="metric-card">
                <span
                    >{{ isHoldings ? '보유 종목' : '배당 기록'
                    }}<i class="pi pi-wallet" aria-hidden="true" /></span
                ><strong
                    >{{ isHoldings ? symbols.length - 1 : counts.dividend
                    }}<small>{{ isHoldings ? '개' : '건' }}</small></strong
                >
                <p>
                    {{
                        isHoldings
                            ? '현금 CASH를 포함한 종목 코드 기준'
                            : '배당 입금·배당 취소 포함'
                    }}
                </p>
            </article>
            <article class="metric-card">
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
                        <small>매수</small><b>{{ counts.buy }}건</b>
                    </div>
                    <div>
                        <small>매도</small><b>{{ counts.sell }}건</b>
                    </div>
                </div>
                <p>{{ currencies }} · 통화별 원본 기록</p>
            </article>
            <article class="metric-card issue-metric">
                <span
                    >이상치 및 검토 필요<i
                        class="pi pi-exclamation-triangle"
                        aria-hidden="true" /></span
                ><strong>{{ counts.unresolved }}<small>건</small></strong
                ><button
                    type="button"
                    :disabled="busy"
                    @click="category = 'unresolved'">
                    검토 필요 항목 보기
                    <i class="pi pi-arrow-right" aria-hidden="true" />
                </button>
            </article>
        </div>
        <Message severity="info" :closable="false" class="review-notice"
            >추출된 자료를 수정한 뒤 전체 행을 검증·저장합니다. 검토는 1시간
            유효하며, 오류가 남으면 저장되지 않습니다.</Message
        >
        <slot name="identity-review" />
        <slot name="holdings-warning" />
        <div class="review-grid">
            <div class="review-main">
                <article class="review-toolbar">
                    <div
                        class="filter-categories"
                        role="group"
                        aria-label="거래 유형 필터">
                        <Button
                            v-for="filter in filters"
                            :key="filter.value"
                            type="button"
                            :label="`${filter.label} ${counts[filter.value]}`"
                            :aria-pressed="category === filter.value"
                            :severity="
                                category === filter.value
                                    ? 'primary'
                                    : 'secondary'
                            "
                            :disabled="busy"
                            rounded
                            size="small"
                            @click="category = filter.value" />
                    </div>
                    <div class="review-search">
                        <label class="search-field"
                            ><i
                                class="pi pi-search"
                                aria-hidden="true" /><InputText
                                v-model="search"
                                aria-label="추출 결과 검색"
                                placeholder="종목명, 코드, 원문 유형 검색"
                                :disabled="busy"
                        /></label>
                        <Select
                            v-model="symbol"
                            :options="symbols"
                            option-label="label"
                            option-value="value"
                            aria-label="추출 종목 필터"
                            placeholder="전체 종목"
                            :disabled="busy" />
                    </div>
                    <div class="filter-footer">
                        <label
                            ><input
                                v-model="onlyIssues"
                                type="checkbox"
                                :disabled="busy" />검토 필요 항목만
                            모아보기</label
                        ><Button
                            label="필터 초기화"
                            type="button"
                            text
                            size="small"
                            :disabled="busy"
                            @click="resetFilters" />
                    </div>
                </article>
                <Message
                    v-if="review.errors?.length"
                    severity="warn"
                    :closable="false"
                    class="review-errors"
                    ><strong>추출 시 확인된 항목</strong>
                    <ul>
                        <li
                            v-for="(problem, index) in review.errors"
                            :key="index">
                            행 {{ problem.row }}: {{ problem.error }}
                        </li>
                    </ul>
                    <span>수정한 값은 저장할 때 다시 검증합니다.</span></Message
                >
                <div class="review-table-card">
                    <div class="table-caption">
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
                        @update-row="emit('update-row', $event)" />
                    <DataTable
                        v-else
                        v-model:first="first"
                        :value="filteredRows"
                        data-key="index"
                        paginator
                        :rows="50"
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
                                ><InputText
                                    :model-value="data.row[column.field]"
                                    :aria-label="`${data.index + 1}행 ${column.field}`"
                                    :disabled="busy"
                                    @update:model-value="
                                        emit('update-row', {
                                            index: data.index,
                                            field: column.field,
                                            value: $event,
                                        })
                                    " /></template
                        ></Column>
                    </DataTable>
                </div>
            </div>
            <aside class="review-sidebar" aria-label="추출 자료 확인 안내">
                <article class="review-side-card">
                    <h3>
                        <i class="pi pi-chart-bar" aria-hidden="true" />추출
                        자료 요약
                    </h3>
                    <dl>
                        <div>
                            <dt>자료 종류</dt>
                            <dd>{{ isHoldings ? '잔고내역' : '거래내역' }}</dd>
                        </div>
                        <div>
                            <dt>자료상 기간</dt>
                            <dd>{{ period }}</dd>
                        </div>
                        <div>
                            <dt>통화</dt>
                            <dd>{{ currencies }}</dd>
                        </div>
                        <div>
                            <dt>저장 대상</dt>
                            <dd>전체 {{ counts.all }}건</dd>
                        </div>
                    </dl>
                    <p>
                        검색과 필터는 화면에 표시할 자료만 바꿉니다. 저장은
                        필터와 관계없이 추출된 전체 행을 대상으로 합니다.
                    </p>
                </article>
                <article class="review-side-card">
                    <h3>
                        <i class="pi pi-shield" aria-hidden="true" />저장 전
                        확인사항
                    </h3>
                    <ul>
                        <li>
                            <strong>종목·유형·금액 확인</strong>
                            <p>
                                원문과 추출 결과를 비교하고, 오류나 미확인
                                종목을 수정하세요.
                            </p>
                        </li>
                        <li>
                            <strong>{{
                                batches > 1
                                    ? `${batches}개 묶음으로 저장`
                                    : '전체 행 검증 후 저장'
                            }}</strong>
                            <p>
                                저장 전 모든 묶음을 검증합니다. 분할 저장 중
                                실패하면 같은 미리보기에서 다시 시도할 수
                                있습니다.
                            </p>
                        </li>
                        <li>
                            <strong>{{
                                isHoldings
                                    ? '전체 잔고 확인'
                                    : '거래 고유번호 확인'
                            }}</strong>
                            <p>
                                {{
                                    isHoldings
                                        ? '기준일 전체 잔고를 입력해야 하며, 빠진 종목은 새 잔고에서 제외됩니다.'
                                        : '같은 계좌의 동일 거래 고유번호로 중복을 확인합니다. 자동 덮어쓰기는 하지 않습니다.'
                                }}
                            </p>
                        </li>
                    </ul>
                </article>
            </aside>
        </div>
        <div class="review-save-bar">
            <Button
                type="button"
                :label="
                    review.source === 'manual-holdings-v1'
                        ? '입력 다시 작성'
                        : '파일 다시 선택'
                "
                icon="pi pi-arrow-left"
                severity="secondary"
                text
                :disabled="busy"
                @click="emit('cancel')" />
            <p>
                <i class="pi pi-info-circle" aria-hidden="true" />전체
                {{ counts.all }}건을 다시 검증합니다. 아직 저장되지 않았습니다.
            </p>
            <div class="review-save-actions">
                <Button
                    type="button"
                    label="취소"
                    severity="secondary"
                    :disabled="busy"
                    @click="emit('cancel')" /><Button
                    type="button"
                    label="수정 내용 검증·저장"
                    icon="pi pi-arrow-right"
                    icon-pos="right"
                    :loading="busy"
                    :disabled="busy || saveDisabled || !counts.all"
                    @click="emit('commit')" />
            </div>
        </div>
    </div>
</template>

<style scoped>
    .import-review {
        --review-tint: color-mix(
            in srgb,
            var(--app-accent) 7%,
            var(--app-surface)
        );
        min-width: 0;
        scroll-margin-top: 100px;
    }
    .review-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 24px;
    }
    .review-eyebrow {
        color: var(--app-accent);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
    }
    .review-heading h2 {
        font-size: 24px;
        margin: 6px 0 10px;
        letter-spacing: -0.025em;
    }
    .review-heading p {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        color: var(--app-muted);
        font-size: 13px;
    }
    h3.review-source {
        margin: 8px 0 0;
        color: var(--app-muted);
        font-size: 12px;
        font-weight: 400;
    }
    .review-steps {
        display: flex;
        gap: 6px;
        list-style: none;
        padding: 6px;
        margin: 0;
        background: var(--review-tint);
        border-radius: 12px;
    }
    .review-steps li {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 12px;
        color: var(--app-muted);
        font-size: 12px;
        white-space: nowrap;
    }
    .review-steps li[aria-current] {
        color: var(--app-accent-contrast);
        background: var(--app-accent);
        border-radius: 8px;
        font-weight: 650;
    }
    .review-steps span {
        display: grid;
        place-items: center;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        border: 1px solid currentColor;
    }
    .review-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
    }
    .metric-card,
    .review-toolbar,
    .review-side-card,
    .review-table-card {
        min-width: 0;
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
    }
    .metric-card > span {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 13px;
        color: var(--app-muted);
    }
    .metric-card > span i {
        color: var(--app-accent);
    }
    .metric-card > strong {
        display: block;
        margin: 10px 0;
        font-size: 32px;
        font-variant-numeric: tabular-nums;
        line-height: 1.4;
    }
    .metric-card strong small {
        margin-left: 8px;
        font-size: 14px;
        font-weight: 500;
    }
    .metric-card p {
        margin: 8px 0 0;
        color: var(--app-muted);
        font-size: 12px;
    }
    .metric-card .metric-date {
        font-size: 22px;
        padding: 7px 0;
    }
    .trade-counts {
        display: flex;
        gap: 28px;
        margin: 10px 0;
    }
    .trade-counts small,
    .trade-counts b {
        display: block;
    }
    .trade-counts small {
        font-size: 11px;
        color: var(--app-muted);
    }
    .trade-counts b {
        font-size: 24px;
    }
    .issue-metric {
        background: color-mix(
            in srgb,
            var(--p-orange-500) 8%,
            var(--app-surface)
        );
    }
    .issue-metric button {
        background: transparent;
        border: 0;
        padding: 0;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        color: var(--app-text);
        text-decoration: underline;
    }
    .review-notice,
    .review-errors {
        margin: 20px 0;
    }
    .review-grid {
        display: grid;
        grid-template-columns: minmax(0, 3fr) minmax(270px, 1fr);
        gap: 24px;
        align-items: start;
    }
    .review-main,
    .review-sidebar {
        display: grid;
        gap: 18px;
        min-width: 0;
    }
    .filter-categories {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .filter-categories .p-button {
        font-size: 12px;
    }
    .review-search {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(140px, 0.6fr);
        gap: 10px;
        margin-top: 16px;
    }
    .search-field {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-left: 12px;
        border: 1px solid var(--app-border);
        border-radius: 10px;
        background: var(--app-surface);
    }
    .search-field i {
        color: var(--app-muted);
    }
    .search-field .p-inputtext {
        min-width: 0;
        width: 100%;
        border: 0;
        background: transparent;
    }
    .filter-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 12px;
        font-size: 12px;
    }
    .filter-footer label {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    input[type='checkbox'] {
        width: 17px;
        height: 17px;
        accent-color: var(--app-accent);
    }
    .review-table-card {
        padding: 0;
        overflow: hidden;
    }
    .table-caption {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 16px;
        font-size: 13px;
    }
    .table-caption span {
        color: var(--app-muted);
        font-size: 12px;
    }
    .review-table-card :deep(.p-inputtext) {
        width: 100%;
        min-width: 90px;
        font-size: 13px;
    }
    .review-table-card :deep(.p-datatable-thead > tr > th) {
        background: var(--review-tint);
        font-size: 12px;
    }
    .review-table-card :deep(.review-issue-row > td) {
        background: color-mix(
            in srgb,
            var(--p-orange-500) 7%,
            var(--app-surface)
        );
    }
    .review-side-card h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
        margin: 0 0 16px;
    }
    .review-side-card h3 i {
        color: var(--app-accent);
    }
    .review-side-card dl {
        display: grid;
        gap: 10px;
        margin: 0;
        font-size: 12px;
    }
    .review-side-card dl > div {
        padding: 10px;
        background: var(--review-tint);
        border-radius: 8px;
    }
    dt {
        color: var(--app-muted);
        margin-bottom: 4px;
    }
    dd {
        margin: 0;
        overflow-wrap: anywhere;
        font-weight: 600;
    }
    .review-side-card p {
        margin: 12px 0 0;
        color: var(--app-muted);
        font-size: 12px;
    }
    .review-side-card ul {
        padding-left: 16px;
        margin: 0;
        font-size: 13px;
    }
    .review-side-card li + li {
        margin-top: 16px;
    }
    .review-side-card li p {
        margin-top: 4px;
    }
    .review-save-bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 16px;
        padding: 18px;
        margin-top: 24px;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
    }
    .review-save-bar p {
        flex: 1;
        margin: 0;
        color: var(--app-muted);
        font-size: 12px;
    }
    .review-save-bar p i {
        color: var(--app-accent);
        margin-right: 6px;
    }
    .review-save-actions {
        display: flex;
        gap: 8px;
    }
    button:focus-visible,
    input[type='checkbox']:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    @media (max-width: 1150px) {
        .review-heading {
            flex-direction: column;
            align-items: flex-start;
        }
        .review-grid {
            grid-template-columns: minmax(0, 1fr);
        }
        .review-sidebar {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 700px) {
        .review-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .metric-card {
            padding: 14px;
        }
        .metric-card > strong {
            font-size: 28px;
        }
        .metric-card .metric-date {
            font-size: 16px;
        }
        .review-heading h2 {
            font-size: 21px;
        }
        .review-steps {
            width: 100%;
        }
        .review-steps li {
            flex: 1;
            padding: 8px 4px;
            font-size: 11px;
            gap: 4px;
        }
        .review-search,
        .review-sidebar {
            grid-template-columns: minmax(0, 1fr);
        }
        .review-toolbar {
            padding: 14px;
        }
        .review-save-bar {
            flex-direction: column;
            align-items: stretch;
        }
        .review-save-actions {
            flex-direction: column-reverse;
        }
    }
</style>
