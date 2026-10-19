<script setup>
    import { computed, onScopeDispose, ref, watch } from 'vue';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import InputNumber from 'primevue/inputnumber';
    import Select from 'primevue/select';
    import Message from 'primevue/message';
    import { familyRequest } from '@/services/familyPortfolio.js';
    import {
        brokerHeaderSignature,
        loadBrokerPreset,
        saveBrokerPreset,
        deleteBrokerPreset,
    } from '@/services/brokerPresets.js';

    const props = defineProps({
        account: { type: Object, required: true },
        busy: Boolean,
    });
    const emit = defineEmits(['preview']);
    const kind = ref('holdings'),
        asOf = ref(''),
        broker = ref('other'),
        encoding = ref('utf-8-sig');
    const sheet = ref(''),
        headerRow = ref(1),
        confirmed = ref(false),
        file = ref(null),
        info = ref(null);
    const mapping = ref({}),
        error = ref(''),
        inspecting = ref(false);
    const defaultCurrency = ref('');
    const presetStatus = ref(''),
        mappingConfirmed = ref(false);
    const presetApplied = ref(false);
    const presetSheet = ref('');
    let pendingPreset = null;
    watch([broker, kind, () => props.account.id], () => {
        pendingPreset = null;
        presetSheet.value = '';
        presetStatus.value = '';
        info.value = null;
        mapping.value = {};
        generation++;
        inspecting.value = false;
        confirmed.value = false;
    });
    watch(
        [mapping, defaultCurrency],
        () => {
            mappingConfirmed.value = false;
        },
        { deep: true }
    );
    function loadPreset() {
        try {
            pendingPreset = loadBrokerPreset(
                localStorage,
                broker.value,
                kind.value
            );
            if (!pendingPreset) throw new Error('저장된 설정이 없습니다.');
            encoding.value = pendingPreset.encoding;
            headerRow.value = pendingPreset.headerRow;
            info.value = null;
            presetStatus.value =
                '인코딩·제목 행을 불러왔습니다. 워크시트를 선택한 뒤 파일 열을 확인하세요.';
        } catch (reason) {
            error.value = reason.message;
        }
    }
    async function savePreset() {
        const version = generation;
        try {
            if (!info.value || !mappingConfirmed.value)
                throw new Error('열 연결을 확인하세요.');
            const value = {
                encoding: encoding.value,
                headerRow: headerRow.value,
                defaultCurrency: defaultCurrency.value,
                columnCount: info.value.headers.length,
                sheetIndex: Math.max(
                    0,
                    info.value.sheets.indexOf(info.value.sheet)
                ),
                mapping: { ...mapping.value },
                headerSignature: await brokerHeaderSignature(
                    info.value.headers
                ),
            };
            if (version !== generation) return;
            saveBrokerPreset(localStorage, broker.value, kind.value, value);
            pendingPreset = value;
            presetStatus.value =
                '이 브라우저에 열 연결 설정을 저장했습니다. 파일·계좌·시트 이름은 저장하지 않습니다.';
        } catch (reason) {
            if (version === generation) error.value = reason.message;
        }
    }
    function deletePreset() {
        try {
            deleteBrokerPreset(localStorage, broker.value, kind.value);
            pendingPreset = null;
            presetStatus.value = '저장된 설정을 삭제했습니다.';
        } catch (reason) {
            error.value = reason.message;
        }
    }
    watch(
        [file, kind],
        () => {
            defaultCurrency.value = '';
            confirmed.value = false;
        },
        { flush: 'sync' }
    );
    let generation = 0;
    const brokers = [
        { label: '토스증권', value: 'toss' },
        { label: '키움증권', value: 'kiwoom' },
        { label: '한국투자증권', value: 'korea-investment' },
        { label: '미래에셋증권', value: 'miraeasset' },
        { label: '삼성증권', value: 'samsung' },
        { label: '기타', value: 'other' },
    ];
    const core = [
        ['symbol', '종목 코드'],
        ['quantity', '수량'],
        ['amount', '평가액/거래 금액'],
        ['currency', '통화'],
    ];
    const fields = computed(() => [
        ...(kind.value === 'transactions'
            ? [
                  ['date', '거래일'],
                  ['type', '거래 유형'],
                  ['externalId', '거래 고유번호'],
              ]
            : []),
        ...core,
        ...(kind.value === 'transactions'
            ? [
                  ['settlementAmount', '원화 정산액'],
                  ['nativeSettlementAmount', '달러 정산액'],
                  ['nativeAmount', '달러 거래 금액'],
                  ['nativeCommission', '달러 수수료'],
                  ['nativeTax', '달러 세금'],
                  ['exchangeRate', '환율'],
                  ['cashKind', '현금 분류'],
              ]
            : []),
    ]);
    const columns = computed(() => [
        { label: '연결 안 함', value: null },
        ...(info.value?.headers || []).map((name, value) => ({
            label: `${value + 1}열 · ${name || '제목 없음'}`,
            value,
        })),
    ]);
    watch(
        [file, sheet, headerRow, encoding, kind],
        () => {
            generation++;
            info.value = null;
            mapping.value = {};
            presetApplied.value = false;
            presetSheet.value = '';
            mappingConfirmed.value = false;
            error.value = '';
            inspecting.value = false;
        },
        { flush: 'sync' }
    );
    onScopeDispose(() => generation++);
    function form() {
        if (!file.value || !confirmed.value)
            throw new Error('파일과 선택 계좌의 명의·금융기관을 확인하세요.');
        if (file.value.size > 2 * 1024 * 1024)
            throw new Error('2MB 이하 파일을 선택하세요.');
        const result = new FormData();
        Object.entries({
            accountId: props.account.id,
            ownerId: props.account.ownerId,
            institution: props.account.institution,
            identityConfirmed: 'true',
            kind: kind.value,
            asOf: asOf.value,
            broker: broker.value,
            format: 'broker-spreadsheet',
            encoding: encoding.value,
            sheet: sheet.value,
            headerRow: String(headerRow.value),
            defaultCurrency: '',
        }).forEach(([key, value]) => result.append(key, value));
        result.append('file', file.value);
        return result;
    }
    async function inspect() {
        error.value = '';
        const version = generation;
        inspecting.value = true;
        try {
            const result = await familyRequest('inspectSpreadsheet', form());
            if (version !== generation) return;
            info.value = result;
            mapping.value = {};
            // Suggest exact standard headers only; broker layouts always require confirmation.
            for (const [key] of fields.value) {
                const index = result.headers.indexOf(key);
                if (index >= 0) mapping.value[key] = index;
            }
            if (pendingPreset) {
                if (
                    result.sheets.length &&
                    result.sheets[pendingPreset.sheetIndex] !== result.sheet
                ) {
                    presetSheet.value =
                        result.sheets[pendingPreset.sheetIndex] || '';
                    presetStatus.value = presetSheet.value
                        ? `저장된 설정은 ${pendingPreset.sheetIndex + 1}번째 시트입니다. 저장된 시트를 선택한 뒤 파일 열을 다시 확인하세요.`
                        : '저장된 순서의 시트가 없습니다. 워크시트와 열을 직접 확인하세요.';
                    return;
                }
                const signature = await brokerHeaderSignature(result.headers);
                if (version !== generation) return;
                if (
                    signature === pendingPreset.headerSignature &&
                    result.headers.length === pendingPreset.columnCount
                ) {
                    mapping.value = { ...pendingPreset.mapping };
                    presetApplied.value = true;
                    defaultCurrency.value = pendingPreset.defaultCurrency;
                    presetStatus.value =
                        '저장된 열 연결을 불러왔습니다. 파일의 실제 열과 통화를 다시 확인하세요.';
                } else {
                    presetStatus.value =
                        '저장된 양식과 파일의 열 구성이 다릅니다. 열을 다시 연결하세요.';
                }
            }
        } catch (reason) {
            if (version === generation) error.value = reason.message;
        } finally {
            if (version === generation) inspecting.value = false;
        }
    }
    function preview() {
        error.value = '';
        try {
            if (!info.value) throw new Error('파일의 열을 먼저 확인하세요.');
            if (presetApplied.value && !mappingConfirmed.value)
                throw new Error(
                    '불러온 열 연결과 통화를 확인한 뒤 확인란을 선택하세요.'
                );
            const data = form();
            data.set('defaultCurrency', defaultCurrency.value);
            data.set(
                'mapping',
                JSON.stringify(
                    Object.fromEntries(
                        Object.entries(mapping.value).filter(([, index]) =>
                            Number.isInteger(index)
                        )
                    )
                )
            );
            emit('preview', { form: data, kind: kind.value, asOf: asOf.value });
        } catch (reason) {
            error.value = reason.message;
        }
    }
</script>
<template>
    <section aria-label="증권사 CSV·XLSX 열 연결" class="broker-import">
        <h3>증권사 CSV·XLSX 가져오기</h3>
        <p>
            양식은 증권사·발급 시점마다 다릅니다. 증권사 이름만으로 자동
            인식하지 않으며, 열을 직접 확인해 표준 원장에 연결합니다.
            XLS·암호화·매크로·수식 파일은 지원하지 않습니다.
        </p>
        <p>
            거래는 발급 기간이 달라져도 같은 고유번호가 필요합니다. 종목명 대신
            정확한 종목 코드를 연결하세요. 통화는 자동 환산하지 않습니다. 잔고는
            기준일의 전체 목록이어야 합니다.
        </p>
        <form @submit.prevent="preview">
            <fieldset :disabled="busy || inspecting">
                <legend>파일과 계좌 확인</legend>
                <p>
                    이 브라우저의 증권사·자료 종류별 설정을 재사용할 수
                    있습니다. 공용 기기에서는 저장하지 마세요.
                </p>
                <Button
                    type="button"
                    label="열 연결 설정 불러오기"
                    severity="secondary"
                    @click="loadPreset" />
                <Button
                    type="button"
                    label="저장된 열 연결 삭제"
                    severity="secondary"
                    @click="deletePreset" />
                <p v-if="presetStatus" role="status">{{ presetStatus }}</p>
                <Button
                    v-if="presetSheet"
                    type="button"
                    label="저장된 시트 선택"
                    severity="secondary"
                    @click="sheet = presetSheet" />
                <label
                    >증권사<Select
                        v-model="broker"
                        :options="brokers"
                        option-label="label"
                        option-value="value"
                        aria-label="파일 증권사"
                /></label>
                <label
                    >자료 종류<Select
                        v-model="kind"
                        :options="[
                            { label: '전체 잔고', value: 'holdings' },
                            { label: '거래 내역', value: 'transactions' },
                        ]"
                        option-label="label"
                        option-value="value"
                        aria-label="연결 자료 종류"
                /></label>
                <label
                    >자료 기준일<InputText v-model="asOf" type="date" required
                /></label>
                <label
                    >CSV 또는 XLSX 파일<input
                        type="file"
                        accept=".csv,.xlsx"
                        required
                        @change="
                            file = $event.target.files?.[0] || null;
                            sheet = '';
                        "
                /></label>
                <label
                    >CSV 인코딩<Select
                        v-model="encoding"
                        :options="[
                            { label: 'UTF-8', value: 'utf-8-sig' },
                            { label: '한국어 CP949', value: 'cp949' },
                        ]"
                        option-label="label"
                        option-value="value"
                        aria-label="CSV 인코딩"
                /></label>
                <label
                    >제목 행<InputNumber
                        v-model="headerRow"
                        :min="1"
                        :max="20"
                        :max-fraction-digits="0"
                        input-id="broker-header-row"
                /></label>
                <label
                    >워크시트 (선택)<InputText
                        v-model="sheet"
                        placeholder="비우면 첫 번째 시트"
                /></label>
                <label
                    ><input v-model="confirmed" type="checkbox" required />
                    {{ account.institution }} · {{ account.alias }}의 명의와
                    계좌에 속하는 자료임을 확인했습니다.</label
                >
                <Button
                    type="button"
                    label="파일 열 확인"
                    :disabled="!confirmed || !file"
                    @click="inspect" />
                <template v-if="info">
                    <p>
                        {{ info.rowCount }}행 · 시트 {{ info.sheet || 'CSV' }} ·
                        사용 가능 시트 {{ info.sheets.join(', ') || 'CSV' }}
                    </p>
                    <label
                        >통화 열이 없을 때 기본 통화<Select
                            v-model="defaultCurrency"
                            :options="[
                                { label: '직접 연결', value: '' },
                                { label: 'USD로 확인', value: 'USD' },
                                { label: 'KRW로 확인', value: 'KRW' },
                            ]"
                            option-label="label"
                            option-value="value"
                            aria-label="기본 통화"
                    /></label>
                    <div class="mapping-fields">
                        <label v-for="[key, label] in fields" :key="key"
                            >{{ label
                            }}<Select
                                v-model="mapping[key]"
                                :options="columns"
                                option-label="label"
                                option-value="value"
                                :aria-label="`연결 ${label}`"
                        /></label>
                    </div>
                    <p>
                        매수·매도·배당(금)·배당취소·입금·출금·입고·출고·분할은
                        표준 유형으로 연결합니다. 다른 값·음수 금액은 다음 검토
                        화면에서 오류를 확인하고 수정하세요.
                    </p>
                    <Button type="submit" label="연결 자료 미리보기" />
                    <label
                        ><input v-model="mappingConfirmed" type="checkbox" />
                        파일의 열 연결과 기본 통화를 확인했습니다.</label
                    >
                    <Button
                        type="button"
                        label="열 연결 설정 저장"
                        severity="secondary"
                        :disabled="!mappingConfirmed"
                        @click="savePreset" />
                </template>
            </fieldset>
        </form>
        <p v-if="inspecting" role="status">파일의 열을 확인하고 있습니다.</p>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
    </section>
</template>
<style scoped>
    fieldset {
        min-width: 0;
        width: 100%;
        padding: 1rem;
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        margin-block: 0.75rem;
        min-width: 0;
    }
    label:has(input[type='checkbox']) {
        flex-direction: row;
    }
    .mapping-fields {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr));
        gap: 0.75rem;
    }
</style>
