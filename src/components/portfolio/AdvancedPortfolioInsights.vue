<script setup>
    import { computed, ref } from 'vue';
    import Message from 'primevue/message';
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
    const confirmed = ref(false);
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
        cash_in: '입금 기록',
        cash_out: '출금 기록',
        transfer_in: '입고 기록',
        transfer_out: '출고 기록',
        split: '분할 기록',
    };
</script>
<template>
    <section class="advanced-insights" aria-label="원장 품질·청산 수익 분석">
        <h3>원장 품질·청산 수익 분석</h3>
        <p>
            {{ month }} · {{ currency }} · 이미 조회한 전체 원장을 사용하며 추가
            조회는 없습니다. 통화 간 합산·환산은 하지 않습니다.
        </p>
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
            매수·매도는 거래 금액이며 입출금 기록을 외부 원금으로 확정하지
            않습니다. 원장에 원화 환산액·달러 원금액이 함께 있으면 선택 통화의
            기록 금액을 사용합니다.
        </p>
        <Message severity="info" :closable="false"
            >날짜 제외 {{ report.excludedDates }}건 · 입출고
            {{ report.transfers }}건 · 환전 후보 {{ report.exchanges }}건.
            입출고·환전은 자동 연결하거나 수익으로 합산하지 않습니다.</Message
        >
        <h4>최근 3개월과 직전 3개월의 배당 기록</h4>
        <p>
            직전 3개월 {{ format(report.trend.before) }} / 최근 3개월
            {{ format(report.trend.recent) }} {{ currency }} · 증감률
            {{ format(report.trend.percent) }}%
        </p>
        <p>
            6개월 기록의 표준편차 {{ format(report.trend.deviation) }}
            {{ currency }} · 변동계수 {{ format(report.trend.coefficient) }}%
        </p>
        <p>
            선택 월이 마감되고 6개월 모두 금액이 확인된 기록이 있을 때만
            계산합니다. 기록 없는 달을 0원으로 만들지 않으며 기록 자체의
            완전성을 보장하지 않습니다.
        </p>
        <h4>완전 청산 거래의 정산액 기준 손익</h4>
        <label
            ><input v-model="confirmed" type="checkbox" /> 계좌 잔고
            기준일까지의 전체 거래이며 기초 보유 누락이 없고 정산액에
            수수료·세금이 반영됐음을 확인했습니다.</label
        >
        <p>
            계좌·종목을 분리하고 기준일 이후 거래는 제외합니다. 보유 중·정산액
            누락·수량 불일치·입출고가 있으면 계산을 보류합니다. 단순 누적 투자금
            대비 손익이며 연환산·시점 반영 수익률이 아닙니다.
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
    </section>
</template>
<style scoped>
    .advanced-insights {
        padding: 1rem;
        margin-block: 1rem;
        border: 1px solid var(--app-border);
        border-radius: 12px;
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
</style>
