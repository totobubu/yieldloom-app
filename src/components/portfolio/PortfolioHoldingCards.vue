<script setup>
    import { computed, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import { RouterLink } from 'vue-router';
    import { formatStoredAmount } from '@/utils/formatStoredAmount';
    const props = defineProps({
        rows: { type: Array, required: true },
        ownerName: { type: Function, required: true },
        accountLabel: { type: Function, required: true },
        number: { type: Function, required: true },
        accountAccess: { type: Function, default: () => '권한 미확인' },
    });
    defineEmits(['evidence']);
    const page = ref(0);
    const pageCount = computed(() => Math.ceil(props.rows.length / 10));
    const visible = computed(() =>
        props.rows.slice(page.value * 10, (page.value + 1) * 10)
    );
    watch(
        () => props.rows,
        () => {
            page.value = 0;
        }
    );
</script>
<template>
    <div class="holding-cards" aria-label="명의자·계좌별 잔고 카드">
        <article
            v-for="(row, index) in visible"
            :key="`${row.accountId}:${row.symbol}:${row.currency}:${index}`"
            class="holding-card">
            <header>
                <div class="holding-identity">
                    <div class="holding-ticker">
                        <strong>{{ row.symbol }}</strong
                        ><span class="currency">{{
                            row.currency || '통화 미확인'
                        }}</span>
                    </div>
                    <p>{{ row.name || '종목명 미제공' }}</p>
                </div>
                <span
                    class="holding-status"
                    :class="{
                        'is-estimated':
                            row.estimated ||
                            row.calculationMode === 'estimated',
                    }"
                    >{{
                        row.estimated || row.calculationMode === 'estimated'
                            ? '추정 잔고'
                            : '저장 잔고'
                    }}</span
                >
            </header>
            <div class="holding-figures">
                <div>
                    <span>보유수량</span
                    ><strong>{{ number(row.quantity) }}</strong>
                </div>
                <div>
                    <span>자료 평가액</span
                    ><strong>{{
                        formatStoredAmount(row.amount, row.currency)
                    }}</strong>
                </div>
            </div>
            <dl>
                <div>
                    <dt>명의자 / 계좌</dt>
                    <dd>
                        {{ ownerName(row.ownerId) }} ·
                        {{ accountLabel(row.accountId) }}
                        <span class="holding-access">{{
                            accountAccess(row.accountId)
                        }}</span>
                    </dd>
                </div>
                <div>
                    <dt>자료 기준일</dt>
                    <dd>{{ row.asOf || '미확인' }}</dd>
                </div>
                <div>
                    <dt>원본 출처</dt>
                    <dd>{{ row.source || '미확인' }}</dd>
                </div>
            </dl>
            <footer>
                <Button
                    label="원본 자료 확인"
                    severity="secondary"
                    size="small"
                    @click="$emit('evidence', row.accountId)" /><RouterLink
                    :to="'/stock/' + row.symbol"
                    >종목 상세 진입</RouterLink
                >
            </footer>
        </article>
        <p v-if="!rows.length">
            확인 가능한 잔고가 없습니다. 계좌 자료를 업로드해 주세요.
        </p>
        <nav v-if="pageCount > 1" aria-label="보유 종목 카드 페이지">
            <Button
                icon="pi pi-chevron-left"
                aria-label="이전 보유 종목"
                text
                :disabled="page === 0"
                @click="page--" /><span aria-live="polite"
                >{{ page + 1 }} / {{ pageCount }}</span
            ><Button
                icon="pi pi-chevron-right"
                aria-label="다음 보유 종목"
                text
                :disabled="page + 1 >= pageCount"
                @click="page++" />
        </nav>
    </div>
</template>
<style scoped>
    .holding-cards {
        display: none;
    }
    @media (max-width: 1023px) {
        .holding-cards {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 16px;
            padding: 16px;
            border-radius: 12px;
            background: var(--app-surface);
            box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
        }
        .holding-card {
            min-width: 0;
            font-size: 14px;
            line-height: 20px;
            padding: 16px;
            border-radius: 12px;
            background: var(--app-surface-muted);
            color: var(--holding-text, var(--app-text));
        }
        header {
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }
        .holding-ticker {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }
        .holding-identity {
            min-width: 0;
            overflow-wrap: anywhere;
        }
        .holding-identity p {
            margin: 0;
            font-size: 12px;
            line-height: 16px;
            color: var(--holding-outline, var(--app-muted));
        }
        header strong {
            font-size: 16px;
            line-height: 24px;
            font-weight: 600;
        }
        .currency {
            font:
                600 11px/14px 'JetBrains Mono',
                monospace;
            padding: 2px 8px;
            border-radius: 4px;
            background: var(--holding-badge, var(--app-surface-muted));
        }
        .holding-status {
            margin-left: auto;
            font:
                600 11px/14px 'JetBrains Mono',
                monospace;
            color: var(--holding-status-normal, var(--app-accent));
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .holding-status::before {
            content: '';
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--app-accent);
        }
        .holding-status.is-estimated {
            color: var(--app-warning-text);
        }
        .holding-status.is-estimated::before {
            background: currentColor;
        }
        .holding-figures {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
            padding: 12px;
            margin-top: 14px;
            border-radius: 8px;
            background: var(--app-surface);
        }
        .holding-figures > div {
            display: block;
            min-width: 0;
            overflow-wrap: anywhere;
        }
        .holding-figures > div:last-child {
            text-align: right;
        }
        .holding-figures span,
        dt {
            font-size: 11px;
            line-height: 14px;
            color: var(--holding-outline, var(--app-muted));
        }
        .holding-figures span {
            display: block;
            color: var(--holding-variant, var(--app-muted));
            font-family: 'JetBrains Mono', monospace;
            font-weight: 500;
        }
        .holding-figures strong {
            font:
                600 13px/16px 'JetBrains Mono',
                monospace;
            font-variant-numeric: tabular-nums;
        }
        dl {
            font-size: 12px;
            line-height: 16px;
            display: grid;
            gap: 6px;
            margin: 14px 0 0;
        }
        dl > div {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0;
        }
        dl > div:last-child {
            align-items: flex-start;
            gap: 8px;
        }
        dl > div:last-child dt {
            flex-shrink: 0;
        }
        dd {
            margin: 0;
            font-size: 12px;
            line-height: 16px;
            text-align: right;
            overflow-wrap: anywhere;
        }
        dt {
            font-size: 12px;
            line-height: 16px;
        }
        dl > div:first-child dd {
            color: var(--holding-text, var(--app-text));
            font-weight: 500;
        }
        dl > div:nth-child(2) dd {
            font:
                500 11px/14px 'JetBrains Mono',
                monospace;
        }
        .holding-access {
            display: inline;
            padding: 2px 4px;
            border-radius: 4px;
            background: var(--holding-badge, var(--app-surface));
            font-size: 11px;
            line-height: 14px;
        }
        footer {
            --p-button-label-font-weight: 400;
            display: flex;
            flex-wrap: nowrap;
            justify-content: flex-end;
            align-items: center;
            gap: 8px;
            margin-top: 14px;
            padding-top: 8px;
        }
        footer > * {
            flex: 0 1 auto;
            min-width: 0;
            white-space: normal;
            justify-content: center;
            text-align: center;
        }
        footer :deep(.p-button) {
            height: 36px;
            min-height: 36px;
            padding: 0 12px;
            border: 0;
            border-radius: 8px;
            font-size: 12px;
            line-height: 16px;
        }
        footer a {
            display: inline-flex;
            align-items: center;
            min-height: 36px;
            padding: 0 12px;
            border-radius: 8px;
            background: var(--app-accent);
            color: var(--app-accent-contrast);
            font-size: 12px;
            line-height: 16px;
            text-decoration: none;
        }
        nav {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        }
        /* d90f121f light reference; dark retains the existing app tokens. */
        :root:not(.p-dark) .holding-cards {
            --holding-text: #191c1e;
            --holding-outline: #6e7977;
            --holding-variant: #3e4947;
            --holding-status-normal: #005f55;
            --holding-badge: #eceef0;
        }
        :root:not(.p-dark) footer :deep(.p-button) {
            --p-button-secondary-background: #eceef0;
            --p-button-secondary-color: #3e4947;
            --p-button-secondary-hover-background: #e6e8ea;
            --p-button-secondary-hover-color: #3e4947;
        }
    }
</style>
