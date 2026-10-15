<script setup>
    import { computed, nextTick, ref, watch } from 'vue';
    import { useRouter } from 'vue-router';
    import { authLoading, firebaseUser } from '@/services/firebaseClient';
    import {
        commitTossStatement,
        loadPortfolioDashboard,
        previewTossStatement,
    } from '@/services/portfolio';
    const router = useRouter();
    const broker = ref('toss');
    const brokers = [
        { id: 'toss', label: '토스증권' },
        { id: 'kis', label: '한국투자증권' },
        { id: 'kiwoom', label: '키움증권' },
    ];
    const portfolioWarning = computed(() => {
        const warnings = dashboard.value.warnings || [];
        if (warnings.some((item) => item.stage === 'transactions'))
            return '보유 종목은 조회했지만 일부 거래 원장을 읽지 못했습니다. 배당과 거래내역이 불완전할 수 있습니다.';
        if (warnings.some((item) => item.stage === 'legacy'))
            return '이전 거래 원장을 조회하지 못했습니다. 현재 보유 종목은 표시하며, 이전 배당·거래내역은 확인이 필요합니다.';
        return '';
    });
    const file = ref(null),
        password = ref(''),
        message = ref(''),
        error = ref(''),
        importing = ref(false),
        loading = ref(false);
    const dashboard = ref({ assets: [], transactions: [], summary: {} });
    const review = ref(null),
        acceptedIds = ref([]),
        committing = ref(false);
    const holdingTab = ref('current');
    const visibleAssets = computed(() =>
        dashboard.value.assets.filter(
            (asset) =>
                (asset.portfolioPriority === 'current'
                    ? 'current'
                    : 'historical') === holdingTab.value
        )
    );
    const tickerFilter = ref(''),
        typeFilter = ref(''),
        selectedAsset = ref(null),
        detailDialog = ref(null);
    const won = (v) =>
        Number.isFinite(Number(v))
            ? `₩${Math.round(Number(v)).toLocaleString('ko-KR')}`
            : '—';
    const quantity = (v) =>
        Number.isFinite(Number(v))
            ? Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 4 })
            : '—';
    const date = (v) =>
        v ? String(v).replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3') : '—';
    const typeLabel = (v) =>
        ({
            buy: '매수',
            sell: '매도',
            dividend: '배당',
            dividend_reversal: '배당 취소',
        })[v] ?? '기타';
    const typeClass = (v) =>
        ({ buy: 'buy', sell: 'sell', dividend: 'dividend' })[v] ?? 'unknown';
    async function refresh() {
        if (!firebaseUser.value) return;
        loading.value = true;
        error.value = '';
        try {
            await Promise.all([
                loadPortfolioDashboard(firebaseUser.value.uid)
                    .then((portfolio) => {
                        dashboard.value = portfolio;
                    })
                    .catch((reason) => {
                        error.value =
                            reason.code === 'permission-denied'
                                ? '현재 보유 종목 조회 권한이 없습니다. 관리자에게 문의해 주세요.'
                                : reason.code === 'unavailable'
                                  ? '포트폴리오 서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'
                                  : '포트폴리오를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
                        console.error(reason);
                    }),
            ]);
        } finally {
            loading.value = false;
        }
    }
    watch(
        [firebaseUser, authLoading],
        async ([user, waiting]) => {
            if (waiting) return;
            if (!user) router.replace('/login');
            else await refresh();
        },
        { immediate: true }
    );
    const filteredTransactions = computed(() =>
        dashboard.value.transactions
            .filter(
                (t) =>
                    (!tickerFilter.value ||
                        t.asset.ticker === tickerFilter.value) &&
                    (!typeFilter.value || t.type === typeFilter.value)
            )
            .slice(0, 20)
    );
    const tickers = computed(() =>
        dashboard.value.assets.filter((asset) => asset.ticker)
    );
    async function openDetail(asset) {
        selectedAsset.value = asset;
        await nextTick();
        detailDialog.value?.showModal();
    }
    function closeDetail() {
        detailDialog.value?.close();
    }
    async function upload() {
        error.value = '';
        message.value = '';
        if (broker.value !== 'toss') {
            error.value =
                '선택한 증권사의 거래내역서 가져오기는 준비 중입니다.';
            return;
        }
        if (!/^\d{6}$/.test(password.value)) {
            error.value = '토스 PDF 비밀번호인 생년월일 6자리를 입력해 주세요.';
            return;
        }
        if (!file.value) {
            error.value = '토스 거래내역 PDF를 선택해 주세요.';
            return;
        }
        importing.value = true;
        try {
            review.value = await previewTossStatement(
                firebaseUser.value,
                file.value,
                password.value
            );
            acceptedIds.value = review.value.rows
                .filter((row) => row.status === 'ready')
                .map((row) => row.id);
            password.value = '';
            file.value = null;
            message.value = `거래 ${review.value.rows.length}건을 검토해 주세요.`;
        } catch (reason) {
            error.value = reason.message;
        } finally {
            importing.value = false;
        }
    }
    async function commitReview() {
        if (!review.value) return;
        committing.value = true;
        error.value = '';
        try {
            const result = await commitTossStatement(
                firebaseUser.value,
                review.value.sessionId,
                acceptedIds.value
            );
            review.value = null;
            message.value = `${result.transactionCount}건의 거래내역을 저장했습니다.`;
            await refresh();
        } catch (reason) {
            error.value = reason.message;
        } finally {
            committing.value = false;
        }
    }
</script>
<template>
    <section class="mypage">
        <header class="page-header">
            <div>
                <p>MY PORTFOLIO</p>
                <h1>마이페이지</h1>
                <span
                    >{{ firebaseUser?.email }}의 거래 원장과 보유
                    종목입니다.</span
                >
            </div>
            <button class="refresh" :disabled="loading" @click="refresh">
                <i class="pi pi-refresh" /> 새로고침
            </button>
        </header>
        <p v-if="error" class="notice error">{{ error }}</p>
        <p v-if="portfolioWarning" class="notice warning" role="status">
            {{ portfolioWarning }}
        </p>
        <p v-if="message" class="notice success">{{ message }}</p>
        <section class="summary-grid" aria-label="포트폴리오 요약">
            <article>
                <small>현재 보유</small
                ><strong
                    >{{ dashboard.summary.currentCount ?? 0
                    }}<em>종목</em></strong
                >
            </article>
            <article>
                <small>과거 보유</small
                ><strong
                    >{{ dashboard.summary.historicalCount ?? 0
                    }}<em>종목</em></strong
                >
            </article>
            <article>
                <small>누적 실수령 배당</small
                ><strong>{{
                    portfolioWarning
                        ? '—'
                        : won(dashboard.summary.dividendTotal)
                }}</strong>
            </article>
            <article>
                <small>최근 거래일</small
                ><strong>{{
                    date(dashboard.summary.latestTransactionDate)
                }}</strong>
            </article>
        </section>
        <section class="panel import-panel">
            <div>
                <h2>증권사 거래내역서 첨부</h2>
                <p>
                    PDF 원본과 비밀번호는 저장하지 않고 거래 원장만 반영합니다.
                </p>
            </div>
            <div class="broker-options" role="group" aria-label="증권사 선택">
                <button
                    v-for="item in brokers"
                    :key="item.id"
                    type="button"
                    :aria-pressed="broker === item.id"
                    :disabled="importing || committing || !!review"
                    @click="
                        broker = item.id;
                        password = '';
                    ">
                    {{ item.label }}
                </button>
            </div>
            <p v-if="broker !== 'toss'" class="broker-help" role="status">
                선택한 증권사의 거래내역서 가져오기는 준비 중입니다.
            </p>
            <p v-else id="pdf-password-help" class="broker-help">
                토스증권 PDF 비밀번호는 생년월일 6자리(YYMMDD)입니다.
            </p>
            <form v-if="broker === 'toss'" @submit.prevent="upload">
                <input
                    type="file"
                    accept="application/pdf"
                    aria-label="토스증권 거래내역서 PDF"
                    @change="file = $event.target.files?.[0] || null" /><input
                    v-model="password"
                    type="password"
                    autocomplete="off"
                    inputmode="numeric"
                    maxlength="6"
                    pattern="[0-9]{6}"
                    aria-label="PDF 비밀번호: 생년월일 6자리"
                    aria-describedby="pdf-password-help"
                    placeholder="생년월일 6자리 (YYMMDD)" /><button
                    :disabled="importing">
                    {{ importing ? '가져오는 중' : '가져오기' }}
                </button>
            </form>
        </section>
        <section v-if="review" class="panel review-panel">
            <div class="section-heading">
                <div>
                    <h2>가져오기 검토</h2>
                    <p>
                        준비된 행만 기본 선택됩니다. 중복·미매핑 행은 이번
                        저장에서 제외됩니다.
                    </p>
                </div>
                <button
                    :disabled="committing || !acceptedIds.length"
                    @click="commitReview">
                    {{
                        committing
                            ? '저장 중'
                            : `${acceptedIds.length}건 확정 저장`
                    }}
                </button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>선택</th>
                            <th>상태</th>
                            <th>날짜</th>
                            <th>종목</th>
                            <th>유형</th>
                            <th class="numeric">수량</th>
                            <th class="numeric">금액</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in review.rows" :key="row.id">
                            <td>
                                <input
                                    v-if="row.status === 'ready'"
                                    v-model="acceptedIds"
                                    type="checkbox"
                                    :value="row.id" /><span v-else>—</span>
                            </td>
                            <td>
                                <span class="type" :class="row.status">{{
                                    row.status === 'ready'
                                        ? '저장 가능'
                                        : row.status === 'duplicate'
                                          ? '중복'
                                          : '미매핑'
                                }}</span>
                            </td>
                            <td>{{ date(row.date) }}</td>
                            <td>{{ row.symbol || row.name || '미식별' }}</td>
                            <td>{{ typeLabel(row.type) }}</td>
                            <td class="numeric">
                                {{ quantity(row.quantity) }}
                            </td>
                            <td class="numeric">{{ won(row.amount) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
        <section class="panel">
            <div class="section-heading">
                <div>
                    <h2>종목별 요약</h2>
                    <p>선택하면 전체 거래내역을 확인할 수 있습니다.</p>
                </div>
                <span>{{ dashboard.assets.length }}종목</span>
            </div>
            <div class="holding-tabs" role="group" aria-label="보유 내역 구분">
                <button
                    :aria-pressed="holdingTab === 'current'"
                    @click="holdingTab = 'current'">
                    보유 현황 ({{ dashboard.summary.currentCount ?? 0 }})
                </button>
                <button
                    :aria-pressed="holdingTab === 'historical'"
                    @click="holdingTab = 'historical'">
                    예전에 보유했던 내역 ({{
                        dashboard.summary.historicalCount ?? 0
                    }})
                </button>
            </div>
            <div v-if="loading" class="empty">
                포트폴리오를 불러오는 중입니다.
            </div>
            <div
                v-else-if="error && !dashboard.assets.length"
                class="empty"
                role="status">
                조회에 실패했습니다. 새로고침으로 다시 시도해 주세요.
            </div>
            <div v-else-if="!dashboard.assets.length" class="empty">
                아직 거래내역이 없습니다. 토스 거래내역서를 추가해 주세요.
            </div>
            <div v-else-if="!visibleAssets.length" class="empty">
                {{
                    holdingTab === 'current'
                        ? '현재 보유한 종목이 없습니다.'
                        : '예전에 보유했던 종목이 없습니다.'
                }}
            </div>
            <div v-else class="asset-grid">
                <article
                    v-for="asset in visibleAssets"
                    :key="asset.id"
                    class="asset-card">
                    <header>
                        <div>
                            <span class="ticker">{{
                                asset.ticker || '미식별'
                            }}</span>
                            <h3>{{ asset.displayName }}</h3>
                        </div>
                        <b
                            :class="
                                asset.portfolioPriority === 'current'
                                    ? 'current'
                                    : 'historical'
                            "
                            >{{
                                asset.portfolioPriority === 'current'
                                    ? '현재 보유'
                                    : '과거 보유'
                            }}</b
                        >
                    </header>
                    <dl>
                        <div>
                            <dt>보유 수량</dt>
                            <dd>{{ quantity(asset.holdingShares) }}주</dd>
                        </div>
                        <div>
                            <dt>최근 거래</dt>
                            <dd>{{ date(asset.latestTransactionDate) }}</dd>
                        </div>
                        <div>
                            <dt>누적 배당</dt>
                            <dd>
                                {{
                                    asset.ledgerUnavailable
                                        ? '조회 실패'
                                        : won(asset.dividendTotal)
                                }}
                            </dd>
                        </div>
                        <div>
                            <dt>원장 건수</dt>
                            <dd>
                                <span v-if="asset.ledgerUnavailable"
                                    >조회 실패</span
                                ><span v-else
                                    >매수 {{ asset.transactionCounts.buy }} ·
                                    매도 {{ asset.transactionCounts.sell }} ·
                                    배당
                                    {{ asset.transactionCounts.dividend }}</span
                                >
                            </dd>
                        </div>
                    </dl>
                    <footer>
                        <button @click="openDetail(asset)">거래 상세</button
                        ><router-link
                            v-if="asset.ticker"
                            :to="`/stock/${asset.ticker}`"
                            >썸네일 보기 <i class="pi pi-arrow-right"
                        /></router-link>
                    </footer>
                </article>
            </div>
        </section>
        <section class="panel">
            <div class="section-heading">
                <div>
                    <h2>최근 거래내역</h2>
                    <p>
                        최근 20건만 표시합니다. 종목 상세에서는 전체 원장을 볼
                        수 있습니다.
                    </p>
                </div>
                <div class="filters">
                    <select v-model="tickerFilter" aria-label="종목 필터">
                        <option value="">전체 종목</option>
                        <option
                            v-for="asset in tickers"
                            :key="asset.id"
                            :value="asset.ticker">
                            {{ asset.ticker }}
                        </option></select
                    ><select v-model="typeFilter" aria-label="거래 유형 필터">
                        <option value="">전체 유형</option>
                        <option value="buy">매수</option>
                        <option value="sell">매도</option>
                        <option value="dividend">배당</option>
                        <option value="dividend_reversal">배당 취소</option>
                    </select>
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>날짜</th>
                            <th>종목</th>
                            <th>유형</th>
                            <th class="numeric">수량</th>
                            <th class="numeric">금액</th>
                            <th class="numeric">수수료</th>
                            <th class="numeric">세금</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="transaction in filteredTransactions"
                            :key="`${transaction.asset.id}-${transaction.date}-${transaction.type}-${transaction.amount}`">
                            <td>{{ date(transaction.date) }}</td>
                            <td>
                                <button
                                    class="asset-link"
                                    @click="openDetail(transaction.asset)">
                                    {{
                                        transaction.asset.ticker ||
                                        transaction.asset.displayName
                                    }}
                                </button>
                            </td>
                            <td>
                                <span
                                    class="type"
                                    :class="typeClass(transaction.type)"
                                    >{{ typeLabel(transaction.type) }}</span
                                >
                            </td>
                            <td class="numeric">
                                {{ quantity(transaction.quantity) }}
                            </td>
                            <td class="numeric">
                                {{ won(transaction.amount) }}
                            </td>
                            <td class="numeric">
                                {{ won(transaction.commission) }}
                            </td>
                            <td class="numeric">{{ won(transaction.tax) }}</td>
                        </tr>
                        <tr v-if="!filteredTransactions.length">
                            <td colspan="7" class="empty">
                                {{
                                    portfolioWarning
                                        ? '거래 원장 조회가 완료되지 않았습니다. 위 안내를 확인해 주세요.'
                                        : '표시할 거래내역이 없습니다.'
                                }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
        <dialog
            ref="detailDialog"
            class="detail-dialog"
            aria-label="종목 거래 상세"
            @click="$event.target === detailDialog && closeDetail()"
            @close="selectedAsset = null">
            <section v-if="selectedAsset">
                <header>
                    <div>
                        <p>{{ selectedAsset.ticker || '미식별 종목' }}</p>
                        <h2>{{ selectedAsset.displayName }}</h2>
                        <span
                            :class="
                                selectedAsset.portfolioPriority === 'current'
                                    ? 'current'
                                    : 'historical'
                            "
                            >{{
                                selectedAsset.portfolioPriority === 'current'
                                    ? '현재 보유'
                                    : '과거 보유'
                            }}</span
                        >
                    </div>
                    <button
                        class="close"
                        aria-label="상세 창 닫기"
                        @click="closeDetail">
                        ×
                    </button>
                </header>
                <div class="detail-metrics">
                    <article>
                        <small>보유 수량</small
                        ><strong
                            >{{
                                quantity(selectedAsset.holdingShares)
                            }}주</strong
                        >
                    </article>
                    <article>
                        <small>누적 배당</small
                        ><strong>{{
                            selectedAsset.ledgerUnavailable
                                ? '조회 실패'
                                : won(selectedAsset.dividendTotal)
                        }}</strong>
                    </article>
                    <article>
                        <small>거래 건수</small
                        ><strong>{{
                            selectedAsset.ledgerUnavailable
                                ? '조회 실패'
                                : `${selectedAsset.transactions.length}건`
                        }}</strong>
                    </article>
                </div>
                <router-link
                    v-if="selectedAsset.ticker"
                    class="thumbnail-link"
                    :to="`/stock/${selectedAsset.ticker}`"
                    @click="closeDetail"
                    >{{ selectedAsset.ticker }} 썸네일 페이지 바로가기
                    <i class="pi pi-arrow-right"
                /></router-link>
                <div class="table-wrap detail-table">
                    <table>
                        <thead>
                            <tr>
                                <th>날짜</th>
                                <th>유형</th>
                                <th class="numeric">수량</th>
                                <th class="numeric">금액</th>
                                <th class="numeric">수수료</th>
                                <th class="numeric">세금</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="transaction in selectedAsset.transactions"
                                :key="`${transaction.date}-${transaction.type}-${transaction.amount}`">
                                <td>{{ date(transaction.date) }}</td>
                                <td>
                                    <span
                                        class="type"
                                        :class="typeClass(transaction.type)"
                                        >{{ typeLabel(transaction.type) }}</span
                                    >
                                </td>
                                <td class="numeric">
                                    {{ quantity(transaction.quantity) }}
                                </td>
                                <td class="numeric">
                                    {{ won(transaction.amount) }}
                                </td>
                                <td class="numeric">
                                    {{ won(transaction.commission) }}
                                </td>
                                <td class="numeric">
                                    {{ won(transaction.tax) }}
                                </td>
                            </tr>
                            <tr v-if="!selectedAsset.transactions.length">
                                <td colspan="6" class="empty">
                                    {{
                                        selectedAsset.ledgerUnavailable
                                            ? '거래 원장을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.'
                                            : '저장된 거래 원장이 없습니다. 토스 거래내역서를 추가하면 배당과 거래내역을 확인할 수 있습니다.'
                                    }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </dialog>
    </section>
</template>
<style scoped>
    .mypage {
        max-width: 1200px;
        margin: 0 auto;
        padding: 32px 24px 64px;
        font-family: system-ui, sans-serif;
        line-height: 1.6;
        min-width: 0;
    }
    .mypage * {
        box-sizing: border-box;
    }
    h1,
    h2,
    h3,
    p {
        margin: 0;
    }
    h1 {
        font-size: 2rem;
        line-height: 1.3;
        margin: 4px 0 8px;
    }
    h2 {
        font-size: 1.2rem;
        line-height: 1.4;
        margin-bottom: 6px;
    }
    h3 {
        font-size: 1rem;
    }
    .page-header,
    .section-heading,
    .asset-card header,
    .asset-card footer,
    .detail-dialog header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
    }
    .page-header {
        margin-bottom: 24px;
    }
    .page-header span {
        overflow-wrap: anywhere;
    }
    .page-header p {
        font-size: 0.75rem;
        letter-spacing: 0.12em;
    }
    button,
    input,
    select {
        font: inherit;
        font-size: 0.9rem;
        border: 1px solid var(--app-border);
        border-radius: 10px;
        padding: 10px 12px;
        max-width: 100%;
        background: var(--app-surface);
        color: var(--app-text);
    }
    button {
        cursor: pointer;
        flex-shrink: 0;
    }
    button:disabled {
        opacity: 0.55;
        cursor: wait;
    }
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    a:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    .summary-grid,
    .detail-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 24px;
    }
    .summary-grid article,
    .detail-metrics article {
        padding: 18px;
        border: 1px solid var(--app-border-subtle);
        border-radius: 14px;
    }
    .summary-grid small,
    .summary-grid strong,
    .detail-metrics small,
    .detail-metrics strong {
        display: block;
    }
    .summary-grid strong {
        font-size: 1.4rem;
        margin-top: 6px;
        overflow-wrap: anywhere;
    }
    .summary-grid em {
        font-size: 0.8rem;
        font-style: normal;
        margin-left: 4px;
    }
    .panel {
        border: 1px solid var(--app-border-subtle);
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 20px;
        min-width: 0;
    }
    .broker-options {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 16px 0 10px;
    }
    .broker-options button[aria-pressed='true'] {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        border-color: var(--app-accent);
    }
    .broker-help {
        font-size: 0.9rem;
    }
    .warning {
        color: var(--app-muted);
    }
    .import-panel form {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 18px;
    }
    .import-panel input[type='file'] {
        flex: 1 1 260px;
        min-width: 0;
    }
    .import-panel input[type='password'] {
        flex: 1 1 160px;
        min-width: 0;
    }
    .notice {
        padding: 12px 16px;
        border: 1px solid currentColor;
        border-radius: 10px;
        margin-bottom: 20px;
        overflow-wrap: anywhere;
    }
    .error {
        color: #e57373;
    }
    .success {
        color: #39ad7c;
    }
    .section-heading {
        margin-bottom: 18px;
    }
    .filters {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .empty {
        padding: 28px 12px;
        text-align: center;
    }
    .asset-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
        gap: 16px;
    }
    .asset-card {
        padding: 18px;
        border: 1px solid var(--app-border-subtle);
        border-radius: 12px;
        min-width: 0;
    }
    .asset-card header {
        align-items: flex-start;
    }
    .asset-card b,
    .type {
        font-size: 0.75rem;
        white-space: nowrap;
    }
    .asset-card dl {
        margin: 18px 0;
    }
    .asset-card dl > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
    }
    .asset-card dd {
        margin: 0;
        text-align: right;
    }
    .asset-card footer {
        padding-top: 14px;
        border-top: 1px solid;
        font-size: 0.85rem;
    }
    .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--app-border-subtle);
        border-radius: 10px;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
        white-space: nowrap;
    }
    th,
    td {
        padding: 12px 14px;
        text-align: left;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .numeric {
        text-align: right;
    }
    .asset-link {
        padding: 0;
        border: 0;
        background: transparent;
    }
    .buy,
    .current,
    .ready {
        color: #60a5fa;
    }
    .sell,
    .historical {
        color: #f59e0b;
    }
    .dividend {
        color: #39ad7c;
    }
    .holding-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 18px;
    }
    .holding-tabs button[aria-pressed='true'] {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        border-color: var(--app-accent);
    }
    .detail-dialog {
        position: fixed;
        inset: 0;
        margin: auto;
        overflow: auto;
        width: min(900px, calc(100% - 32px));
        max-height: 85vh;
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 18px;
    }
    .detail-dialog header {
        margin-bottom: 20px;
    }
    .detail-metrics {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .thumbnail-link {
        display: inline-block;
        margin-bottom: 16px;
    }
    .close {
        font-size: 1.6rem;
        background: transparent;
        border: 0;
    }
    @media (max-width: 640px) {
        .mypage {
            padding: 20px 12px 40px;
        }
        h1 {
            font-size: 1.65rem;
        }
        .summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .summary-grid article {
            padding: 14px;
        }
        .summary-grid strong {
            font-size: 1.15rem;
        }
        .panel {
            padding: 14px;
        }
        .page-header,
        .section-heading,
        .connection-panel {
            flex-direction: column;
            align-items: stretch !important;
        }
        .page-header .refresh {
            align-self: flex-start;
        }
        .connection-status {
            align-self: flex-start;
        }
        .broker-options {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin: 16px 0 10px;
        }
        .broker-options button[aria-pressed='true'] {
            background: var(--app-accent);
            color: var(--app-accent-contrast);
            border-color: var(--app-accent);
        }
        .broker-help {
            font-size: 0.9rem;
        }
        .warning {
            color: var(--app-muted);
        }
        .import-panel form {
            flex-direction: column;
        }
        .import-panel input[type='file'],
        .import-panel input[type='password'] {
            flex: auto;
            width: 100%;
        }
        .detail-metrics {
            grid-template-columns: 1fr;
        }
        .detail-dialog {
            padding: 18px;
        }
    }

    .mypage {
        color: var(--app-text);
    }
    .page-header p,
    .detail-dialog header p,
    .ticker,
    .asset-link,
    .asset-card footer a,
    .thumbnail-link {
        color: var(--app-accent);
    }
    .page-header span,
    .section-heading p,
    .import-panel p,
    .connection-panel p,
    .section-heading > span,
    .summary-grid small,
    .detail-metrics small,
    .summary-grid em,
    .asset-card dt,
    .empty {
        color: var(--app-muted);
    }
    .refresh,
    .asset-card footer button,
    .filters select,
    .import-panel input,
    .toss-controls select,
    .toss-controls button {
        border-color: var(--app-border);
        background: var(--app-surface);
        color: var(--app-text);
    }
    .summary-grid article,
    .panel,
    .asset-card,
    .table-wrap {
        border-color: var(--app-border-subtle);
        background: var(--app-surface);
    }
    .import-panel button,
    .toss-controls button {
        background: var(--app-accent);
        border-color: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .connection-panel {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
    }
    .connection-status {
        border: 1px solid var(--app-border);
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 0.78rem;
        white-space: nowrap;
        color: var(--app-muted);
    }
    .toss-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 10px;
    }
    .asset-card footer {
        border-color: var(--app-border-subtle);
    }
    th,
    .detail-metrics article {
        background: var(--app-surface-muted);
        color: var(--app-text);
    }
    th,
    td {
        border-color: var(--app-border-subtle);
    }
    .detail-dialog {
        background: var(--app-surface);
        color: var(--app-text);
        box-shadow: 0 25px 70px var(--app-overlay);
    }
    .detail-dialog::backdrop {
        background: var(--app-overlay);
    }
    .close {
        color: var(--app-text);
    }
</style>
