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
    let submittedContent = null;

    async function submit() {
        if (busy.value) return;
        busy.value = true;
        error.value = '';
        sent.value = false;
        const content = {
            symbol: props.symbol,
            category: form.category,
            message: form.message,
            website: form.website,
        };
        const contentKey = JSON.stringify(content);
        if (submittedContent !== null && submittedContent !== contentKey)
            requestId.value = crypto.randomUUID();
        submittedContent = contentKey;
        try {
            await submitStockFeedback({
                ...content,
                requestId: requestId.value,
                pageUrl: window.location.href,
            });
            form.message = '';
            submittedContent = null;
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
        :aria-busy="busy"
        tabindex="-1">
        <div>
            <h2 id="stock-feedback-heading">익명 요청 및 한마디</h2>
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
                :disabled="busy"
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
                :disabled="busy"
                aria-describedby="feedback-help" />
            <output class="feedback-character-count" for="feedback-message"
                >{{ form.message.length }} / 1,000자</output
            >
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
                label="요청 전송하기"
                icon="pi pi-send"
                :loading="busy"
                :disabled="busy || form.message.trim().length < 10" />
        </form>
    </section>
</template>

<style scoped>
    .stock-feedback {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 16px;
        margin-top: 0;
        padding: 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    h2 {
        margin: 0 0 10px;
        font-size: 18px;
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
    .feedback-character-count {
        text-align: right;
        color: var(--app-muted);
        font-size: 12px;
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
