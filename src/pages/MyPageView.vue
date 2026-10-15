<script setup>
    import { computed, nextTick, ref, watch } from 'vue';
    import { useRouter } from 'vue-router';
    import PortfolioCapitalPanel from '@/components/portfolio/PortfolioCapitalPanel.vue';
    import PurchaseFundingEditor from '@/components/portfolio/PurchaseFundingEditor.vue';
    import TransactionAmount from '@/components/portfolio/TransactionAmount.vue';
    import {
        transactionAmountRows,
        transactionMoney,
    } from '@/services/transactionAmount.js';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import { purchaseBasis } from '../../lib/portfolio-capital.js';
    import { authLoading, firebaseUser } from '@/services/firebaseClient';
    import { loadPortfolioDashboard } from '@/services/portfolio';
    import { summarizePortfolio } from '@/services/portfolioSummary';
    import { isPortfolioAdmin } from '../../lib/portfolio-admin.js';
    import { closedPositionPerformance } from '@/services/portfolioPerformance';
    import {
        formatPortfolioQuantity,
        portfolioAssetsInPeriod,
    } from '@/services/portfolioPeriod';
    const router = useRouter();
    const portfolioWarning = computed(() => {
        const warnings = dashboard.value.warnings || [];
        if (warnings.some((item) => item.stage === 'transactions'))
            return '보유 종목은 조회했지만 일부 거래 원장을 읽지 못했습니다. 배당과 거래내역이 불완전할 수 있습니다.';
        if (warnings.some((item) => item.stage === 'legacy'))
            return '이전 거래 원장을 조회하지 못했습니다. 현재 보유 종목은 표시하며, 이전 배당·거래내역은 확인이 필요합니다.';
        return '';
    });
    const message = ref(''),
        error = ref(''),
        loading = ref(false);
    const dashboard = ref({ assets: [], transactions: [], summary: {} });
    const capital = ref({ entries: [], classifications: [], allocations: [] });
    const capitalLoading = ref(false),
        capitalError = ref(''),
        fundingTransaction = ref(null),
        fundingEditor = ref(null),
        fundingMessage = ref('');
    let capitalRequestId = 0,
        capitalOwnerUid = '';
    async function loadCapital() {
        const user = firebaseUser.value,
            requestId = ++capitalRequestId;
        capitalError.value = '';
        capitalLoading.value = true;
        if (capitalOwnerUid !== user?.uid) {
            capital.value = {
                entries: [],
                classifications: [],
                allocations: [],
            };
            capitalOwnerUid = user?.uid || '';
        }
        if (!user) {
            capital.value = {
                entries: [],
                classifications: [],
                allocations: [],
            };
            capitalLoading.value = false;
            return;
        }
        try {
            const state = await portfolioCapitalRequest(user);
            if (
                requestId === capitalRequestId &&
                firebaseUser.value?.uid === user.uid
            )
                capital.value = state;
        } catch (reason) {
            if (requestId === capitalRequestId)
                capitalError.value = reason.message;
        } finally {
            if (requestId === capitalRequestId) capitalLoading.value = false;
        }
    }
    async function fundingSaved() {
        await loadCapital();
        fundingMessage.value = capitalError.value
            ? ''
            : '자금 구성을 저장했습니다.';
    }
    async function openFunding(transaction) {
        fundingTransaction.value = transaction;
        fundingMessage.value = '';
        await nextTick();
        fundingEditor.value?.$el?.scrollIntoView({ block: 'start' });
    }
    const fundingLabel = (transaction) => {
        const allocation = capital.value.allocations.find(
            (row) =>
                row.assetId === selectedAssetId.value &&
                row.transactionId === transaction.id
        );
        if (allocation?.status && allocation.status !== 'reset') {
            try {
                if (allocation.basisKey !== purchaseBasis(transaction).basisKey)
                    return '자금 구성 · 재확인 필요';
            } catch {
                return '자금 구성 · 재확인 필요';
            }
        }
        return allocation?.status === 'confirmed'
            ? '자금 구성 · 확인 완료'
            : allocation?.status === 'partial'
              ? '자금 구성 · 일부 확인 필요'
              : '자금 구성 확인';
    };
    const period = ref('all');
    const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Seoul',
    });
    const startDate = ref(`${today.slice(0, 4)}-01-01`);
    const endDate = ref(today);
    const years = computed(() =>
        [
            ...new Set(
                dashboard.value.transactions
                    .map((t) => String(t.date).replace(/\D/g, '').slice(0, 4))
                    .filter((y) => /^\d{4}$/.test(y))
            ),
        ]
            .sort()
            .reverse()
    );
    const periodError = computed(() =>
        period.value === 'custom'
            ? !startDate.value || !endDate.value
                ? '시작일과 종료일을 선택해 주세요.'
                : startDate.value > endDate.value
                  ? '종료일은 시작일 이후로 선택해 주세요.'
                  : ''
            : ''
    );
    const periodLabel = computed(() =>
        period.value === 'all'
            ? '전체 기간'
            : period.value === 'custom'
              ? `${startDate.value} ~ ${endDate.value}`
              : `${period.value}년`
    );
    const periodDashboard = computed(() => {
        const start =
            period.value === 'all'
                ? ''
                : period.value === 'custom'
                  ? startDate.value
                  : `${period.value}-01-01`;
        const end =
            period.value === 'all'
                ? ''
                : period.value === 'custom'
                  ? endDate.value
                  : `${period.value}-12-31`;
        return summarizePortfolio(
            portfolioAssetsInPeriod(dashboard.value.assets, start, end)
        );
    });
    const performanceAssets = computed(() => {
        const performances = new Map(
            dashboard.value.assets.map((asset) => [
                asset.id,
                closedPositionPerformance(asset),
            ])
        );
        return periodDashboard.value.assets.map((asset) => ({
            ...asset,
            performance: performances.get(asset.id),
            usdPerformance: closedPositionPerformance(
                dashboard.value.assets.find((full) => full.id === asset.id),
                'USD'
            ),
        }));
    });
    const selectedAssetId = ref(null);
    const selectedAsset = computed(
        () =>
            performanceAssets.value.find(
                (a) => a.id === selectedAssetId.value
            ) || null
    );
    const historyUnavailable = computed(() =>
        (dashboard.value.warnings || []).some((item) => item.stage === 'legacy')
    );
    const historicalCountLabel = computed(() =>
        historyUnavailable.value
            ? '확인 필요'
            : loading.value || error.value
              ? '—'
              : (dashboard.value.summary.historicalCount ?? 0)
    );
    const holdingTab = ref('current');
    const visibleAssets = computed(() =>
        performanceAssets.value.filter(
            (asset) =>
                (asset.portfolioPriority === 'current'
                    ? 'current'
                    : 'historical') === holdingTab.value
        )
    );
    const tickerFilter = ref(''),
        typeFilter = ref(''),
        detailDialog = ref(null);
    const won = (v) =>
        Number.isFinite(Number(v))
            ? `₩${Math.round(Number(v)).toLocaleString('ko-KR')}`
            : '—';
    const signedWon = (value) =>
        value == null
            ? '—'
            : `${value > 0 ? '+' : value < 0 ? '−' : ''}${won(Math.abs(value))}`;
    const profitClass = (value) =>
        value > 0 ? 'profit-positive' : value < 0 ? 'profit-negative' : '';
    const percent = (value) =>
        value == null
            ? '—'
            : `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
    const usd = (value, digits = 2) =>
        value == null || !Number.isFinite(Number(value))
            ? '—'
            : `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
    const performanceRows = [
        { key: 'purchaseCost', label: '매수 정산액 합계' },
        { key: 'saleProceeds', label: '매도 정산액 합계' },
        { key: 'tradingProfit', label: '누적 매매손익', signed: true },
        { key: 'dividends', label: '누적 실수령 배당' },
        { key: 'totalProfit', label: '배당 포함 손익', signed: true },
        { key: 'totalReturnPercent', label: '배당 포함 수익률', rate: true },
    ];
    const performanceValue = (performance, row, currency) => {
        if (!performance?.available) return '—';
        const value = performance[row.key];
        if (row.rate) return percent(value);
        if (currency === 'KRW')
            return row.signed ? signedWon(value) : won(value);
        return row.signed
            ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${usd(Math.abs(value))}`
            : usd(value);
    };
    const quantity = formatPortfolioQuantity;
    const date = (v) =>
        v ? String(v).replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3') : '—';
    const typeLabel = (v) =>
        ({
            buy: '매수',
            sell: '매도',
            dividend: '배당',
            dividend_reversal: '배당 취소',
            cash: '계좌 입출금·환전',
        })[v] ?? '기타';
    const typeClass = (v) =>
        ({ buy: 'buy', sell: 'sell', dividend: 'dividend' })[v] ?? 'unknown';
    async function refresh() {
        if (!firebaseUser.value) return;
        loading.value = true;
        error.value = '';
        try {
            await Promise.all([
                loadCapital(),
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
            if (!user) {
                await loadCapital();
                dashboard.value = { assets: [], transactions: [], summary: {} };
                router.replace('/login');
            } else await refresh();
        },
        { immediate: true }
    );
    const filteredTransactions = computed(() =>
        (periodError.value ? [] : periodDashboard.value.transactions)
            .filter(
                (t) =>
                    (!tickerFilter.value ||
                        t.asset.ticker === tickerFilter.value) &&
                    (!typeFilter.value || t.type === typeFilter.value)
            )
            .slice(0, 20)
    );
    const allocationsByTrade = computed(
        () =>
            new Map(
                capital.value.allocations.map((row) => [
                    `${row.assetId}|${row.transactionId}`,
                    row,
                ])
            )
    );
    const amountGroups = (transactions, assetId) =>
        transactions.map((transaction, index) => ({
            transaction,
            key: `${assetId || transaction.asset?.id}-${transaction.id || index}`,
            amounts: transactionAmountRows(
                transaction,
                allocationsByTrade.value.get(
                    `${assetId || transaction.asset?.id}|${transaction.id}`
                )
            ),
        }));
    const recentAmountGroups = computed(() =>
        amountGroups(filteredTransactions.value)
    );
    const detailAmountGroups = computed(() =>
        amountGroups(
            periodError.value ? [] : selectedAsset.value?.transactions || [],
            selectedAssetId.value
        )
    );
    const tickers = computed(() =>
        dashboard.value.assets.filter((asset) => asset.ticker)
    );
    async function openDetail(asset) {
        fundingTransaction.value = null;
        fundingMessage.value = '';
        selectedAssetId.value = asset.id;
        await nextTick();
        detailDialog.value?.showModal();
    }
    function closeDetail() {
        detailDialog.value?.close();
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
        <section class="panel period-panel" aria-label="조회 기간">
            <div class="section-heading">
                <div>
                    <h2>조회 기간</h2>
                    <p>
                        배당 합계와 거래내역에 적용됩니다. 보유 수량은 현재
                        기준입니다.
                    </p>
                </div>
                <div class="filters">
                    <label
                        >기간
                        <select v-model="period" aria-label="조회 기간 선택">
                            <option value="all">전체 기간</option>
                            <option
                                v-for="year in years"
                                :key="year"
                                :value="year">
                                {{ year }}년
                            </option>
                            <option value="custom">직접 선택</option>
                        </select>
                    </label>
                    <template v-if="period === 'custom'">
                        <label
                            >시작일
                            <input
                                v-model="startDate"
                                type="date"
                                aria-label="조회 시작일"
                        /></label>
                        <label
                            >종료일
                            <input
                                v-model="endDate"
                                type="date"
                                aria-label="조회 종료일"
                        /></label>
                    </template>
                </div>
            </div>
            <p v-if="periodError" class="error" role="alert">
                {{ periodError }}
            </p>
            <p v-else class="period-label" role="status">
                {{ periodLabel }} · 거래
                {{
                    periodDashboard.transactions.length.toLocaleString('ko-KR')
                }}건
            </p>
        </section>
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
                    >{{ historicalCountLabel
                    }}<em v-if="typeof historicalCountLabel === 'number'"
                        >종목</em
                    ></strong
                >
            </article>
            <article>
                <small>실수령 배당 · {{ periodLabel }}</small
                ><strong>{{
                    portfolioWarning || periodError
                        ? '—'
                        : won(periodDashboard.summary.dividendTotal)
                }}</strong>
            </article>
            <article>
                <small>최근 거래일</small
                ><strong>{{
                    periodError
                        ? '—'
                        : date(periodDashboard.summary.latestTransactionDate)
                }}</strong>
            </article>
        </section>
        <PortfolioCapitalPanel
            :user="firebaseUser"
            :state="capital"
            :loading="capitalLoading"
            :error="capitalError"
            @refresh="loadCapital" />
        <section class="panel">
            <h2>이전 단일 계좌 자료</h2>
            <p>
                기준일이 확인되지 않은 이전 데이터입니다. 현재 보유량과
                평가액으로 확정하지 마세요.
            </p>
            <router-link to="/mypage"
                >가족 포트폴리오에서 계좌 등록·자료 이전·새 업로드
                →</router-link
            >
        </section>
        <section class="panel">
            <div class="section-heading">
                <div>
                    <h2>종목별 요약</h2>
                    <p v-if="holdingTab === 'historical'">
                        손익은 기간 선택과 별개로 저장된 전체 보유기간의 원화
                        정산액을 기준으로 계산합니다.
                    </p>
                    <p v-else>선택하면 거래내역을 확인할 수 있습니다.</p>
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
                    과거 보유 ({{ historicalCountLabel }})
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
            <div
                v-else-if="holdingTab === 'historical' && historyUnavailable"
                class="empty"
                role="status">
                <p>
                    과거 보유 내역을 불러오지 못했습니다. 조회 권한을 확인한 뒤
                    다시 시도해 주세요.
                </p>
                <button
                    class="history-retry"
                    :disabled="loading"
                    @click="refresh">
                    다시 조회
                </button>
            </div>
            <div v-else-if="!dashboard.assets.length" class="empty">
                아직 거래내역이 없습니다. 토스 거래내역서를 추가해 주세요.
            </div>
            <div v-else-if="!visibleAssets.length" class="empty">
                {{
                    holdingTab === 'current'
                        ? '현재 보유한 종목이 없습니다.'
                        : '과거 보유 종목이 없습니다.'
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
                                asset.ticker || asset.isin || asset.id
                            }}</span>
                            <h3>{{ asset.displayName }}</h3>
                            <small v-if="!asset.ticker">티커 연결 필요</small>
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
                        <template v-if="asset.portfolioPriority !== 'current'">
                            <div>
                                <dt>누적 매매손익</dt>
                                <dd
                                    :class="
                                        profitClass(
                                            asset.performance?.tradingProfit
                                        )
                                    ">
                                    {{
                                        signedWon(
                                            asset.performance?.tradingProfit
                                        )
                                    }}
                                </dd>
                            </div>
                            <div>
                                <dt>배당 포함 손익</dt>
                                <dd
                                    :class="
                                        profitClass(
                                            asset.performance?.totalProfit
                                        )
                                    ">
                                    {{
                                        signedWon(
                                            asset.performance?.totalProfit
                                        )
                                    }}
                                </dd>
                            </div>
                            <div v-if="asset.performance?.available">
                                <dt>배당 포함 수익률</dt>
                                <dd
                                    :class="
                                        profitClass(
                                            asset.performance.totalReturnPercent
                                        )
                                    ">
                                    {{
                                        percent(
                                            asset.performance.totalReturnPercent
                                        )
                                    }}
                                </dd>
                            </div>
                        </template>
                        <div v-else>
                            <dt>보유 수량</dt>
                            <dd>{{ quantity(asset.holdingShares) }}주</dd>
                        </div>
                        <div>
                            <dt>최근 거래</dt>
                            <dd>{{ date(asset.latestTransactionDate) }}</dd>
                        </div>
                        <div>
                            <dt>기간 배당</dt>
                            <dd>
                                {{
                                    asset.ledgerUnavailable || periodError
                                        ? '확인 필요'
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
                    <p
                        v-if="
                            asset.portfolioPriority !== 'current' &&
                            !asset.performance?.available
                        "
                        class="performance-note">
                        {{ asset.performance?.reason }}
                    </p>
                    <footer>
                        <router-link
                            v-if="
                                !asset.ticker && isPortfolioAdmin(firebaseUser)
                            "
                            :to="{
                                path: '/admin/portfolio-mappings',
                                query: { isin: asset.isin || asset.id },
                            }"
                            >종목 연결</router-link
                        >
                        <button @click="openDetail(asset)">거래 상세</button
                        ><router-link
                            v-if="
                                asset.ticker &&
                                asset.portfolioCatalogMatched !== false
                            "
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
                    <h2>기간별 거래내역</h2>
                    <p>
                        선택한 기간의 최근 20건을 표시합니다. 종목 상세에서는
                        해당 기간의 전체 거래를 볼 수 있습니다.
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
                <table aria-label="기간별 거래내역">
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
                        <template
                            v-for="group in recentAmountGroups"
                            :key="group.key">
                            <tr
                                v-for="(amountRow, rowIndex) in group.amounts"
                                :key="rowIndex">
                                <td
                                    v-if="rowIndex === 0"
                                    :rowspan="group.amounts.length">
                                    {{ date(group.transaction.date) }}
                                </td>
                                <td
                                    v-if="rowIndex === 0"
                                    :rowspan="group.amounts.length">
                                    <button
                                        class="asset-link"
                                        @click="
                                            openDetail(group.transaction.asset)
                                        ">
                                        {{
                                            group.transaction.asset.ticker ||
                                            group.transaction.asset.displayName
                                        }}
                                    </button>
                                </td>
                                <td
                                    v-if="rowIndex === 0"
                                    :rowspan="group.amounts.length">
                                    <span
                                        class="type"
                                        :class="
                                            typeClass(group.transaction.type)
                                        "
                                        >{{
                                            typeLabel(group.transaction.type)
                                        }}</span
                                    >
                                </td>
                                <td
                                    v-if="rowIndex === 0"
                                    :rowspan="group.amounts.length"
                                    class="numeric">
                                    {{ quantity(group.transaction.quantity) }}
                                </td>
                                <td class="numeric">
                                    <TransactionAmount :row="amountRow" />
                                </td>
                                <td
                                    v-if="rowIndex === 0"
                                    :rowspan="group.amounts.length"
                                    class="numeric">
                                    {{
                                        transactionMoney(
                                            group.transaction.commission
                                        )
                                    }}
                                </td>
                                <td
                                    v-if="rowIndex === 0"
                                    :rowspan="group.amounts.length"
                                    class="numeric">
                                    {{
                                        transactionMoney(group.transaction.tax)
                                    }}
                                </td>
                            </tr>
                        </template>
                        <tr v-if="!filteredTransactions.length">
                            <td colspan="7" class="empty">
                                {{
                                    periodError ||
                                    (portfolioWarning
                                        ? '거래 원장 조회가 완료되지 않았습니다. 위 안내를 확인해 주세요.'
                                        : '선택한 기간에 거래내역이 없습니다.')
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
            @close="selectedAssetId = null">
            <section v-if="selectedAsset">
                <header>
                    <div>
                        <p>
                            {{
                                selectedAsset.ticker ||
                                selectedAsset.isin ||
                                selectedAsset.id
                            }}
                        </p>
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
                        <template
                            v-if="
                                selectedAsset.portfolioPriority !== 'current'
                            ">
                            <small>배당 포함 손익 · 전체 보유기간</small>
                            <strong
                                :class="
                                    profitClass(
                                        selectedAsset.performance?.totalProfit
                                    )
                                "
                                >{{
                                    signedWon(
                                        selectedAsset.performance?.totalProfit
                                    )
                                }}</strong
                            >
                        </template>
                        <template v-else>
                            <small>보유 수량</small
                            ><strong
                                >{{
                                    quantity(selectedAsset.holdingShares)
                                }}주</strong
                            >
                        </template>
                    </article>
                    <article>
                        <small>기간 배당 · {{ periodLabel }}</small
                        ><strong>{{
                            selectedAsset.ledgerUnavailable || periodError
                                ? '확인 필요'
                                : won(selectedAsset.dividendTotal)
                        }}</strong>
                    </article>
                    <article>
                        <small>거래 건수</small
                        ><strong>{{
                            selectedAsset.ledgerUnavailable || periodError
                                ? '확인 필요'
                                : `${selectedAsset.transactions.length}건`
                        }}</strong>
                    </article>
                </div>
                <section
                    v-if="selectedAsset.portfolioPriority !== 'current'"
                    class="performance-detail"
                    aria-label="과거 보유 손익">
                    <h3>전체 보유기간 손익</h3>
                    <p>
                        기간 필터와 별개로 전체 매수·매도를 대조한 참고
                        손익입니다. 수수료·세금은 정산액에 반영하며,
                        양도소득세는 포함하지 않습니다.
                    </p>
                    <div class="table-wrap">
                        <table aria-label="원화 달러 손익 비교">
                            <thead>
                                <tr>
                                    <th>항목</th>
                                    <th class="numeric">원화 (KRW)</th>
                                    <th class="numeric">달러 (USD)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="row in performanceRows"
                                    :key="row.key">
                                    <td>{{ row.label }}</td>
                                    <td
                                        class="numeric"
                                        :class="
                                            row.signed
                                                ? profitClass(
                                                      selectedAsset
                                                          .performance?.[
                                                          row.key
                                                      ]
                                                  )
                                                : ''
                                        ">
                                        {{
                                            performanceValue(
                                                selectedAsset.performance,
                                                row,
                                                'KRW'
                                            )
                                        }}
                                    </td>
                                    <td
                                        class="numeric"
                                        :class="
                                            row.signed
                                                ? profitClass(
                                                      selectedAsset
                                                          .usdPerformance?.[
                                                          row.key
                                                      ]
                                                  )
                                                : ''
                                        ">
                                        {{
                                            performanceValue(
                                                selectedAsset.usdPerformance,
                                                row,
                                                'USD'
                                            )
                                        }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <p
                        v-if="!selectedAsset.performance?.available"
                        class="performance-note">
                        원화: {{ selectedAsset.performance?.reason }}
                    </p>
                    <p
                        v-if="!selectedAsset.usdPerformance?.available"
                        class="performance-note">
                        달러: {{ selectedAsset.usdPerformance?.reason }}
                    </p>
                    <p>
                        원화와 달러 손익은 각각 명세서의 정산액으로 계산합니다.
                        현재 환율로 환산한 금액이 아닙니다.
                    </p>
                </section>
                <router-link
                    v-if="
                        selectedAsset.ticker &&
                        selectedAsset.portfolioCatalogMatched !== false
                    "
                    class="thumbnail-link"
                    :to="`/stock/${selectedAsset.ticker}`"
                    @click="closeDetail"
                    >{{ selectedAsset.ticker }} 썸네일 페이지 바로가기
                    <i class="pi pi-arrow-right"
                /></router-link>
                <p class="performance-note">
                    금액 아래에는 반대 통화의 가치와 환율을 표시합니다. 확인된
                    매수 자금은 수수료·세금을 포함한 정산액 기준으로 달러 잔액과
                    원화 환전 사용분을 나눕니다. 결제 구성이 미확인된 거래는
                    원문 거래금액을 표시합니다. 환산 금액만으로 원화 자동환전
                    여부를 판단하지 않습니다.
                </p>
                <p v-if="fundingMessage" role="status">{{ fundingMessage }}</p>
                <PurchaseFundingEditor
                    v-if="fundingTransaction"
                    ref="fundingEditor"
                    :key="`${selectedAsset.id}-${fundingTransaction.id}`"
                    :user="firebaseUser"
                    :transaction="fundingTransaction"
                    :asset="selectedAsset"
                    :state="capital"
                    :loading="capitalLoading"
                    :load-error="capitalError"
                    @saved="fundingSaved"
                    @close="fundingTransaction = null" />
                <div class="table-wrap detail-table">
                    <table aria-label="종목 거래내역">
                        <thead>
                            <tr>
                                <th>날짜</th>
                                <th>유형</th>
                                <th class="numeric">수량</th>
                                <th class="numeric">거래·결제 금액</th>
                                <th class="numeric">수수료</th>
                                <th class="numeric">세금</th>
                                <th>매수 자금</th>
                            </tr>
                        </thead>
                        <tbody>
                            <template
                                v-for="group in detailAmountGroups"
                                :key="group.key">
                                <tr
                                    v-for="(
                                        amountRow, rowIndex
                                    ) in group.amounts"
                                    :key="rowIndex">
                                    <td
                                        v-if="rowIndex === 0"
                                        :rowspan="group.amounts.length">
                                        {{ date(group.transaction.date) }}
                                    </td>
                                    <td
                                        v-if="rowIndex === 0"
                                        :rowspan="group.amounts.length">
                                        <span
                                            class="type"
                                            :class="
                                                typeClass(
                                                    group.transaction.type
                                                )
                                            "
                                            >{{
                                                typeLabel(
                                                    group.transaction.type
                                                )
                                            }}</span
                                        >
                                    </td>
                                    <td
                                        v-if="rowIndex === 0"
                                        :rowspan="group.amounts.length"
                                        class="numeric">
                                        {{
                                            quantity(group.transaction.quantity)
                                        }}
                                    </td>
                                    <td class="numeric">
                                        <TransactionAmount :row="amountRow" />
                                    </td>
                                    <td
                                        v-if="rowIndex === 0"
                                        :rowspan="group.amounts.length"
                                        class="numeric">
                                        {{
                                            transactionMoney(
                                                group.transaction.commission
                                            )
                                        }}
                                    </td>
                                    <td
                                        v-if="rowIndex === 0"
                                        :rowspan="group.amounts.length"
                                        class="numeric">
                                        {{
                                            transactionMoney(
                                                group.transaction.tax
                                            )
                                        }}
                                    </td>
                                    <td
                                        v-if="rowIndex === 0"
                                        :rowspan="group.amounts.length">
                                        <button
                                            v-if="
                                                group.transaction.type ===
                                                    'buy' &&
                                                group.transaction.id
                                            "
                                            type="button"
                                            @click="
                                                openFunding(group.transaction)
                                            ">
                                            {{
                                                fundingLabel(group.transaction)
                                            }}</button
                                        ><span v-else>-</span>
                                    </td>
                                </tr>
                            </template>
                            <tr
                                v-if="
                                    periodError ||
                                    !selectedAsset.transactions.length
                                ">
                                <td colspan="7" class="empty">
                                    {{
                                        periodError ||
                                        (selectedAsset.ledgerUnavailable
                                            ? '거래 원장을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.'
                                            : '선택한 기간에 거래내역이 없습니다.')
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
    .period-panel label {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .period-label {
        font-size: 0.9rem;
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
        flex-wrap: wrap;
        padding-top: 14px;
        border-top: 1px solid;
        font-size: 0.85rem;
    }
    .profit-positive {
        color: #c62828;
    }
    .profit-negative {
        color: #2563b8;
    }
    .performance-note {
        font-size: 0.85rem;
        margin-bottom: 12px;
    }
    .performance-detail {
        margin-bottom: 18px;
    }
    .performance-detail p {
        margin: 8px 0;
        font-size: 0.85rem;
    }
    .performance-detail dl > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
    }
    .performance-detail dd {
        margin: 0;
        text-align: right;
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
    .history-retry {
        margin-top: 12px;
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
    .profit-positive {
        color: #c62828;
    }
    .profit-negative {
        color: #2563b8;
    }
    .performance-note {
        font-size: 0.85rem;
        margin-bottom: 12px;
    }
    .performance-detail {
        margin-bottom: 18px;
    }
    .performance-detail p {
        margin: 8px 0;
        font-size: 0.85rem;
    }
    .performance-detail dl > div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 8px;
    }
    .performance-detail dd {
        margin: 0;
        text-align: right;
    }
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
        flex-wrap: wrap;
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
