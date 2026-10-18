<script setup>
    import { computed, ref, onScopeDispose } from 'vue';
    import Button from 'primevue/button';
    import Textarea from 'primevue/textarea';
    import Message from 'primevue/message';
    import {
        monthlyBlogText,
        monthlyCardSvg,
    } from '@/services/monthlyContent.js';
    import { downloadContent, svgPng } from '@/utils/contentDownload.js';
    const props = defineProps({
        statement: { type: Object, required: true },
        previous: { type: Object, default: null },
    });
    defineEmits(['close']);
    const amounts = ref(false),
        notes = ref(''),
        busy = ref(false),
        status = ref('');
    let generation = 0;
    onScopeDispose(() => generation++);
    const draft = computed(() =>
        monthlyBlogText(props.statement, props.previous, {
            amounts: amounts.value,
            notes: notes.value,
        })
    );
    const svg = computed(() =>
        monthlyCardSvg(props.statement, props.previous, {
            amounts: amounts.value,
        })
    );
    const preview = computed(
        () =>
            'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.value)
    );
    async function copy() {
        try {
            await navigator.clipboard.writeText(draft.value);
            status.value = '결산 본문을 복사했습니다.';
        } catch {
            status.value = '복사하지 못했습니다. TXT 저장을 이용하세요.';
        }
    }
    async function png() {
        const version = generation,
            source = svg.value,
            name = `monthly-${props.statement.month}.png`;
        busy.value = true;
        try {
            const blob = await svgPng(source, 1080, 1080);
            if (version === generation) {
                downloadContent(blob, name);
                status.value = '카드 PNG 다운로드를 시작했습니다.';
            }
        } catch (reason) {
            if (version === generation) status.value = reason.message;
        } finally {
            if (version === generation) busy.value = false;
        }
    }
</script>
<template>
    <section class="monthly-content" aria-label="결산 콘텐츠 작업실">
        <h4>결산 카드·블로그 작업실</h4>
        <p>
            지금 확인한 결산과 이전 결산 비교를 본문·카드에 연결합니다. 금액은
            기본 비공개이며 자유 메모는 공개 전에 직접 확인하세요. 자동 게시하지
            않습니다.
        </p>
        <label
            ><input v-model="amounts" type="checkbox" :disabled="busy" /> 결산
            콘텐츠에 금액 공개</label
        >
        <label for="monthly-notes"
            >결산 공개 메모<Textarea
                id="monthly-notes"
                v-model="notes"
                :disabled="busy"
                rows="3"
                maxlength="5000"
                fluid
        /></label>
        <label for="monthly-draft"
            >결산 블로그 초안<Textarea
                id="monthly-draft"
                :model-value="draft"
                readonly
                rows="12"
                fluid
        /></label>
        <img
            :src="preview"
            alt="월간 배당 결산 카드 미리보기"
            width="1080"
            height="1080" />
        <div class="actions">
            <Button label="결산 본문 복사" :disabled="busy" @click="copy" />
            <Button
                label="결산 TXT 저장"
                :disabled="busy"
                @click="
                    downloadContent(
                        new Blob([draft], { type: 'text/plain;charset=utf-8' }),
                        `monthly-${statement.month}.txt`
                    )
                " />
            <Button
                label="결산 카드 SVG 저장"
                :disabled="busy"
                @click="
                    downloadContent(
                        new Blob([svg], {
                            type: 'image/svg+xml;charset=utf-8',
                        }),
                        `monthly-${statement.month}.svg`
                    )
                " />
            <Button
                label="결산 카드 PNG 저장"
                :loading="busy"
                :disabled="busy"
                @click="png" />
            <Button
                label="결산 작업실 닫기"
                text
                :disabled="busy"
                @click="$emit('close')" />
        </div>
        <Message v-if="status" severity="info" :closable="false">{{
            status
        }}</Message>
    </section>
</template>
<style scoped>
    .monthly-content {
        margin-block: 1rem;
        padding: 1rem;
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    label {
        display: block;
        margin-block: 0.75rem;
    }
    img {
        display: block;
        width: min(100%, 420px);
        height: auto;
        margin-block: 1rem;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
    }
</style>
