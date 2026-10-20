<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import {
        loadValuationQuotes,
        valuePortfolio,
        valuationToday,
    } from '@/services/portfolioValuation.js';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';

    const props = defineProps({
        positions: { type: Array, required: true },
        accounts: { type: Array, default: () => [] },
        missingAccounts: { type: Number, default: 0 },
        estimatedPositions: { type: Number, default: 0 },
    });
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
                props.accounts.map((account) => [account.id, account.alias])
            )
    );
    const valuation = computed(() =>
        valuePortfolio(props.positions, quotes.value, { today: today.value })
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
        <div class="valuation-heading">
            <div>
                <h2 id="valuation-title">최근 종가 기준 평가</h2>
                <p>저장된 보유수량이 유지됐다는 가정의 참고 평가액입니다.</p>
            </div>
            <Button
                label="시세 다시 조회"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                :loading="loading"
                @click="refresh++" />
        </div>
        <p class="valuation-note">
            최근 일봉 가격을 사용하며 장중에는 미확정 가격일 수 있습니다. 현금은
            제외하며 통화별로 구분합니다. 자료 평가액과의 차이는 취득원가 기준
            손익·수익률이 아닙니다.
        </p>
        <p v-if="loading" role="status">
            시세를 확인하고 있습니다. 최대 100종목을 조회합니다.
        </p>
        <Message v-else-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <template v-else>
            <Message
                v-if="estimatedPositions"
                severity="warn"
                :closable="false">
                거래내역으로 계산한 추정 잔고 {{ estimatedPositions }}개를
                표시합니다. 시작일 이전 보유분·누락 거래·분할·병합 때문에 실제
                잔고와 다를 수 있습니다.
            </Message>
            <div v-if="!positions.length" class="valuation-empty">
                <i class="pi pi-inbox" aria-hidden="true" />
                <div>
                    <h3>아직 거래내역이 없습니다</h3>
                    <p>거래내역을 추가하면 보유수량을 자동으로 계산합니다.</p>
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
            <div v-if="valuation.currencies.length" class="valuation-grid">
                <article
                    v-for="group in valuation.currencies"
                    :key="group.currency"
                    class="valuation-card">
                    <h3>{{ group.currency }} · 시세 확인 종목 평가액</h3>
                    <strong
                        >{{ money(group.total) }} {{ group.currency }}</strong
                    >
                    <p>
                        {{ group.valued }} / {{ group.count }}개 보유 항목
                        평가{{
                            group.valued < group.count ? ' · 일부 합계' : ''
                        }}
                    </p>
                    <p v-if="group.valued">
                        종가 기준일 {{ group.oldestPriceDate
                        }}{{
                            group.oldestPriceDate !== group.newestPriceDate
                                ? ` ~ ${group.newestPriceDate}`
                                : ''
                        }}
                    </p>
                    <p v-if="group.compared">
                        자료 평가액 대비 차이 {{ money(group.difference) }}
                        {{ group.currency }}<br /><small
                            >비교 가능한 {{ group.compared }}개 항목만
                            계산</small
                        >
                    </p>
                    <p v-else>자료 평가액 대비 차이 확인 불가</p>
                </article>
            </div>
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
                        잔고 자료가 없는 계좌 {{ missingAccounts }}개는 평가에서
                        제외했습니다.
                    </li>
                    <li v-if="valuation.excluded">
                        시세·수량·기준일 확인이 필요한
                        {{ valuation.excluded }}개 항목은 합계에서 제외했습니다.
                        아래 상태를 확인해 주세요.
                    </li>
                    <li v-if="valuation.oldSnapshots">
                        30일 초과된 잔고 {{ valuation.oldSnapshots }}개 항목이
                        있습니다. 최근 잔고로 갱신해 주세요.
                    </li>
                </ul>
            </Message>
            <DataTable
                v-if="valuation.rows.length"
                :value="valuation.rows"
                paginator
                :rows="10"
                scrollable
                table-style="min-width: 44rem"
                aria-label="보유 항목별 최근 종가 평가와 데이터 상태">
                <Column field="symbol" header="종목" />
                <Column header="계좌"
                    ><template #body="{ data }">{{
                        accountNames.get(data.accountId) || '계좌 미확인'
                    }}</template></Column
                >
                <Column field="currency" header="통화" />
                <Column header="저장 수량"
                    ><template #body="{ data }">{{
                        data.quantity ?? '—'
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
                <Column header="자료 평가액"
                    ><template #body="{ data }">{{
                        money(data.baseline)
                    }}</template></Column
                >
                <Column header="종가 / 기준일"
                    ><template #body="{ data }"
                        >{{ money(data.price)
                        }}<small class="valuation-detail"
                            >{{ data.priceDate || '미확인' }}<br />{{
                                data.source || '출처 미확인'
                            }}</small
                        ></template
                    ></Column
                >
                <Column header="참고 평가액"
                    ><template #body="{ data }">{{
                        money(data.value)
                    }}</template></Column
                >
                <Column header="상태"
                    ><template #body="{ data }">{{
                        data.reason || '수량 유지 가정'
                    }}</template></Column
                >
            </DataTable>
            <p v-if="positions.length && !valuation.currencies.length">
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
</style>
