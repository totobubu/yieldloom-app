<script setup>
    import { computed, reactive, ref, watch } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { authLoading, firebaseUser } from '@/services/firebaseClient';
    import { portfolioMappingRequest } from '@/services/portfolioMappings';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
    const route = useRoute(),
        router = useRouter();
    const allowed = computed(() => isPortfolioAdmin(firebaseUser.value));
    const pending = ref([]),
        reviewed = ref([]),
        catalog = ref([]);
    const busy = ref(false),
        error = ref(''),
        message = ref(''),
        search = ref('');
    const review = ref(null),
        accepted = ref(false),
        manual = ref(false);
    const form = reactive({
        isin: String(route.query.isin || ''),
        symbol: '',
        name: '',
        canonicalIsin: '',
        evidence: '',
    });
    const lookupResult = ref(null);
    const autoVerified = computed(
        () =>
            lookupResult.value?.isin === form.isin.trim().toUpperCase() &&
            lookupResult.value.candidates.some(
                (item) => item.symbol === form.symbol && item.crossChecked
            )
    );
    watch(
        () => form.isin,
        () => {
            lookupResult.value = null;
        }
    );
    async function autoLookup() {
        busy.value = true;
        error.value = '';
        lookupResult.value = null;
        review.value = null;
        accepted.value = false;
        try {
            const result = await portfolioMappingRequest(firebaseUser.value, {
                action: 'lookup',
                isin: form.isin,
            });
            lookupResult.value = result;
            if (
                result.candidates.length === 1 &&
                result.candidates[0].crossChecked
            )
                chooseAutomatic(result.candidates[0]);
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
    function chooseAutomatic(item) {
        const entry = catalog.value.find((row) => row.symbol === item.symbol);
        Object.assign(form, {
            symbol: item.symbol,
            name: entry?.name || item.name,
            canonicalIsin: item.canonicalIsin,
            evidence: item.crossChecked
                ? `OpenFIGI와 Yahoo Finance의 ISIN 조회 결과가 ${item.symbol}로 일치함`
                : '자동 검색 후보입니다. 종목 정보를 추가 확인해 주세요.',
        });
        manual.value = !entry;
    }
    const matches = computed(() => {
        const query = search.value.trim().toLowerCase();
        return query
            ? catalog.value
                  .filter((row) =>
                      `${row.symbol} ${row.name} ${row.isin || ''}`
                          .toLowerCase()
                          .includes(query)
                  )
                  .slice(0, 20)
            : [];
    });
    watch(
        [form, manual],
        () => {
            review.value = null;
            accepted.value = false;
        },
        { deep: true }
    );
    async function load() {
        const data = await portfolioMappingRequest(firebaseUser.value);
        pending.value = data.pending;
        reviewed.value = data.reviewed;
        catalog.value = data.catalog;
    }
    watch(
        [firebaseUser, authLoading],
        async ([user, waiting]) => {
            if (waiting) return;
            if (!user) {
                router.replace('/login');
                return;
            }
            pending.value = [];
            reviewed.value = [];
            catalog.value = [];
            if (!allowed.value) return;
            busy.value = true;
            try {
                await load();
                if (form.isin) await autoLookup();
            } catch (reason) {
                error.value = reason.message;
            } finally {
                busy.value = false;
            }
        },
        { immediate: true }
    );
    async function chooseSource(item) {
        Object.assign(form, {
            isin: item.isin,
            symbol: '',
            name: '',
            canonicalIsin: '',
            evidence: '',
        });
        search.value = '';
        manual.value = false;
        error.value = '';
        message.value = '';
        await autoLookup();
    }
    function chooseTarget(item) {
        Object.assign(form, {
            symbol: item.symbol,
            name: item.name,
            canonicalIsin: item.isin || form.isin,
        });
    }
    async function preview() {
        busy.value = true;
        error.value = '';
        message.value = '';
        review.value = null;
        try {
            review.value = await portfolioMappingRequest(firebaseUser.value, {
                action: 'preview',
                ...form,
                autoLookup: autoVerified.value,
            });
            accepted.value = false;
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
    async function apply() {
        if (!review.value || !accepted.value) return;
        busy.value = true;
        error.value = '';
        try {
            const result = await portfolioMappingRequest(firebaseUser.value, {
                action: 'apply',
                reviewId: review.value.reviewId,
            });
            message.value = `${result.isin} → ${result.symbol} 연결을 저장하고 기존 원장 ${result.updatedAssets}개에 반영했습니다.`;
            review.value = null;
            accepted.value = false;
            await load();
        } catch (reason) {
            error.value = reason.message;
        } finally {
            busy.value = false;
        }
    }
</script>
<template>
    <section class="mapping-page">
        <header>
            <div>
                <p>ADMIN</p>
                <h1>종목 식별 관리</h1>
            </div>
            <router-link to="/mypage">마이페이지</router-link>
        </header>
        <p v-if="authLoading">로그인을 확인하고 있습니다.</p>
        <p v-else-if="!allowed" role="alert">관리자 전용 페이지입니다.</p>
        <template v-else>
            <p class="intro">
                PDF의 ISIN과 종목명을 대조해 티커를 연결합니다. 원래 ISIN은
                보존하며, 확정한 연결은 기존 원장과 이후 PDF 가져오기에
                적용됩니다.
            </p>
            <p v-if="error" class="notice error" role="alert">{{ error }}</p>
            <p v-if="message" class="notice" role="status">{{ message }}</p>
            <p v-if="busy" role="status">처리 중입니다.</p>
            <section class="panel">
                <h2>티커 연결 대기 · {{ pending.length }}개 ISIN</h2>
                <p v-if="!pending.length && !busy">
                    티커 연결이 필요한 종목이 없습니다.
                </p>
                <div class="pending-grid">
                    <button
                        v-for="item in pending"
                        :key="item.isin"
                        :disabled="busy"
                        :aria-pressed="form.isin === item.isin"
                        @click="chooseSource(item)">
                        <strong>{{
                            item.names.join(' / ') || '종목명 없음'
                        }}</strong
                        ><span>{{ item.isin }}</span
                        ><small>원장 {{ item.assetCount }}개</small>
                    </button>
                </div>
            </section>
            <section class="panel">
                <h2>연결할 종목 확인</h2>
                <form @submit.prevent="preview">
                    <fieldset :disabled="busy">
                        <label
                            >PDF ISIN
                            <input
                                v-model="form.isin"
                                required
                                maxlength="12"
                                placeholder="US로 시작하는 12자리 식별번호"
                        /></label>
                        <button
                            type="button"
                            :disabled="!form.isin"
                            @click="autoLookup">
                            ISIN 자동 조회
                        </button>
                        <section
                            v-if="lookupResult"
                            class="lookup-results"
                            aria-label="ISIN 자동 조회 결과">
                            <p v-if="!lookupResult.candidates.length">
                                자동 조회 결과가 없습니다. 카탈로그나 웹
                                검색으로 확인해 주세요.
                            </p>
                            <article
                                v-for="item in lookupResult.candidates"
                                :key="item.symbol">
                                <strong
                                    >{{ item.symbol }} · {{ item.name }}</strong
                                >
                                <p>
                                    {{
                                        item.crossChecked
                                            ? 'OpenFIGI ISIN 일치 · Yahoo 결과도 일치'
                                            : item.exactIsin
                                              ? 'ISIN 일치 · 추가 확인 필요'
                                              : '검색 후보 · ISIN 추가 확인 필요'
                                    }}
                                </p>
                                <a
                                    v-for="source in item.sources"
                                    :key="source.name"
                                    :href="source.url"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >{{ source.name }}</a
                                >
                                <button
                                    type="button"
                                    @click="chooseAutomatic(item)">
                                    이 후보 선택
                                </button>
                            </article>
                            <p
                                v-if="
                                    lookupResult.statuses.openfigi !== 'ok' ||
                                    lookupResult.statuses.yahoo !== 'ok'
                                ">
                                일부 조회 서비스에 연결하지 못했습니다. 결과를
                                추가 확인해 주세요.
                            </p>
                        </section>
                        <a
                            v-if="form.isin"
                            :href="`https://www.google.com/search?q=${encodeURIComponent(form.isin)}`"
                            target="_blank"
                            rel="noopener noreferrer"
                            >웹에서 ISIN 검색</a
                        >
                        <label
                            >카탈로그 검색
                            <input
                                v-model="search"
                                placeholder="티커 · 종목명 · ISIN 검색"
                        /></label>
                        <ul v-if="matches.length" class="matches">
                            <li
                                v-for="item in matches"
                                :key="`${item.symbol}-${item.isin}`">
                                <button
                                    type="button"
                                    @click="chooseTarget(item)">
                                    <strong
                                        >{{ item.symbol }} ·
                                        {{ item.name }}</strong
                                    ><span>{{
                                        item.isin || 'ISIN 미등록'
                                    }}</span>
                                </button>
                            </li>
                        </ul>
                        <p v-else-if="search">
                            일치하는 종목이 없습니다. 확인된 종목은 아래 직접
                            입력으로 연결할 수 있습니다.
                        </p>
                        <label class="check"
                            ><input v-model="manual" type="checkbox" />
                            카탈로그에 없는 종목 직접 입력</label
                        >
                        <div class="fields">
                            <label
                                >연결할 티커
                                <input
                                    v-model="form.symbol"
                                    required
                                    :readonly="!manual"
                                    placeholder="검색 결과에서 선택"
                            /></label>
                            <label
                                >종목명
                                <input
                                    v-model="form.name"
                                    required
                                    :readonly="!manual"
                                    maxlength="200"
                            /></label>
                            <label
                                >연결할 종목 ISIN
                                <input
                                    v-model="form.canonicalIsin"
                                    required
                                    :readonly="!manual"
                                    maxlength="12"
                            /></label>
                        </div>
                        <p
                            v-if="
                                form.canonicalIsin &&
                                form.isin.toUpperCase() !==
                                    form.canonicalIsin.toUpperCase()
                            "
                            class="notice">
                            두 ISIN이 다릅니다. 분할·병합·종목 변경으로 이어지는
                            동일 종목인지 확인해 주세요.
                        </p>
                        <label
                            >확인 근거
                            <textarea
                                v-model="form.evidence"
                                required
                                minlength="8"
                                maxlength="1000"
                                rows="3"
                                placeholder="발행사 자료, 증권사 종목 정보, ISIN 변경 이력 등 확인한 내용을 남겨 주세요." />
                        </label>
                        <button type="submit" :disabled="!form.symbol">
                            연결 검토
                        </button>
                    </fieldset>
                </form>
            </section>
            <section
                v-if="review"
                class="panel review"
                aria-label="종목 연결 검토">
                <h2>연결 내용 검토</h2>
                <p v-if="review.mapping.verifiedByLookup">
                    OpenFIGI와 Yahoo의 ISIN 조회 결과가 일치하는 연결입니다.
                </p>
                <p v-if="!review.mapping.catalogMatched">
                    서비스 카탈로그에 없는 종목입니다. 티커는 연결되며 썸네일은
                    카탈로그 등록 후 사용할 수 있습니다.
                </p>
                <dl>
                    <div>
                        <dt>PDF ISIN</dt>
                        <dd>{{ review.mapping.isin }}</dd>
                    </div>
                    <div>
                        <dt>PDF 종목명</dt>
                        <dd>
                            {{ review.names.join(' / ') || '기존 원장 없음' }}
                        </dd>
                    </div>
                    <div>
                        <dt>연결할 종목</dt>
                        <dd>
                            {{ review.mapping.symbol }} ·
                            {{ review.mapping.koName }}
                        </dd>
                    </div>
                    <div>
                        <dt>연결할 종목 ISIN</dt>
                        <dd>{{ review.mapping.canonicalIsin }}</dd>
                    </div>
                    <div>
                        <dt>기존 원장 반영</dt>
                        <dd>{{ review.affectedAssets }}개</dd>
                    </div>
                    <div>
                        <dt>확인 근거</dt>
                        <dd>{{ review.mapping.evidence }}</dd>
                    </div>
                </dl>
                <p v-if="review.replacesExistingSymbols" class="notice">
                    이미 연결된 티커를 변경하는 원장이 포함됩니다.
                </p>
                <p>종목 연결만 변경하며 거래금액과 수량은 유지합니다.</p>
                <label class="check"
                    ><input
                        v-model="accepted"
                        type="checkbox"
                        :disabled="busy" />
                    PDF ISIN과 선택한 종목의 관계 및 변경 내용을
                    확인했습니다.</label
                >
                <button :disabled="busy || !accepted" @click="apply">
                    연결 확정 및 기존 원장 반영
                </button>
            </section>
            <section class="panel">
                <h2>최근 연결 기록</h2>
                <p v-if="!reviewed.length">확정된 연결 기록이 없습니다.</p>
                <ul class="reviewed">
                    <li v-for="item in reviewed" :key="item.isin">
                        <strong
                            >{{ item.isin }} → {{ item.symbol }} ·
                            {{ item.koName }}</strong
                        ><span>종목 ISIN {{ item.canonicalIsin }}</span>
                        <p>{{ item.evidence }}</p>
                        <button :disabled="busy" @click="chooseSource(item)">
                            다시 검토
                        </button>
                    </li>
                </ul>
            </section>
        </template>
    </section>
</template>
<style scoped>
    .mapping-page {
        max-width: 1100px;
        margin: auto;
        padding: 28px 16px;
        line-height: 1.6;
    }
    * {
        box-sizing: border-box;
    }
    h1,
    h2,
    p {
        margin: 0 0 12px;
    }
    h1 {
        font-size: 1.8rem;
    }
    h2 {
        font-size: 1.15rem;
    }
    header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }
    a {
        color: var(--app-accent);
    }
    .panel {
        padding: 22px;
        border: 1px solid var(--app-border-subtle);
        border-radius: 14px;
        margin-top: 20px;
    }
    button,
    input,
    textarea {
        font: inherit;
        background: var(--app-surface);
        color: var(--app-text);
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 10px 12px;
        max-width: 100%;
    }
    input,
    textarea {
        width: 100%;
        min-width: 0;
    }
    input[readonly] {
        background: var(--app-surface-muted);
    }
    button {
        cursor: pointer;
    }
    button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    button:focus-visible,
    input:focus-visible,
    textarea:focus-visible,
    a:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    fieldset {
        border: 0;
        padding: 0;
        margin: 0;
        min-width: 0;
    }
    label {
        display: block;
        margin: 12px 0;
    }
    label input,
    label textarea {
        display: block;
        margin-top: 6px;
    }
    .check {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }
    .check input {
        width: auto;
        flex-shrink: 0;
    }
    .fields,
    .pending-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
        gap: 12px;
    }
    .pending-grid button {
        text-align: left;
    }
    .pending-grid button[aria-pressed='true'] {
        border-color: var(--app-accent);
    }
    span,
    small {
        display: block;
    }
    .notice {
        border: 1px solid var(--app-border);
        padding: 12px;
        border-radius: 8px;
        margin: 12px 0;
    }
    .error {
        color: #c62828;
    }
    ul {
        list-style: none;
        padding: 0;
    }
    .matches {
        max-height: 320px;
        overflow-y: auto;
    }
    .matches button {
        text-align: left;
        width: 100%;
        margin-bottom: 6px;
    }
    .lookup-results {
        margin: 14px 0;
    }
    .lookup-results article {
        border: 1px solid var(--app-border-subtle);
        padding: 12px;
        margin-bottom: 10px;
        border-radius: 8px;
    }
    .lookup-results a {
        display: inline-block;
        margin-right: 12px;
    }
    .lookup-results button {
        display: block;
        margin-top: 8px;
    }
    .reviewed li {
        padding: 14px 0;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .reviewed p,
    dd {
        overflow-wrap: anywhere;
    }
    dl > div {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 20px;
        margin: 10px 0;
    }
    dt {
        min-width: 140px;
    }
    dd {
        margin: 0;
        flex: 1 1 200px;
    }
</style>
