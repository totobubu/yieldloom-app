import { computed, onScopeDispose, readonly, ref, watch } from 'vue';

const loadingTasks = ref(new Map());

export const fullscreenLoading = computed(() => loadingTasks.value.size > 0);
export const fullscreenLoadingMessage = computed(() => {
    const tasks = [...loadingTasks.value.values()];
    return tasks.at(-1) || '데이터를 불러오고 있습니다.';
});

export function useFullscreenLoading(source, message) {
    const token = Symbol('fullscreen-loading');

    const stop = watch(
        source,
        (loading) => {
            const tasks = new Map(loadingTasks.value);
            if (loading) tasks.set(token, message);
            else tasks.delete(token);
            loadingTasks.value = tasks;
        },
        { immediate: true }
    );

    onScopeDispose(() => {
        stop();
        if (!loadingTasks.value.has(token)) return;
        const tasks = new Map(loadingTasks.value);
        tasks.delete(token);
        loadingTasks.value = tasks;
    });
}

export function useFullscreenLoadingState() {
    return {
        loading: readonly(fullscreenLoading),
        message: readonly(fullscreenLoadingMessage),
    };
}
