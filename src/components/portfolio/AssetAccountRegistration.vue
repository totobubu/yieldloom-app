<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Select from 'primevue/select';
    import SelectButton from 'primevue/selectbutton';
    import Message from 'primevue/message';
    import { familyRequest } from '@/services/familyPortfolio';
    const props = defineProps({
        memberName: { type: String, required: true },
        showMemberName: { type: Boolean, default: true },
        accounts: { type: Array, required: true },
        busy: Boolean,
        error: { type: String, default: '' },
    });
    const emit = defineEmits(['submit', 'existing']);
    const method = ref('document');
    const form = ref({
        institution: '',
        type: 'general',
        alias: '',
        last4: '',
    });
    const file = ref(null),
        password = ref(''),
        identity = ref(null),
        confirmed = ref(false),
        inspecting = ref(false),
        inspectionError = ref('');
    let generation = 0;
    const options = [
        { label: '문서로 등록', value: 'document' },
        { label: '직접 입력', value: 'manual' },
    ];
    const types = [
        { label: '일반', value: 'general' },
        { label: 'ISA', value: 'isa' },
        { label: '연금', value: 'pension' },
        { label: '기타', value: 'other' },
    ];
    const duplicates = computed(() =>
        form.value.last4.length === 4
            ? props.accounts.filter(
                  (a) =>
                      a.institution.trim() === form.value.institution.trim() &&
                      a.maskedNumber === `****${form.value.last4}`
              )
            : []
    );
    watch([file, password, method], () => {
        generation++;
        identity.value = null;
        confirmed.value = false;
        inspectionError.value = '';
        inspecting.value = false;
    });
    onScopeDispose(() => {
        generation++;
        password.value = '';
        file.value = null;
    });
    async function inspect() {
        if (inspecting.value || !file.value) return;
        if (file.value.size > 2 * 1024 * 1024) {
            inspectionError.value = '2MB 이하 PDF를 선택하세요.';
            return;
        }
        const current = ++generation;
        inspecting.value = true;
        inspectionError.value = '';
        try {
            const body = new FormData();
            body.append('file', file.value);
            body.append('password', password.value);
            const result = await familyRequest('inspectAccountDocument', body);
            if (generation !== current) return;
            identity.value = result;
            form.value.institution = result.institution;
            form.value.alias = result.institution;
            form.value.last4 = result.maskedNumber?.slice(-4) || '';
        } catch (reason) {
            if (generation === current) inspectionError.value = reason.message;
        } finally {
            if (generation === current) inspecting.value = false;
        }
    }
    function submit() {
        if (
            props.busy ||
            inspecting.value ||
            (method.value === 'document' &&
                (!identity.value || !confirmed.value))
        )
            return;
        emit(
            'submit',
            { ...form.value },
            method.value === 'document'
                ? { file: file.value, password: password.value }
                : null
        );
    }
</script>
<template>
    <section class="account-registration" aria-label="계좌 등록">
        <p v-if="showMemberName">
            명의자: <strong>{{ memberName }}</strong>
        </p>
        <SelectButton
            v-model="method"
            :options="options"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            :disabled="busy || inspecting"
            aria-label="계좌 등록 방법" />
        <div v-if="method === 'document'" class="document">
            <div class="document-upload">
                <span class="document-upload-icon" aria-hidden="true">📄</span>
                <label for="registration-pdf" class="document-file-info">{{
                    file
                        ? `${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB 선택됨)`
                        : '토스 거래내역 PDF 선택'
                }}</label>
                <p>최대 2MB 이하 토스증권 거래내역 PDF 원본만 지원합니다.</p>
                <input
                    id="registration-pdf"
                    type="file"
                    accept=".pdf,application/pdf"
                    aria-label="토스 거래내역 PDF"
                    :disabled="busy || inspecting"
                    @change="file = $event.target.files?.[0] || null" />
            </div>
            <div class="document-extract">
                <div class="registration-field">
                    <label for="registration-password"
                        >PDF 비밀번호<span
                            class="required-mark"
                            aria-hidden="true" /></label
                    >
                    <InputText
                        id="registration-password"
                        v-model="password"
                        type="password"
                        autocomplete="off"
                        :disabled="busy || inspecting" />
                </div>
                <Button
                    label="계좌 정보 추출"
                    :loading="inspecting"
                    :disabled="busy || inspecting || !file || !password"
                    @click="inspect" />
            </div>
            <Message
                v-if="inspectionError"
                severity="error"
                :closable="false"
                >{{ inspectionError }}</Message
            >
            <p v-if="identity" class="identified-summary">
                추출된 명의: {{ identity.customerName || '확인할 수 없음' }} ·
                {{ identity.maskedNumber || '끝 4자리 확인 필요' }}
            </p>
        </div>
        <form class="account-form" @submit.prevent="submit">
            <div class="registration-field">
                <label for="registration-institution"
                    >금융기관<span
                        class="required-mark"
                        aria-hidden="true" /></label
                >
                <InputText
                    id="registration-institution"
                    v-model="form.institution"
                    required
                    maxlength="100"
                    :disabled="busy || inspecting" />
            </div>
            <div class="registration-field">
                <label for="registration-type">유형</label>
                <Select
                    v-model="form.type"
                    input-id="registration-type"
                    :options="types"
                    option-label="label"
                    option-value="value"
                    :disabled="busy || inspecting" />
            </div>
            <div class="registration-field">
                <label for="registration-alias"
                    >별칭<span
                        class="required-mark"
                        aria-hidden="true" /></label
                >
                <InputText
                    id="registration-alias"
                    v-model="form.alias"
                    required
                    maxlength="100"
                    :disabled="busy || inspecting" />
            </div>
            <div class="registration-field">
                <label for="registration-last4">계좌 끝 4자리 (선택)</label>
                <InputText
                    id="registration-last4"
                    v-model="form.last4"
                    maxlength="4"
                    pattern="[0-9]{4}"
                    inputmode="numeric"
                    autocomplete="off"
                    :disabled="busy || inspecting" />
            </div>
            <template v-if="method === 'document' && identity">
                <label class="identity-confirmation"
                    ><input
                        v-model="confirmed"
                        type="checkbox"
                        :disabled="busy"
                        required />원본의 명의·계좌와 선택 가족을
                    확인했습니다.</label
                >
            </template>
            <Message v-if="duplicates.length" severity="warn" :closable="false">
                같은 기관·끝 4자리의 계좌가 있습니다. 같은 계좌인지 확인하세요.
                <Button
                    v-for="account in duplicates"
                    :key="account.id"
                    :label="`${account.alias}에 자료 업로드`"
                    :disabled="
                        busy || !['owner', 'editor'].includes(account._role)
                    "
                    @click="$emit('existing', account.id)" />
            </Message>
            <Message v-if="error" severity="error" :closable="false">{{
                error
            }}</Message>
            <Button
                type="submit"
                label="계좌 등록"
                :loading="busy"
                :disabled="
                    busy ||
                    inspecting ||
                    (method === 'document' && (!identity || !confirmed))
                " />
        </form>
    </section>
</template>
<style scoped>
    .account-form,
    .document {
        display: grid;
        gap: 0.75rem;
        margin-top: 1.25rem;
    }
    .account-form label:has(input) {
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
    }

    .account-registration {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 960px;
        margin: auto;
        min-width: 0;
        width: 100%;
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .account-registration > p {
        font-size: 14px;
        margin: 0;
        color: var(--app-muted);
    }
    .account-registration :deep(.p-selectbutton) {
        display: flex;
        gap: 8px;
    }
    .account-registration :deep(.p-togglebutton) {
        min-height: 44px;
        padding: 0 20px;
        border-radius: 8px;
        font-size: 14px;
    }
    .account-registration :deep(.p-togglebutton-checked),
    .account-registration
        :deep(.p-togglebutton-checked .p-togglebutton-content) {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .document {
        gap: 16px;
        margin: 0;
    }
    .document-upload {
        position: relative;
        display: grid;
        gap: 8px;
        padding: 24px;
        border: 2px dashed var(--app-border);
        border-radius: 10px;
        background: var(--app-bg);
        text-align: center;
    }
    .document-upload:focus-within {
        outline: 2px solid var(--app-accent);
        outline-offset: 2px;
    }
    .document-file-info {
        font-size: 15px;
        line-height: 22.5px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .document-upload p {
        margin: 0;
        color: var(--app-muted);
        font-size: 13px;
        line-height: 19.5px;
    }
    .document-upload-icon {
        justify-self: center;
        font-size: 28px;
        line-height: 42px;
    }
    .required-mark {
        margin-left: 2px;
        color: var(--p-red-500);
    }
    .required-mark::before {
        content: '*';
    }
    .document-extract {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: end;
        gap: 16px;
    }
    .document-extract :deep(.p-button),
    .account-form > .p-button {
        height: 44px;
        min-height: 44px;
        padding: 0 20px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
    }
    .identified-summary {
        padding: 14px 18px;
        border: 1px solid var(--app-accent);
        border-radius: 8px;
        background: var(--app-accent-light);
    }
    .identity-confirmation {
        padding: 14px 16px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        font-size: 14px;
        font-weight: 600;
    }
    .identity-confirmation input {
        accent-color: var(--app-accent);
        width: 18px;
        height: 18px;
    }
    .document > p {
        margin: 0;
        color: var(--app-muted);
        font-size: 13px;
    }
    .document input[type='file'] {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }
    .document input[type='file']:disabled {
        cursor: not-allowed;
    }
    .account-form {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
    }
    .registration-field {
        display: grid;
        gap: 6px;
        min-width: 0;
    }
    .registration-field label {
        font-size: 13px;
        line-height: 19.5px;
        font-weight: 600;
    }
    .registration-field :deep(.p-inputtext),
    .registration-field :deep(.p-select) {
        width: 100%;
        height: 44px;
        min-height: 44px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
    }
    .registration-field :deep(.p-inputtext) {
        padding: 0 14px;
    }
    .registration-field :deep(.p-select-label) {
        padding: 0 14px;
        line-height: 42px;
        font-size: 14px;
        font-weight: 500;
    }
    .account-form > :not(.registration-field) {
        grid-column: 1 / -1;
    }
    .account-form > .p-button {
        justify-self: end;
        min-width: 180px;
    }
    @media (max-width: 768px) {
        .account-form,
        .document-extract {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 640px) {
        .account-form {
            padding: 0;
        }
        .account-registration :deep(.p-selectbutton) {
            flex-direction: column;
        }
        .account-registration :deep(.p-togglebutton) {
            width: 100%;
        }
    }
</style>
