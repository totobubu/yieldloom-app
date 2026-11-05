<script setup>
    import Button from 'primevue/button';
    defineProps({
        accounts: { type: Array, required: true },
        selected: { type: String, default: '' },
        userId: { type: String, default: '' },
        busy: Boolean,
        ownerName: { type: Function, default: () => '명의자 미확인' },
        number: {
            type: Function,
            default: (value) => (value == null ? '미확인' : String(value)),
        },
    });
    defineEmits(['select', 'upload', 'connect-toss', 'rename']);
</script>
<template>
    <p v-if="!accounts.length">
        등록된 계좌가 없습니다. 계좌 추가로 시작하세요.
    </p>
    <ul v-else class="accounts">
        <li v-for="account in accounts" :key="account.id">
            <Button
                class="account-card-select"
                :aria-label="`${account.institution} · ${account.alias} · ${account.maskedNumber}`"
                severity="secondary"
                :outlined="selected !== account.id"
                :disabled="busy"
                :aria-pressed="selected === account.id"
                @click="$emit('select', account.id)">
                <span class="account-card-identity"
                    ><strong>{{ ownerName(account.ownerId) }}</strong
                    ><span
                        >{{ account.institution }}
                        {{ account.maskedNumber }}</span
                    ></span
                >
                <span class="account-card-selection">{{
                    selected === account.id ? '선택됨' : '계좌 선택'
                }}</span>
            </Button>
            <div class="account-card-role">
                <span>{{
                    {
                        owner: '소유자 (Owner)',
                        editor: '편집자 (Editor)',
                        viewer: '조회 전용 (Viewer)',
                    }[account.permissions?.[userId]] || '권한 미확인'
                }}</span
                ><span>{{ account.type || '유형 미확인' }}</span>
            </div>
            <dl class="account-card-snapshot">
                <div>
                    <dt>최신 자료</dt>
                    <dd>{{ account.snapshot?.source || '미확인' }}</dd>
                </div>
                <div>
                    <dt>기준 일자</dt>
                    <dd>
                        {{ account.snapshot?.asOf || account.asOf || '미확인' }}
                    </dd>
                </div>
                <div>
                    <dt>보유 현황</dt>
                    <dd v-if="account.snapshot?.rows?.length">
                        <span
                            v-for="(row, index) in account.snapshot.rows.slice(
                                0,
                                3
                            )"
                            :key="`${row.symbol}:${row.currency}:${index}`"
                            >{{ row.symbol }} · {{ number(row.quantity) }} ·
                            {{ number(row.amount) }} {{ row.currency }}<br
                        /></span>
                        <span v-if="account.snapshot.rows.length > 3"
                            >외 {{ account.snapshot.rows.length - 3 }}개 항목 ·
                            계좌 선택 후 전체 확인</span
                        >
                    </dd>
                    <dd v-else>보유 자료 미확인</dd>
                </div>
            </dl>
            <small>{{ account.alias }}</small>
            <div class="account-card-primary-tools">
                <Button
                    label="별칭 수정"
                    :title="
                        account.permissions?.[userId] === 'viewer'
                            ? '조회 전용 계좌는 별칭을 변경할 수 없습니다.'
                            : account.authorityUid !== userId
                              ? '별칭 변경은 명의자 또는 보호자 권한이 필요합니다.'
                              : '선택 계좌의 별칭 입력란으로 이동'
                    "
                    icon="pi pi-pencil"
                    severity="secondary"
                    :disabled="
                        busy ||
                        account.authorityUid !== userId ||
                        !['owner', 'editor'].includes(
                            account.permissions?.[userId]
                        )
                    "
                    @click="$emit('rename', account.id)" />
                <Button
                    label="출처 원본 (미지원)"
                    icon="pi pi-file"
                    severity="secondary"
                    text
                    disabled
                    title="원문 파일 열기는 미구현입니다. 저장된 출처·기준일은 위에서 확인할 수 있습니다." />
            </div>
        </li>
    </ul>
</template>
<style scoped>
    .accounts {
        list-style: none;
        padding: 0;
        display: grid;
        gap: 1rem;
    }
    .accounts li {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        flex-wrap: wrap;
        padding: 1rem 0;
        border-bottom: 1px solid var(--p-content-border-color);
    }

    /* CONTENT / Asset Management / Reviewed: registered-account cards. */
    .accounts {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin: 0 0 32px;
    }
    .accounts li {
        padding: 20px;
        gap: 12px;
        min-width: 0;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        align-content: flex-start;
    }
    .accounts li > .p-button:first-child {
        width: 100%;
        justify-content: flex-start;
        text-align: left;
    }
    .accounts li > small {
        width: 100%;
        color: var(--app-muted);
        font-size: 12px;
    }
    .accounts li {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
    }
    .accounts .account-card-select {
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--app-text);
        box-shadow: none;
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 8px;
    }
    .account-card-identity {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px;
        min-width: 0;
    }
    .account-card-identity strong {
        font-size: 16px;
    }
    .account-card-identity > span {
        font-size: 12px;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .account-card-selection {
        font-size: 11px;
        white-space: nowrap;
        padding: 3px 6px;
        border-radius: 4px;
        background: var(--app-surface-muted);
    }
    .account-card-select[aria-pressed='true'] .account-card-selection {
        background: var(--app-accent-light);
        color: var(--app-accent);
    }
    .account-card-primary-tools {
        display: flex;
        gap: 8px;
        padding-top: 8px;
        margin-top: auto;
        flex-wrap: wrap;
    }
    .account-card-primary-tools :deep(.p-button) {
        flex: 1 1 100px;
        min-height: 36px;
        font-size: 12px;
    }
    .account-card-role {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 11px;
    }
    .account-card-role span {
        padding: 2px 6px;
        border-radius: 4px;
        background: var(--app-surface-muted);
    }
    .account-card-snapshot {
        margin: 0;
        padding: 12px;
        border-radius: 8px;
        background: var(--app-bg);
        display: grid;
        gap: 8px;
    }
    .account-card-snapshot > div {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
    }
    .account-card-snapshot dt {
        font-size: 12px;
        color: var(--app-muted);
        flex-shrink: 0;
    }
    .account-card-snapshot dd {
        margin: 0;
        font-size: 12px;
        text-align: right;
        overflow-wrap: anywhere;
    }
    @media (max-width: 1024px) {
        .accounts {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 640px) {
        .accounts {
            grid-template-columns: 1fr;
        }
        .accounts li {
            padding: 16px;
        }
    }
</style>
