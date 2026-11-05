<script setup>
    import { computed, ref, watch } from 'vue';
    import { accountXirr } from '@/services/portfolioXirr.js';
    import Message from 'primevue/message';
    import { validCalendarDate } from '@/services/portfolioCalendar.js';
    import {
        advancedLedgerInsights,
        closedLedgerResults,
    } from '@/services/advancedPortfolioInsights.js';
    const props = defineProps({
        entries: { type: Array, required: true },
        positions: { type: Array, required: true },
        accounts: { type: Array, required: true },
        month: { type: String, required: true },
        currency: { type: String, required: true },
        today: { type: String, required: true },
    });
    const recordFilter = ref('all');
    const recordPage = ref(0);
    const recordAccounts = computed(
        () => new Set(props.accounts.map((account) => account.id))
    );
    const records = computed(() =>
        props.entries
            .map((entry, index) => ({ ...entry, row: entry.row || {}, index }))
            .filter(
                (entry) =>
                    recordAccounts.value.has(entry.accountId) &&
                    (!validCalendarDate(entry.row?.date) ||
                        entry.row.date.startsWith(props.month))
            )
    );
    const missingRecord = (row) =>
        !validCalendarDate(row.date) ||
        row.date > props.today ||
        !row.currency ||
        row.amount == null ||
        (typeof row.amount === 'string' && !row.amount.trim()) ||
        typeof row.amount === 'boolean' ||
        !Number.isFinite(Number(row.amount));
    const recordTabs = [
        { value: 'all', label: '전체 거래' },
        { value: 'trade', label: '주식 매수/매도' },
        { value: 'dividend', label: '배당·취소' },
        { value: 'cash', label: '현금·이동' },
        { value: 'missing', label: '확인 필요' },
    ];
    function matchesRecord(row, type) {
        return (
            type === 'all' ||
            (type === 'trade' && ['buy', 'sell'].includes(row.type)) ||
            (type === 'dividend' &&
                ['dividend', 'dividend_reversal'].includes(row.type)) ||
            (type === 'cash' && row.symbol === 'CASH') ||
            (type === 'missing' && missingRecord(row))
        );
    }
    const filteredRecords = computed(() =>
        records.value.filter((entry) =>
            matchesRecord(entry.row, recordFilter.value)
        )
    );
    const pagedRecords = computed(() =>
        filteredRecords.value.slice(
            recordPage.value * 100,
            (recordPage.value + 1) * 100
        )
    );
    watch(
        () => [props.entries, props.accounts, props.month, recordFilter.value],
        () => {
            recordPage.value = 0;
        }
    );
    const rawValue = (value) =>
        value == null || value === '' ? '미제공' : String(value);
    const rawAmount = (value) =>
        rawValue(value).replace(
            /^([+-]?)(\d+)(\.\d+)?$/,
            (_, sign, whole, fraction = '') =>
                sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + fraction
        );
    const confirmed = ref(false);
    const xirrConfirmed = ref(false);
    watch(
        () => [
            props.entries,
            props.accounts,
            props.currency,
            props.month,
            props.today,
        ],
        () => {
            confirmed.value = false;
            xirrConfirmed.value = false;
        }
    );
    const xirr = computed(() =>
        props.accounts.map((account) => ({
            id: account.id,
            alias: account.alias,
            ...accountXirr(props.entries, account, {
                currency: props.currency,
                today: props.today,
                confirmed: xirrConfirmed.value,
            }),
        }))
    );
    const report = computed(() => advancedLedgerInsights(props.entries, props));
    const closed = computed(() =>
        closedLedgerResults(props.entries, props.positions, props.accounts, {
            currency: props.currency,
            today: props.today,
            confirmed: confirmed.value,
        })
    );
    const format = (value) =>
        value == null
            ? '확인 불가'
            : value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    const names = {
        buy: '매수 기록',
        sell: '매도 기록',
        dividend: '배당·취소 순기록',
        dividend_reversal: '배당 취소 기록',
        cash_in: '입금 기록',
        cash_out: '출금 기록',
        transfer_in: '입고 기록',
        transfer_out: '출고 기록',
        split: '분할 기록',
    };
</script>
<template>
    <section class="advanced-insights" aria-label="원장 품질·청산 수익 분석">
        <header class="ledger-heading">
            <div class="ledger-badges">
                <span>원장 데이터 분석</span><span>저장 원장 기준</span>
            </div>
            <h3>원장 품질 및 청산 손익 분석</h3>
            <p>
                가져온 증권 거래 원장의 기록과 확인 필요 항목을 검토합니다. 실제
                자료와 기존 계산 조건을 보존합니다.
            </p>
            <div class="ledger-scope">
                <span
                    >분석 마감월 <strong>{{ month }}</strong></span
                ><span
                    >집계 통화
                    <strong
                        >{{ currency }} · 통화 간 환산·합산 없음</strong
                    ></span
                ><span
                    >권한 있는 계좌
                    <strong>{{ accounts.length }}개</strong></span
                >
            </div>
            <p class="ledger-notice">
                이미 조회한 전체 원장을 사용하며 추가 조회는 없습니다. 아래 저장
                원장 표는 통화를 각각 표시하며, 집계는 선택 통화와 기존 계산
                기준을 따릅니다.
            </p>
        </header>
        <div class="ledger-analysis-grid">
            <div class="ledger-main">
                <div class="ledger-kpis">
                    <article>
                        <span>원장 정합성 검토 상태</span
                        ><strong
                            >{{ records.length }}건 · 확인 필요
                            {{
                                records.filter((entry) =>
                                    missingRecord(entry.row)
                                ).length
                            }}건</strong
                        ><small>날짜·금액·통화 확인 대상 · 완전성 미인증</small>
                    </article>
                    <article>
                        <span>배당 연속성 지표</span><strong>산출 보류</strong
                        ><small
                            >연속성 정의 미확정 · 기존 기록 증감률은 아래 별도
                            표시</small
                        >
                    </article>
                    <article>
                        <span>XIRR (연환산 내부수익률)</span
                        ><strong>{{
                            xirrConfirmed
                                ? '계좌별 결과 확인'
                                : '사용자 확인 필요'
                        }}</strong
                        ><small>아래 기초 자산·외부 입출금 확인 후 계산</small>
                    </article>
                    <article>
                        <span>청산 포지션 손익</span
                        ><strong>{{
                            confirmed
                                ? '계좌·종목별 결과 확인'
                                : '사용자 확인 필요'
                        }}</strong
                        ><small
                            >완전 청산·정산액 조건 적용 · 가정 손익 사용 안
                            함</small
                        >
                    </article>
                </div>
                <article class="ledger-card ledger-records">
                    <div class="ledger-card-heading">
                        <h4>원장 트랜잭션 검증 내역</h4>
                        <span>총 {{ records.length }}건</span>
                    </div>
                    <div
                        class="ledger-tabs"
                        role="group"
                        aria-label="원장 거래 유형">
                        <button
                            v-for="tab in recordTabs"
                            :key="tab.value"
                            type="button"
                            :aria-pressed="recordFilter === tab.value"
                            @click="recordFilter = tab.value">
                            {{ tab.label }} ({{
                                records.filter((entry) =>
                                    matchesRecord(entry.row, tab.value)
                                ).length
                            }})
                        </button>
                    </div>
                    <p class="ledger-notice">
                        선택 월과 날짜 미확인 행 · 좌우로 스크롤하여 원장 필드를
                        확인하세요.
                    </p>
                    <div
                        class="table-scroll"
                        tabindex="0"
                        aria-label="원장 거래 기록 가로 스크롤">
                        <table aria-label="원장 트랜잭션 기록">
                            <thead>
                                <tr>
                                    <th>No.</th>
                                    <th>거래일자</th>
                                    <th>식별코드 / 종목명</th>
                                    <th>구분</th>
                                    <th>수량 / 단가</th>
                                    <th>저장 거래금액</th>
                                    <th>확인 상태</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="entry in pagedRecords"
                                    :key="entry.index"
                                    :class="{
                                        'ledger-missing': missingRecord(
                                            entry.row
                                        ),
                                    }">
                                    <td>{{ entry.index + 1 }}</td>
                                    <td>{{ rawValue(entry.row.date) }}</td>
                                    <th>
                                        {{ rawValue(entry.row.symbol)
                                        }}<small>{{
                                            entry.row.securityName ||
                                            '명칭 미제공'
                                        }}</small>
                                    </th>
                                    <td>
                                        {{
                                            names[entry.row.type] ||
                                            entry.row.type ||
                                            '유형 미확인'
                                        }}
                                    </td>
                                    <td>
                                        {{ rawValue(entry.row.quantity)
                                        }}<small>단가 미제공</small>
                                    </td>
                                    <td>
                                        {{ rawAmount(entry.row.amount)
                                        }}<small>{{
                                            entry.row.currency || '통화 미지정'
                                        }}</small>
                                    </td>
                                    <td>
                                        {{
                                            missingRecord(entry.row)
                                                ? '원문 확인 필요'
                                                : '저장 원장 · 완전성 미인증'
                                        }}
                                    </td>
                                </tr>
                                <tr v-if="!pagedRecords.length">
                                    <td colspan="7">
                                        조건에 맞는 원장 기록이 없습니다.
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <nav
                        v-if="filteredRecords.length > 100"
                        class="ledger-paging"
                        aria-label="원장 기록 페이지">
                        <button
                            type="button"
                            :disabled="recordPage === 0"
                            @click="recordPage--">
                            이전 100행</button
                        ><span
                            >{{ recordPage + 1 }} /
                            {{ Math.ceil(filteredRecords.length / 100) }}</span
                        ><button
                            type="button"
                            :disabled="
                                (recordPage + 1) * 100 >= filteredRecords.length
                            "
                            @click="recordPage++">
                            다음 100행
                        </button>
                    </nav>
                </article>
            </div>
            <article class="ledger-card ledger-flows">
                <h4>선택 통화 유형별 독립 집계 · {{ currency }}</h4>
                <div class="table-scroll">
                    <table aria-label="유형별 기록 금액">
                        <thead>
                            <tr>
                                <th>유형</th>
                                <th>건수</th>
                                <th>확인 금액</th>
                                <th>금액 미확인</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in report.flows" :key="row.type">
                                <th>{{ names[row.type] || row.type }}</th>
                                <td>{{ row.count }}</td>
                                <td>{{ format(row.amount) }}</td>
                                <td>{{ row.unknown }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p>
                    매수·매도는 거래 금액이며 입출금 기록을 외부 원금으로
                    확정하지 않습니다. 원장에 원화 환산액·달러 원금액이 함께
                    있으면 선택 통화의 기록 금액을 사용합니다.
                </p>
                <Message severity="info" :closable="false"
                    >날짜 제외 {{ report.excludedDates }}건 · 입출고
                    {{ report.transfers }}건 · 환전 후보
                    {{ report.exchanges }}건. 입출고·환전은 자동 연결하거나
                    수익으로 합산하지 않습니다.</Message
                >
            </article>
        </div>
        <article class="ledger-card ledger-trend">
            <h4>최근 3개월과 직전 3개월의 배당 기록</h4>
            <p>
                직전 3개월 {{ format(report.trend.before) }} / 최근 3개월
                {{ format(report.trend.recent) }} {{ currency }} · 증감률
                {{ format(report.trend.percent) }}%
            </p>
            <p>
                6개월 기록의 표준편차 {{ format(report.trend.deviation) }}
                {{ currency }} · 변동계수
                {{ format(report.trend.coefficient) }}%
            </p>
            <p>
                선택 월이 마감되고 6개월 모두 금액이 확인된 기록이 있을 때만
                계산합니다. 기록 없는 달을 0원으로 만들지 않으며 기록 자체의
                완전성을 보장하지 않습니다.
            </p>
        </article>
        <article class="ledger-card ledger-xirr">
            <h4>계좌 현금흐름 수익률 · XIRR</h4>
            <label
                ><input v-model="xirrConfirmed" type="checkbox" /> 계좌 개설
                시점의 기초 자산은 0이며, 잔고 기준일까지의 모든 외부 입출금과
                현금을 포함한 전체 잔고 평가액을 확인했습니다.</label
            >
            <p>
                선택 월의 수익률이 아니라 계좌 개설부터 잔고 기준일까지의 연환산
                수익률입니다. 외부 입금은 투자 유출, 외부 출금과 마지막 전체
                평가액은 회수 유입으로 계산합니다. 계좌 내부 배당·매매는 중복
                가산하지 않습니다. 외부 입금·외부 출금으로 명시된 기록만
                사용하며, 미분류·환전·증권 이동·통화 혼재·복수 해 가능성은
                계산을 보류합니다. 현재 시세 대신 업로드한 평가액을 사용합니다.
            </p>
            <ul v-if="xirrConfirmed" aria-label="계좌 XIRR 결과">
                <li v-for="row in xirr" :key="row.id">
                    {{ row.alias }} ·
                    {{
                        row.available
                            ? `${format(row.percent)}% · ${row.start} ~ ${row.end}`
                            : row.reason
                    }}
                </li>
            </ul>
        </article>
        <article class="ledger-card ledger-closed">
            <h4>완전 청산 거래의 정산액 기준 손익</h4>
            <label
                ><input v-model="confirmed" type="checkbox" /> 계좌 잔고
                기준일까지의 전체 거래이며 기초 보유 누락이 없고 정산액에
                수수료·세금이 반영됐음을 확인했습니다.</label
            >
            <p>
                계좌·종목을 분리하고 기준일 이후 거래는 제외합니다. 보유
                중·정산액 누락·수량 불일치·입출고가 있으면 계산을 보류합니다.
                단순 누적 투자금 대비 손익이며 연환산·시점 반영 수익률이
                아닙니다.
            </p>
            <p v-if="confirmed && !closed.length">
                조건에 맞는 매수·매도 기록 또는 기준일 잔고가 없습니다.
            </p>
            <div v-if="confirmed && closed.length" class="table-scroll">
                <table aria-label="청산 종목 정산 손익">
                    <thead>
                        <tr>
                            <th>계좌·종목</th>
                            <th>잔고 기준일</th>
                            <th>정산 매매손익</th>
                            <th>배당 포함 손익</th>
                            <th>투자금 대비 손익률</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in closed.slice(0, 50)"
                            :key="`${row.accountId}:${row.symbol}`">
                            <th>{{ row.account }} · {{ row.symbol }}</th>
                            <td>{{ row.asOf }}</td>
                            <template v-if="row.available"
                                ><td>{{ format(row.tradingProfit) }}</td>
                                <td>{{ format(row.totalProfit) }}</td>
                                <td>
                                    {{ format(row.totalReturnPercent) }}%
                                </td></template
                            >
                            <td v-else colspan="3">{{ row.reason }}</td>
                        </tr>
                    </tbody>
                </table>
                <p v-if="closed.length > 50">
                    계산 결과 중 처음 50개를 표시합니다. 계좌 필터로 범위를 좁혀
                    주세요.
                </p>
            </div>
        </article>
    </section>
</template>
<style scoped>
    .advanced-insights {
        max-width: 834px;
        min-width: 0;
        padding: 0;
        margin-block: 1rem;
        border: 0;
    }
    .table-scroll {
        overflow: auto;
        max-width: 100%;
    }
    table {
        width: 100%;
        border-collapse: collapse;
    }
    th,
    td {
        text-align: left;
        padding: 0.6rem;
        border-bottom: 1px solid var(--app-border);
    }
    .ledger-heading {
        margin-bottom: 20px;
    }
    .ledger-heading h3 {
        font-size: 30px;
        line-height: 1.375;
        color: var(--app-brand-brown);
        margin: 12px 0 8px;
    }
    .ledger-heading p {
        color: var(--app-muted);
        font-size: 14px;
        line-height: 22.75px;
    }
    .ledger-badges {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 11px;
        color: var(--app-accent);
    }
    .ledger-badges span {
        border: 1px solid var(--app-border);
        border-radius: 4px;
        padding: 2px 8px;
        background: var(--app-surface);
    }
    .ledger-scope {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin: 20px 0 12px;
        padding: 16px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        font-size: 11px;
    }
    .ledger-scope strong {
        display: block;
        margin-top: 6px;
        font-size: 12px;
    }
    .ledger-kpis {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 20px;
    }
    .ledger-kpis article {
        display: grid;
        gap: 8px;
        padding: 16px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        font-size: 11px;
    }
    .ledger-kpis strong {
        font-size: 16px;
        line-height: 24px;
        overflow-wrap: anywhere;
    }
    .ledger-kpis small {
        color: var(--app-muted);
        line-height: 18px;
    }
    .ledger-main {
        min-width: 0;
    }
    .ledger-card {
        min-width: 0;
        padding: 16px;
        margin-bottom: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        font-size: 12px;
        line-height: 20px;
    }
    .ledger-card h4 {
        font-size: 14px;
        line-height: 20px;
        margin: 0 0 12px;
    }
    .ledger-card p {
        margin: 10px 0;
    }
    .ledger-card-heading {
        display: flex;
        justify-content: space-between;
        gap: 12px;
    }
    .ledger-card-heading span {
        white-space: nowrap;
        font-size: 11px;
    }
    .ledger-tabs {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding: 4px 0 10px;
    }
    .ledger-tabs button,
    .ledger-paging button {
        border: 1px solid var(--app-border);
        border-radius: 6px;
        padding: 6px 10px;
        white-space: nowrap;
        font-size: 11px;
        background: var(--app-bg);
        color: var(--app-text);
        cursor: pointer;
    }
    .ledger-tabs button[aria-pressed='true'] {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        border-color: var(--app-accent);
    }
    .ledger-records table {
        min-width: 740px;
        font-size: 11px;
    }
    .ledger-records th,
    .ledger-records td {
        padding: 10px 8px;
        vertical-align: top;
        font-weight: 400;
    }
    .ledger-records th small,
    .ledger-records td small {
        display: block;
        color: var(--app-muted);
    }
    .ledger-missing {
        background: var(--app-warning-light);
    }
    .ledger-notice {
        font-size: 11px;
        color: var(--app-muted);
        line-height: 18px;
    }
    .ledger-paging {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 12px;
        gap: 8px;
    }
    .ledger-paging button:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .p-dark .ledger-heading h3 {
        color: var(--app-text);
    }
    @media (min-width: 1024px) {
        .ledger-analysis-grid {
            display: grid;
            grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
            gap: 16px;
            align-items: start;
        }
    }
    @media (max-width: 640px) {
        .ledger-heading h3 {
            font-size: 20px;
            line-height: 28px;
            letter-spacing: -0.5px;
        }
        .ledger-heading > p:not(.ledger-notice) {
            line-height: 19.25px;
        }
        .ledger-kpis {
            gap: 10px;
        }
        .ledger-scope {
            grid-template-columns: minmax(0, 1fr);
        }
        .ledger-card {
            padding: 12px;
        }
        .ledger-kpis article {
            padding: 12px;
        }
    }
    .ledger-badges span {
        border-radius: 999px;
        padding: 4px 10px;
    }
    html:not(.p-dark) .ledger-badges span:first-child {
        border-color: #99d9d2;
        background: #e6f4f1;
        color: #0d7a6e;
    }
    html:not(.p-dark) .ledger-badges span:nth-child(2) {
        border-color: #fde68a;
        background: #fffbeb;
        color: #854d0e;
    }
</style>
