<script setup>
    import Button from 'primevue/button';
    import { computed, ref, watch } from 'vue';
    import { firebaseUser, authLoading } from '@/services/firebaseClient';
    import { familyRequest } from '@/services/familyPortfolio';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    const props = defineProps({
        symbol: { type: String, required: true },
        price: { type: Number, default: null },
        currency: { type: String, default: 'USD' },
        next: { type: Object, default: null },
    });
    const positions = ref([]),
        loading = ref(false),
        error = ref('');
    useFullscreenLoading(loading, '계좌별 잔고를 불러오고 있습니다.');
    let sequence = 0;
    const load = async () => {
        const current = ++sequence;
        positions.value = [];
        error.value = '';
        loading.value = false;
        if (!firebaseUser.value || authLoading.value) return;
        loading.value = true;
        try {
            const { families } = await familyRequest();
            const results = await Promise.all(
                families.map((f) =>
                    familyRequest('', undefined, { familyId: f.id })
                )
            );
            if (current !== sequence) return;
            positions.value = results.flatMap((result) =>
                result.summary.positions
                    .filter((row) => row.symbol === props.symbol.toUpperCase())
                    .map((row) => ({
                        ...row,
                        account: result.accounts.find(
                            (a) => a.id === row.accountId
                        )?.alias,
                        owner:
                            result.families.find((f) => f.id === row.familyId)
                                ?.profiles?.[row.ownerId]?.name ||
                            result.families
                                .flatMap((f) => Object.entries(f.profiles))
                                .find(([id]) => id === row.ownerId)?.[1]?.name,
                    }))
            );
        } catch {
            if (current === sequence)
                error.value =
                    '계좌별 잔고를 불러오지 못했습니다. 다시 시도해 주세요.';
        } finally {
            if (current === sequence) loading.value = false;
        }
    };
    watch([() => props.symbol, firebaseUser, authLoading], load, {
        immediate: true,
    });
    const quantity = computed(() =>
        positions.value.reduce((sum, row) => sum + row.quantity, 0)
    );
    const format = (value) =>
        value == null
            ? '미확인'
            : Number(value).toLocaleString('ko-KR', {
                  maximumFractionDigits: 8,
              });
</script>
<template>
    <section class="holding-panel">
        <header>
            <h2>가족 계좌별 투자 현황</h2>
            <router-link to="/mypage">포트폴리오 보기 →</router-link>
        </header>
        <p v-if="authLoading || loading" role="status">
            잔고 자료를 확인하는 중…
        </p>
        <p v-else-if="!firebaseUser">
            <router-link to="/admin/login">관리자 로그인</router-link> 후 접근
            가능한 가족 계좌의 잔고 자료를 확인할 수 있습니다.
        </p>
        <div v-else-if="error" role="alert">
            <p>{{ error }}</p>
            <Button
                label="다시 시도"
                icon="pi pi-refresh"
                severity="secondary"
                outlined
                @click="load" />
        </div>
        <template v-else>
            <p v-if="!positions.length">
                {{ symbol }}의 확인된 잔고 자료가 없습니다. 거래만 있는 계좌의
                현재 보유량은 추정하지 않습니다.
            </p>
            <template v-else
                ><p>
                    접근 가능한 계좌의 자료상 합산 수량:
                    {{ format(quantity) }}주
                </p>
                <ul>
                    <li
                        v-for="row in positions"
                        :key="`${row.accountId}:${row.currency}`">
                        {{ row.owner }} · {{ row.account }} ·
                        {{ format(row.quantity) }}주 · 자료 평가액
                        {{ format(row.amount) }} {{ row.currency }} · 기준일
                        {{ row.asOf }} · {{ row.source }}
                    </li>
                </ul>
            </template>
            <p class="holding-basis">
                계좌마다 자료 기준일이 다를 수 있습니다. 위 금액은 자료 기준일의
                값이며 현재 평가액·수익률이 아닙니다. 기초 잔고·취득원가·계좌
                이동이 확인되기 전에는 손익을 확정하지 않습니다.
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
