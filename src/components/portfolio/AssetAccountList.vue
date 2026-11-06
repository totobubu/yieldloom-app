<script setup>
    import Button from 'primevue/button';
    import StitchSymbol from './StitchSymbol.vue';
    const props = defineProps({
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
    const accountRoleLabels = {
        owner: '소유자 (Owner)',
        editor: '편집자 (Editor)',
        viewer: '조회 전용 (Viewer)',
    };
    const accountRoleLabel = (role) =>
        typeof role === 'string' && Object.hasOwn(accountRoleLabels, role)
            ? accountRoleLabels[role]
            : '권한 미확인';
    const accountTypeLabels = {
        general: '일반',
        isa: 'ISA',
        pension: '연금',
        other: '기타',
    };
    const accountTypeLabel = (type) =>
        typeof type === 'string' && Object.hasOwn(accountTypeLabels, type)
            ? accountTypeLabels[type]
            : '유형 미확인';
    const canRename = (account) =>
        account.authorityUid === props.userId &&
        ['owner', 'editor'].includes(account.permissions?.[props.userId]);
    defineEmits(['select', 'upload', 'connect-toss', 'rename']);
</script>
<template>
    <p v-if="!accounts.length">
        등록된 계좌가 없습니다. 계좌 추가로 시작하세요.
    </p>
    <ul v-else class="accounts">
        <li v-for="account in accounts" :key="account.id">
            <div class="account-card-content">
                <Button
                    class="account-card-select"
                    :aria-label="`${ownerName(account.ownerId)} · ${account.institution} · ${account.alias} · ${account.maskedNumber} · ${accountRoleLabel(account.permissions?.[userId])} · ${accountTypeLabel(account.type)}`"
                    severity="secondary"
                    :outlined="selected !== account.id"
                    :disabled="busy"
                    :aria-pressed="selected === account.id"
                    @click="$emit('select', account.id)">
                    <span class="account-card-heading">
                        <span class="account-card-identity"
                            ><strong>{{ ownerName(account.ownerId) }}</strong
                            ><span
                                >{{ account.institution }}
                                {{ account.maskedNumber }}</span
                            ></span
                        >
                        <span class="account-card-role">
                            <span
                                class="account-role-label"
                                :data-role="
                                    account.permissions?.[userId] || 'unknown'
                                "
                                >{{
                                    accountRoleLabel(
                                        account.permissions?.[userId]
                                    )
                                }}</span
                            ><span>{{ accountTypeLabel(account.type) }}</span>
                        </span>
                    </span>
                    <span class="account-card-selection">{{
                        selected === account.id ? '선택됨' : '계좌 선택'
                    }}</span>
                </Button>
                <dl class="account-card-snapshot">
                    <div>
                        <dt>최신 자료</dt>
                        <dd>{{ account.snapshot?.source || '미확인' }}</dd>
                    </div>
                    <div>
                        <dt>기준 일자</dt>
                        <dd>
                            {{
                                account.snapshot?.asOf ||
                                account.asOf ||
                                '미확인'
                            }}
                        </dd>
                    </div>
                    <div>
                        <dt>보유 현황</dt>
                        <dd v-if="account.snapshot?.rows?.length">
                            <span
                                v-for="(
                                    row, index
                                ) in account.snapshot.rows.slice(0, 3)"
                                :key="`${row.symbol}:${row.currency}:${index}`"
                                >{{ row.symbol }} · {{ number(row.quantity) }} ·
                                {{ number(row.amount) }} {{ row.currency }}<br
                            /></span>
                            <span v-if="account.snapshot.rows.length > 3"
                                >외 {{ account.snapshot.rows.length - 3 }}개
                                항목 · 계좌 선택 후 전체 확인</span
                            >
                        </dd>
                        <dd v-else>보유 자료 미확인</dd>
                    </div>
                </dl>
                <small class="account-card-alias">{{ account.alias }}</small>
            </div>
            <div class="account-card-primary-tools">
                <Button
                    :label="canRename(account) ? '별칭 수정' : '별칭 수정 불가'"
                    :title="
                        account.permissions?.[userId] === 'viewer'
                            ? '조회 전용 계좌는 별칭을 변경할 수 없습니다.'
                            : account.authorityUid !== userId
                              ? '별칭 변경은 명의자 또는 보호자 권한이 필요합니다.'
                              : '선택 계좌의 별칭 입력란으로 이동'
                    "
                    severity="secondary"
                    :disabled="busy || !canRename(account)"
                    @click="$emit('rename', account.id)">
                    <template #icon
                        ><StitchSymbol
                            :name="canRename(account) ? 'edit_note' : 'lock'"
                    /></template>
                </Button>
                <Button
                    label="출처 원본 (미지원)"
                    severity="secondary"
                    text
                    disabled
                    title="원문 파일 열기는 미구현입니다. 저장된 출처·기준일은 위에서 확인할 수 있습니다.">
                    <template #icon
                        ><StitchSymbol name="description"
                    /></template>
                </Button>
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
        border: 0;
        box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
        border-radius: 12px;
        background: var(--app-surface);
        align-content: flex-start;
    }
    .accounts li > .p-button:first-child {
        width: 100%;
        justify-content: flex-start;
        text-align: left;
    }
    .account-card-alias {
        width: 100%;
        color: var(--app-muted);
        font-size: 12px;
        line-height: 16px;
    }
    .accounts li {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 20px;
        font-size: 14px;
        line-height: 20px;
    }
    .account-card-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: 0;
    }
    .accounts .account-card-select {
        width: 100%;
        text-align: left;
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
    .account-card-heading {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
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
        line-height: 24px;
        font-weight: 600;
    }
    .account-card-identity > span {
        font-size: 12px;
        line-height: 16px;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .account-card-selection {
        font:
            500 11px/14px 'JetBrains Mono',
            monospace;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        padding: 4px 8px;
        border-radius: 4px;
        background: var(--app-surface-muted);
    }
    .account-card-select[aria-pressed='true'] .account-card-selection {
        background: var(--app-accent-light);
        color: var(--app-accent);
    }
    .account-card-select[aria-pressed='true'] .account-card-selection::before {
        content: '';
        width: 6px;
        height: 6px;
        flex-shrink: 0;
        border-radius: 50%;
        background: currentColor;
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
        height: 36px;
        min-height: 36px;
        padding: 0 12px;
        border-radius: 8px;
        font-size: 12px;
        line-height: 16px;
    }
    .account-card-primary-tools > .p-button:first-child {
        flex: 1 1 0;
        min-width: 0;
    }
    .account-card-primary-tools > .p-button:last-child {
        flex: 0 1 auto;
        min-width: 0;
    }
    .account-card-primary-tools :deep(.stitch-symbol) {
        font-size: 16px;
    }
    .account-card-role {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: flex-start;
    }
    .account-card-role span {
        font-size: 12px;
        line-height: 16px;
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--app-surface-muted);
    }
    .account-card-role .account-role-label {
        font:
            600 11px/14px 'JetBrains Mono',
            monospace;
    }
    .account-role-label[data-role='owner'] {
        color: var(--p-primary-contrast-color, white);
        background: var(--app-accent);
    }
    .account-role-label[data-role='viewer'] {
        color: var(--app-muted);
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
        line-height: 16px;
        color: var(--app-muted);
        flex-shrink: 0;
    }
    .account-card-snapshot dd {
        margin: 0;
        font:
            500 11px/14px 'JetBrains Mono',
            monospace;
        text-align: right;
        overflow-wrap: anywhere;
    }
    .account-card-snapshot > div:last-child {
        padding-top: 4px;
    }
    .account-card-snapshot > div:last-child dd {
        font-size: 13px;
        line-height: 16px;
        font-weight: 600;
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
    }
</style>
