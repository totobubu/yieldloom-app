<script setup>
    import { computed, reactive, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';
    import Select from 'primevue/select';
    import Tag from 'primevue/tag';
    import Textarea from 'primevue/textarea';
    import { authLoading, firebaseUser } from '@/services/firebaseClient.js';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
    import {
        loadStockFeedback,
        updateStockFeedback,
    } from '@/services/stockFeedback.js';

    const rows = ref([]),
        selectedId = ref(''),
        query = ref(''),
        statusFilter = ref('new'),
        busy = ref(false),
        error = ref(''),
        notice = ref('');
    const statuses = [
        { label: '신규', value: 'new' },
        { label: '검토 중', value: 'in_review' },
        { label: '처리 완료', value: 'resolved' },
        { label: '스팸', value: 'spam' },
    ];
    const categories = {
        data_error: '정보 오류',
        information_request: '추가 정보 요청',
        question: '질문',
        other: '기타',
    };
    const form = reactive({ status: 'new', internalNote: '' });
    const filtered = computed(() =>
        rows.value.filter(
            (row) =>
                (!statusFilter.value || row.status === statusFilter.value) &&
                `${row.symbol} ${row.message}`
                    .toLowerCase()
                    .includes(query.value.trim().toLowerCase())
        )
    );
    const selected = computed(() =>
        rows.value.find((row) => row.id === selectedId.value)
    );

    async function load() {
        if (!isPortfolioAdmin(firebaseUser.value)) return;
        busy.value = true;
        error.value = '';
        try {
            rows.value = (await loadStockFeedback(firebaseUser.value)).feedback;
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
    async function save() {
        if (!selected.value || busy.value) return;
        busy.value = true;
        error.value = '';
        notice.value = '';
        try {
            await updateStockFeedback(firebaseUser.value, {
                id: selected.value.id,
                ...form,
            });
            await load();
            notice.value = '처리 상태를 저장했습니다.';
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
    watch(
        [firebaseUser, authLoading],
        ([user, waiting]) => {
            if (!waiting && isPortfolioAdmin(user)) load();
        },
        { immediate: true }
    );
    watch(selected, (row) => {
        form.status = row?.status || 'new';
        form.internalNote = row?.internalNote || '';
        notice.value = '';
    });
</script>

<template>
    <section class="feedback-admin">
        <header>
            <div>
                <span class="studio-eyebrow">ADMIN</span>
                <h1>종목 의견함</h1>
            </div>
            <Button
                label="새로 불러오기"
                icon="pi pi-refresh"
                :loading="busy"
                @click="load" />
        </header>
        <Message v-if="error" severity="error" role="alert">{{
            error
        }}</Message>
        <Message v-if="notice" severity="success" role="status">{{
            notice
        }}</Message>
        <div class="filters">
            <InputText
                v-model="query"
                placeholder="티커·내용 검색"
                aria-label="티커·내용 검색" />
            <Select
                v-model="statusFilter"
                :options="[{ label: '전체', value: '' }, ...statuses]"
                option-label="label"
                option-value="value"
                aria-label="처리 상태 필터" />
        </div>
        <div class="feedback-layout">
            <section aria-label="종목 의견 목록">
                <button
                    v-for="row in filtered"
                    :key="row.id"
                    type="button"
                    class="feedback-row"
                    :aria-pressed="selectedId === row.id"
                    @click="selectedId = row.id">
                    <strong>{{ row.symbol }}</strong>
                    <span>{{ categories[row.category] || row.category }}</span>
                    <small>{{ row.message }}</small>
                    <Tag
                        :value="
                            statuses.find((item) => item.value === row.status)
                                ?.label || row.status
                        " />
                </button>
                <p v-if="!filtered.length">해당 조건의 의견이 없습니다.</p>
            </section>
            <section v-if="selected" aria-label="종목 의견 처리">
                <h2>
                    {{ selected.symbol }} · {{ categories[selected.category] }}
                </h2>
                <p>{{ selected.message }}</p>
                <a
                    :href="selected.pageUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    >종목 상세 열기</a
                >
                <label for="feedback-status">처리 상태</label>
                <Select
                    v-model="form.status"
                    input-id="feedback-status"
                    :options="statuses"
                    option-label="label"
                    option-value="value" />
                <label for="feedback-note">내부 메모</label>
                <Textarea
                    id="feedback-note"
                    v-model="form.internalNote"
                    rows="7"
                    maxlength="1000" />
                <Button
                    label="처리 상태 저장"
                    icon="pi pi-save"
                    :loading="busy"
                    @click="save" />
            </section>
        </div>
    </section>
</template>

<style scoped>
    .feedback-admin header,
    .filters {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        margin-bottom: 20px;
    }
    .feedback-admin h1 {
        margin: 8px 0 0;
    }
    .feedback-layout {
        display: grid;
        grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.2fr);
        gap: 20px;
    }
    .feedback-layout > section {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        padding: 20px;
        background: var(--app-surface);
    }
    .feedback-row {
        width: 100%;
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 4px 10px;
        text-align: left;
        padding: 14px;
        border: 0;
        border-bottom: 1px solid var(--app-border);
        background: transparent;
        color: inherit;
        cursor: pointer;
    }
    .feedback-row[aria-pressed='true'] {
        background: var(--app-surface-muted);
    }
    .feedback-row small {
        grid-column: 1 / -1;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--app-muted);
    }
    .feedback-layout section[aria-label='종목 의견 처리'] {
        display: grid;
        gap: 12px;
        align-content: start;
    }
    @media (max-width: 760px) {
        .feedback-admin header,
        .filters {
            align-items: stretch;
            flex-direction: column;
        }
        .feedback-layout {
            grid-template-columns: 1fr;
        }
    }
</style>
