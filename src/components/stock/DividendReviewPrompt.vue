<script setup>
    import { ref, watch } from 'vue';
    import Button from 'primevue/button';
    import Tag from 'primevue/tag';
    import Dialog from 'primevue/dialog';
    const props = defineProps({
        symbol: { type: String, required: true },
        rows: { type: Array, default: () => [] },
        currency: { type: String, default: 'USD' },
    });
    const opened = ref(false);
    watch(
        () => props.symbol,
        () => {
            opened.value = false;
        }
    );
    const sourceUrl = (value) => {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' ? url.href : null;
        } catch {
            return null;
        }
    };
    function exportReview() {
        const blob = new Blob(
            [
                JSON.stringify(
                    {
                        symbol: props.symbol,
                        currency: props.currency,
                        verificationStatus: 'needs_review',
                        payments: props.rows,
                    },
                    null,
                    2
                ),
            ],
            { type: 'application/json' }
        );
        const url = URL.createObjectURL(blob),
            link = document.createElement('a');
        link.href = url;
        link.download = `${props.symbol}-dividend-review.json`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
</script>
<template>
    <aside
        v-if="rows.length"
        class="dividend-review-prompt"
        aria-label="관리자 배당 검증">
        <Tag severity="warn" :value="`검증 필요 · ${rows.length}건`" />
        <span>검증 대기 자료가 사용자 화면에 표시되고 있습니다.</span>
        <Button
            label="배당 검증하기"
            icon="pi pi-check-square"
            severity="warn"
            outlined
            size="small"
            @click="opened = true" />
        <Dialog
            v-model:visible="opened"
            modal
            :header="`${symbol} 배당 검증`"
            :style="{ width: '720px', maxWidth: '94vw' }">
            <ol class="review-steps">
                <li>
                    운용사 원문에서 종목·배당락일·지급일·주당 금액을 대조하세요.
                </li>
                <li>
                    중복 공시와 수정 공시를 확인하고 검토 자료를 내려받으세요.
                </li>
                <li>
                    검증 결과를 배당 원장에 반영한 뒤 최신 데이터를 다시
                    불러오세요.
                </li>
            </ol>
            <p class="review-note">
                자료 다운로드는 검증 완료 처리가 아닙니다. 원장의 검증 상태가
                반영될 때까지 배지가 유지됩니다.
            </p>
            <div
                class="review-scroll"
                tabindex="0"
                role="region"
                aria-label="검증 대기 배당 내역">
                <table>
                    <caption class="studio-sr-only">
                        {{
                            symbol
                        }}
                        검증 대기 배당
                    </caption>
                    <thead>
                        <tr>
                            <th scope="col">배당락일</th>
                            <th scope="col">지급일</th>
                            <th scope="col">주당 금액</th>
                            <th scope="col">원문</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rows" :key="row.date">
                            <th scope="row">{{ row.date }}</th>
                            <td>{{ row.payableDate || '미확인' }}</td>
                            <td>
                                {{ row.amountFixed ?? row.amount }}
                                {{ currency }}
                            </td>
                            <td>
                                <a
                                    v-if="sourceUrl(row.officialUrl)"
                                    :href="sourceUrl(row.officialUrl)"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >원문 대조
                                    <i
                                        class="pi pi-external-link"
                                        aria-hidden="true" /></a
                                ><span v-else>원문 미제공</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <template #footer
                ><Button
                    label="검토 자료 다운로드"
                    icon="pi pi-download"
                    @click="exportReview" /><Button
                    label="닫기"
                    severity="secondary"
                    text
                    @click="opened = false"
            /></template>
        </Dialog>
    </aside>
</template>
<style scoped>
    .dividend-review-prompt {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        margin: 16px 0;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface-muted);
    }
    .dividend-review-prompt > span {
        color: var(--app-muted);
        font-size: 13px;
    }
    .review-steps {
        padding-left: 22px;
        line-height: 1.9;
    }
    .review-note {
        font-size: 13px;
        color: var(--app-muted);
        line-height: 1.7;
    }
    .review-scroll {
        overflow-x: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        white-space: nowrap;
    }
    th,
    td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid var(--app-border);
    }
    td a {
        display: inline-flex;
        align-items: center;
        min-height: 44px;
        gap: 6px;
        color: var(--app-accent);
    }
</style>
