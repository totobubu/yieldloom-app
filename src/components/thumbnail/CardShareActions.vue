<script setup>
    import { computed, ref } from 'vue';
    import Button from 'primevue/button';
    import Dialog from 'primevue/dialog';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';

    const props = defineProps({
        title: { type: String, required: true },
        text: { type: String, required: true },
        url: { type: String, required: true },
    });
    const copied = ref(false);
    const manualCopyOpen = ref(false),
        shareError = ref('');
    const canWebShare = computed(
        () =>
            typeof navigator !== 'undefined' &&
            typeof navigator.share === 'function'
    );
    const encodedUrl = computed(() => encodeURIComponent(props.url));
    const encodedText = computed(() => encodeURIComponent(props.text));

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(props.url);
            copied.value = true;
            window.setTimeout(() => (copied.value = false), 1800);
        } catch {
            manualCopyOpen.value = true;
        }
    };
    const webShare = async () => {
        shareError.value = '';
        try {
            await navigator.share({
                title: props.title,
                text: props.text,
                url: props.url,
            });
        } catch (error) {
            if (error?.name !== 'AbortError')
                shareError.value =
                    '공유 창을 열지 못했습니다. 링크를 복사해 주세요.';
        }
    };
    const open = (url) =>
        window.open(url, '_blank', 'noopener,noreferrer,width=640,height=560');
</script>

<template>
    <nav class="card-share-actions" :aria-label="`${title} 공유`">
        <Button
            v-if="canWebShare"
            label="공유"
            icon="pi pi-share-alt"
            severity="secondary"
            outlined
            @click="webShare" />
        <Button
            label="카카오톡"
            severity="secondary"
            outlined
            @click="
                open(
                    `https://sharer.kakao.com/talk/friends/picker/link?url=${encodedUrl}`
                )
            " />
        <Button
            label="X"
            severity="secondary"
            outlined
            @click="
                open(
                    `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`
                )
            " />
        <Button
            label="Facebook"
            severity="secondary"
            outlined
            @click="
                open(
                    `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
                )
            " />
        <Button
            :label="copied ? '링크 복사됨' : '링크 복사'"
            :icon="copied ? 'pi pi-check' : 'pi pi-link'"
            severity="secondary"
            outlined
            @click="copyLink" />
    </nav>
    <Message v-if="shareError" severity="warn" :closable="false">{{
        shareError
    }}</Message>
    <Dialog
        v-model:visible="manualCopyOpen"
        modal
        header="링크 직접 복사"
        :style="{ width: '460px' }"
        :breakpoints="{ '600px': '92vw' }"
        ><p>아래 링크를 선택해 복사해 주세요.</p>
        <label for="manual-share-url" class="studio-sr-only">공유 링크</label
        ><InputText
            id="manual-share-url"
            :model-value="url"
            readonly
            fluid
            autofocus
            @focus="$event.target.select()" /><template #footer
            ><Button label="닫기" @click="manualCopyOpen = false" /></template
    ></Dialog>
</template>

<style scoped>
    .card-share-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .card-share-actions :deep(.p-button) {
        font-size: 13px;
    }
</style>
