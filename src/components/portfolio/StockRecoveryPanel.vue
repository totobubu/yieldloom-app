<script setup>
    import { computed } from 'vue';
    import { stockRecovery } from '../../../lib/portfolio-capital.js';
    const props = defineProps({
        trades: { type: Array, default: () => [] },
        allocations: { type: Array, default: () => [] },
        accounts: { type: Array, default: () => [] },
    });
    const rows = computed(() => stockRecovery(props.trades, props.allocations));
    const money = (v, c) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: c,
            maximumFractionDigits: c === 'KRW' ? 0 : 6,
        }).format(v);
    const accountLabel = (id) =>
        props.accounts.find((a) => a.id === id)?.alias || id;
</script>
<template>
    <section class="stock-recovery" aria-label="종목별 투자 비용 회수">
        <h2>종목별 매매·배당 누계</h2>
        <p>
            매수원가는 직접 넣은 돈과 배당·매도금 재투자를 모두 포함합니다. 배당
            성과는 배당을 지급한 종목에 남습니다.
        </p>
        <p>
            수령액/매수액 = (매도 정산금 + 원장 배당액) ÷ 누적 매수 정산금.
            재투자 후 반복 매도하면 같은 자금이 중복 누적되므로 원금 회수율로
            사용하지 않습니다. 실제 현금 회수는 위 자금 추적에서 확인하세요.
        </p>
        <div class="scroll">
            <table>
                <thead>
                    <tr>
                        <th>계좌 · 종목</th>
                        <th>매수원가</th>
                        <th>매도 정산금</th>
                        <th>원장 배당액</th>
                        <th>수령액/매수액</th>
                        <th>매수 자금 출처</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in rows" :key="item.key">
                        <th scope="row">
                            {{ accountLabel(item.accountId) }} · {{ item.symbol
                            }}<small>{{ item.currency }}</small>
                        </th>
                        <td>
                            {{
                                item.complete
                                    ? money(item.purchaseCost, item.currency)
                                    : '정산액·원장 확인 필요'
                            }}
                        </td>
                        <td>
                            {{
                                item.complete
                                    ? money(item.saleProceeds, item.currency)
                                    : '확인 필요'
                            }}
                        </td>
                        <td>
                            {{
                                item.dividendComplete
                                    ? money(item.dividends, item.currency)
                                    : '확인 필요'
                            }}
                        </td>
                        <td>
                            {{
                                item.rate === null
                                    ? '확인 필요'
                                    : `${item.rate.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`
                            }}
                        </td>
                        <td>
                            <small
                                v-for="(amount, label) in item.funding"
                                :key="label"
                                >{{ label }} ·
                                {{ money(amount, item.currency) }}</small
                            >
                            <small v-if="item.unknownFunding"
                                >출처 미확인 ·
                                {{
                                    money(item.unknownFunding, item.currency)
                                }}</small
                            >
                            <small v-if="!item.purchaseCost"
                                >매수 내역 확인 필요</small
                            >
                        </td>
                    </tr>
                    <tr v-if="!rows.length">
                        <td colspan="6">저장된 종목 거래내역이 없습니다.</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p>
            전체 저장 거래 기준이며 누락된 기초 보유·입출고 내역은 별도 확인이
            필요합니다. 자금 출처는 각 매수 거래의 ‘자금 구성 확인’에서
            입력하세요.
        </p>
    </section>
</template>
<style scoped>
    .stock-recovery {
        padding: 20px;
        margin: 20px 0;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
        color: var(--app-text);
    }
    h2 {
        margin: 0;
        font-size: 1.2rem;
    }
    p {
        font-size: 0.88rem;
        color: var(--app-muted);
    }
    .scroll {
        overflow-x: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
    }
    th,
    td {
        text-align: left;
        padding: 12px;
        border-bottom: 1px solid var(--app-border);
        min-width: 125px;
    }
    small {
        display: block;
        font-weight: normal;
    }
</style>
