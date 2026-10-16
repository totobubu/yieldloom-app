import { computed, onScopeDispose, ref, toValue, watch } from 'vue';

export function useRequestCooldown(error) {
    const currentTime = ref(Date.now());
    let timer;
    const clear = () => {
        if (timer) clearInterval(timer);
        timer = undefined;
    };
    const retryAt = computed(() => {
        const value = toValue(error);
        return value?.status === 429 && Number.isFinite(value.retryAt)
            ? value.retryAt
            : null;
    });
    const remainingSeconds = computed(() =>
        retryAt.value === null
            ? 0
            : Math.max(0, Math.ceil((retryAt.value - currentTime.value) / 1000))
    );
    watch(
        retryAt,
        () => {
            clear();
            currentTime.value = Date.now();
            if (remainingSeconds.value > 0)
                timer = setInterval(() => {
                    currentTime.value = Date.now();
                    if (!remainingSeconds.value) clear();
                }, 1000);
        },
        { immediate: true }
    );
    onScopeDispose(clear);
    return {
        retryAt,
        remainingSeconds,
        coolingDown: computed(() => remainingSeconds.value > 0),
    };
}
