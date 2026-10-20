<script setup>
    import Dialog from 'primevue/dialog';
    import ProgressBar from 'primevue/progressbar';
    import ProgressSpinner from 'primevue/progressspinner';
    import { computed, ref, watch } from 'vue';

    const props = defineProps({
        busy: Boolean,
        progress: { type: Object, default: null },
    });
    defineEmits(['afterHide']);
    const stages = {
        extract: { title: '거래내역서를 읽고 있습니다', label: '파일 추출' },
        resolve: {
            title: '거래내역을 정리하고 있습니다',
            label: '종목·환전 확인',
        },
        validate: {
            title: '저장할 자료를 검증하고 있습니다',
            label: '저장 전 검증',
        },
        save: { title: '거래내역을 저장하고 있습니다', label: '자료 저장' },
        finalize: { title: '포트폴리오를 갱신하고 있습니다', label: '마무리' },
    };
    const stage = computed(() => stages[props.progress?.stage]);
    const extracting = computed(() => props.progress?.stage === 'extract');
    const elapsed = ref(0);
    watch(
        () => props.busy,
        (busy, _, onCleanup) => {
            elapsed.value = 0;
            if (!busy) return;
            const started = Date.now();
            const timer = setInterval(() => {
                elapsed.value = Math.floor((Date.now() - started) / 1000);
            }, 1000);
            onCleanup(() => clearInterval(timer));
        },
        { immediate: true }
    );
    const percent = computed(() =>
        props.progress?.total > 0
            ? Math.round(
                  (props.progress.completed / props.progress.total) * 100
              )
            : null
    );
</script>

<template>
    <div class="portfolio-content" :aria-busy="busy">
        <Dialog
            :visible="busy"
            modal
            :closable="false"
            :close-on-escape="false"
            :draggable="false"
            block-scroll
            :header="stage?.title || '자료를 처리하고 있습니다.'"
            :style="{ width: 'min(460px, calc(100vw - 32px))' }"
            :pt="{
                mask: {
                    class: 'portfolio-loading-overlay',
                    style: {
                        background:
                            'color-mix(in srgb, var(--app-bg) 85%, transparent)',
                        backdropFilter: 'blur(4px)',
                    },
                },
            }"
            @after-hide="$emit('afterHide')">
            <div
                class="portfolio-loading-status"
                tabindex="0"
                autofocus
                role="status"
                aria-live="polite">
                <template v-if="progress">
                    <div class="progress-heading">
                        <strong>{{ stage?.label }}</strong>
                        <span v-if="progress.total > 0">
                            {{ progress.completed }} / {{ progress.total
                            }}{{
                                progress.stage === 'extract'
                                    ? '개 파일 완료'
                                    : '묶음 완료'
                            }}
                        </span>
                    </div>
                    <ProgressBar
                        :value="extracting ? null : percent"
                        :mode="
                            extracting || percent === null
                                ? 'indeterminate'
                                : 'determinate'
                        "
                        :show-value="false"
                        :pt="{
                            value: { style: { transition: 'width 0.2s ease' } },
                        }"
                        :aria-label="stage?.label" />
                    <p v-if="progress.detail" class="progress-detail">
                        <strong v-if="extracting && progress.total > 0">
                            {{
                                Math.min(
                                    progress.completed + 1,
                                    progress.total
                                )
                            }}번째 파일 처리 중
                        </strong>
                        {{ progress.detail }}
                        <span v-if="progress.message">{{
                            progress.message
                        }}</span>
                    </p>
                </template>
                <ProgressSpinner
                    v-else
                    class="portfolio-loading-spinner"
                    aria-hidden="true" />
                <p class="progress-elapsed" aria-live="off">
                    처리 시간 {{ elapsed }}초
                </p>
                <p v-if="extracting">
                    파일 하나의 추출이 끝날 때마다 완료 수가 올라갑니다.
                    <template v-if="elapsed >= 20">
                        응답을 기다리고 있습니다. 파일 크기와 네트워크 상태에
                        따라 시간이 더 필요할 수 있습니다.
                    </template>
                </p>
                <p v-else>처리가 완료될 때까지 잠시만 기다려 주세요.</p>
            </div>
        </Dialog>
        <div class="portfolio-content-body" :inert="busy">
            <slot />
        </div>
    </div>
</template>

<style scoped>
    .portfolio-content {
        min-width: 0;
    }
    .portfolio-loading-status {
        display: flex;
        flex-direction: column;
        gap: 20px;
        color: var(--app-text);
        overflow-wrap: anywhere;
    }
    .portfolio-loading-status:focus {
        outline: none;
    }
    .progress-heading {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
    }
    .progress-heading span {
        color: var(--app-muted);
        font-variant-numeric: tabular-nums;
        font-size: 14px;
    }
    .portfolio-loading-status p {
        margin: 0;
        color: var(--app-muted);
        font-size: 14px;
    }
    .progress-detail {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 8px;
        background: var(--app-surface-muted);
    }
    .progress-detail strong {
        color: var(--app-text);
    }
    .progress-elapsed {
        font-variant-numeric: tabular-nums;
    }
    .portfolio-loading-spinner {
        width: 80px;
        height: 80px;
        --p-progressspinner-color-one: var(--app-accent);
        --p-progressspinner-color-two: var(--app-accent);
        --p-progressspinner-color-three: var(--app-accent);
        --p-progressspinner-color-four: var(--app-accent);
    }
    @media (prefers-reduced-motion: reduce) {
        .portfolio-loading-status :deep(*) {
            animation: none;
            transition: none;
        }
    }
</style>
