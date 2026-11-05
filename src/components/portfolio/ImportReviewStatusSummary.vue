<script setup>
    import ImportReviewCurrencySummary from './ImportReviewCurrencySummary.vue';
    defineProps({
        counts: { type: Object, required: true },
        summary: { type: Object, required: true },
        busy: Boolean,
    });
</script>
<template>
    <section class="review-verification-summary" aria-label="검토 현황 요약">
        <header>
            <h3>검토 현황 요약</h3>
            <strong>최종 검증 {{ busy ? '진행 중' : '대기' }}</strong>
        </header>
        <div class="review-verification-counts">
            <span>추출 {{ counts.all }}건</span
            ><span>확인 필요 {{ counts.unresolved }}건</span>
        </div>
        <div class="review-verification-track" aria-hidden="true" />
        <ImportReviewCurrencySummary
            :summary="summary"
            class="review-summary-currency" />
    </section>
</template>
<style scoped>
    .review-verification-summary {
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        min-width: 0;
        box-shadow: 0 1px 2px rgb(23 32 51 / 6%);
    }
    header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
    }
    h3 {
        font-size: 14px;
        line-height: 20px;
        margin: 0;
    }
    header strong {
        font-size: 12px;
        line-height: 20px;
    }
    .review-verification-counts {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 14px;
        font-size: 12px;
        line-height: 20px;
        color: var(--app-muted);
    }
    .review-verification-track {
        height: 8px;
        border-radius: 999px;
        background: var(--app-border);
        margin: 8px 0 16px;
    }
    .review-summary-currency {
        padding: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
    }
    @media (max-width: 640px) {
        .review-verification-summary {
            display: flex;
            flex-direction: column;
        }
        header {
            order: 0;
        }
        h3 {
            font-size: 13px;
            line-height: 18px;
        }
        .review-verification-track {
            order: 1;
            margin: 8px 0;
        }
        .review-verification-counts {
            order: 2;
            margin-top: 0;
            padding-top: 2px;
        }
        .review-summary-currency {
            order: 3;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid var(--app-border);
        }
    }
</style>
