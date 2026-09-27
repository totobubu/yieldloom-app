<!-- REFACTORED: src/pages/ContactView.vue -->
<script setup>
    import { ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import Card from 'primevue/card';
    import InputText from 'primevue/inputtext';
    import Textarea from 'primevue/textarea';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';

    useHead({
        title: '문의하기',
    });

    const name = ref('');
    const email = ref('');
    const message = ref('');
    const isLoading = ref(false);
    const feedback = ref({ type: '', text: '' });

    const handleSubmit = async () => {
        if (!name.value || !email.value || !message.value) {
            feedback.value = {
                type: 'error',
                text: '모든 필드를 입력해주세요.',
            };
            return;
        }

        isLoading.value = true;
        feedback.value = { type: '', text: '' };

        try {
            const response = await fetch('/api/sendEmail', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: name.value,
                    email: email.value,
                    message: message.value,
                }),
            });

            if (!response.ok) {
                let errorMessage = `서버 오류가 발생했습니다. (Status: ${response.status})`;
                // --- [핵심 수정] ---
                // response 객체를 복제하여 별도의 스트림으로 처리합니다.
                const clonedResponse = response.clone();
                try {
                    const errorResult = await response.json();
                    errorMessage = errorResult.error || errorMessage;
                } catch (e) {
                    // json() 파싱이 실패하면, 복제된 응답에서 text()를 읽습니다.
                    const errorText = await clonedResponse.text();
                    console.error(
                        'Server Error Response (Not JSON):',
                        errorText
                    );
                    // 404 Not Found 오류를 더 명확하게 사용자에게 안내
                    if (response.status === 404) {
                        errorMessage =
                            'API 경로를 찾을 수 없습니다. vercel dev로 실행했는지 확인해주세요.';
                    }
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();

            feedback.value = {
                type: 'success',
                text: '문의 내용이 성공적으로 전송되었습니다. 감사합니다!',
            };
            name.value = '';
            email.value = '';
            message.value = '';
        } catch (error) {
            feedback.value = { type: 'error', text: error.message };
        } finally {
            isLoading.value = false;
        }
    };
</script>

<template>
    <div id="t-auth">
        <Card>
            <template #header>
                <div class="flex flex-col justify-content-center">
                    <Button
                        class="t-auth-icon"
                        icon="pi pi-envelope"
                        severity="secondary"
                        rounded
                        disabled />
                </div>
            </template>
            <template #title>문의하기</template>
            <template #subtitle
                >서비스에 대한 질문이나 피드백을 보내주세요.</template
            >
            <template #content>
                <form
                    @submit.prevent="handleSubmit"
                    class="flex flex-column gap-4 mt-4">
                    <InputGroup>
                        <InputGroupAddon>
                            <i class="pi pi-user"></i>
                        </InputGroupAddon>
                        <InputText v-model="name" placeholder="이름" />
                    </InputGroup>

                    <InputGroup>
                        <InputGroupAddon>
                            <i class="pi pi-at"></i>
                        </InputGroupAddon>
                        <InputText
                            v-model="email"
                            type="email"
                            placeholder="회신받을 이메일" />
                    </InputGroup>

                    <Textarea
                        v-model="message"
                        rows="5"
                        placeholder="문의 내용을 입력하세요..."
                        autoResize />

                    <Message
                        v-if="feedback.text"
                        :severity="feedback.type"
                        :closable="false">
                        {{ feedback.text }}
                    </Message>

                    <Button
                        type="submit"
                        label="전송하기"
                        :loading="isLoading" />
                </form>
            </template>
        </Card>
    </div>
</template>
