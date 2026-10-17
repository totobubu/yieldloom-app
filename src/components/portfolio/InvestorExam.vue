<script setup>
    import { computed, reactive, watch } from 'vue';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import {
        investmentQuestions,
        assessInvestor,
    } from '@/services/investmentPlanning.js';
    const props = defineProps({
        largestShare: { type: Number, default: null },
    });
    const emit = defineEmits(['result']);
    const answers = reactive({});
    const result = computed(() => assessInvestor(answers, props.largestShare));
    watch(answers, () => emit('result', null), { flush: 'sync' });
    function grade() {
        emit('result', result.value);
    }
    function reset() {
        for (const key of Object.keys(answers)) delete answers[key];
        emit('result', null);
    }
</script>
<template>
    <section aria-labelledby="exam-title">
        <h3 id="exam-title">내 성향 투자법 모의고사</h3>
        <p>
            위험 선호와 실제 투자 여력을 따로 살펴보는 학습 도구입니다. 10문항
            응답은 이 화면에서만 유지합니다.
        </p>
        <form @submit.prevent="grade">
            <fieldset v-for="(q, index) in investmentQuestions" :key="q.id">
                <legend>{{ index + 1 }}. {{ q.title }}</legend>
                <label v-for="(option, i) in q.options" :key="option"
                    ><input
                        v-model="answers[q.id]"
                        type="radio"
                        :name="q.id"
                        :value="i"
                        required />
                    {{ option }}</label
                >
            </fieldset>
            <div class="actions">
                <Button
                    type="submit"
                    label="성향·학습 결과 반영"
                    :disabled="!result" /><Button
                    label="응답 초기화"
                    severity="secondary"
                    outlined
                    @click="reset" />
            </div>
        </form>
        <div v-if="result" aria-live="polite">
            <h4>
                {{ result.label }} · 학습 정답 {{ result.correct }}/{{
                    result.total
                }}
            </h4>
            <p>
                위험 선호 {{ result.preference }}/6 · 투자 여력
                {{ result.capacity }}/6 (설문상 참고 점수)
            </p>
            <Message
                v-for="warning in result.warnings"
                :key="warning"
                severity="warn"
                :closable="false"
                >{{ warning }}</Message
            >
            <ul>
                <li v-for="rule in result.rules" :key="rule">{{ rule }}</li>
            </ul>
            <details>
                <summary>상황 판단·학습 해설</summary>
                <p
                    v-for="q in investmentQuestions.filter(
                        (q) => q.explanation
                    )"
                    :key="q.id">
                    <strong>{{ q.title }}</strong
                    ><br />{{
                        answers[q.id] === q.correct
                            ? '권장 답안과 일치'
                            : '다시 점검'
                    }}
                    · {{ q.explanation }}
                </p>
            </details>
        </div>
    </section>
</template>
<style scoped>
    fieldset {
        border: 1px solid var(--p-content-border-color);
        border-radius: 0.5rem;
        margin-block: 1rem;
        padding: 1rem;
        min-width: 0;
    }
    legend {
        font-weight: 600;
        max-width: 100%;
    }
    label {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        margin-block: 0.6rem;
    }
    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
    }
</style>
