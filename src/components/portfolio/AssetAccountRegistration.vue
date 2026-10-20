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
        accounts: { type: Array, required: true },
        busy: Boolean,
        error: { type: String, default: '' },
    });
    const emit = defineEmits(['submit', 'existing']);
    const method = ref('manual');
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
        { label: '직접 입력', value: 'manual' },
        { label: '문서로 등록', value: 'document' },
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
    <p>
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
        <p>토스 거래내역 PDF에서 계좌 정보를 확인합니다.</p>
        <label for="registration-pdf">토스 거래내역 PDF</label>
        <input
            id="registration-pdf"
            type="file"
            accept=".pdf,application/pdf"
            :disabled="busy || inspecting"
            @change="file = $event.target.files?.[0] || null" />
        <label for="registration-password">PDF 비밀번호</label>
        <InputText
            id="registration-password"
            v-model="password"
            type="password"
            autocomplete="off"
            :disabled="busy || inspecting" />
        <Button
            label="계좌 정보 추출"
            :loading="inspecting"
            :disabled="busy || inspecting || !file || !password"
            @click="inspect" />
        <Message v-if="inspectionError" severity="error" :closable="false">{{
            inspectionError
        }}</Message>
        <p v-if="identity">
            추출된 명의: {{ identity.customerName || '확인할 수 없음' }} ·
            {{ identity.maskedNumber || '끝 4자리 확인 필요' }}
        </p>
    </div>
    <form class="account-form" @submit.prevent="submit">
        <label for="registration-institution">금융기관</label>
        <InputText
            id="registration-institution"
            v-model="form.institution"
            required
            maxlength="100"
            :disabled="busy || inspecting" />
        <label for="registration-type">유형</label>
        <Select
            v-model="form.type"
            input-id="registration-type"
            :options="types"
            option-label="label"
            option-value="value"
            :disabled="busy || inspecting" />
        <label for="registration-alias">별칭</label>
        <InputText
            id="registration-alias"
            v-model="form.alias"
            required
            maxlength="100"
            :disabled="busy || inspecting" />
        <label for="registration-last4">계좌 끝 4자리 (선택)</label>
        <InputText
            id="registration-last4"
            v-model="form.last4"
            maxlength="4"
            pattern="[0-9]{4}"
            inputmode="numeric"
            autocomplete="off"
            :disabled="busy || inspecting" />
        <template v-if="method === 'document' && identity">
            <label
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
                :disabled="busy || !['owner', 'editor'].includes(account._role)"
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
</style>
