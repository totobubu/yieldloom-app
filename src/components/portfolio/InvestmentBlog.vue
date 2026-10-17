<script setup>
    import { computed, reactive, ref } from 'vue';
    import Button from 'primevue/button';
    import Select from 'primevue/select';
    import Textarea from 'primevue/textarea';
    import Message from 'primevue/message';
    import {
        blogTemplates,
        buildBlogDraft,
        monthlyChartSvg,
    } from '@/services/investmentEditorial.js';
    const props = defineProps({ context: { type: Object, required: true } });
    const selected = ref('monthly'),
        notes = ref(''),
        status = ref(''),
        busy = ref(false);
    const privacy = reactive({ amounts: false, symbols: false });
    const draft = computed(() =>
        buildBlogDraft(
            selected.value,
            { ...props.context, notes: notes.value },
            privacy
        )
    );
    function save(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function copy() {
        try {
            await navigator.clipboard.writeText(draft.value);
            status.value =
                '초안을 복사했습니다. 네이버 편집기에 붙여넣고 검토해 주세요.';
        } catch {
            status.value =
                '복사하지 못했습니다. 초안 다운로드를 이용해 주세요.';
        }
    }
    async function pngChart(svg) {
        const url = URL.createObjectURL(
            new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
        );
        try {
            const img = new Image();
            img.src = url;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = 960;
            canvas.height = 420;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('차트 출력 실패');
            ctx.drawImage(img, 0, 0);
            const blob = await new Promise((resolve) =>
                canvas.toBlob(resolve, 'image/png')
            );
            if (!blob) throw new Error('차트 출력 실패');
            return new Uint8Array(await blob.arrayBuffer());
        } finally {
            URL.revokeObjectURL(url);
        }
    }
    async function bundle() {
        busy.value = true;
        status.value = '';
        try {
            const { zipSync, strToU8 } = await import('fflate');
            const files = Object.fromEntries(
                blogTemplates.map((t) => [
                    `${t.id}.txt`,
                    strToU8(
                        buildBlogDraft(
                            t.id,
                            { ...props.context, notes: notes.value },
                            privacy
                        )
                    ),
                ])
            );
            const svg = monthlyChartSvg(props.context.baseline, privacy);
            files['monthly-dividends.svg'] = strToU8(svg);
            files['monthly-dividends.png'] = await pngChart(svg);
            files['README.txt'] = strToU8(
                '네이버 블로그용 초안 5종입니다. TXT를 편집기에 붙여넣으세요. PNG 차트를 이미지로 업로드할 수 있습니다. SVG 원본도 함께 제공합니다. 금액·종목 공개 설정을 반영했으나 자유 메모는 직접 검토해야 합니다. 자동 게시하지 않습니다.'
            );
            save(
                new Blob([zipSync(files)], { type: 'application/zip' }),
                `investment-blog-${props.context.month}.zip`
            );
            status.value = '템플릿 5종과 배당 차트를 다운로드했습니다.';
        } catch {
            status.value =
                '패키지 생성에 실패했습니다. 개별 초안 다운로드를 이용해 주세요.';
        } finally {
            busy.value = false;
        }
    }
</script>
<template>
    <section aria-labelledby="blog-title">
        <h3 id="blog-title">네이버 블로그 템플릿 5종</h3>
        <p>
            분석 결과를 본문 초안과 차트로 내보냅니다. 금액·비율·예상 시점과
            종목명은 기본 비공개입니다.
        </p>
        <label for="blog-template">글 유형</label
        ><Select
            input-id="blog-template"
            aria-label="글 유형"
            v-model="selected"
            :options="blogTemplates"
            option-label="label"
            option-value="id" />
        <div class="privacy">
            <label
                ><input v-model="privacy.amounts" type="checkbox" />
                금액·비율·예상 시점 공개</label
            ><label
                ><input v-model="privacy.symbols" type="checkbox" /> 종목명
                공개</label
            >
        </div>
        <label for="blog-notes">공개할 나의 메모 (개인정보 직접 확인)</label
        ><Textarea
            input-id="blog-notes"
            id="blog-notes"
            v-model="notes"
            rows="3"
            maxlength="5000"
            fluid />
        <label for="blog-preview">생성된 초안</label
        ><Textarea
            id="blog-preview"
            :model-value="draft"
            rows="18"
            readonly
            fluid />
        <div class="actions">
            <Button label="본문 복사" icon="pi pi-copy" @click="copy" /><Button
                label="초안 TXT 다운로드"
                outlined
                @click="
                    save(
                        new Blob([draft], { type: 'text/plain;charset=utf-8' }),
                        `${selected}-${context.month}.txt`
                    )
                " /><Button
                label="5종·차트 ZIP 다운로드"
                outlined
                :loading="busy"
                @click="bundle" />
        </div>
        <Message
            v-if="status"
            severity="info"
            :closable="false"
            role="status"
            >{{ status }}</Message
        >
    </section>
</template>
<style scoped>
    label {
        display: block;
        margin-block: 0.75rem 0.4rem;
    }
    .privacy,
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-block: 1rem;
    }
    textarea {
        max-width: 100%;
    }
</style>
