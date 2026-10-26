<script setup>
    import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
    import Select from 'primevue/select';
    import { createSheetReportClient } from '@/services/sheetReports.js';

    const props = defineProps({ user: { type: Object, default: null } });
    const client = createSheetReportClient();
    const account = ref('wife');
    const accounts = [
        { label: '아내', value: 'wife' },
        { label: '남편', value: 'husband' },
    ];
    const summary = shallowRef(null),
        details = shallowRef(null);
    const loading = ref(false),
        detailLoading = ref(false),
        error = ref(''),
        detailError = ref('');
    const showDetails = ref(false),
        showBacklog = ref(false);
    let generation = 0;
    const accountName = computed(
        () => accounts.find((x) => x.value === account.value)?.label
    );
    const reviewItems = computed(() =>
        (details.value?.items || []).filter((x) => x.category !== 'nonblocking')
    );
    const backlogItems = computed(() =>
        (details.value?.items || []).filter((x) => x.category === 'nonblocking')
    );
    const formatTime = (value) =>
        value
            ? new Intl.DateTimeFormat('ko-KR', {
                  timeZone: 'Asia/Seoul',
                  dateStyle: 'medium',
                  timeStyle: 'short',
              }).format(new Date(value))
            : '기준시각 미확인';
    const valueText = (field) =>
        field.value == null
            ? '미확인'
            : `${field.value}${field.unit ? ` ${field.unit}` : ''}`;
    async function load(refresh = false) {
        const current = ++generation;
        summary.value = null;
        details.value = null;
        error.value = '';
        detailError.value = '';
        showDetails.value = false;
        showBacklog.value = false;
        detailLoading.value = false;
        if (!props.user) {
            loading.value = false;
            return;
        }
        loading.value = true;
        if (refresh) client.clear();
        try {
            const result = await client.load(
                props.user,
                account.value,
                'summary',
                { refresh }
            );
            if (current === generation) summary.value = result;
        } catch (e) {
            if (current === generation) error.value = e.message;
        } finally {
            if (current === generation) loading.value = false;
        }
    }
    async function loadDetails() {
        if (details.value || detailLoading.value || !summary.value) return;
        const current = generation;
        detailLoading.value = true;
        detailError.value = '';
        try {
            const result = await client.load(
                props.user,
                account.value,
                'details'
            );
            if (current !== generation) return;
            if (result.runId !== summary.value.runId)
                throw new Error(
                    '보고서 기준이 변경되었습니다. 요약을 새로고침해 주세요.'
                );
            details.value = result;
        } catch (e) {
            if (current === generation) {
                detailError.value = e.message;
                if ([401, 403].includes(e.status)) {
                    summary.value = null;
                    details.value = null;
                    showDetails.value = false;
                    showBacklog.value = false;
                    error.value = e.message;
                }
            }
        } finally {
            if (current === generation) detailLoading.value = false;
        }
    }
    function toggleDetails() {
        showDetails.value = !showDetails.value;
        if (showDetails.value) loadDetails();
    }
    function toggleBacklog() {
        showBacklog.value = !showBacklog.value;
        if (showBacklog.value) loadDetails();
    }
    watch(
        () => [props.user, props.user?.email, props.user?.emailVerified],
        () => {
            client.clear();
            load();
        },
        { immediate: true }
    );
    watch(account, () => load());
    onBeforeUnmount(() => {
        generation++;
        client.clear();
    });
</script>

<template>
    <section class="cloud-review" aria-label="클라우드 수집·대조 현황">
        <header class="review-header">
            <div>
                <span class="eyebrow">비공개 클라우드 · 읽기 전용</span>
                <h2>수집·대조 한눈에 보기</h2>
                <p>
                    원문 확보, 검증된 비교, 수동 근거와 미확인을 구분합니다.
                    원금 확정·자동 채택은 하지 않습니다.
                </p>
            </div>
            <div class="review-controls">
                <label for="cloud-review-account">보고서 계좌</label
                ><Select
                    v-model="account"
                    input-id="cloud-review-account"
                    :options="accounts"
                    option-label="label"
                    option-value="value" /><Button
                    label="보고서 새로고침"
                    icon="pi pi-refresh"
                    severity="secondary"
                    :loading="loading"
                    :disabled="loading || !user"
                    @click="load(true)" />
            </div>
        </header>
        <p v-if="!user">관리자 로그인 후 확인할 수 있습니다.</p>
        <p v-else-if="loading" role="status">
            {{ accountName }} 계좌 요약을 읽고 있습니다.
        </p>
        <Message v-else-if="error" severity="error" :closable="false"
            >{{ error }}
            <Button label="보고서 다시 조회" size="small" @click="load(true)"
        /></Message>
        <template v-else-if="summary">
            <p class="review-basis">
                {{ accountName }} · {{ formatTime(summary.snapshotAt) }} 기준 ·
                {{ summary.overallStatus }}
            </p>
            <div class="review-metrics">
                <article v-for="metric in summary.metrics" :key="metric.id">
                    <span>{{ metric.label }}</span
                    ><strong
                        >{{ metric.value ?? '미확인' }}
                        <small>{{ metric.unit }}</small></strong
                    >
                    <p>{{ metric.note }}</p>
                </article>
            </div>
            <section aria-label="실제 금융 흐름 대조">
                <h3>현금·체결 중심으로 진행</h3>
                <div class="review-flows">
                    <article v-for="flow in summary.flows" :key="flow.kind">
                        <h4>{{ flow.label }}</h4>
                        <Tag :value="flow.status" severity="secondary" />
                        <p>{{ flow.note }}</p>
                    </article>
                </div>
            </section>
            <section aria-label="값 채택 보류">
                <h3>해당 값·연결만 보류</h3>
                <p>
                    아래 차이가 다른 거래의 검토를 막지는 않습니다. 서로 다른
                    행·주문·표본 건수를 합쳐 금융사건 수로 세지 않습니다.
                </p>
                <ul>
                    <li v-for="hold in summary.holds" :key="hold.id">
                        <strong
                            >{{ hold.title }} · {{ hold.count
                            }}{{ hold.unit }}</strong
                        >
                        — {{ hold.note }}
                    </li>
                </ul>
            </section>
            <Message
                v-for="evidence in summary.manualEvidence"
                :key="evidence.id"
                severity="info"
                :closable="false"
                ><strong>수동 근거 · {{ evidence.title }}</strong>
                <p>{{ evidence.note }}</p></Message
            >
            <Button
                :label="
                    showDetails ? '비교 근거 접기' : '비교값·원문 위치 확인'
                "
                :aria-expanded="showDetails"
                aria-controls="cloud-review-details"
                severity="secondary"
                @click="toggleDetails" />
            <div v-if="showDetails" id="cloud-review-details">
                <p v-if="detailLoading" role="status">
                    선택한 계좌의 비교 근거를 읽고 있습니다.
                </p>
                <Message
                    v-else-if="detailError"
                    severity="error"
                    :closable="false"
                    >{{ detailError }}
                    <Button
                        label="근거 다시 조회"
                        size="small"
                        @click="loadDetails"
                /></Message>
                <p v-else-if="details && !reviewItems.length">
                    이 보고서에 별도 비교 항목이 없습니다. 전체 검증 완료를
                    뜻하지 않습니다.
                </p>
                <article
                    v-for="item in reviewItems"
                    :key="item.id"
                    class="review-case">
                    <h4>
                        {{ item.date }} {{ item.symbol }} · {{ item.label }}
                    </h4>
                    <p>{{ item.reason }}</p>
                    <div class="review-values">
                        <div>
                            <h5>기존 값·관측</h5>
                            <dl>
                                <template
                                    v-for="field in item.existing"
                                    :key="field.field"
                                    ><dt>{{ field.field }}</dt>
                                    <dd>{{ valueText(field) }}</dd></template
                                >
                            </dl>
                        </div>
                        <div>
                            <h5>비교 값·제안</h5>
                            <dl>
                                <template
                                    v-for="field in item.compared"
                                    :key="field.field"
                                    ><dt>{{ field.field }}</dt>
                                    <dd>{{ valueText(field) }}</dd></template
                                >
                            </dl>
                        </div>
                    </div>
                    <p>{{ item.nextAction }}</p>
                    <details>
                        <summary>근거 위치</summary>
                        <ul>
                            <li
                                v-for="source in item.sourceReferences"
                                :key="`${source.key}:${source.location}`">
                                <code>{{ source.key }}</code
                                ><br /><span>{{ source.location }}</span>
                            </li>
                        </ul>
                    </details>
                    <small>검토 제안 · 값 채택 기능 없음</small>
                </article>
            </div>
            <section class="review-backlog" aria-label="비차단 참고">
                <Button
                    :label="
                        showBacklog
                            ? '비차단 참고 접기'
                            : `비차단 참고 · ${summary.nonblocking?.label || '미확인 비체결 주문'}`
                    "
                    severity="secondary"
                    variant="text"
                    :aria-expanded="showBacklog"
                    aria-controls="cloud-review-backlog"
                    @click="toggleBacklog" />
                <p>{{ summary.nonblocking?.note }}</p>
                <div v-if="showBacklog" id="cloud-review-backlog">
                    <p v-if="detailLoading" role="status">
                        참고 근거를 읽고 있습니다.
                    </p>
                    <p v-if="detailError" role="alert">{{ detailError }}</p>
                    <ul>
                        <li v-for="item in backlogItems" :key="item.id">
                            {{ item.date }} {{ item.symbol }} —
                            {{ item.label }} · {{ item.reason }}
                        </li>
                    </ul>
                </div>
            </section>
            <details>
                <summary>검증 범위와 남은 한계</summary>
                <ul>
                    <li v-for="line in summary.limitations" :key="line">
                        {{ line }}
                    </li>
                </ul>
            </details>
        </template>
    </section>
</template>

<style scoped>
    .cloud-review {
        margin-block: 1.5rem;
        padding: 1.25rem;
        border: 1px solid var(--p-content-border-color);
        border-radius: var(--p-border-radius-lg);
        background: var(--p-content-background);
        overflow-wrap: anywhere;
    }
    .review-header {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
    }
    .review-controls {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
    }
    h2,
    h3,
    h4,
    h5 {
        margin-block: 0.5rem;
    }
    .eyebrow,
    .review-basis,
    small {
        color: var(--p-text-muted-color);
    }
    .review-metrics,
    .review-flows {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
        gap: 0.75rem;
        margin-block: 1rem;
    }
    .review-metrics article,
    .review-flows article,
    .review-case {
        border: 1px solid var(--p-content-border-color);
        border-radius: var(--p-border-radius-md);
        padding: 1rem;
    }
    .review-metrics strong {
        display: block;
        font-size: 1.5rem;
        margin-block: 0.5rem;
    }
    .review-metrics small {
        font-size: 0.9rem;
    }
    .review-case {
        margin-block: 0.75rem;
    }
    .review-values {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
    }
    dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.4rem;
    }
    dd {
        margin: 0;
    }
    ul {
        padding-inline-start: 1.3rem;
    }
    li {
        margin-block: 0.5rem;
    }
    .review-backlog {
        margin-block: 1rem;
        border-top: 1px solid var(--p-content-border-color);
        padding-block-start: 0.75rem;
    }
    @media (max-width: 600px) {
        .cloud-review {
            padding: 0.75rem;
        }
        .review-values {
            grid-template-columns: 1fr;
        }
    }
</style>
