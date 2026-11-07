<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Paginator from 'primevue/paginator';
    import { formatStoredAmount } from '@/utils/formatStoredAmount.js';
    import {
        loadValuationQuotes,
        valuePortfolio,
        valuationToday,
    } from '@/services/portfolioValuation.js';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';

    const props = defineProps({
        positions: { type: Array, required: true },
        ownerName: { type: Function, default: () => '명의자 미확인' },
        scopeAccountId: { type: String, default: '' },
        scopeAccountIds: { type: Array, default: null },
        accounts: { type: Array, default: () => [] },
        missingAccounts: { type: Number, default: 0 },
        estimatedPositions: { type: Number, default: 0 },
    });
    const firstRow = ref(0);
    watch(
        [
            () => props.scopeAccountId,
            () => props.scopeAccountIds,
            () => props.positions,
        ],
        () => {
            firstRow.value = 0;
        }
    );
    const emit = defineEmits(['request-transactions']);
    const quotes = ref({}),
        loading = ref(false),
        error = ref('');
    useFullscreenLoading(loading, '포트폴리오 평가 시세를 불러오고 있습니다.');
    const refresh = ref(0),
        today = ref(valuationToday());
    const accountNames = computed(
        () =>
            new Map(
                props.accounts.map((account) => [
                    account.id,
                    [account.alias, account.maskedNumber]
                        .filter(Boolean)
                        .join(' · '),
                ])
            )
    );
    const scopedPositions = computed(() =>
        props.scopeAccountIds !== null
            ? props.positions.filter((row) =>
                  props.scopeAccountIds.includes(row.accountId)
              )
            : props.scopeAccountId
              ? props.positions.filter(
                    (row) => row.accountId === props.scopeAccountId
                )
              : props.positions
    );
    const valuation = computed(() =>
        valuePortfolio(scopedPositions.value, quotes.value, {
            today: today.value,
        })
    );
    const detailRows = computed(() =>
        valuation.value.rows.slice(firstRow.value, firstRow.value + 10)
    );
    const money = (value) =>
        value == null
            ? '—'
            : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    watch(
        [() => props.positions, refresh],
        async ([positions], previous, onCleanup) => {
            const controller = new AbortController();
            onCleanup(() => controller.abort());
            quotes.value = {};
            error.value = '';
            loading.value = true;
            today.value = valuationToday();
            try {
                const result = await loadValuationQuotes(
                    positions.map((row) => row.symbol),
                    {
                        signal: controller.signal,
                        force:
                            previous?.[1] !== undefined &&
                            previous[1] !== refresh.value,
                    }
                );
                if (!controller.signal.aborted) quotes.value = result.quotes;
            } catch {
                if (!controller.signal.aborted)
                    error.value =
                        '시세를 불러오지 못했습니다. 다시 시도해 주세요.';
            } finally {
                if (!controller.signal.aborted) loading.value = false;
            }
        },
        { immediate: true }
    );
</script>

<template>
    <section
        class="valuation"
        aria-labelledby="valuation-title"
        :aria-busy="loading">
        <div class="valuation-comparison">
            <section class="stored-valuation-panel">
                <h2>저장 자료 평가액 합계</h2>
                <p>계좌별로 제공된 스냅샷 원본 평가액의 통화별 독립 합산</p>
                <slot name="stored-values" />
            </section>
            <section class="reference-valuation-panel">
                <div class="valuation-heading">
                    <div>
                        <h2 id="valuation-title">최근 종가 참고 평가액</h2>
                        <p>
                            저장된 보유수량이 유지됐다는 가정의 참고
                            평가액입니다.
                        </p>
                    </div>
                    <Button
                        label="시세 다시 조회"
                        icon="pi pi-refresh"
                        severity="secondary"
                        outlined
                        :loading="loading"
                        @click="refresh++" />
                </div>
                <p v-if="loading" role="status">
                    시세를 확인하고 있습니다. 최대 100종목을 조회합니다.
                </p>
                <Message v-else-if="error" severity="error" :closable="false">{{
                    error
                }}</Message>
                <template v-else>
                    <div v-if="!scopedPositions.length" class="valuation-empty">
                        <i class="pi pi-inbox" aria-hidden="true" />
                        <div>
                            <h3>아직 거래내역이 없습니다</h3>
                            <p>
                                거래내역을 추가하면 보유수량을 자동으로
                                계산합니다.
                            </p>
                            <p v-if="missingAccounts">
                                현재 선택 범위의 {{ missingAccounts }}개 계좌에
                                잔고내역이 없습니다.
                            </p>
                        </div>
                        <div class="valuation-empty-actions">
                            <Button
                                label="거래내역 추가"
                                icon="pi pi-upload"
                                @click="emit('request-transactions')" />
                        </div>
                    </div>
                    <div
                        v-if="valuation.currencies.length"
                        class="valuation-grid">
                        <article
                            v-for="group in valuation.currencies"
                            :key="group.currency"
                            class="valuation-card">
                            <h3>{{ group.currency }} 참고 평가액</h3>
                            <strong
                                :class="{
                                    'partial-total': group.valued < group.count,
                                }"
                                >{{
                                    group.valued
                                        ? formatStoredAmount(
                                              group.total,
                                              group.currency
                                          )
                                        : '—'
                                }}</strong
                            >
                            <p>
                                {{ group.valued }} / {{ group.count }}개 보유
                                항목 평가{{
                                    group.valued < group.count
                                        ? ' · 일부 합계'
                                        : ''
                                }}
                            </p>
                            <p v-if="group.valued">
                                종가 기준일 {{ group.oldestPriceDate
                                }}{{
                                    group.oldestPriceDate !==
                                    group.newestPriceDate
                                        ? ` ~ ${group.newestPriceDate}`
                                        : ''
                                }}
                            </p>
                            <p v-if="group.compared">
                                자료 평가액 대비 차이
                                {{ money(group.difference) }} {{ group.currency
                                }}<br /><small
                                    >비교 가능한 {{ group.compared }}개 항목만
                                    계산</small
                                >
                            </p>
                            <p v-else>자료 평가액 대비 차이 확인 불가</p>
                        </article>
                    </div>
                </template>
                <p class="valuation-note">
                    최근 일봉 가격을 사용하며 장중에는 미확정 가격일 수
                    있습니다. 현금은 제외하며 통화별로 구분합니다. 자료
                    평가액과의 차이는 취득원가 기준 손익·수익률이 아닙니다.
                </p>
            </section>
        </div>
        <template v-if="!loading && !error">
            <section
                v-if="valuation.rows.length"
                class="valuation-details"
                aria-labelledby="valuation-details-title">
                <header class="valuation-details-heading">
                    <h3 id="valuation-details-title">
                        보유 자산 내역 및 평가 명세
                    </h3>
                    <span>총 {{ valuation.rows.length }}건</span>
                </header>
                <DataTable
                    v-model:first="firstRow"
                    class="valuation-desktop"
                    :value="valuation.rows"
                    :paginator="valuation.rows.length > 10"
                    :rows="10"
                    scrollable
                    table-style="min-width: 60rem"
                    aria-label="보유 항목별 최근 종가 평가와 데이터 상태">
                    <Column header="명의자 / 계좌"
                        ><template #body="{ data }"
                            ><span class="valuation-primary-label">{{
                                ownerName(data.ownerId)
                            }}</span
                            ><small class="valuation-detail">{{
                                accountNames.get(data.accountId) ||
                                '계좌 미확인'
                            }}</small></template
                        ></Column
                    >
                    <Column field="symbol" header="종목"
                        ><template #body="{ data }"
                            ><span class="valuation-primary-label">{{
                                data.symbol
                            }}</span></template
                        ></Column
                    >
                    <Column field="currency" header="통화"
                        ><template #body="{ data }"
                            ><span class="valuation-currency-chip">{{
                                data.currency
                            }}</span></template
                        ></Column
                    >
                    <Column header="저장 수량"
                        ><template #body="{ data }">{{
                            data.quantity ?? '—'
                        }}</template></Column
                    >
                    <Column header="자료 평가액"
                        ><template #body="{ data }">{{
                            data.baseline == null
                                ? '—'
                                : formatStoredAmount(
                                      data.baseline,
                                      data.currency
                                  )
                        }}</template></Column
                    >
                    <Column header="잔고 기준일"
                        ><template #body="{ data }"
                            >{{ data.asOf || '미확인'
                            }}<small
                                v-if="data.oldSnapshot"
                                class="valuation-detail"
                                >30일 초과</small
                            ></template
                        ></Column
                    >
                    <Column header="종가"
                        ><template #body="{ data }">{{
                            data.price == null
                                ? '—'
                                : formatStoredAmount(data.price, data.currency)
                        }}</template></Column
                    >
                    <Column header="시세 기준일 · 출처"
                        ><template #body="{ data }"
                            >{{ data.priceDate || '미확인'
                            }}<small class="valuation-detail">{{
                                data.source || '출처 미확인'
                            }}</small></template
                        ></Column
                    >
                    <Column header="참고 평가액"
                        ><template #body="{ data }">{{
                            data.value == null
                                ? '—'
                                : formatStoredAmount(data.value, data.currency)
                        }}</template></Column
                    >
                    <Column header="상태"
                        ><template #body="{ data }">{{
                            data.reason || '수량 유지 가정'
                        }}</template></Column
                    >
                </DataTable>
                <div
                    class="valuation-mobile"
                    role="list"
                    aria-label="보유 항목별 평가 카드">
                    <article
                        v-for="(row, index) in detailRows"
                        :key="`${row.accountId}:${row.symbol}:${index}`"
                        class="valuation-detail-card"
                        :data-symbol="row.symbol"
                        role="listitem"
                        :class="{ 'has-issue': row.reason }">
                        <header>
                            <div>
                                <div class="valuation-position-heading">
                                    <h4>{{ row.symbol }}</h4>
                                    <span>{{ row.currency }}</span
                                    ><small
                                        >수량 {{ row.quantity ?? '—' }}</small
                                    ><span
                                        v-if="
                                            row.calculationMode === 'estimated'
                                        "
                                        >추정</span
                                    >
                                </div>
                                <p>
                                    {{ ownerName(row.ownerId) }} ·
                                    {{
                                        accountNames.get(row.accountId) ||
                                        '계좌 미확인'
                                    }}
                                </p>
                            </div>
                            <span class="valuation-row-state">{{
                                row.reason || '수량 유지 가정'
                            }}</span>
                        </header>
                        <dl>
                            <div>
                                <dt>저장 자료 평가액</dt>
                                <dd>
                                    {{
                                        row.baseline == null
                                            ? '—'
                                            : formatStoredAmount(
                                                  row.baseline,
                                                  row.currency
                                              )
                                    }}
                                </dd>
                                <small
                                    >기준: {{ row.asOf || '미확인'
                                    }}{{
                                        row.oldSnapshot ? ' · 30일 초과' : ''
                                    }}</small
                                >
                            </div>
                            <div>
                                <dt>참고 평가액</dt>
                                <dd class="reference-amount">
                                    {{
                                        row.value == null
                                            ? '—'
                                            : formatStoredAmount(
                                                  row.value,
                                                  row.currency
                                              )
                                    }}
                                </dd>
                                <small
                                    >종가
                                    {{
                                        row.price == null
                                            ? '미확인'
                                            : formatStoredAmount(
                                                  row.price,
                                                  row.currency
                                              )
                                    }}
                                    ·
                                    {{
                                        row.priceDate || '기준일 미확인'
                                    }}</small
                                >
                            </div>
                        </dl>
                        <p class="valuation-row-source">
                            출처: {{ row.source || '미확인' }}
                        </p>
                    </article>
                    <Paginator
                        v-if="valuation.rows.length > 10"
                        :first="firstRow"
                        :rows="10"
                        :total-records="valuation.rows.length"
                        :page-link-size="3"
                        template="PrevPageLink PageLinks NextPageLink"
                        aria-label="보유 평가 카드 페이지"
                        @page="firstRow = $event.first" />
                </div>
            </section>
            <section
                v-if="
                    estimatedPositions ||
                    valuation.excluded ||
                    missingAccounts ||
                    valuation.oldSnapshots
                "
                class="valuation-review"
                aria-labelledby="valuation-review-title">
                <header>
                    <i class="pi pi-verified" aria-hidden="true" />
                    <div>
                        <h3 id="valuation-review-title">
                            누락 · 추정 · 제외 자료 검토
                        </h3>
                        <span>확인 필요</span>
                    </div>
                </header>
                <Message
                    v-if="estimatedPositions"
                    severity="warn"
                    :closable="false">
                    거래내역으로 계산한 추정 잔고
                    {{ estimatedPositions }}개를 표시합니다. 시작일 이전
                    보유분·누락 거래·분할·병합 때문에 실제 잔고와 다를 수
                    있습니다.
                </Message>
                <Message
                    v-if="
                        valuation.excluded ||
                        missingAccounts ||
                        valuation.oldSnapshots
                    "
                    severity="warn"
                    :closable="false">
                    <ul class="valuation-issues">
                        <li v-if="missingAccounts">
                            잔고 자료가 없는 계좌 {{ missingAccounts }}개는
                            평가에서 제외했습니다.
                        </li>
                        <li v-if="valuation.excluded">
                            시세·수량·기준일 확인이 필요한
                            {{ valuation.excluded }}개 항목은 합계에서
                            제외했습니다. 아래 상태를 확인해 주세요.
                        </li>
                        <li v-if="valuation.oldSnapshots">
                            30일 초과된 잔고 {{ valuation.oldSnapshots }}개
                            항목이 있습니다. 최근 잔고로 갱신해 주세요.
                        </li>
                    </ul>
                </Message>

                <div class="valuation-review-action">
                    <Button
                        label="자료 검토 상세 진입"
                        icon="pi pi-arrow-right"
                        icon-pos="right"
                        severity="secondary"
                        disabled /><small
                        >별도 검토 화면 미구현 · 위 평가 명세에서 자료별 사유를
                        확인해 주세요.</small
                    >
                </div>
            </section>
            <p v-if="scopedPositions.length && !valuation.currencies.length">
                증권 잔고가 없습니다. 현금은 아래 자료상 평가액에서 확인해
                주세요.
            </p>
        </template>
    </section>
</template>

<style scoped>
    .valuation {
        margin-block: 1.5rem;
        padding: 1.25rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: 1rem;
        background: var(--p-content-background);
        color: var(--p-content-color);
    }
    .valuation-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
    }
    .valuation-empty {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 1rem;
        margin-top: 1.25rem;
        padding: 1rem;
        border-radius: 0.75rem;
        background: var(--p-content-hover-background);
    }
    .valuation-empty > .pi {
        color: var(--app-accent);
        font-size: 1.5rem;
    }
    .valuation-empty h3,
    .valuation-empty p {
        margin: 0;
    }
    .valuation-empty p + p {
        margin-top: 0.25rem;
    }
    .valuation-empty-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }
    .valuation h2,
    .valuation h3 {
        margin-top: 0;
    }
    .valuation-heading p,
    .valuation-note,
    .valuation-detail {
        color: var(--p-text-muted-color);
    }
    .valuation-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
        gap: 1rem;
        margin-block: 1rem;
    }
    .valuation-card {
        border: 1px solid var(--p-content-border-color);
        border-radius: 0.75rem;
        padding: 1rem;
        overflow-wrap: anywhere;
    }
    .valuation-card h3 {
        font-size: 1rem;
    }
    .valuation-card strong {
        font-size: 1.5rem;
    }
    .valuation-card p {
        margin-bottom: 0;
    }
    .valuation-detail {
        display: block;
        margin-top: 0.25rem;
    }
    .valuation-issues {
        margin: 0;
        padding-left: 1.25rem;
    }
    .valuation :deep(.p-datatable) {
        margin-top: 1rem;
        max-width: 100%;
    }
    @media (max-width: 767px) {
        .valuation-empty {
            grid-template-columns: auto minmax(0, 1fr);
        }
        .valuation-empty-actions {
            grid-column: 1 / -1;
            width: 100%;
        }
        .valuation-empty-actions :deep(.p-button) {
            flex: 1 1 10rem;
        }
    }

    /* CONTENT / Portfolio Summary: independent stored and reference currency totals. */
    .valuation {
        padding: 0;
        border: 0;
        background: transparent;
        margin: 24px 0;
    }
    .valuation-comparison {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 24px;
        align-items: stretch;
        margin-bottom: 32px;
    }
    .stored-valuation-panel,
    .reference-valuation-panel {
        min-width: 0;
        padding: 24px;
        border-radius: 12px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
    }
    .stored-valuation-panel h2,
    .valuation-heading h2 {
        font-size: 16px;
        margin: 0 0 8px;
    }
    .stored-valuation-panel > p,
    .valuation-heading p,
    .valuation-note {
        font-size: 13px;
        color: var(--app-muted);
        margin: 0 0 16px;
    }
    .valuation-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
    .valuation-card {
        border: 0;
        border-radius: 12px;
        padding: 16px;
        background: var(--app-surface-muted);
    }
    .valuation-card h3 {
        font-size: 13px;
        color: var(--app-muted);
        margin: 0 0 8px;
    }
    .valuation-card > strong {
        font-size: 24px;
        color: var(--app-accent);
        font-variant-numeric: tabular-nums;
    }
    .valuation-card p {
        font-size: 12px;
        margin: 8px 0 0;
    }
    @media (max-width: 767px) {
        .valuation-comparison {
            grid-template-columns: 1fr;
            gap: 24px;
        }
    }
    @media (max-width: 640px) {
        .stored-valuation-panel,
        .reference-valuation-panel {
            padding: 24px;
        }
        .valuation-grid {
            grid-template-columns: 1fr;
        }
    }

    /* Actual summary original:24px panels,16/24 titles, mono24/32 amounts. */
    .stored-valuation-panel,
    .reference-valuation-panel {
        border: 0;
    }
    .stored-valuation-panel h2,
    .valuation-heading h2 {
        letter-spacing: normal;
        line-height: 24px;
        font-weight: 600;
    }
    .valuation-card > strong {
        display: block;
        line-height: 32px;
        letter-spacing: -0.025em;
    }
    .valuation-card h3 {
        font-size: 11px;
        line-height: 14px;
        font-weight: 500;
    }
    .valuation-details {
        background: var(--app-surface);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
    }
    .valuation-details-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        padding: 16px 24px;
    }
    .valuation-details-heading h3 {
        margin: 0;
        letter-spacing: normal;
        font-size: 16px;
        line-height: 24px;
        font-weight: 600;
    }
    .valuation-details-heading > span {
        padding: 2px 8px;
        background: var(--app-surface-muted);
        border-radius: 4px;
        font-size: 11px;
        line-height: 14px;
        font-family: 'JetBrains Mono', monospace;
    }
    .valuation .valuation-details :deep(.p-datatable) {
        margin: 0;
    }
    .valuation .valuation-details :deep(.p-datatable-thead > tr > th) {
        height: 40px;
        padding: 0 12px;
        font-size: 11px;
        line-height: 14px;
        font-weight: 500;
    }
    .valuation .valuation-details :deep(.p-datatable-tbody > tr > td) {
        padding: 12px;
        font-size: 13px;
        line-height: 18px;
    }
    .valuation
        .valuation-details
        :deep(.p-datatable-thead > tr > th:first-child),
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:first-child),
    .valuation
        .valuation-details
        :deep(.p-datatable-thead > tr > th:last-child),
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:last-child) {
        padding-left: 16px;
        padding-right: 16px;
    }
    .valuation-mobile {
        display: none;
        padding: 12px;
    }
    .valuation-detail-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border-radius: 12px;
        background: var(--app-surface-muted);
        min-width: 0;
    }
    .valuation-detail-card.has-issue {
        background: color-mix(
            in srgb,
            var(--app-warning-light) 35%,
            var(--app-surface)
        );
    }
    .valuation-detail-card > header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
    }
    .valuation-position-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }
    .valuation-position-heading h4 {
        margin: 0;
        font-size: 16px;
        line-height: 24px;
        font-weight: 700;
    }
    .valuation-position-heading > span,
    .valuation-position-heading > small {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        font:
            500 11px/14px 'JetBrains Mono',
            monospace;
        background: var(--app-surface);
    }
    .valuation-detail-card header p {
        margin: 2px 0 0;
        font-size: 13px;
        line-height: 18px;
        color: var(--app-muted);
    }
    .valuation-row-state {
        max-width: 50%;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 14px;
        color: var(--app-muted);
        background: var(--app-surface);
    }
    .has-issue .valuation-row-state {
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .valuation-detail-card dl {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        border-top: 1px solid var(--app-border);
        padding-top: 8px;
        margin: 0;
    }
    .valuation-detail-card dl > div {
        min-width: 0;
    }
    .valuation-detail-card dl > div:last-child {
        text-align: right;
    }
    .valuation-detail-card dt {
        font:
            500 11px/14px 'JetBrains Mono',
            monospace;
        color: var(--app-muted);
    }
    .valuation-detail-card dd {
        margin: 0;
        font:
            700 13px/16px 'JetBrains Mono',
            monospace;
        overflow-wrap: anywhere;
    }
    .valuation-detail-card small {
        font-size: 11px;
        line-height: 14px;
        color: var(--app-muted);
    }
    .reference-amount {
        color: var(--app-accent);
    }
    .valuation-row-source {
        margin: 0;
        font-size: 11px;
        line-height: 14px;
        color: var(--app-muted);
    }
    @media (max-width: 1023px) {
        .valuation-desktop {
            display: none;
        }
        .valuation-mobile {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
    }
    .valuation-detail-card > header > div {
        min-width: 0;
        flex: 1;
    }
    .valuation-position-heading h4 {
        overflow-wrap: anywhere;
    }

    .valuation .valuation-details :deep(.p-datatable-tbody > tr) {
        height: 56px;
    }
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:nth-child(5)),
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:nth-child(9)),
    .valuation
        .valuation-details
        :deep(.p-datatable-thead > tr > th:nth-child(5)),
    .valuation
        .valuation-details
        :deep(.p-datatable-thead > tr > th:nth-child(9)) {
        padding-left: 16px;
        padding-right: 16px;
    }
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:nth-child(4)),
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:nth-child(5)),
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:nth-child(7)),
    .valuation
        .valuation-details
        :deep(.p-datatable-tbody > tr > td:nth-child(9)) {
        text-align: right;
        font-family: 'JetBrains Mono', monospace;
    }
    .valuation
        .valuation-details
        :deep(th:nth-child(4) .p-datatable-column-header-content),
    .valuation
        .valuation-details
        :deep(th:nth-child(5) .p-datatable-column-header-content),
    .valuation
        .valuation-details
        :deep(th:nth-child(7) .p-datatable-column-header-content),
    .valuation
        .valuation-details
        :deep(th:nth-child(9) .p-datatable-column-header-content) {
        justify-content: flex-end;
    }
    .valuation .valuation-details :deep(td:nth-child(3)),
    .valuation .valuation-details :deep(td:nth-child(6)),
    .valuation .valuation-details :deep(td:nth-child(8)),
    .valuation .valuation-details :deep(td:nth-child(10)) {
        text-align: center;
    }
    .valuation
        .valuation-details
        :deep(th:nth-child(3) .p-datatable-column-header-content),
    .valuation
        .valuation-details
        :deep(th:nth-child(6) .p-datatable-column-header-content),
    .valuation
        .valuation-details
        :deep(th:nth-child(8) .p-datatable-column-header-content),
    .valuation
        .valuation-details
        :deep(th:nth-child(10) .p-datatable-column-header-content) {
        justify-content: center;
    }
    .valuation-note {
        margin: 16px 0 0;
        padding: 10px;
        border-radius: 8px;
        background: var(--app-surface-muted);
        font-size: 13px;
        line-height: 18px;
    }

    .valuation .valuation-details :deep(td .valuation-detail) {
        margin-top: 0;
        font-size: 11px;
        line-height: 14px;
    }
    .valuation .valuation-details :deep(td:nth-child(4)),
    .valuation .valuation-details :deep(td:nth-child(5)),
    .valuation .valuation-details :deep(td:nth-child(7)),
    .valuation .valuation-details :deep(td:nth-child(9)) {
        line-height: 16px;
    }
    .valuation-currency-chip {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--app-surface-muted);
        font:
            500 11px/14px 'JetBrains Mono',
            monospace;
    }
    .valuation .valuation-details :deep(.p-datatable-tbody > tr > td) {
        line-height: 16px;
    }
    .valuation-detail-card header p {
        line-height: 16px;
    }
    .valuation-card > strong {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        white-space: nowrap;
        overflow-wrap: normal;
        word-break: keep-all;
        width: calc(100% + 16px);
        margin-right: -16px;
        overflow-x: auto;
    }
    .valuation-card > strong.partial-total {
        color: var(--app-text);
        font-weight: 600;
    }

    .valuation-review {
        margin-top: 24px;
        padding: 24px;
        border-radius: 12px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(0 0 0 / 3%);
        display: grid;
        gap: 12px;
    }
    .valuation-review > header {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    .valuation-review > header > i {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border-radius: 8px;
        color: var(--app-warning-text);
        background: var(--app-warning-light);
        font-size: 20px;
    }
    .valuation-review > header > div {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
    }
    .valuation-review h3 {
        margin: 0;
        letter-spacing: normal;
        font-size: 16px;
        line-height: 24px;
        font-weight: 600;
    }
    .valuation-review header span {
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        line-height: 14px;
        color: var(--app-warning-text);
        background: var(--app-warning-light);
    }
    .valuation-review :deep(.p-message) {
        margin: 0;
    }
    .valuation-review-action {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
    }
    .valuation-review-action small {
        color: var(--app-muted);
        font-size: 11px;
        line-height: 14px;
    }
    .valuation-review-action :deep(.p-button) {
        min-height: 44px;
        padding: 0 20px;
    }

    .valuation .valuation-details :deep(.p-datatable-tbody > tr > td) {
        font-size: 12px;
    }
    .valuation .valuation-details :deep(td:nth-child(4)),
    .valuation .valuation-details :deep(td:nth-child(5)),
    .valuation .valuation-details :deep(td:nth-child(7)),
    .valuation .valuation-details :deep(td:nth-child(9)) {
        font-size: 13px;
    }
    .valuation .valuation-details :deep(td:nth-child(6)),
    .valuation .valuation-details :deep(td:nth-child(8)) {
        font:
            500 11px/14px 'JetBrains Mono',
            monospace;
    }
    .valuation-primary-label {
        font-weight: 500;
    }
</style>
