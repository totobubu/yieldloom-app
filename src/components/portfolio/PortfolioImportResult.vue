<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import Tag from 'primevue/tag';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';

    const props = defineProps({
        receipt: { type: Object, required: true },
        busy: Boolean,
        accountsState: { type: String, default: 'loading' },
        latestHoldingsDate: { type: String, default: '' },
    });
    defineEmits(['view', 'export', 'another', 'calendar', 'retry']);
    const filter = ref('all'),
        page = ref(0),
        pageSize = 50;
    const hasDetails = computed(
        () =>
            props.receipt.rowResultsComplete === true &&
            Array.isArray(props.receipt.rowResults) &&
            props.receipt.rowResults.length ===
                props.receipt.inserted + props.receipt.duplicates
    );
    const rows = computed(() =>
        hasDetails.value ? props.receipt.rowResults : []
    );
    const filtered = computed(() =>
        rows.value.filter(
            (item) => filter.value === 'all' || item.status === filter.value
        )
    );
    const visibleRows = computed(() =>
        filtered.value.slice(page.value * pageSize, (page.value + 1) * pageSize)
    );
    const total = computed(
        () => props.receipt.inserted + props.receipt.duplicates
    );
    watch([() => props.receipt, filter], () => {
        page.value = 0;
    });
    const typeLabels = {
        buy: '매수',
        sell: '매도',
        dividend: '배당금',
        deposit: '입금',
        withdrawal: '출금',
        fee: '수수료',
        tax: '세금',
        split: '분할',
        transfer: '이체',
    };
    function number(value) {
        return typeof value === 'number' && Number.isFinite(value)
            ? value.toLocaleString('ko-KR', { maximumFractionDigits: 20 })
            : '미제공';
    }
    const currencyGroups = computed(() => {
        const groups = new Map();
        for (const item of rows.value) {
            if (item.status !== 'inserted' || !item.row.currency) continue;
            const group = groups.get(item.row.currency) || {
                currency: item.row.currency,
                count: 0,
                types: new Set(),
            };
            group.count++;
            group.types.add(item.row.type);
            groups.set(item.row.currency, group);
        }
        return [...groups.values()].map((group) => ({
            ...group,
            labels: [
                ...(group.types.has('buy') ? ['매수 금액'] : []),
                ...(group.types.has('sell') ? ['매도 금액'] : []),
                ...(group.types.has('deposit') || group.types.has('withdrawal')
                    ? ['입출금 순액']
                    : []),
                ...(group.types.has('dividend') ? ['배당 입금액'] : []),
            ],
        }));
    });
    const summaryGroups = computed(() =>
        currencyGroups.value.length
            ? currencyGroups.value
            : [
                  {
                      currency: '통화별 신규 내역 미제공',
                      count: null,
                      labels: [
                          '매수 금액',
                          '매도 금액',
                          '입출금 순액',
                          '배당 입금액',
                      ],
                  },
              ]
    );
    const heading = ref(null);
    function focusHeading() {
        heading.value?.focus({ preventScroll: true });
        heading.value
            ?.closest('.import-result')
            ?.scrollIntoView({ block: 'start' });
    }
    defineExpose({ focusHeading });
    const explanation = computed(() => {
        if (props.accountsState !== 'ready')
            return '저장은 완료되었습니다. 계좌 목록 갱신 상태를 확인해 주세요.';
        if (props.receipt.kind === 'transactions')
            return '거래 기록을 저장했고 계산 잔고에 반영했습니다. 증권사 잔고내역을 등록하면 해당 기준일 이후 거래만 누적합니다.';
        if (
            props.latestHoldingsDate &&
            props.latestHoldingsDate > props.receipt.asOf
        )
            return `과거 기준일 자료로 보관했습니다. 화면에는 더 최신인 ${props.latestHoldingsDate} 잔고가 표시됩니다.`;
        return '이 기준일의 전체 잔고가 한눈에 보기 > 보유 종목에 표시됩니다. 현재 시세로 계산한 평가액은 아닙니다.';
    });
</script>

<template>
    <div class="import-result">
        <header class="receipt-header">
            <div class="receipt-badges">
                <Tag value="데이터 가져오기 및 저장 영수증" /><Tag
                    severity="secondary"
                    :value="`기준일: ${receipt.asOf}`" />
            </div>
            <ol class="receipt-steps" aria-label="가져오기 진행 단계">
                <li>
                    <i class="pi pi-check" aria-hidden="true" />Step 1 파일
                    업로드
                </li>
                <li>
                    <i class="pi pi-check" aria-hidden="true" />Step 2 열
                    매핑·검토
                </li>
                <li aria-current="step">
                    <i class="pi pi-check-circle" aria-hidden="true" />Step 3
                    저장 결과 영수증
                </li>
            </ol>
            <div class="result-heading" role="status" aria-live="polite">
                <h2 ref="heading" tabindex="-1">
                    {{
                        receipt.inserted
                            ? '자료 저장이 완료되었습니다'
                            : '이미 등록된 자료입니다'
                    }}
                </h2>
                <Tag
                    :value="`${number(receipt.inserted)}건 저장 완료 · ${number(receipt.duplicates)}건 중복 제외`" />
            </div>
            <p class="receipt-description">
                총 {{ number(total) }}건 중 {{ number(receipt.inserted) }}건을
                새로 저장하고 {{ number(receipt.duplicates) }}건은 중복으로
                제외했습니다. ({{
                    receipt.kind === 'holdings' ? '잔고 기준일' : '조회 종료일'
                }}: {{ receipt.asOf }})
            </p>
        </header>
        <Card class="receipt-card">
            <template #content>
                <div class="receipt-workflow">
                    <div class="receipt-overview">
                        <div class="receipt-summary">
                            <i class="pi pi-receipt" aria-hidden="true" />
                            <div>
                                <h3>
                                    {{
                                        receipt.kind === 'holdings'
                                            ? '잔고내역'
                                            : '거래내역'
                                    }}
                                    저장 영수증
                                </h3>
                                <p>
                                    {{ receipt.accountAlias }} · 기준일
                                    {{ receipt.asOf }}
                                </p>
                            </div>
                            <Tag
                                severity="secondary"
                                value="저장 영수증 유지" />
                        </div>
                        <p class="result-explanation">{{ explanation }}</p>
                        <dl class="result-counts">
                            <div>
                                <dt>기준일</dt>
                                <dd>{{ receipt.asOf }}</dd>
                            </div>
                            <div>
                                <dt>연동 계좌</dt>
                                <dd>{{ receipt.accountAlias }}</dd>
                            </div>
                            <div>
                                <dt>업로드 파일</dt>
                                <dd>
                                    {{
                                        receipt.fileNames?.join(', ') ||
                                        '파일명 미제공'
                                    }}
                                </dd>
                            </div>
                        </dl>
                    </div>
                    <div class="receipt-side">
                        <section
                            class="receipt-finance"
                            aria-label="통화별 금융 요약 제공 상태">
                            <h3>통화별 요약</h3>
                            <p>
                                매수·매도 금액, 입출금 순액과 배당 입금액는 이
                                저장 영수증에서 제공하지 않습니다.
                            </p>
                            <div class="receipt-currencies">
                                <article
                                    v-for="group in summaryGroups"
                                    :key="group.currency">
                                    <div class="receipt-currency-title">
                                        <strong>{{ group.currency }}</strong
                                        ><span v-if="group.count != null"
                                            >{{ number(group.count) }}건 신규
                                            저장</span
                                        >
                                    </div>
                                    <dl>
                                        <div
                                            v-for="label in group.labels"
                                            :key="label">
                                            <dt>{{ label }}</dt>
                                            <dd>미제공</dd>
                                        </div>
                                    </dl>
                                </article>
                            </div>
                        </section>
                        <div
                            v-if="accountsState !== 'ready'"
                            class="receipt-refresh"
                            :role="
                                accountsState === 'error' ? 'alert' : 'status'
                            ">
                            <i
                                class="pi pi-exclamation-triangle"
                                aria-hidden="true" />
                            <div>
                                <strong>{{
                                    accountsState === 'error'
                                        ? '계좌 목록 새로고침이 필요합니다'
                                        : '계좌 목록을 갱신하고 있습니다'
                                }}</strong>
                                <p>
                                    저장 영수증은 유지됩니다. 계좌 목록 갱신이
                                    완료되면 잔고·거래, 배당 캘린더와 CSV
                                    내보내기를 이용할 수 있습니다.
                                </p>
                                <Button
                                    v-if="accountsState === 'error'"
                                    label="계좌 목록 다시 불러오기"
                                    icon="pi pi-refresh"
                                    severity="secondary"
                                    outlined
                                    :disabled="busy"
                                    @click="$emit('retry')" />
                            </div>
                        </div>
                        <div class="receipt-next">
                            <h3>후속 작업 및 확인</h3>
                            <div class="result-actions">
                                <Button
                                    :label="
                                        receipt.kind === 'holdings'
                                            ? '잔고 확인'
                                            : '저장 거래 확인'
                                    "
                                    :disabled="
                                        busy || accountsState !== 'ready'
                                    "
                                    @click="$emit('view')" />
                                <Button
                                    label="배당 캘린더 확인"
                                    icon="pi pi-calendar"
                                    severity="secondary"
                                    outlined
                                    :disabled="
                                        busy || accountsState !== 'ready'
                                    "
                                    @click="$emit('calendar')" />
                                <Button
                                    label="CSV로 내려받기"
                                    icon="pi pi-download"
                                    severity="secondary"
                                    outlined
                                    :disabled="
                                        busy || accountsState !== 'ready'
                                    "
                                    @click="$emit('export')" />
                            </div>
                            <p class="receipt-footnote">
                                CSV는 선택한 계좌의
                                {{
                                    receipt.kind === 'holdings'
                                        ? '잔고내역'
                                        : '거래내역'
                                }}을 내보냅니다. 이 영수증의 행만 내보내는
                                기능은 아닙니다.
                            </p>
                            <Button
                                class="receipt-another"
                                label="추가 등록"
                                icon="pi pi-upload"
                                severity="secondary"
                                outlined
                                :disabled="busy"
                                @click="$emit('another')" />
                        </div>
                    </div>
                </div>
                <section
                    class="receipt-detail"
                    aria-labelledby="receipt-details-title">
                    <div class="receipt-detail-title">
                        <h3 id="receipt-details-title">가져오기 내역 상세</h3>
                        <span>총 {{ number(total) }}건</span>
                    </div>
                    <template v-if="hasDetails">
                        <div
                            class="receipt-filters"
                            role="group"
                            aria-label="저장 결과 필터">
                            <Button
                                label="전체 결과"
                                :aria-pressed="filter === 'all'"
                                :severity="
                                    filter === 'all' ? 'primary' : 'secondary'
                                "
                                text
                                @click="filter = 'all'" />
                            <Button
                                :label="`신규 저장 (${number(receipt.inserted)})`"
                                :aria-pressed="filter === 'inserted'"
                                :severity="
                                    filter === 'inserted'
                                        ? 'primary'
                                        : 'secondary'
                                "
                                text
                                @click="filter = 'inserted'" />
                            <Button
                                :label="`중복 제외 (${number(receipt.duplicates)})`"
                                :aria-pressed="filter === 'duplicate'"
                                :severity="
                                    filter === 'duplicate'
                                        ? 'primary'
                                        : 'secondary'
                                "
                                text
                                @click="filter = 'duplicate'" />
                        </div>
                        <p class="receipt-footnote">
                            서버가 이번 저장 요청에서 판정한 행입니다. 신규 저장
                            표시는 현재 잔고 반영·금융사 확인을 뜻하지 않습니다.
                        </p>
                        <p class="receipt-scroll-hint">
                            가로 스크롤로 전체 열을 확인할 수 있습니다. →
                        </p>
                        <DataTable
                            class="receipt-table"
                            :pt="{
                                tableContainer: {
                                    tabindex: 0,
                                    role: 'region',
                                    'aria-label':
                                        '가져오기 결과 표 · 가로 스크롤',
                                },
                            }"
                            :value="visibleRows"
                            data-key="position"
                            scrollable
                            table-style="min-width:720px"
                            aria-label="가져오기 행별 저장 결과">
                            <Column header="상태"
                                ><template #body="{ data }"
                                    ><Tag
                                        :severity="
                                            data.status === 'duplicate'
                                                ? 'warn'
                                                : 'success'
                                        "
                                        :value="
                                            data.status === 'duplicate'
                                                ? '중복 제외'
                                                : '신규 저장'
                                        " /></template
                            ></Column>
                            <Column field="row.date" header="거래일자" /><Column
                                field="row.symbol"
                                header="종목/전표" />
                            <Column header="구분"
                                ><template #body="{ data }">{{
                                    typeLabels[data.row.type] ||
                                    data.row.type ||
                                    (receipt.kind === 'holdings'
                                        ? '잔고'
                                        : '유형 미제공')
                                }}</template></Column
                            >
                            <Column header="수량 (저장값)"
                                ><template #body="{ data }">{{
                                    number(data.row.quantity)
                                }}</template></Column
                            >
                            <Column header="금액 (저장값)"
                                ><template #body="{ data }">{{
                                    data.row.amount == null
                                        ? '미제공'
                                        : `${number(data.row.amount)} ${data.row.currency || '통화 미제공'}`
                                }}</template></Column
                            >
                            <Column header="상세 비고"
                                ><template #body="{ data }"
                                    >{{
                                        data.status === 'duplicate'
                                            ? '기존 내역과 일치하여 제외'
                                            : '신규 저장'
                                    }}<span v-if="data.row.externalId">
                                        · {{ data.row.externalId }}</span
                                    ></template
                                ></Column
                            >
                        </DataTable>
                        <div class="receipt-rows">
                            <article
                                v-for="item in visibleRows"
                                :key="item.position"
                                class="receipt-row"
                                :class="{
                                    duplicate: item.status === 'duplicate',
                                }">
                                <div class="receipt-row-status">
                                    <Tag
                                        :severity="
                                            item.status === 'duplicate'
                                                ? 'warn'
                                                : 'success'
                                        "
                                        :value="
                                            item.status === 'duplicate'
                                                ? '중복 제외'
                                                : '신규 저장'
                                        " /><time>{{ item.row.date }}</time
                                    ><span
                                        class="receipt-row-type"
                                        :class="`receipt-type-${item.row.type || 'unknown'}`"
                                        >{{
                                            typeLabels[item.row.type] ||
                                            item.row.type ||
                                            (receipt.kind === 'holdings'
                                                ? '잔고'
                                                : '유형 미제공')
                                        }}</span
                                    >
                                </div>
                                <div class="receipt-row-values">
                                    <strong>{{ item.row.symbol }}</strong>
                                    <div>
                                        <strong>{{
                                            item.row.amount == null
                                                ? '미제공'
                                                : `${number(item.row.amount)} ${item.row.currency || '통화 미제공'}`
                                        }}</strong>
                                        <p>
                                            {{
                                                item.row.quantity == null
                                                    ? '수량 미제공'
                                                    : `${number(item.row.quantity)}주`
                                            }}
                                            ·
                                            {{
                                                item.row.currency ||
                                                '통화 미제공'
                                            }}
                                        </p>
                                    </div>
                                </div>
                                <p class="receipt-row-reason">
                                    {{
                                        item.status === 'duplicate'
                                            ? '기존 등록 내역과 일치하여 제외했습니다.'
                                            : '이번 요청에서 새로 저장했습니다.'
                                    }}<span v-if="item.row.externalId">
                                        · 고유번호
                                        {{ item.row.externalId }}</span
                                    >
                                </p>
                            </article>
                        </div>
                        <p v-if="!filtered.length" class="receipt-footnote">
                            선택한 처리 결과가 없습니다.
                        </p>
                        <nav
                            v-if="filtered.length > pageSize"
                            class="receipt-pagination"
                            aria-label="저장 결과 페이지">
                            <Button
                                label="이전"
                                severity="secondary"
                                outlined
                                :disabled="page === 0"
                                @click="page--" /><span
                                >{{ page * pageSize + 1 }}–{{
                                    Math.min(
                                        (page + 1) * pageSize,
                                        filtered.length
                                    )
                                }}
                                / {{ number(filtered.length) }}</span
                            ><Button
                                label="다음"
                                severity="secondary"
                                outlined
                                :disabled="
                                    (page + 1) * pageSize >= filtered.length
                                "
                                @click="page++" />
                        </nav>
                    </template>
                    <p v-else class="receipt-unavailable">
                        이 영수증은 행별 저장 결과를 제공하지 않습니다.
                        저장·중복 건수는 위 영수증에서 확인하고, 계좌 갱신 후
                        저장 거래·잔고에서 실제 내역을 확인해 주세요.
                    </p>
                </section>
            </template>
        </Card>
    </div>
</template>

<style scoped>
    .import-result {
        display: flex;
        flex-direction: column;
        gap: 24px;
        color: var(--app-text);
        scroll-margin-top: var(--portfolio-scroll-offset, 90px);
        margin-bottom: 24px;
    }
    .receipt-header {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .receipt-badges {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }
    .receipt-steps {
        list-style: none;
        margin: 0;
        padding: 16px;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-steps li {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        color: var(--app-muted);
    }
    .receipt-steps i {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        flex-shrink: 0;
    }
    .receipt-steps [aria-current] {
        color: var(--app-accent);
        font-weight: 700;
    }
    .result-heading {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .result-heading h2 {
        margin: 0;
        font-size: 24px;
        line-height: 32px;
        letter-spacing: -0.01em;
        color: var(--app-text);
        font-weight: 700;
    }
    .receipt-description {
        margin: 0;
        color: var(--app-muted);
        font-size: 14px;
        line-height: 22.75px;
    }
    .receipt-card {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        box-shadow: 0 1px 2px #0000000d;
    }
    .receipt-card :deep(.p-card-body) {
        padding: 24px;
    }
    .receipt-summary {
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        padding: 16px;
    }
    .receipt-summary > i {
        border-radius: 50%;
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
    }
    .receipt-summary > div {
        flex: 1;
        min-width: 0;
    }
    .receipt-summary h3 {
        font-size: 16px;
        line-height: 24px;
        margin: 0;
    }
    .receipt-summary p {
        font-size: 12px;
        line-height: 18px;
        margin: 4px 0 0;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .result-counts {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin: 20px 0;
    }
    .result-counts > div {
        padding: 12px;
        background: var(--app-bg);
        border: 1px solid var(--app-border);
        border-radius: 8px;
    }
    .result-counts dt {
        font-size: 12px;
        color: var(--app-muted);
    }
    .result-counts dd {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 20px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .result-explanation {
        font-size: 13px;
        line-height: 20px;
        color: var(--app-muted);
    }
    .receipt-refresh {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px;
        border: 1px solid var(--p-yellow-400);
        background: color-mix(
            in srgb,
            var(--p-yellow-300) 10%,
            var(--app-surface)
        );
        border-radius: 8px;
        margin: 16px 0;
        font-size: 13px;
        line-height: 20px;
    }
    .receipt-refresh > i {
        margin-top: 3px;
        color: var(--p-yellow-600);
    }
    .receipt-refresh p {
        margin: 4px 0 12px;
    }
    .result-actions {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
        margin-top: 20px;
    }
    .result-actions :deep(.p-button-label) {
        white-space: normal;
    }
    .receipt-footnote {
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
        margin: 8px 0 12px;
    }
    .receipt-another {
        width: 100%;
        margin-top: 12px;
    }
    .receipt-detail-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }
    .receipt-detail-title h3,
    .receipt-finance h3 {
        font-size: 20px;
        line-height: 28px;
        margin: 0;
    }
    .receipt-detail-title > span {
        font-size: 12px;
        color: var(--app-muted);
    }
    .receipt-filters {
        display: flex;
        gap: 4px;
        padding: 4px;
        background: var(--app-bg);
        border-radius: 8px;
    }
    .receipt-filters > button {
        flex: 1;
        font-size: 12px;
    }
    .receipt-filters [aria-pressed='true'] {
        background: var(--app-surface);
    }
    .receipt-rows {
        display: grid;
        gap: 10px;
    }
    .receipt-row {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 2px #0000000d;
    }
    .receipt-row.duplicate {
        border-inline-start: 4px solid var(--p-yellow-400);
    }
    .receipt-row-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--app-muted);
        flex-wrap: wrap;
    }
    .receipt-row-type {
        margin-inline-start: auto;
    }
    .receipt-row-values {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin: 12px 0 8px;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
    }
    .receipt-row-values > div {
        text-align: right;
    }
    .receipt-row-values p {
        font-size: 11px;
        color: var(--app-muted);
        margin: 4px 0 0;
    }
    .receipt-row-reason {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
        margin: 0;
        border-top: 1px solid var(--app-border);
        padding-top: 8px;
        overflow-wrap: anywhere;
    }
    .receipt-pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 12px;
        font-size: 12px;
    }
    .receipt-unavailable {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 16px;
        font-size: 13px;
        line-height: 20px;
        color: var(--app-muted);
    }
    .receipt-finance > p {
        font-size: 12px;
        line-height: 18px;
        color: var(--app-muted);
    }
    .receipt-currencies {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }
    .receipt-currencies > article {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-currencies dl {
        display: grid;
        gap: 8px;
        font-size: 12px;
        margin: 12px 0 0;
    }
    .receipt-currencies dl > div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }
    .receipt-currencies dt {
        color: var(--app-muted);
    }
    .receipt-currencies dd {
        margin: 0;
    }
    @media (max-width: 640px) {
        .import-result {
            gap: 16px;
        }
        .receipt-header {
            gap: 12px;
        }
        .receipt-steps {
            padding: 12px;
            gap: 4px;
        }
        .receipt-steps li {
            flex: 1;
            flex-direction: column;
            gap: 4px;
            font-size: 10px;
            text-align: center;
        }
        .receipt-steps i {
            width: 24px;
            height: 24px;
        }
        .result-heading {
            gap: 6px;
        }
        .result-heading h2 {
            font-size: 20px;
            line-height: 28px;
        }
        .receipt-card :deep(.p-card-body) {
            padding: 16px;
        }
        .receipt-summary {
            padding: 12px;
            flex-wrap: wrap;
        }
        .receipt-summary > i {
            width: 32px;
            height: 32px;
        }
        .receipt-summary h3 {
            font-size: 15px;
            line-height: 20px;
        }
        .result-counts {
            gap: 8px;
            margin: 14px 0;
        }
        .result-counts > div {
            padding: 8px;
        }
        .result-counts dd {
            font-size: 13px;
            line-height: 20px;
        }
        .result-actions {
            grid-template-columns: minmax(0, 1fr);
            margin-top: 14px;
        }
        .receipt-refresh {
            padding: 12px;
        }
        .receipt-row {
            padding: 14px;
        }
        .receipt-currencies {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    .receipt-card :deep(.p-card-content) {
        display: flex;
        flex-direction: column;
        gap: 24px;
    }
    .receipt-workflow {
        display: contents;
    }
    .receipt-overview {
        order: 1;
    }
    .receipt-detail {
        order: 2;
    }
    .receipt-finance {
        order: 3;
    }
    .receipt-refresh {
        order: 4;
        margin: 0;
    }
    .receipt-next {
        order: 5;
    }
    .receipt-next h3 {
        font-size: 16px;
        line-height: 24px;
        margin: 0;
    }
    .result-counts {
        margin: 16px 0 0;
    }
    .result-counts > div {
        background: transparent;
        border: 0;
        padding: 0;
    }
    .result-counts dd {
        overflow-wrap: anywhere;
    }
    @media (max-width: 640px) {
        .receipt-card {
            display: contents;
        }
        .receipt-card :deep(.p-card-body),
        .receipt-card :deep(.p-card-content) {
            display: contents;
        }
        .receipt-workflow {
            display: flex;
            flex-direction: column;
            gap: 14px;
            padding: 16px;
            border: 1px solid var(--app-border);
            border-radius: 12px;
            background: var(--app-surface);
        }
        .receipt-overview {
            order: 0;
        }
        .receipt-finance {
            order: 1;
        }
        .receipt-refresh {
            order: 2;
        }
        .receipt-next {
            order: 3;
        }
        .receipt-detail {
            order: 4;
        }
        .result-counts {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
        }
        .result-counts > div {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            padding: 0;
            border-bottom: 1px solid var(--app-border);
        }
        .result-counts dd {
            text-align: right;
            max-width: 65%;
            font-weight: 500;
            margin-top: 0;
        }
    }

    .receipt-table {
        font-size: 12px;
    }
    .receipt-table :deep(.p-datatable-thead > tr > th) {
        font-size: 11px;
        padding: 12px 8px;
        background: var(--app-bg);
    }
    .receipt-table :deep(.p-datatable-tbody > tr > td) {
        padding: 16px 8px;
        overflow-wrap: anywhere;
        max-width: 220px;
    }
    .receipt-rows {
        display: none;
    }
    @media (max-width: 640px) {
        .receipt-table {
            display: none;
        }
        .receipt-rows {
            display: grid;
        }
    }

    :global(html:not(.p-dark)) .import-result {
        --app-text: #191c1e;
        --app-muted: #3e4947;
        --app-border: #bdc9c699;
        --app-bg: #f7f9fb;
        --app-surface: #fff;
    }
    .import-result :deep(.p-tag) {
        font-size: 11px;
        line-height: 16px;
        font-weight: 600;
        padding: 2px 6px;
        border-radius: 4px;
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 12%,
            var(--app-surface)
        );
    }
    .import-result :deep(.p-tag-warn) {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .receipt-badges :deep(.p-tag) {
        border-radius: 999px;
        padding: 3px 8px;
    }
    .receipt-summary :deep(.p-tag-secondary),
    .receipt-badges :deep(.p-tag-secondary) {
        color: var(--app-muted);
        background: var(--app-bg);
    }
    .import-result :deep(.p-button) {
        min-height: 44px;
        padding: 8px 12px;
        font-size: 13px;
        line-height: 18px;
        border-radius: 8px;
    }
    .receipt-filters :deep(.p-button) {
        min-height: 32px;
        padding: 6px 8px;
        font-size: 11px;
        line-height: 16px;
    }
    .receipt-row-type {
        border-radius: 999px;
        padding: 3px 8px;
        background: var(--app-bg);
        font-size: 11px;
        line-height: 16px;
    }
    .receipt-type-buy {
        color: var(--app-up);
        background: color-mix(in srgb, var(--app-up) 10%, var(--app-surface));
    }
    .receipt-type-sell {
        color: var(--app-accent);
        background: color-mix(
            in srgb,
            var(--app-accent) 12%,
            var(--app-surface)
        );
    }
    .receipt-type-dividend {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .receipt-row.duplicate .receipt-row-values strong {
        text-decoration: line-through;
        color: var(--app-muted);
    }

    .receipt-card {
        display: contents;
    }
    .receipt-card :deep(.p-card-body) {
        display: contents;
    }
    .receipt-card :deep(.p-card-content) {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
    .receipt-side {
        display: flex;
        flex-direction: column;
        gap: 16px;
        order: 3;
        min-width: 0;
    }
    .receipt-overview {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-detail {
        min-width: 0;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-finance {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .receipt-currencies {
        grid-template-columns: minmax(0, 1fr);
    }
    .receipt-next {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .result-actions {
        grid-template-columns: minmax(0, 1fr);
    }
    .receipt-refresh {
        margin: 0;
    }
    @media (min-width: 768px) {
        .receipt-card :deep(.p-card-content) {
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            grid-template-rows: min-content 1fr;
            gap: 20px;
            align-items: start;
        }
        .receipt-overview {
            grid-column: 1 / span 7;
            grid-row: 1;
        }
        .receipt-detail {
            grid-column: 1 / span 7;
            grid-row: 2;
        }
        .receipt-side {
            grid-column: 8 / span 5;
            grid-row: 1 / span 2;
        }
        .receipt-summary {
            flex-wrap: wrap;
        }
        .result-counts {
            grid-template-columns: minmax(0, 1fr);
            gap: 8px;
        }
        .result-counts > div {
            display: flex;
            gap: 8px;
        }
        .result-counts dd {
            margin: 0;
            font-weight: 500;
        }
        .receipt-detail-title {
            display: none;
        }
    }
    @media (max-width: 640px) {
        .receipt-side {
            order: 1;
        }
        .receipt-overview,
        .receipt-finance,
        .receipt-next {
            padding: 0;
            border: 0;
            background: transparent;
        }
        .receipt-detail {
            padding: 0;
            border: 0;
            background: transparent;
        }
        .receipt-summary {
            padding: 12px;
        }
    }
    .receipt-scroll-hint {
        font-size: 11px;
        color: var(--app-muted);
        text-align: right;
        margin: 4px 0 8px;
    }
    @media (max-width: 640px) {
        .receipt-scroll-hint {
            display: none;
        }
    }
    .receipt-currency-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .receipt-currency-title > span {
        font-size: 11px;
        color: var(--app-muted);
    }
</style>
