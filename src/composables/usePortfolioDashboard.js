import { onScopeDispose, ref, watch } from 'vue';

const emptyDashboard = () => ({ assets: [], transactions: [], summary: {} });

// The caller supplies identity and data access; this scope owns request state.
export function usePortfolioDashboard(user, loadDashboard) {
    const dashboard = ref(emptyDashboard());
    const loading = ref(false);
    const error = ref('');
    let generation = 0;

    const invalidate = () => {
        generation++;
        dashboard.value = emptyDashboard();
        loading.value = false;
        error.value = '';
    };
    watch(() => user.value?.uid, invalidate, { flush: 'sync' });
    onScopeDispose(invalidate);

    async function refresh() {
        const uid = user.value?.uid;
        const request = ++generation;
        if (!uid) {
            invalidate();
            return;
        }
        const isCurrent = () =>
            request === generation && user.value?.uid === uid;
        loading.value = true;
        error.value = '';
        try {
            const result = await loadDashboard(uid);
            if (isCurrent()) dashboard.value = result;
        } catch (reason) {
            if (isCurrent()) {
                error.value =
                    reason.code === 'permission-denied'
                        ? '현재 보유 종목 조회 권한이 없습니다. 관리자에게 문의해 주세요.'
                        : reason.code === 'unavailable'
                          ? '포트폴리오 서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'
                          : '포트폴리오를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
            }
        } finally {
            if (isCurrent()) loading.value = false;
        }
    }

    return { dashboard, loading, error, refresh };
}
