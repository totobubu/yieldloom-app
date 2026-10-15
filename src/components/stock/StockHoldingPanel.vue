<script setup>
    import { computed, ref, watch } from 'vue';
    import { firebaseUser, authLoading } from '@/services/firebaseClient';
    import { loadPortfolioAsset } from '@/services/portfolio';
    import { stockHoldingMetrics } from '@/services/stockAnalysis';
    const props = defineProps({
        symbol: { type: String, required: true },
        price: { type: Number, default: null },
        currency: { type: String, default: 'USD' },
        next: { type: Object, default: null },
    });
    const asset = ref(null),
        loading = ref(false),
        error = ref('');
    let sequence = 0;
    const load = async () => {
        const current = ++sequence;
        asset.value = null;
        error.value = '';
        loading.value = false;
        if (!firebaseUser.value || authLoading.value) return;
        loading.value = true;
        try {
            const result = await loadPortfolioAsset(
                firebaseUser.value.uid,
                props.symbol
            );
            if (current === sequence) asset.value = result;
        } catch {
            if (current === sequence)
                error.value =
                    '보유 정보를 불러오지 못했습니다. 다시 시도해 주세요.';
        } finally {
            if (current === sequence) loading.value = false;
        }
    };
    watch([() => props.symbol, firebaseUser, authLoading], load, {
        immediate: true,
    });
    const metrics = computed(() =>
        stockHoldingMetrics(asset.value, props.price, props.currency)
    );
    const format = (value, digits = 2) =>
        value == null
            ? '미확인'
            : Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: digits,
              });
    const future = computed(
        () => props.next?.exDate >= new Date().toISOString().slice(0, 10)
    );
    const expected = computed(() =>
        future.value &&
        metrics.value?.shares > 0 &&
        Number(props.next?.amount) > 0
            ? metrics.value.shares * Number(props.next.amount)
            : null
    );
</script>
<template>
    <section class="holding-panel">
        <header>
            <h2>내 투자 현황</h2>
            <router-link to="/mypage">포트폴리오 보기 →</router-link>
        </header>
        <p v-if="authLoading || loading" role="status">
            보유 정보를 확인하는 중…
        </p>
        <p v-else-if="!firebaseUser">
            로그인하면 보유 수량과 실제 수령 배당을 확인할 수 있습니다.
            <router-link to="/login">로그인</router-link>
        </p>
        <div v-else-if="error" role="alert">
            <p>{{ error }}</p>
            <button @click="load">다시 시도</button>
        </div>
        <p v-else-if="!asset">
            등록된 {{ symbol }} 보유 내역이 없습니다. 포트폴리오에서 거래내역을
            가져오면 연결됩니다.
        </p>
        <template v-else
            ><p class="holding-basis">
                {{
                    asset.portfolioPriority === 'current'
                        ? '현재 보유'
                        : '과거 보유'
                }}
                · 원장 최근 거래 {{ metrics.latestDate || '미확인' }} · 최초
                확인 매수 {{ metrics.firstBuy || '미확인' }}
            </p>
            <div class="holding-metrics">
                <article>
                    <span>보유 수량</span
                    ><strong>{{ format(metrics.shares, 6) }}주</strong>
                </article>
                <article>
                    <span>잔여 주식 평균 매수가 · FIFO</span
                    ><strong
                        >{{ format(metrics.averageCost) }}
                        <small>{{ currency }}</small></strong
                    >
                </article>
                <article>
                    <span>실제 누적 수령 배당</span
                    ><strong
                        >{{ format(metrics.wonDividends, 0) }}
                        <small>KRW</small></strong
                    ><small>{{ metrics.dividendCount }}개 수령 내역 기준</small>
                </article>
                <article>
                    <span>배당 포함 누적 손익</span
                    ><strong
                        >{{ format(metrics.totalProfit) }}
                        <small>{{ currency }}</small></strong
                    ><small>{{
                        metrics.totalReturn == null
                            ? '계산 가능 범위 확인 필요'
                            : `${format(metrics.totalReturn)}% · 누적 매수대금 대비`
                    }}</small>
                </article>
                <article>
                    <span>차기 공시 기준 예상 배당 · 세전</span
                    ><strong
                        >{{ format(expected, 4) }}
                        <small>{{ currency }}</small></strong
                    ><small>{{
                        future
                            ? next.exDate + ' 배당락'
                            : '차기 공시 확인 후 제공'
                    }}</small>
                </article>
            </div>
            <p class="holding-basis">
                {{
                    metrics.complete
                        ? '등록된 매수·매도·배당 원장과 잔고가 일치하는 범위에서 계산합니다.'
                        : '통화별 거래금액 또는 매수·매도 원장이 부족하거나 잔고가 일치하지 않아 평균 매수가와 누적 손익을 계산하지 않습니다.'
                }}
                원화 수령 배당과 외화 평가액을 합산하지 않습니다. 예상 배당은
                현재 수량 기준이며 배당락일의 실제 보유 여부·세금·수수료에 따라
                달라집니다.
            </p>
        </template>
    </section>
</template>
<style scoped>
    .holding-panel {
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 16px;
        margin: 24px 0;
        background: var(--app-surface);
    }
    header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        flex-wrap: wrap;
    }
    h2 {
        margin: 0 !important;
        font-size: 1.1rem;
    }
    a {
        color: var(--app-accent);
        font-size: 0.85rem;
    }
    .holding-panel p {
        color: var(--app-muted);
        font-size: 0.85rem;
        line-height: 1.7;
    }
    .holding-metrics {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
        gap: 12px;
        margin: 20px 0;
    }
    .holding-metrics article {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
        border-radius: 10px;
        background: var(--app-surface-muted);
    }
    span,
    small {
        font-size: 0.75rem;
        color: var(--app-muted);
    }
    strong {
        font-size: 1.25rem;
        overflow-wrap: anywhere;
    }
    .holding-basis {
        font-size: 0.75rem !important;
    }
    button {
        padding: 8px 12px;
        background: var(--app-surface-muted);
        border: 1px solid var(--app-border);
        border-radius: 6px;
        color: var(--app-text);
        cursor: pointer;
    }
</style>
