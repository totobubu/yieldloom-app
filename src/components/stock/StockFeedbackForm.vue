<script setup>
    import { reactive, ref } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import Select from 'primevue/select';
    import Textarea from 'primevue/textarea';
    import { submitStockFeedback } from '@/services/stockFeedback.js';

    const props = defineProps({ symbol: { type: String, required: true } });
    const categories = [
        { label: '정보 오류', value: 'data_error' },
        { label: '추가 정보 요청', value: 'information_request' },
        { label: '질문', value: 'question' },
        { label: '기타', value: 'other' },
    ];
    const form = reactive({ category: 'data_error', message: '', website: '' });
    const busy = ref(false),
        error = ref(''),
        sent = ref(false);
    const requestId = ref(crypto.randomUUID());

    async function submit() {
        if (busy.value) return;
        busy.value = true;
        error.value = '';
        sent.value = false;
        try {
            await submitStockFeedback({
                symbol: props.symbol,
                category: form.category,
                message: form.message,
                website: form.website,
                requestId: requestId.value,
                pageUrl: window.location.href,
            });
            form.message = '';
            requestId.value = crypto.randomUUID();
            sent.value = true;
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
</script>

<template>
    <section
        id="stock-feedback"
        class="stock-feedback"
        aria-labelledby="stock-feedback-heading"
        tabindex="-1">
        <div>
            <span class="studio-eyebrow">PRIVATE FEEDBACK</span>
            <h2 id="stock-feedback-heading">요청·한마디 남기기</h2>
            <p>
                {{ symbol }} 정보의 오류나 추가 요청을 익명으로 남겨 주세요.
                작성 내용은 관리자만 확인합니다.
            </p>
        </div>
        <Message v-if="sent" severity="success" :closable="false" role="status"
            >의견을 접수했습니다. 검토에 참고하겠습니다.</Message
        >
        <Message v-if="error" severity="error" :closable="false" role="alert">{{
            error
        }}</Message>
        <form @submit.prevent="submit">
            <label for="feedback-category">의견 유형</label>
            <Select
                v-model="form.category"
                input-id="feedback-category"
                :options="categories"
                option-label="label"
                option-value="value" />
            <label for="feedback-message">내용</label>
            <Textarea
                id="feedback-message"
                v-model="form.message"
                rows="5"
                minlength="10"
                maxlength="1000"
                required
                fluid
                aria-describedby="feedback-help" />
            <small id="feedback-help"
                >10~1,000자 · 개인정보는 남기지 마세요.</small
            >
            <label class="feedback-trap" aria-hidden="true">
                웹사이트
                <input
                    v-model="form.website"
                    type="text"
                    tabindex="-1"
                    autocomplete="off" />
            </label>
            <Button
                type="submit"
                label="익명 의견 보내기"
                icon="pi pi-send"
                :loading="busy"
                :disabled="form.message.trim().length < 10" />
        </form>
    </section>
</template>

<style scoped>
    .stock-feedback {
        display: grid;
        grid-template-columns: minmax(0, 0.8fr) minmax(280px, 1.2fr);
        gap: 24px;
        margin-top: 32px;
        padding: 28px;
        border: 1px solid var(--app-border);
        border-radius: 18px;
        background: var(--app-surface);
    }
    h2 {
        margin: 8px 0;
    }
    p,
    small {
        color: var(--app-muted);
    }
    form {
        display: grid;
        gap: 10px;
    }
    label {
        font-size: 14px;
        font-weight: 650;
    }
    .feedback-trap {
        position: absolute;
        left: -10000px;
        width: 1px;
        height: 1px;
        overflow: hidden;
    }
    @media (max-width: 700px) {
        .stock-feedback {
            grid-template-columns: 1fr;
            padding: 20px;
        }
    }
</style>
