<script setup>
    import Button from 'primevue/button';
    import Tag from 'primevue/tag';
    defineProps({
        events: { type: Array, default: () => [] },
        basis: { type: String, default: 'payable' },
        accountLabel: { type: Function, required: true },
        money: { type: Function, required: true },
        stateNames: { type: Object, required: true },
        safeSource: { type: Function, required: true },
    });
    defineEmits(['open']);
</script>
<template>
    <section class="calendar-inline-detail" aria-label="선택 일정 상세 정보">
        <div class="detail-title">
            <h3>이벤트 상세 정보</h3>
            <Tag
                v-if="events[0]"
                :value="stateNames[events[0].status] || '상태 미확인'"
                :severity="
                    events[0].status === 'forecast' ||
                    events[0].status === 'review'
                        ? 'warn'
                        : 'success'
                " />
        </div>
        <p v-if="!events.length">
            선택한 계좌·통화·기간에 확인된 일정이 없습니다. 배당이 0이라는 뜻은
            아닙니다.
        </p>
        <article v-for="event in events" :key="event.id">
            <dl>
                <div>
                    <dt>종목명 / 티커</dt>
                    <dd>{{ event.symbol }}</dd>
                </div>
                <div>
                    <dt>계좌</dt>
                    <dd>{{ accountLabel(event.accountId) }}</dd>
                </div>
                <div>
                    <dt>선택 통화</dt>
                    <dd>{{ event.currency || '통화 미확인' }}</dd>
                </div>
                <div>
                    <dt>
                        날짜 기준 ({{ basis === 'ex' ? '배당락일' : '지급일' }})
                    </dt>
                    <dd>{{ event.date }}</dd>
                </div>
                <div>
                    <dt>주당 배당금</dt>
                    <dd>{{ money(event.perShare ?? null, event.currency) }}</dd>
                </div>
                <div>
                    <dt>계좌 보유수량</dt>
                    <dd>
                        {{ event.quantity == null ? '미확인' : event.quantity
                        }}<small
                            >수량 기준일
                            {{ event.quantityAsOf || '미확인' }}</small
                        >
                    </dd>
                </div>
                <div class="detail-amount">
                    <dt>
                        {{
                            event.status === 'recorded' ||
                            event.status === 'reversal'
                                ? '저장 거래금액'
                                : '계산 세전 예상액'
                        }}
                    </dt>
                    <dd>{{ money(event.amount ?? null, event.currency) }}</dd>
                </div>
                <div>
                    <dt>자료 출처</dt>
                    <dd>
                        <span
                            v-if="
                                event.status === 'recorded' ||
                                event.status === 'reversal'
                            "
                            >저장된 배당 거래 기록</span
                        >
                        <a
                            v-else-if="safeSource(event.sourceUrl)"
                            :href="safeSource(event.sourceUrl)"
                            target="_blank"
                            rel="noopener noreferrer"
                            >공시 원문 확인</a
                        ><span v-else>공시 원문 연결 미확인</span>
                    </dd>
                </div>
                <div>
                    <dt>상태 확인</dt>
                    <dd>{{ stateNames[event.status] || '상태 미확인' }}</dd>
                </div>
            </dl>
            <p>{{ event.notice }}</p>
            <Button
                label="전체 상세 보기"
                severity="secondary"
                outlined
                size="small"
                @click="$emit('open', event.date)" />
        </article>
    </section>
</template>
<style scoped>
    .calendar-inline-detail {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 20px;
        background: var(--app-surface);
        min-width: 0;
    }
    h3 {
        font-size: 16px;
        margin: 0;
    }
    article + article {
        border-top: 1px solid var(--app-border);
        margin-top: 20px;
        padding-top: 20px;
    }
    .detail-title {
        margin-bottom: 14px;
    }
    .detail-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    }
    dl {
        margin: 0;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    dl > div {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        padding: 0 0 6px;
        border-bottom: 1px solid var(--app-border-subtle);
        font-size: 13px;
    }
    dt {
        color: var(--app-muted);
    }
    dd {
        margin: 0;
        text-align: right;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    dd small {
        display: block;
        font-weight: 400;
        font-size: 11px;
        color: var(--app-muted);
    }
    .detail-amount dd {
        color: var(--app-accent);
        font-size: 15px;
    }
    p {
        font-size: 12px;
        color: var(--app-muted);
        line-height: 1.4;
        margin: 12px 0;
        padding: 10px 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
    }
    a,
    .source-pending {
        display: block;
        margin: 12px 0;
        font-size: 12px;
        color: var(--app-muted);
    }
    @media (max-width: 640px) {
        .calendar-inline-detail {
            padding: 16px;
        }
    }
</style>
