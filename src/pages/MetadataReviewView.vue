<script setup>
    import { computed, reactive, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Textarea from 'primevue/textarea';
    import Select from 'primevue/select';
    import Checkbox from 'primevue/checkbox';
    import Message from 'primevue/message';
    import Tag from 'primevue/tag';
    import CollectionHealth from '@/components/stock/CollectionHealth.vue';
    import { firebaseUser, authLoading } from '@/services/firebaseClient';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
    import { metadataReviewRequest } from '@/services/metadataReview.js';
    import { useFullscreenLoading } from '@/composables/useFullscreenLoading.js';
    const allowed = computed(() => isPortfolioAdmin(firebaseUser.value));
    const data = ref(null),
        error = ref(''),
        notice = ref(''),
        busy = ref(false),
        saving = ref(false);
    useFullscreenLoading(busy, 'ETF 검토 데이터를 불러오고 있습니다.');
    const search = ref(''),
        status = ref('pending'),
        selectedSymbol = ref('');
    const labels = {
        verified: '공식 검증',
        'legacy-unverified': '기존 연결 재검증',
        'needs-review': '후보 검토',
        conflict: '자료 충돌',
        unregistered: '신규 등록',
        approve: '승인',
        hold: '보류',
        amend: '수정 제안',
        reject: '후보 제외',
        'needs-verification': '수정 후 검증 대기',
    };
    const filters = [
        { label: '검토 필요', value: 'pending' },
        { label: '전체', value: 'all' },
        { label: '신규 등록', value: 'unregistered' },
    ];
    const form = reactive({
        action: 'hold',
        underlying: '',
        note: '',
        market: '',
        currency: 'USD',
        name: '',
        confirmInstrument: false,
    });
    const actions = ['approve', 'hold', 'amend', 'reject'].map((value) => ({
        label: labels[value],
        value,
    }));
    const markets = ['NASDAQ', 'NYSE', 'AMEX', 'BATS', 'NYSEARCA'];
    const reviewed = computed(
        () =>
            new Map((data.value?.reviews || []).map((row) => [row.symbol, row]))
    );
    const queue = computed(() =>
        (data.value?.queue || []).filter(
            (row) =>
                (status.value === 'all' ||
                    (status.value === 'pending'
                        ? row.status !== 'verified'
                        : row.status === status.value)) &&
                `${row.symbol} ${row.name} ${row.currentUnderlying || ''} ${row.proposed?.underlying || ''}`
                    .toLowerCase()
                    .includes(search.value.toLowerCase())
        )
    );
    const selected = computed(() =>
        data.value?.queue.find((row) => row.symbol === selectedSymbol.value)
    );
    const history = computed(() =>
        (data.value?.history || []).filter(
            (row) => row.symbol === selectedSymbol.value
        )
    );
    let generation = 0;
    async function load(refresh = false) {
        const user = firebaseUser.value,
            request = ++generation;
        if (!isPortfolioAdmin(user)) return;
        busy.value = true;
        error.value = '';
        try {
            const result = await metadataReviewRequest(user, undefined, {
                refresh,
            });
            if (request === generation && user === firebaseUser.value)
                data.value = result;
        } catch (reason) {
            if (request === generation) error.value = reason.message;
        } finally {
            if (request === generation) busy.value = false;
        }
    }
    watch(
        [firebaseUser, authLoading],
        ([user, waiting]) => {
            generation++;
            data.value = null;
            error.value = '';
            notice.value = '';
            selectedSymbol.value = '';
            if (!waiting && isPortfolioAdmin(user)) load();
        },
        { immediate: true }
    );
    watch(selectedSymbol, () => {
        Object.assign(form, {
            action: 'hold',
            underlying:
                selected.value?.proposed?.underlying ||
                selected.value?.currentUnderlying ||
                '',
            note: '',
            market: selected.value?.market || '',
            name: selected.value?.name || '',
            confirmInstrument: false,
        });
        notice.value = '';
    });
    async function save() {
        if (!selected.value || saving.value) return;
        const user = firebaseUser.value,
            symbol = selected.value.symbol,
            request = generation;
        saving.value = true;
        error.value = '';
        notice.value = '';
        try {
            await metadataReviewRequest(user, {
                ...form,
                symbol,
                requestId: crypto.randomUUID(),
                expectedRevision: reviewed.value.get(symbol)?.revision || 0,
                datasetRevision: data.value.revision,
            });
            if (request !== generation || user !== firebaseUser.value) return;
            await load(true);
            if (user === firebaseUser.value) {
                notice.value =
                    form.action === 'approve'
                        ? '승인을 저장했습니다. 다음 데이터 반영 작업에서 검색 목록을 갱신합니다.'
                        : '검토 결과와 변경 이력을 저장했습니다.';
                form.note = '';
            }
        } catch (reason) {
            if (request === generation) error.value = reason.message;
        } finally {
            saving.value = false;
        }
    }
</script>
<template>
    <main class="metadata-review">
        <header>
            <div>
                <h1>ETF 데이터 검토</h1>
                <p>공식 근거와 기존 연결을 대조하고 검토 이력을 남깁니다.</p>
            </div>
            <Button
                label="새로 불러오기"
                icon="pi pi-refresh"
                :loading="busy"
                :disabled="!allowed || saving"
                @click="load(true)" />
        </header>
        <Message v-if="authLoading" severity="info"
            >로그인을 확인하고 있습니다.</Message
        >
        <Message v-else-if="!firebaseUser" severity="info"
            ><router-link to="/admin/login"
                >로그인 후 관리자 권한을 확인해 주세요.</router-link
            ></Message
        >
        <Message v-else-if="!allowed" severity="warn"
            >관리자만 데이터 검토를 할 수 있습니다.</Message
        >
        <Message v-if="error" severity="error" role="alert">{{
            error
        }}</Message>
        <Message v-if="notice" severity="success" role="status">{{
            notice
        }}</Message>
        <template v-if="allowed && data">
            <section aria-label="조사 요약">
                <p>
                    조사 기준 {{ data.generatedAt }} · 전체 ETF
                    {{ data.summary.etfsAudited }}개 · 공식 검증
                    {{ data.summary.verified }}개
                </p>
            </section>
            <CollectionHealth
                :health="data.health"
                :failures="data.sourceFailures" />
            <div class="review-layout">
                <section aria-label="검토 목록">
                    <div class="filters">
                        <label for="metadata-query">티커·기초자산 검색</label
                        ><InputText
                            id="metadata-query"
                            v-model="search"
                            fluid /><label
                            id="metadata-status-label"
                            for="metadata-status"
                            >검토 상태</label
                        ><Select
                            v-model="status"
                            fluid
                            input-id="metadata-status"
                            aria-labelledby="metadata-status-label"
                            :options="filters"
                            option-label="label"
                            option-value="value" />
                    </div>
                    <p>{{ queue.length }}개 종목</p>
                    <ul class="queue">
                        <li v-for="row in queue" :key="row.symbol">
                            <button
                                type="button"
                                :aria-pressed="selectedSymbol === row.symbol"
                                @click="selectedSymbol = row.symbol">
                                <strong>{{ row.symbol }}</strong
                                ><span>{{ row.name }}</span
                                ><Tag
                                    :value="
                                        labels[
                                            reviewed.get(row.symbol)?.status
                                        ] ||
                                        labels[row.status] ||
                                        row.status
                                    " />
                            </button>
                        </li>
                    </ul>
                    <p v-if="!queue.length">
                        해당 조건의 검토 대상이 없습니다.
                    </p>
                </section>
                <section aria-label="선택 종목 검토">
                    <template v-if="selected"
                        ><h2>{{ selected.symbol }} 검토</h2>
                        <dl>
                            <dt>기존 기초자산</dt>
                            <dd>
                                {{ selected.currentUnderlying || '미확인' }}
                            </dd>
                            <dt>공식 후보</dt>
                            <dd>
                                {{
                                    selected.proposed?.underlying ||
                                    '공식 근거 추가 수집 필요'
                                }}
                            </dd>
                            <dt>이름에서 찾은 후보</dt>
                            <dd>
                                {{
                                    selected.nameCandidates.join(' · ') ||
                                    '없음'
                                }}
                            </dd>
                        </dl>
                        <div v-if="selected.proposed" class="evidence">
                            <a
                                :href="selected.proposed.evidence.url"
                                target="_blank"
                                rel="noopener noreferrer"
                                >공식 자료 열기</a
                            >
                            <p>{{ selected.proposed.evidence.text }}</p>
                            <small
                                >확인
                                {{
                                    selected.proposed.evidence.fetchedAt
                                }}</small
                            >
                        </div>
                        <Message v-else severity="info"
                            >현재 승인 가능한 공식 후보가 없습니다. 수정
                            제안·보류로 기록한 뒤 공식 자료를 재수집해
                            주세요.</Message
                        >
                        <form class="review-form" @submit.prevent="save">
                            <label
                                id="metadata-action-label"
                                for="metadata-action"
                                >검토 결과</label
                            ><Select
                                v-model="form.action"
                                fluid
                                input-id="metadata-action"
                                aria-labelledby="metadata-action-label"
                                :options="actions"
                                option-label="label"
                                option-value="value" /><label
                                for="metadata-underlying"
                                >기초자산 티커</label
                            ><InputText
                                id="metadata-underlying"
                                v-model="form.underlying"
                                fluid
                                :disabled="form.action !== 'amend'" />
                            <template
                                v-if="
                                    !selected.registered &&
                                    form.action === 'approve'
                                "
                                ><label for="metadata-name">공식 종목명</label
                                ><InputText
                                    id="metadata-name"
                                    v-model="form.name"
                                    fluid /><label
                                    id="metadata-market-label"
                                    for="metadata-market"
                                    >공식 거래소</label
                                ><Select
                                    v-model="form.market"
                                    fluid
                                    input-id="metadata-market"
                                    aria-labelledby="metadata-market-label"
                                    :options="markets" /><label
                                    for="metadata-currency"
                                    >통화</label
                                ><InputText
                                    id="metadata-currency"
                                    v-model="form.currency"
                                    fluid
                                    readonly /><label for="metadata-confirm"
                                    ><Checkbox
                                        v-model="form.confirmInstrument"
                                        input-id="metadata-confirm"
                                        binary />
                                    공식 자료에서 종목명·거래소·통화를
                                    확인했습니다.</label
                                ></template
                            >
                            <label for="metadata-note"
                                >검토 근거 (8~1,000자)</label
                            ><Textarea
                                id="metadata-note"
                                v-model="form.note"
                                fluid
                                rows="4"
                                :maxlength="1000"
                                required /><Button
                                label="검토 저장"
                                type="submit"
                                :loading="saving"
                                :disabled="
                                    busy ||
                                    (form.action === 'approve' &&
                                        !selected.proposed)
                                " />
                        </form>
                        <h3>최근 변경 이력</h3>
                        <ol>
                            <li v-for="row in history" :key="row.revision">
                                <strong
                                    >{{ labels[row.status] || row.status }} ·
                                    {{ row.createdAt }}</strong
                                >
                                <p>{{ row.note }}</p>
                                <small
                                    >{{ row.proposedUnderlying }} · 버전
                                    {{ row.revision }}</small
                                >
                            </li>
                        </ol>
                        <p v-if="!history.length">
                            저장된 변경 이력이 없습니다.
                        </p>
                    </template>
                    <p v-else>목록에서 검토할 종목을 선택해 주세요.</p>
                </section>
            </div>
        </template>
    </main>
</template>
<style scoped>
    .metadata-review {
        max-width: 1200px;
        margin: auto;
        padding: 24px;
        color: var(--app-text);
    }
    header {
        display: flex;
        gap: 16px;
        justify-content: space-between;
        align-items: start;
    }
    .review-layout {
        display: grid;
        grid-template-columns: minmax(260px, 1fr) minmax(0, 1.4fr);
        gap: 24px;
    }
    .review-layout > section,
    .evidence {
        border: 1px solid var(--app-border);
        background: var(--app-surface);
        padding: 18px;
        border-radius: 14px;
        min-width: 0;
    }
    .filters,
    .review-form {
        display: grid;
        gap: 10px;
    }
    .filters > *,
    .review-form > * {
        min-width: 0;
        max-width: 100%;
    }
    .queue {
        list-style: none;
        padding: 0;
        max-height: 650px;
        overflow: auto;
    }
    .queue button {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        text-align: left;
        width: 100%;
        background: var(--app-surface);
        color: var(--app-text);
        border: 1px solid var(--app-border);
        padding: 14px;
        cursor: pointer;
    }
    .queue button[aria-pressed='true'] {
        border: 2px solid var(--app-accent);
    }
    .queue span {
        overflow-wrap: anywhere;
    }
    dt {
        font-weight: 700;
    }
    dd {
        margin: 4px 0 16px;
    }
    .review-form {
        margin-top: 20px;
    }
    .evidence {
        overflow-wrap: anywhere;
    }
    li p {
        white-space: pre-wrap;
    }
    @media (max-width: 720px) {
        header {
            flex-direction: column;
        }
        .review-layout {
            grid-template-columns: 1fr;
        }
        .queue {
            max-height: 300px;
        }
    }
    @media (max-width: 767px) {
        .metadata-review {
            padding: 0;
        }
        h1 {
            margin-top: 0;
        }
    }
</style>
