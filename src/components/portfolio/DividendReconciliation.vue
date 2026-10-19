<script setup>
    import { computed, ref } from 'vue';
    import Message from 'primevue/message';
    import { reconcileDividends } from '@/services/dividendReconciliation.js';
    import { calendarToday } from '@/services/portfolioCalendar.js';
    const props = defineProps({
        schedules: { type: Array, required: true },
        recorded: { type: Array, required: true },
        accounts: { type: Array, required: true },
        period: { type: String, required: true },
        currency: { type: String, default: '' },
    });
    const confirmedBasis = ref(false),
        issuesOnly = ref(false);
    const rows = computed(() =>
        reconcileDividends(props.schedules, props.recorded, {
            today: calendarToday(),
            confirmedBasis: confirmedBasis.value,
        })
            .filter(
                (r) =>
                    r.date.startsWith(props.period) &&
                    (!props.currency || r.currency === props.currency)
            )
            .filter(
                (r) =>
                    !issuesOnly.value ||
                    [
                        'unrecorded',
                        'difference',
                        'ambiguous',
                        'unlinked',
                    ].includes(r.status)
            )
    );
    const labels = {
        ambiguous: '후보 중복·수동 확인',
        unrecorded: '지급일 경과·거래 미확인',
        upcoming: '지급 예정',
        candidate: '거래 연결 후보',
        matched: '참고액과 일치',
        difference: '금액 차이 확인',
        unlinked: '대응 공시 미확인',
    };
    const money = (v) =>
        v == null
            ? '확인 필요'
            : v.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
</script>
<template>
    <section aria-label="예상 배당과 기록 대조" class="reconciliation">
        <h3>예상 배당과 기록 대조</h3>
        <Message severity="info" :closable="false"
            >같은 계좌·종목·통화의 지급일과 같은 날짜 기록을 우선 연결하고, 전후
            7일 기록도 후보로 확인합니다. 거래 미확인은 미수령을 뜻하지 않으며,
            중복 후보는 자동 합산하지 않습니다. 배당 취소는 차감합니다.</Message
        >
        <p>
            현재 보유 종목의 공시와 조회된 원장 범위만 사용합니다. 매도한 종목의
            과거 공시는 누락될 수 있습니다.
        </p>
        <label
            ><input v-model="confirmedBasis" type="checkbox" /> 조회 기간의
            배당락일 보유 수량이 표시 수량과 같고, 거래 금액과 공시가 같은 세전
            기준임을 확인했습니다.</label
        >
        <p>
            확인한 경우에만 공시 주당 배당금 × 표시 수량과 거래 금액의 차이를
            계산합니다. 실수령액·지급 자격을 자동 확정하지 않습니다.
        </p>
        <label
            ><input v-model="issuesOnly" type="checkbox" /> 확인할 항목만
            보기</label
        >
        <p v-if="!rows.length">선택 범위에 대조 항목이 없습니다.</p>
        <div v-else class="table-scroll">
            <table aria-label="배당 대조 결과">
                <thead>
                    <tr>
                        <th>지급일·기록일</th>
                        <th>계좌·종목</th>
                        <th>통화</th>
                        <th>상태</th>
                        <th>공시 참고액</th>
                        <th>거래 기록액</th>
                        <th>차이</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="row in rows.slice(0, 200)" :key="row.id">
                        <td>{{ row.date }}</td>
                        <th>
                            {{
                                accounts.find((a) => a.id === row.accountId)
                                    ?.alias
                            }}
                            · {{ row.symbol }}
                        </th>
                        <td>{{ row.currency || '미확인' }}</td>
                        <td>{{ labels[row.status] }}</td>
                        <td>{{ money(row.reference) }}</td>
                        <td>{{ money(row.actual) }}</td>
                        <td>{{ money(row.difference) }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-if="rows.length > 200">
            처음 200개를 표시합니다. 월·계좌 필터로 범위를 좁혀 주세요.
        </p>
    </section>
</template>
<style scoped>
    .reconciliation {
        margin-block: 1rem;
        min-width: 0;
    }
    label {
        display: block;
        margin-block: 1rem;
    }
    .table-scroll {
        overflow: auto;
        max-width: 100%;
    }
    table {
        width: 100%;
        min-width: 680px;
        border-collapse: collapse;
    }
    th,
    td {
        text-align: left;
        padding: 0.6rem;
        border-bottom: 1px solid var(--app-border);
    }
</style>
