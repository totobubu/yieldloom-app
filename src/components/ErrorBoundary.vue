<!-- src/components/ErrorBoundary.vue -->
<template>
    <div v-if="error" class="error-boundary">
        <Message severity="error" :closable="true" @close="clearError">
            <div class="error-content">
                <i class="pi pi-exclamation-triangle error-icon"></i>
                <div class="error-text">
                    <strong>{{ error.userMessage?.title || '오류 발생' }}</strong>
                    <p>{{ error.userMessage?.message || error.message }}</p>
                </div>
            </div>
            <template #footer v-if="error.userMessage?.type === 'network'">
                <Button
                    label="다시 시도"
                    icon="pi pi-refresh"
                    severity="secondary"
                    size="small"
                    @click="retry"
                />
            </template>
        </Message>
    </div>

    <Toast position="top-right" />

    <slot></slot>
</template>

<script setup>
    import { ref, provide, onErrorCaptured } from 'vue';
    import { useToast } from 'primevue/usetoast';
    import Message from 'primevue/message';
    import Button from 'primevue/button';
    import Toast from 'primevue/toast';
    import { reportError } from '@/utils/sentry';

    const toast = useToast();
    const error = ref(null);
    const retryCallback = ref(null);

    /**
     * Vue 에러 캡처
     */
    onErrorCaptured((err, instance, info) => {
        console.error('❌ Error captured:', err, info);

        // Sentry에 리포트
        reportError(err, {
            component: instance?.$options?.name || 'Unknown',
            info
        });

        // 에러 상태 업데이트
        error.value = err;

        // Toast 알림
        showErrorToast(err);

        // 에러 전파 중단
        return false;
    });

    /**
     * Toast 알림 표시
     */
    function showErrorToast(err) {
        const userMessage = err.userMessage || {
            title: '오류 발생',
            message: err.message
        };

        toast.add({
            severity: 'error',
            summary: userMessage.title,
            detail: userMessage.message,
            life: 5000
        });
    }

    /**
     * 에러 초기화
     */
    function clearError() {
        error.value = null;
        retryCallback.value = null;
    }

    /**
     * 재시도
     */
    function retry() {
        if (retryCallback.value) {
            retryCallback.value();
        }
        clearError();
    }

    /**
     * 전역 에러 핸들러 제공
     */
    provide('handleError', (err, callback) => {
        error.value = err;
        retryCallback.value = callback;
        showErrorToast(err);
    });
</script>

<style scoped>
    .error-boundary {
        position: fixed;
        top: 1rem;
        right: 1rem;
        z-index: 9999;
        max-width: 400px;
    }

    .error-content {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
    }

    .error-icon {
        font-size: 1.5rem;
        flex-shrink: 0;
    }

    .error-text {
        flex: 1;
    }

    .error-text strong {
        display: block;
        margin-bottom: 0.5rem;
    }

    .error-text p {
        margin: 0;
        font-size: 0.9rem;
        opacity: 0.9;
    }
</style>
