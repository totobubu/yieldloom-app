<script setup>
    import StitchSymbol from './StitchSymbol.vue';
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
    const uploadSettings = ref(null);
    function openUploadSettings() {
        const panel = uploadSettings.value;
        if (!panel) return;
        panel.open = true;
        panel.scrollIntoView({ block: 'center' });
        panel.querySelector('summary')?.focus();
    }
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
    const requiredFields = computed(() =>
        kind.value === 'transactions'
            ? ['date', 'symbol', 'type', 'externalId']
            : ['symbol', 'quantity']
    );
    const basicKeys = [
        'date',
        'symbol',
        'type',
        'externalId',
        'quantity',
        'amount',
        'currency',
    ];
    const basicFields = computed(() =>
        basicKeys.flatMap((key) =>
            fields.value.filter((field) => field[0] === key)
        )
    );
    const detailFields = computed(() =>
        fields.value.filter(([key]) => !basicKeys.includes(key))
    );
    const requiredConnected = computed(
        () =>
            requiredFields.value.filter((key) =>
                Number.isInteger(mapping.value[key])
            ).length
    );
    const hasCurrency = computed(
        () =>
            Number.isInteger(mapping.value.currency) ||
            ['USD', 'KRW'].includes(defaultCurrency.value)
    );
    const duplicateKeys = computed(() => {
        const entries = Object.entries(mapping.value).filter(([, index]) =>
            Number.isInteger(index)
        );
        return new Set(
            entries
                .filter(
                    ([, index]) =>
                        entries.filter(([, other]) => other === index).length >
                        1
                )
                .map(([key]) => key)
        );
    });
    const mappingReady = computed(
        () =>
            requiredConnected.value === requiredFields.value.length &&
            hasCurrency.value &&
            !duplicateKeys.value.size
    );
    const rawPreviewNotes = computed(() =>
        (info.value?.previewRows || []).slice(0, 3).map((row, index) => ({
            row: index + 1,
            date: Number.isInteger(mapping.value.date)
                ? (row[mapping.value.date] ?? '')
                : null,
            amount: Number.isInteger(mapping.value.amount)
                ? (row[mapping.value.amount] ?? '')
                : null,
            currency: Number.isInteger(mapping.value.currency)
                ? (row[mapping.value.currency] ?? '')
                : null,
        }))
    );
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
        <header class="broker-heading">
            <div>
                <p class="broker-eyebrow">
                    <i class="pi pi-sync" aria-hidden="true" />데이터 가져오기
                    및 동기화
                </p>
                <h3>증권사 파일 열 연결 (컬럼 매핑)</h3>
                <p>
                    업로드된 증권사
                    {{ kind === 'transactions' ? '거래내역' : '잔고' }} 파일의
                    열을 표준 항목에 연결합니다. 필수 항목이 모두 연결되면 검토
                    단계로 진행할 수 있습니다.
                </p>
            </div>
            <ol class="broker-steps" aria-label="가져오기 진행 단계">
                <li class="broker-step">
                    <b class="completed"
                        ><i class="pi pi-check" aria-hidden="true" /></b
                    ><span
                        ><small>Step 1</small
                        ><span class="broker-step-prefix">1. </span>파일
                        업로드</span
                    >
                </li>
                <li class="broker-step-separator" aria-hidden="true" />
                <li class="broker-step" aria-current="step">
                    <b>2</b
                    ><span
                        ><small>진행중</small
                        ><span class="broker-step-prefix">2. </span>열
                        연결·검토</span
                    ><em class="broker-progress-badge">진행중</em>
                </li>
                <li class="broker-step-separator" aria-hidden="true" />
                <li class="broker-step">
                    <b>3</b
                    ><span
                        ><small>대기</small
                        ><span class="broker-step-prefix">3. </span>저장
                        결과</span
                    >
                </li>
            </ol>
        </header>
        <form @submit.prevent="preview">
            <fieldset :disabled="busy || inspecting">
                <legend class="broker-sr-only">파일과 계좌 확인</legend>
                <section class="broker-file-card">
                    <div class="broker-file-toolbar">
                        <div class="broker-file-meta">
                            <button
                                type="button"
                                class="broker-file-settings"
                                aria-label="파일·계좌 확인 및 업로드 설정 열기"
                                title="파일·계좌 확인 및 업로드 설정"
                                :disabled="busy || inspecting"
                                @click="openUploadSettings">
                                <StitchSymbol name="description" />
                            </button>
                            <div>
                                <div class="broker-file-name">
                                    <strong>{{
                                        file?.name || 'CSV·XLSX 파일 선택'
                                    }}</strong
                                    ><span class="broker-file-badge">{{
                                        account.institution
                                    }}</span>
                                </div>
                                <small
                                    ><span
                                        v-if="info"
                                        class="broker-tablet-account"
                                        >{{ account.alias }} · </span
                                    ><template v-if="info"
                                        >총 {{ info.rowCount }}행 데이터
                                        감지됨</template
                                    ><template v-else
                                        >{{ account.institution }} ·
                                        {{ account.alias }}</template
                                    ></small
                                >
                            </div>
                        </div>
                        <div class="broker-preset-actions">
                            <div v-if="info" class="broker-account-context">
                                <span>계좌:</span
                                ><code>{{ account.alias }}</code
                                ><span :class="{ verified: confirmed }"
                                    ><i
                                        :class="
                                            confirmed
                                                ? 'pi pi-check-square'
                                                : 'pi pi-exclamation-circle'
                                        "
                                        aria-hidden="true" />{{
                                        confirmed
                                            ? '계좌 및 소유자 확인'
                                            : '계좌 및 소유자 확인 필요'
                                    }}</span
                                >
                            </div>
                            <Button
                                type="button"
                                label="열 연결 설정 불러오기"
                                icon="pi pi-refresh"
                                severity="secondary"
                                outlined
                                @click="loadPreset" />
                            <Button
                                type="button"
                                label="열 연결 설정 저장"
                                icon="pi pi-bookmark"
                                severity="secondary"
                                outlined
                                :disabled="!info || !mappingConfirmed"
                                @click="savePreset" />
                        </div>
                    </div>
                    <div class="broker-file-options">
                        <label
                            >CSV 인코딩<Select
                                v-model="encoding"
                                :disabled="busy || inspecting"
                                :options="[
                                    { label: 'UTF-8', value: 'utf-8-sig' },
                                    { label: '한국어 CP949', value: 'cp949' },
                                ]"
                                option-label="label"
                                option-value="value"
                                aria-label="CSV 인코딩"
                        /></label>
                        <label
                            >헤더 시작 행 (1–20행)<InputNumber
                                v-model="headerRow"
                                :min="1"
                                :max="20"
                                :max-fraction-digits="0"
                                input-id="broker-header-row"
                        /></label>
                        <div class="broker-kind-control">
                            <span>데이터 종류</span>
                            <div
                                class="broker-kind-toggle"
                                role="radiogroup"
                                aria-label="연결 자료 종류">
                                <label
                                    v-for="option in [
                                        {
                                            label: '거래 내역',
                                            value: 'transactions',
                                        },
                                        {
                                            label: '전체 잔고',
                                            value: 'holdings',
                                        },
                                    ]"
                                    :key="option.value"
                                    :class="{
                                        selected: kind === option.value,
                                    }">
                                    <input
                                        v-model="kind"
                                        type="radio"
                                        name="broker-data-kind"
                                        :value="option.value" /><span>{{
                                        option.label
                                    }}</span>
                                </label>
                            </div>
                        </div>
                        <p
                            v-if="
                                file &&
                                !file.name.toLowerCase().endsWith('.xlsx')
                            "
                            class="broker-file-note">
                            ※ CSV 파일은 시트 선택을 지원하지 않습니다.
                        </p>
                        <p v-if="info?.sheets.length" class="broker-file-note">
                            시트 {{ info.sheet }} · 사용 가능 시트
                            {{ info.sheets.join(', ') }}
                        </p>
                    </div>
                </section>
                <div
                    v-if="presetStatus.includes('열 구성이 다릅니다')"
                    class="broker-mismatch"
                    role="status">
                    <i class="pi pi-exclamation-triangle" aria-hidden="true" />
                    <div>
                        <strong>헤더 지문 불일치 안내</strong>
                        <p>
                            기존 저장된 설정과 업로드된 파일의 헤더 구조가
                            일치하지 않아 저장된 열 연결을 적용하지 않았습니다.
                            각 항목의 열 연결을 직접 확인해 주세요.
                        </p>
                        <p>
                            이 브라우저에 열 위치 설정만 저장하며 파일·계좌·시트
                            이름은 저장하지 않습니다.
                        </p>
                    </div>
                </div>
                <Message
                    v-else-if="presetStatus"
                    severity="info"
                    :closable="false"
                    class="broker-preset-status"
                    ><p>{{ presetStatus }}</p>
                    <p>
                        이 브라우저에 열 위치 설정만 저장하며 파일·계좌·시트
                        이름은 저장하지 않습니다.
                    </p></Message
                >
                <template v-if="info">
                    <div class="broker-mapping-workspace">
                        <section class="broker-mapping-card">
                            <header class="broker-card-heading">
                                <div>
                                    <h4>
                                        <span class="broker-mapping-title-main"
                                            >표준 항목 열 연결</span
                                        ><span
                                            class="broker-mapping-title-tablet"
                                            >표준 항목 열 매핑 ({{
                                                fields.length
                                            }}개 규격)</span
                                        >
                                    </h4>
                                    <p>
                                        원장 저장이 아닌 표준 항목 연결
                                        단계입니다.
                                    </p>
                                </div>
                                <span
                                    class="broker-state"
                                    :class="{ ready: mappingReady }"
                                    >필수 {{ requiredConnected }}/{{
                                        requiredFields.length
                                    }}
                                    연결<template
                                        v-if="
                                            kind === 'transactions' &&
                                            !Number.isInteger(mapping.type)
                                        ">
                                        · 거래 유형 확인 필요</template
                                    ><template v-if="duplicateKeys.size">
                                        · 중복 연결 확인 필요</template
                                    ><template v-if="!hasCurrency">
                                        · 통화 확인 필요</template
                                    ></span
                                >
                            </header>
                            <p class="broker-mapping-guide">
                                동일한 원본 열을 두 개 이상의 항목에 중복 매핑할
                                수 없습니다. 필수 항목
                                {{ requiredFields.length }}개를 모두 지정해야
                                데이터 검토 단계로 이동할 수 있습니다.
                            </p>
                            <div class="broker-basic-fields">
                                <div
                                    v-for="([key, label], index) in basicFields"
                                    :key="key"
                                    class="broker-mapping-row"
                                    :class="{
                                        'needs-mapping':
                                            duplicateKeys.has(key) ||
                                            (requiredFields.includes(key) &&
                                                !Number.isInteger(
                                                    mapping[key]
                                                )),
                                    }">
                                    <div class="broker-mapping-label">
                                        <label :for="`broker-map-${key}`"
                                            ><span class="broker-field-index"
                                                >{{ index + 1 }}. </span
                                            >{{ label }}
                                            <small
                                                v-if="
                                                    requiredFields.includes(key)
                                                "
                                                >*필수</small
                                            ><small
                                                v-else-if="key === 'currency'"
                                                >[필수 설정]</small
                                            ><small v-else>(선택)</small>
                                            <code>{{ key }}</code></label
                                        ><span
                                            class="broker-field-state"
                                            :class="{
                                                mapped:
                                                    !duplicateKeys.has(key) &&
                                                    (Number.isInteger(
                                                        mapping[key]
                                                    ) ||
                                                        (key === 'currency' &&
                                                            hasCurrency)),
                                                invalid:
                                                    duplicateKeys.has(key) ||
                                                    (requiredFields.includes(
                                                        key
                                                    ) &&
                                                        !Number.isInteger(
                                                            mapping[key]
                                                        )),
                                            }"
                                            ><i
                                                v-if="
                                                    requiredFields.includes(
                                                        key
                                                    ) ||
                                                    Number.isInteger(
                                                        mapping[key]
                                                    ) ||
                                                    (key === 'currency' &&
                                                        hasCurrency)
                                                "
                                                :class="
                                                    !duplicateKeys.has(key) &&
                                                    (Number.isInteger(
                                                        mapping[key]
                                                    ) ||
                                                        (key === 'currency' &&
                                                            hasCurrency))
                                                        ? 'pi pi-check-circle'
                                                        : 'pi pi-exclamation-triangle'
                                                "
                                                aria-hidden="true" />{{
                                                duplicateKeys.has(key)
                                                    ? '중복 연결'
                                                    : Number.isInteger(
                                                            mapping[key]
                                                        ) ||
                                                        (key === 'currency' &&
                                                            hasCurrency)
                                                      ? '매핑 완료'
                                                      : requiredFields.includes(
                                                              key
                                                          )
                                                        ? '선택 필요'
                                                        : '미지정'
                                            }}</span
                                        >
                                    </div>
                                    <Select
                                        v-model="mapping[key]"
                                        :disabled="busy || inspecting"
                                        :options="columns"
                                        option-label="label"
                                        option-value="value"
                                        :input-id="`broker-map-${key}`"
                                        :aria-label="`연결 ${label}`"
                                        :invalid="
                                            duplicateKeys.has(key) ||
                                            (requiredFields.includes(key) &&
                                                !Number.isInteger(mapping[key]))
                                        "
                                        placeholder="-- [열을 선택하세요 (미지정)] --" />
                                    <p
                                        v-if="
                                            key === 'type' &&
                                            !Number.isInteger(mapping[key])
                                        "
                                        class="broker-field-note broker-required-note">
                                        <i
                                            class="pi pi-info-circle"
                                            aria-hidden="true" />거래구분(매수/매도/배당/입출금
                                        등) 식별 열을 반드시 지정하세요.
                                    </p>
                                    <p
                                        v-if="
                                            key === 'quantity' &&
                                            kind === 'transactions'
                                        "
                                        class="broker-field-note">
                                        거래행은 수량 또는 거래 금액 중 최소
                                        하나가 필요합니다.
                                    </p>
                                    <div
                                        v-if="key === 'currency'"
                                        class="broker-currency-choice">
                                        <div
                                            class="broker-currency-toggle"
                                            role="radiogroup"
                                            aria-label="기본 통화">
                                            <label
                                                v-for="option in [
                                                    {
                                                        label: '파일 내 통화 열 사용',
                                                        value: '',
                                                    },
                                                    {
                                                        label: 'USD로 확인',
                                                        value: 'USD',
                                                    },
                                                    {
                                                        label: 'KRW로 확인',
                                                        value: 'KRW',
                                                    },
                                                ]"
                                                :key="option.value"
                                                :class="{
                                                    selected:
                                                        defaultCurrency ===
                                                        option.value,
                                                }">
                                                <input
                                                    v-model="defaultCurrency"
                                                    type="radio"
                                                    name="broker-default-currency"
                                                    :value="
                                                        option.value
                                                    " /><span>{{
                                                    option.label
                                                }}</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <details
                                v-if="detailFields.length"
                                class="broker-detail-fields">
                                <summary>
                                    <i
                                        class="pi pi-sliders-h"
                                        aria-hidden="true" />상세 항목 매핑 ({{
                                        detailFields.length
                                    }}개 선택 항목)
                                </summary>
                                <div class="broker-optional-grid">
                                    <div
                                        v-for="[key, label] in detailFields"
                                        :key="key"
                                        class="broker-optional-row">
                                        <label :for="`broker-map-${key}`"
                                            >{{ label
                                            }}<code>{{ key }}</code></label
                                        ><Select
                                            v-model="mapping[key]"
                                            :disabled="busy || inspecting"
                                            :options="columns"
                                            option-label="label"
                                            option-value="value"
                                            :input-id="`broker-map-${key}`"
                                            :aria-label="`연결 ${label}`"
                                            :invalid="duplicateKeys.has(key)" />
                                    </div>
                                </div>
                            </details>
                        </section>
                        <aside class="broker-mapping-aside">
                            <section class="broker-preview-card">
                                <header class="broker-card-heading">
                                    <div>
                                        <h4>
                                            <i
                                                class="pi pi-table"
                                                aria-hidden="true" />원본 파일
                                            미리보기 (상위 3행)
                                        </h4>
                                        <p>
                                            원본 파일 확인용이며 실제 원장
                                            반영(저장)이 아닙니다.
                                        </p>
                                    </div>
                                    <span>총 {{ info.rowCount }}행</span>
                                </header>
                                <p
                                    v-if="info.previewRows?.length"
                                    class="broker-preview-scroll">
                                    <span>좌우 스크롤 ↔</span>
                                </p>
                                <div
                                    v-if="Array.isArray(info.previewRows)"
                                    class="broker-raw-preview"
                                    tabindex="0"
                                    role="region"
                                    aria-label="원본 파일 상위 3행, 가로 스크롤 가능">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th
                                                    v-for="(
                                                        name, index
                                                    ) in info.headers"
                                                    :key="index"
                                                    scope="col">
                                                    {{
                                                        name || `${index + 1}열`
                                                    }}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <tr
                                                v-for="(
                                                    row, index
                                                ) in info.previewRows"
                                                :key="index">
                                                <td
                                                    v-for="(
                                                        _, column
                                                    ) in info.headers"
                                                    :key="column">
                                                    {{ row[column] ?? '' }}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <p v-else class="broker-mapping-guide">
                                    이 응답에는 원본 미리보기 자료가 없습니다.
                                    예시 값으로 대체하지 않습니다.
                                </p>
                                <div
                                    v-if="rawPreviewNotes.length"
                                    class="broker-preview-notes">
                                    <p>
                                        선택한 열의 원문 · 미확정 (세전·세후
                                        미판정)
                                    </p>
                                    <ul>
                                        <li
                                            v-for="note in rawPreviewNotes"
                                            :key="note.row">
                                            <strong
                                                >{{ note.row }}행<template
                                                    v-if="note.date !== null">
                                                    ({{
                                                        note.date === ''
                                                            ? '빈 값'
                                                            : note.date
                                                    }})</template
                                                >:</strong
                                            >
                                            amount
                                            {{
                                                note.amount === null
                                                    ? '열 미지정'
                                                    : note.amount === ''
                                                      ? '빈 값'
                                                      : note.amount
                                            }}
                                            · currency
                                            {{
                                                note.currency === null
                                                    ? '열 미지정'
                                                    : note.currency === ''
                                                      ? '빈 값'
                                                      : note.currency
                                            }}
                                        </li>
                                    </ul>
                                </div>
                            </section>
                            <section class="broker-confirm-card">
                                <header class="broker-card-heading">
                                    <h4>확인 및 다음 단계</h4>
                                    <span
                                        class="broker-state"
                                        :class="{ ready: mappingReady }"
                                        >{{
                                            mappingReady
                                                ? '필수 연결 확인'
                                                : kind === 'transactions' &&
                                                    !Number.isInteger(
                                                        mapping.type
                                                    )
                                                  ? '미완료 (거래 유형 미지정)'
                                                  : '연결 미완료'
                                        }}</span
                                    >
                                </header>
                                <label class="broker-check"
                                    ><input
                                        v-model="mappingConfirmed"
                                        type="checkbox"
                                        :disabled="!mappingReady" />파일의 열
                                    연결과 기본 통화를 확인했습니다.</label
                                >
                                <Message
                                    v-if="duplicateKeys.size"
                                    severity="error"
                                    :closable="false"
                                    >같은 열을 여러 항목에 연결할 수 없습니다.
                                    중복 연결을 해제하세요.</Message
                                >
                                <Message
                                    v-else-if="!mappingReady"
                                    severity="warn"
                                    :closable="false"
                                    >필수 열과 통화 설정을 확인해야 미리보기가
                                    활성화됩니다.</Message
                                >
                                <Message
                                    v-else-if="
                                        presetApplied && !mappingConfirmed
                                    "
                                    severity="warn"
                                    :closable="false"
                                    >불러온 열 연결과 통화를 확인한 뒤 확인란을
                                    선택하세요.</Message
                                >
                                <Button
                                    type="submit"
                                    label="연결 자료 미리보기"
                                    icon="pi pi-arrow-right"
                                    icon-pos="right"
                                    :disabled="
                                        !mappingReady ||
                                        (presetApplied && !mappingConfirmed)
                                    " />
                                <Button
                                    type="button"
                                    label="열 연결 설정 저장"
                                    severity="secondary"
                                    outlined
                                    :disabled="
                                        !mappingReady || !mappingConfirmed
                                    "
                                    @click="savePreset" />
                                <p>
                                    저장된 설정을 적용했다면 열과 통화를 다시
                                    확인해야 합니다. 공용 기기에서는 설정을
                                    저장하지 마세요.
                                </p>
                            </section>
                        </aside>
                    </div>
                </template>
                <details
                    ref="uploadSettings"
                    class="broker-upload-settings"
                    :open="!info">
                    <summary>파일·계좌 확인 및 업로드 설정</summary>
                    <div class="broker-settings-grid">
                        <label
                            >증권사<Select
                                v-model="broker"
                                :disabled="busy || inspecting"
                                :options="brokers"
                                option-label="label"
                                option-value="value"
                                aria-label="파일 증권사"
                        /></label>
                        <label
                            >{{
                                kind === 'transactions'
                                    ? '조회 종료일'
                                    : '잔고 기준일'
                            }}<InputText v-model="asOf" type="date" required
                        /></label>
                        <label class="broker-source-file"
                            >CSV 또는 XLSX 파일<input
                                type="file"
                                accept=".csv,.xlsx"
                                required
                                @change="
                                    file = $event.target.files?.[0] || null;
                                    sheet = '';
                                "
                        /></label>
                        <label v-if="file?.name.toLowerCase().endsWith('.xlsx')"
                            >워크시트 (선택)<InputText
                                v-model="sheet"
                                placeholder="비우면 첫 번째 시트"
                        /></label>
                    </div>
                    <label class="broker-check"
                        ><input
                            v-model="confirmed"
                            type="checkbox"
                            required />{{ account.institution }} ·
                        {{ account.alias }}의 명의와 계좌에 속하는 자료임을
                        확인했습니다.</label
                    >
                    <div class="broker-setup-actions">
                        <Button
                            type="button"
                            label="파일 열 확인"
                            icon="pi pi-search"
                            :disabled="!confirmed || !file"
                            @click="inspect" />
                        <Button
                            type="button"
                            label="저장된 열 연결 삭제"
                            severity="secondary"
                            text
                            @click="deletePreset" />
                        <Button
                            v-if="presetSheet"
                            type="button"
                            label="저장된 시트 선택"
                            severity="secondary"
                            outlined
                            @click="sheet = presetSheet" />
                    </div>
                </details>
            </fieldset>
        </form>
        <details class="broker-format-help">
            <summary>파일 형식·거래 식별 안내</summary>
            <p>
                양식은 증권사·발급 시점마다 다릅니다. 증권사 이름만으로 자동
                인식하지 않으며, 열을 직접 확인해 표준 원장에 연결합니다.
                XLS·암호화·매크로·수식 파일은 지원하지 않습니다.
            </p>
            <p>
                거래는 발급 기간이 달라져도 같은 고유번호가 필요합니다. 종목명
                대신 정확한 종목 코드를 연결하세요. 통화는 자동 환산하지
                않습니다. 잔고는 기준일의 전체 목록이어야 합니다.
            </p>
            <p>
                매수·매도·배당(금)·배당취소·입금·출금·입고·출고·분할은 표준
                유형으로 연결합니다. 다른 값·음수 금액은 다음 검토 화면에서
                오류를 확인하고 수정하세요.
            </p>
        </details>
        <p v-if="inspecting" role="status">파일의 열을 확인하고 있습니다.</p>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
    </section>
</template>
<style scoped>
    @font-face {
        font-family: Inter;
        font-style: normal;
        font-weight: 100 900;
        font-display: swap;
        src: url('../../assets/fonts/Inter-latin-variable.woff2')
            format('woff2');
        unicode-range:
            U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02DA, U+02DC,
            U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
            U+2212, U+2215, U+FEFF, U+FFFD;
    }
    .broker-import {
        color: var(--app-text);
        font-family:
            Inter,
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            sans-serif;
        min-width: 0;
    }
    .broker-heading {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
        margin-bottom: 24px;
    }
    .broker-eyebrow {
        font-size: 12px !important;
        font-weight: 600;
        color: var(--app-muted);
        margin: 0 0 8px !important;
    }
    .broker-heading h3 {
        font-size: 28px;
        line-height: 32px;
        letter-spacing: -0.02em;
        font-weight: 700;
        color: var(--app-brand-brown);
        margin: 0 0 8px;
    }
    .broker-heading p {
        font-size: 14px;
        line-height: 22px;
        margin: 0;
        max-width: 768px;
    }
    .broker-steps {
        list-style: none;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        margin: 0;
        align-self: flex-start;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        font-size: 12px;
    }
    .broker-steps li {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--app-muted);
        white-space: nowrap;
    }
    .broker-steps li[aria-current] {
        color: var(--app-accent);
        font-weight: 700;
    }
    .broker-steps b {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: var(--app-surface-muted);
    }
    .broker-steps li[aria-current] b {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    fieldset {
        border: 0;
        min-width: 0;
        width: 100%;
        padding: 0;
        margin: 0;
    }
    .broker-sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }
    .broker-file-card,
    .broker-mapping-card,
    .broker-preview-card,
    .broker-confirm-card {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        box-shadow: 0 1px 3px #0f172a05;
        min-width: 0;
    }
    .broker-file-card {
        padding: 16px;
        margin-bottom: 24px;
    }
    .broker-file-toolbar,
    .broker-preset-actions,
    .broker-setup-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .broker-file-toolbar {
        justify-content: space-between;
        gap: 16px;
    }
    .broker-file-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
    }
    .broker-file-meta > i {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
        border-radius: 8px;
        background: var(--app-accent-light);
        color: var(--app-accent);
        font-size: 22px;
    }
    .broker-file-meta > div {
        min-width: 0;
    }
    .broker-file-meta strong {
        display: block;
        font-size: 14px;
        overflow-wrap: anywhere;
    }
    .broker-file-meta small {
        display: block;
        font-size: 12px;
        color: var(--app-muted);
        margin-top: 2px;
        overflow-wrap: anywhere;
    }
    .broker-file-options,
    .broker-settings-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px solid var(--app-border-subtle);
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        font-weight: 500;
        min-width: 0;
        margin: 0;
    }
    label :deep(.p-select),
    label :deep(.p-inputnumber),
    label :deep(.p-inputtext) {
        width: 100%;
        min-width: 0;
    }
    .broker-upload-settings {
        margin-top: 16px;
    }
    summary {
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        padding: 8px 0;
        color: var(--app-muted);
    }
    .broker-source-file {
        grid-column: span 2;
    }
    .broker-source-file input {
        width: 100%;
        min-width: 0;
        font-size: 12px;
        padding: 10px;
        border: 1px dashed var(--app-border);
        border-radius: 8px;
    }
    .broker-check {
        flex-direction: row;
        align-items: flex-start;
        gap: 8px;
        margin: 16px 0;
        line-height: 20px;
    }
    .broker-check input {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin: 2px 0 0;
        accent-color: var(--app-accent);
    }
    .broker-file-note {
        font-size: 11px;
        color: var(--app-muted);
        margin: 12px 0 0;
    }
    .broker-preset-status {
        margin: 0 0 24px;
    }
    .broker-preset-status p {
        margin: 6px 0 0;
    }
    .broker-mapping-workspace {
        display: grid;
        grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
        gap: 24px;
        align-items: start;
    }
    .broker-card-heading {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        flex-wrap: wrap;
    }
    .broker-mapping-card > .broker-card-heading {
        padding: 20px;
        border-bottom: 1px solid var(--app-border-subtle);
    }
    .broker-card-heading h4 {
        font-size: 18px;
        line-height: 27px;
        font-weight: 700;
        margin: 0;
        color: var(--app-brand-brown);
    }
    .broker-card-heading h4 i {
        color: var(--app-accent);
        margin-right: 8px;
        font-size: 18px;
    }
    .broker-card-heading p {
        font-size: 12px;
        line-height: 18px;
        color: var(--app-muted);
        margin: 6px 0 0;
    }
    .broker-card-heading > span:not(.broker-state) {
        font-size: 11px;
        color: var(--app-muted);
        white-space: nowrap;
    }
    .broker-state,
    .broker-field-state {
        border: 1px solid var(--app-warning);
        border-radius: 999px;
        background: var(--app-warning-light);
        color: var(--app-warning-text);
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 600;
        line-height: 18px;
    }
    .broker-state.ready,
    .broker-field-state.mapped {
        background: var(--app-accent-light);
        border-color: var(--app-border);
        color: var(--app-accent);
    }
    .broker-mapping-guide {
        padding: 12px;
        margin: 16px 20px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        font-size: 12px;
        line-height: 18px;
        color: var(--app-muted);
    }
    .broker-basic-fields {
        display: grid;
        gap: 16px;
        padding: 4px 20px 20px;
    }
    .broker-mapping-row {
        padding: 14px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        min-width: 0;
    }
    .broker-mapping-row.needs-mapping {
        border-color: color-mix(in srgb, var(--app-up), transparent 70%);
        background: color-mix(in srgb, var(--app-up), transparent 97%);
    }
    .broker-mapping-label {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
    }
    .broker-mapping-label > label {
        display: block;
        font-size: 14px;
        font-weight: 600;
    }
    .broker-mapping-label small {
        font-size: 11px;
        color: var(--app-muted);
    }
    .broker-mapping-label small:first-of-type {
        color: var(--app-up);
    }
    code {
        font-size: 11px;
        font-weight: 400;
        color: var(--app-muted);
        margin-left: 6px;
    }
    .broker-field-state {
        font-size: 11px;
        padding: 2px 8px;
        flex-shrink: 0;
    }
    .broker-mapping-row > :deep(.p-select) {
        width: 100%;
        height: 44px;
    }
    .broker-field-note {
        font-size: 11px;
        line-height: 17px;
        color: var(--app-muted);
        margin: 6px 0 0;
    }
    .broker-currency-choice {
        margin-top: 10px;
        padding: 10px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
    }
    .broker-detail-fields {
        margin: 0 20px 20px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 0 14px;
    }
    .broker-detail-fields summary {
        padding: 14px 0;
        display: flex;
        gap: 8px;
        align-items: center;
    }
    .broker-optional-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
        gap: 12px;
        align-items: center;
        padding: 8px 0;
    }
    .broker-optional-row label {
        font-size: 12px;
    }
    .broker-optional-row code {
        margin: 0;
    }
    .broker-mapping-aside {
        display: grid;
        gap: 24px;
        min-width: 0;
    }
    .broker-preview-card,
    .broker-confirm-card {
        padding: 20px;
    }
    .broker-raw-preview {
        overflow: auto;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        margin-top: 14px;
        max-height: 320px;
    }
    .broker-raw-preview table {
        border-collapse: collapse;
        min-width: 100%;
        font-size: 12px;
        text-align: left;
        white-space: nowrap;
    }
    .broker-raw-preview th {
        background: var(--app-bg);
        font-weight: 600;
    }
    .broker-raw-preview th,
    .broker-raw-preview td {
        padding: 12px 14px;
        border-bottom: 1px solid var(--app-border-subtle);
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .broker-confirm-card > :deep(.p-button) {
        width: 100%;
        margin-top: 10px;
    }
    .broker-confirm-card > :deep(.p-message) {
        margin: 12px 0;
    }
    .broker-confirm-card > p {
        font-size: 11px;
        line-height: 18px;
        color: var(--app-muted);
        text-align: center;
        margin: 14px 0 0;
    }
    .broker-format-help {
        margin-top: 20px;
    }
    .broker-format-help p {
        font-size: 12px;
        line-height: 19px;
        color: var(--app-muted);
    }
    @media (min-width: 1024px) {
        .broker-file-options :deep(.p-select),
        .broker-file-options :deep(.p-inputtext) {
            min-height: 32px;
            height: 32px;
            font-size: 12px;
        }
        .broker-file-options :deep(.p-select-label) {
            padding: 6px 10px;
        }
        .broker-preset-actions :deep(.p-button) {
            min-height: 36px;
            font-size: 12px;
        }
    }
    @media (max-width: 1023px) {
        .broker-mapping-workspace {
            grid-template-columns: 1fr;
        }
        .broker-heading h3 {
            font-size: 24px;
            line-height: 32px;
        }
    }
    @media (max-width: 640px) {
        .broker-steps {
            width: 100%;
            justify-content: space-between;
            gap: 8px;
            font-size: 11px;
            padding: 10px 8px;
        }
        .broker-steps li {
            gap: 4px;
        }
        .broker-steps b {
            width: 20px;
            height: 20px;
        }
        .broker-file-options,
        .broker-settings-grid {
            grid-template-columns: 1fr;
        }
        .broker-source-file {
            grid-column: auto;
        }
        .broker-preset-actions {
            width: 100%;
        }
        .broker-preset-actions > :deep(.p-button) {
            flex: 1;
        }
        .broker-heading h3 {
            font-size: 20px;
            line-height: 25px;
        }
        .broker-mapping-label {
            align-items: flex-start;
        }
        .broker-card-heading h4 {
            font-size: 18px;
        }
        .broker-preview-card,
        .broker-confirm-card {
            padding: 16px;
        }
        .broker-basic-fields {
            padding: 4px 16px 16px;
        }
        .broker-mapping-card > .broker-card-heading {
            padding: 16px;
        }
        .broker-mapping-guide {
            margin: 16px;
        }
        .broker-detail-fields {
            margin: 0 16px 16px;
        }
        .broker-optional-row {
            grid-template-columns: 1fr;
        }
    }

    .broker-import {
        --broker-brown: #382418;
    }
    :global(.p-dark .broker-import) {
        --broker-brown: var(--app-text);
    }
    .broker-heading h3,
    .broker-card-heading h4 {
        color: var(--broker-brown);
    }
    .broker-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 10px;
        border-radius: 999px;
        background: var(--app-surface-muted);
        border: 1px solid var(--app-border);
        font-size: 11px !important;
        line-height: 16px;
    }
    .broker-eyebrow i {
        color: var(--app-accent);
        font-size: 13px;
    }
    .broker-steps small {
        display: none;
    }
    .broker-steps b.completed {
        background: var(--app-accent-light);
        color: var(--app-accent);
        border: 1px solid var(--app-border);
    }
    .broker-file-badge {
        display: inline-block;
        padding: 2px 6px;
        margin-top: 4px;
        font-size: 10px;
        color: var(--app-muted);
        background: var(--app-surface-muted);
        border-radius: 4px;
    }
    .broker-account-context {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 11px;
        color: var(--app-muted);
    }
    .broker-account-context code {
        margin: 0;
        font-size: 11px;
        color: var(--app-text);
        font-weight: 600;
    }
    .broker-account-context > span:last-child {
        display: flex;
        gap: 6px;
        align-items: center;
    }
    .broker-account-context .verified {
        color: var(--app-accent);
        font-weight: 600;
    }
    .broker-kind-control {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
    }
    .broker-kind-toggle {
        display: flex;
        background: var(--app-surface-muted);
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 4px;
        gap: 4px;
    }
    .broker-kind-toggle label,
    .broker-currency-toggle label {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex: 1;
        padding: 8px 10px;
        border-radius: 6px;
        color: var(--app-muted);
        font-size: 12px;
    }
    .broker-kind-toggle label.selected {
        background: var(--app-surface);
        color: var(--app-accent);
        font-weight: 600;
    }
    .broker-kind-toggle input,
    .broker-currency-toggle input {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }
    .broker-kind-toggle label:has(input:focus-visible),
    .broker-currency-toggle label:has(input:focus-visible) {
        outline: 2px solid var(--app-accent);
        outline-offset: 2px;
    }
    .broker-currency-choice {
        padding: 0;
        border: 0;
        background: none;
    }
    .broker-currency-toggle {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
    }
    .broker-currency-toggle label {
        flex: initial;
        border: 1px solid var(--app-border);
        padding: 6px 10px;
    }
    .broker-currency-toggle label.selected {
        color: var(--app-accent);
        background: var(--app-accent-light);
        border-color: var(--app-accent);
        font-weight: 600;
    }
    .broker-field-state {
        border-radius: 4px;
    }
    .broker-field-state.mapped {
        border-color: #a7f3d0;
    }
    .broker-mapping-label small {
        display: inline-block;
        border-radius: 3px;
        padding: 1px 5px;
        background: var(--app-surface-muted);
        color: var(--app-muted);
    }
    .broker-mapping-label small:first-of-type {
        color: var(--app-muted);
    }
    .broker-mapping-row.needs-mapping {
        border: 2px solid #f87171;
        background: color-mix(in srgb, var(--app-up), transparent 98%);
    }
    .broker-mapping-row.needs-mapping small {
        color: var(--app-up);
        background: color-mix(in srgb, var(--app-up), transparent 95%);
    }
    .broker-required-note {
        color: var(--app-up);
        display: flex;
        align-items: flex-start;
        gap: 6px;
    }
    .broker-required-note i {
        margin-top: 2px;
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        .broker-heading {
            padding: 24px;
            background: var(--app-surface);
            border: 1px solid var(--app-border);
            border-radius: 12px;
            margin-bottom: 20px;
        }
        .broker-heading > div {
            flex: 1;
            min-width: 0;
        }
        .broker-steps {
            padding: 8px;
            gap: 6px;
            font-size: 11px;
        }
        .broker-steps li {
            gap: 4px;
        }
        .broker-steps b {
            height: 16px;
            width: 16px;
            font-size: 10px;
        }
    }
    @media (max-width: 640px) {
        .broker-heading {
            gap: 12px;
            margin-bottom: 16px;
        }
        .broker-heading h3 {
            margin-bottom: 4px;
        }
        .broker-heading p:not(.broker-eyebrow) {
            font-size: 12px;
            line-height: 19.5px;
            color: var(--app-muted);
        }
        .broker-steps {
            padding: 12px;
            gap: 6px;
            min-height: 52px;
        }
        .broker-steps li {
            flex: 1;
            min-width: 0;
            gap: 6px;
            white-space: normal;
        }
        .broker-steps li > span {
            display: flex;
            flex-direction: column;
            font-size: 11px;
            line-height: 13.75px;
        }
        .broker-steps small {
            display: block;
            font-size: 10px;
            line-height: 12.5px;
        }
        .broker-steps b {
            height: 24px;
            width: 24px;
            flex-shrink: 0;
        }
        .broker-file-card {
            margin-bottom: 16px;
        }
        .broker-file-toolbar {
            gap: 10px;
        }
        .broker-file-meta {
            gap: 10px;
        }
        .broker-file-meta small {
            font-size: 11px;
        }
        .broker-file-meta strong {
            display: inline;
        }
        .broker-file-badge {
            margin: 0 0 0 6px;
        }
        .broker-account-context {
            width: 100%;
            padding: 10px;
            border-radius: 8px;
            border: 1px solid var(--app-border);
            background: var(--app-bg);
            justify-content: space-between;
        }
        .broker-preset-actions :deep(.p-button) {
            font-size: 12px;
            min-height: 40px;
            padding: 4px 12px;
            gap: 6px;
            line-height: 18px;
        }
        .broker-preset-actions :deep(.p-button-icon) {
            font-size: 15px;
        }
        .broker-file-options {
            gap: 12px;
        }
        .broker-preset-status {
            margin-bottom: 16px;
        }
        .broker-mapping-label {
            margin-bottom: 10px;
        }
        .broker-mapping-row {
            padding: 12px;
        }
        .broker-basic-fields {
            gap: 12px;
        }
        .broker-mapping-row > .p-select {
            height: 44px;
        }
        .broker-mapping-card > .broker-card-heading h4 {
            font-size: 16px;
            line-height: 24px;
        }
        .broker-mapping-aside {
            gap: 16px;
        }
        .broker-mapping-workspace {
            gap: 16px;
        }
    }

    @media (min-width: 1024px) {
        .broker-file-meta strong {
            display: inline;
        }
        .broker-file-badge {
            margin: 0 0 0 8px;
        }
        .broker-file-options {
            display: flex;
            align-items: center;
            gap: 20px;
            flex-wrap: wrap;
        }
        .broker-file-options > label {
            flex-direction: row;
            align-items: center;
        }
        .broker-file-options > label :deep(.p-select) {
            width: 120px;
        }
        .broker-file-options > label :deep(.p-inputnumber) {
            width: 64px;
        }
        .broker-file-options > label :deep(.p-inputnumber-input) {
            text-align: center;
            padding: 4px 8px;
        }
        .broker-kind-control {
            flex-direction: row;
            align-items: center;
            gap: 8px;
            font-weight: 500;
        }
        .broker-kind-toggle {
            padding: 2px;
        }
        .broker-kind-toggle label {
            padding: 4px 10px;
        }
    }

    .broker-confirm-card :deep(.p-button:disabled) {
        background: var(--app-surface-muted);
        border-color: var(--app-border);
        color: var(--app-muted);
        opacity: 0.6;
    }
    .broker-currency-toggle label {
        font-size: 11px;
        line-height: 16px;
        padding: 4px 10px;
    }
    .broker-upload-settings {
        margin-top: 8px;
    }
    .broker-upload-settings > summary {
        padding: 4px 0;
        font-size: 11px;
    }
    @media (min-width: 1024px) {
        :deep(.p-select) {
            font-size: 12px;
        }
        .broker-preset-actions :deep(.p-button) {
            height: 36px;
            padding: 4px 12px;
            line-height: 18px;
        }
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        :deep(.p-select),
        :deep(.p-inputnumber-input) {
            font-size: 14px;
        }
        .broker-file-options :deep(.p-select),
        .broker-file-options :deep(.p-inputnumber-input) {
            height: 44px;
            min-height: 44px;
        }
    }
    @media (max-width: 640px) {
        :deep(.p-select),
        :deep(.p-inputnumber-input) {
            font-size: 13px;
        }
        .broker-file-options :deep(.p-select),
        .broker-file-options :deep(.p-inputnumber-input) {
            height: 44px;
            min-height: 44px;
        }
    }
    .broker-field-state.invalid {
        background: color-mix(in srgb, var(--app-up), transparent 92%);
        border-color: #fca5a5;
        color: var(--app-up);
    }

    .broker-tablet-account {
        display: none;
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        .broker-tablet-account {
            display: inline;
        }
        .broker-account-context > span:first-child,
        .broker-account-context > code {
            display: none;
        }
        .broker-preset-actions :deep(.p-button) {
            height: 36px;
            min-height: 36px;
            font-size: 12px;
            line-height: 18px;
            padding: 4px 12px;
            gap: 6px;
        }
        .broker-preset-actions :deep(.p-button-icon) {
            font-size: 16px;
        }
        .broker-file-meta strong {
            display: inline;
            font-size: 20px;
            line-height: 28px;
        }
        .broker-file-badge {
            margin: 0 0 0 6px;
        }
        .broker-file-meta small {
            font-size: 11px;
            line-height: 16px;
        }
    }

    /* Final source geometry; extra upload controls remain accessible below the mapping. */
    .broker-file-settings {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        flex: 0 0 40px;
        padding: 0;
        border: 1px solid #d1fae5;
        border-radius: 8px;
        background: var(--app-accent-light);
        color: var(--app-accent);
        font-size: 22px;
        cursor: pointer;
    }
    .broker-file-settings:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 3px;
    }
    .broker-file-note {
        margin: 0;
    }
    .broker-file-options > .broker-file-note {
        grid-column: 1 / -1;
    }
    .broker-upload-settings {
        margin-top: 20px;
    }
    .broker-step-separator {
        flex: none !important;
        min-width: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: none !important;
    }
    .broker-step-separator::before {
        content: '';
        display: block;
        width: 20px;
        height: 1px;
        background: var(--app-border);
    }
    .broker-progress-badge {
        font-size: 10px;
        line-height: 15px;
        font-weight: 600;
        font-style: normal;
        padding: 2px 6px;
        border: 1px solid #a7f3d0;
        border-radius: 999px;
        background: var(--app-accent-light);
        color: var(--app-accent);
        white-space: nowrap;
    }
    @media (min-width: 1024px) {
        .broker-eyebrow {
            border: 0;
            border-radius: 0;
            padding: 0;
            background: none;
            font-size: 12px !important;
            line-height: 18px;
        }
        .broker-eyebrow i {
            display: none;
        }
        .broker-steps {
            gap: 10px;
        }
        .broker-steps .broker-step {
            gap: 8px;
        }
        .broker-file-options > .broker-file-note {
            margin-left: auto;
        }
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        .broker-file-card {
            padding: 24px;
            margin-bottom: 20px;
        }
        .broker-file-options {
            gap: 12px;
            padding-top: 0;
            border: 0;
        }
        .broker-file-toolbar {
            padding-bottom: 12px;
            border-bottom: 1px solid var(--app-border-subtle);
            gap: 12px;
        }
        .broker-steps {
            gap: 6px;
            background: var(--app-bg);
            border-radius: 8px;
        }
        .broker-steps .broker-step {
            gap: 4px;
            padding: 4px 8px;
        }
        .broker-steps .broker-step:first-child {
            background: var(--app-surface);
            border: 1px solid var(--app-border);
            border-radius: 4px;
        }
        .broker-steps .broker-step[aria-current] {
            background: var(--app-accent-light);
            border: 1px solid #99f6e4;
            border-radius: 4px;
        }
        .broker-step-prefix,
        .broker-progress-badge {
            display: none;
        }
        .broker-step:first-child .broker-step-prefix {
            display: inline;
        }
        .broker-step-separator::before {
            content: '/';
            height: auto;
            width: auto;
            background: none;
            color: var(--app-border);
        }
    }
    @media (max-width: 640px) {
        .broker-steps {
            gap: 4px;
        }
        .broker-step-prefix,
        .broker-progress-badge {
            display: none;
        }
        .broker-step-separator::before {
            width: 12px;
        }
        .broker-file-toolbar {
            padding-bottom: 12px;
            border-bottom: 1px solid var(--app-border-subtle);
            gap: 10px;
        }
        .broker-file-options {
            border: 0;
            padding-top: 0;
            margin-top: 14px;
            gap: 12px;
        }
        .broker-file-options > .broker-file-note {
            font-size: 11px;
            line-height: 16.5px;
        }
    }

    .broker-eyebrow {
        display: flex;
        width: fit-content;
    }
    .broker-file-meta strong {
        line-height: 20px;
    }
    .broker-file-meta small {
        line-height: 16px;
    }
    .broker-file-badge {
        line-height: 16px;
    }
    .broker-kind-toggle {
        flex-shrink: 0;
    }
    .broker-kind-toggle label {
        white-space: nowrap;
        line-height: 16px;
    }
    @media (min-width: 1024px) {
        .broker-eyebrow {
            line-height: 16px;
        }
        .broker-heading p:not(.broker-eyebrow) {
            line-height: 22.75px;
        }
        .broker-kind-toggle {
            height: 32px;
        }
        .broker-file-options > label,
        .broker-kind-control {
            line-height: 16px;
        }
        .broker-file-note {
            line-height: 16px;
        }
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        .broker-heading > div {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .broker-heading .broker-eyebrow {
            margin: 0 !important;
        }
        .broker-heading h3 {
            margin: 0;
        }
        .broker-heading p:not(.broker-eyebrow) {
            line-height: 22.75px;
        }
        .broker-file-meta strong {
            line-height: 28px;
        }
        .broker-file-options > label,
        .broker-kind-control {
            font-size: 13px;
            line-height: 18px;
            gap: 6px;
        }
        .broker-kind-toggle {
            height: 44px;
        }
        .broker-file-options {
            row-gap: 16px;
        }
        .broker-file-note {
            font-size: 12px;
            line-height: 16px;
        }
    }
    @media (max-width: 640px) {
        .broker-file-toolbar {
            gap: 8px;
        }
        .broker-preset-actions {
            row-gap: 12px;
        }
        .broker-account-context {
            line-height: 16.5px;
        }
        .broker-file-options > label,
        .broker-kind-control {
            line-height: 18px;
            gap: 4px;
            font-weight: 600;
        }
        .broker-kind-toggle {
            height: 44px;
        }
        .broker-file-options > .broker-file-note {
            padding-top: 2px;
        }
    }

    .broker-mismatch {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 16px;
        margin-bottom: 24px;
        border: 1px solid #fcd34d;
        border-radius: 12px;
        background: #fffbeb;
        color: #78350f;
    }
    .broker-mismatch > i {
        flex-shrink: 0;
        font-size: 22px;
        line-height: 22px;
        color: #eab308;
        margin-top: 2px;
    }
    .broker-mismatch > div {
        min-width: 0;
    }
    .broker-mismatch strong {
        display: block;
        font-size: 13px;
        line-height: 19.5px;
        color: #451a03;
        margin-bottom: 4px;
    }
    .broker-mismatch p {
        margin: 0;
        font-size: 12px;
        line-height: 19.5px;
    }
    .broker-mismatch p + p {
        margin-top: 6px;
        font-size: 11px;
        line-height: 16.5px;
    }
    :global(.p-dark .broker-mismatch) {
        background: var(--app-warning-light);
        border-color: var(--app-warning);
        color: var(--app-warning-text);
    }
    :global(.p-dark .broker-mismatch strong) {
        color: var(--app-warning-text);
    }
    .broker-field-index {
        display: none;
    }
    @media (min-width: 1280px) {
        .broker-mapping-workspace {
            grid-template-columns: repeat(12, minmax(0, 1fr));
        }
        .broker-mapping-card {
            grid-column: span 7;
        }
        .broker-mapping-aside {
            grid-column: span 5;
        }
    }
    @media (min-width: 1024px) and (max-width: 1279px) {
        .broker-mapping-workspace {
            grid-template-columns: 1fr;
        }
    }
    @media (min-width: 1024px) {
        .broker-mapping-card > .broker-card-heading {
            padding: 20px 20px 6px;
            border-bottom: 0;
            gap: 8px;
        }
        .broker-mapping-card > .broker-card-heading p {
            display: none;
        }
        .broker-mapping-card > .broker-card-heading h4 {
            line-height: 28px;
        }
        .broker-mapping-card > .broker-mapping-guide {
            padding: 0 20px 20px;
            margin: 0;
            border: 0;
            border-bottom: 1px solid var(--app-border-subtle);
            border-radius: 0;
            background: none;
            line-height: 19.5px;
        }
        .broker-basic-fields {
            gap: 14px;
            padding: 20px;
        }
        .broker-mapping-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto;
            align-items: center;
            gap: 12px;
        }
        .broker-mapping-label {
            display: contents;
        }
        .broker-mapping-label > label {
            grid-column: 1;
            grid-row: 1;
            line-height: 20px;
        }
        .broker-mapping-label code {
            display: block;
            margin: 2px 0 0;
            line-height: 16.5px;
        }
        .broker-field-state {
            grid-column: 3;
            grid-row: 1;
            white-space: nowrap;
        }
        .broker-mapping-row > :deep(.p-select) {
            grid-column: 2;
            grid-row: 1;
        }
        .broker-mapping-row > .broker-field-note,
        .broker-currency-choice {
            grid-column: 1 / -1;
        }
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        .broker-file-settings {
            font-size: 24px;
            background: #f0fdfa;
            border-color: #ccfbf1;
        }
        :global(.p-dark .broker-file-settings) {
            background: var(--app-accent-light);
            border-color: #d1fae5;
        }
        .broker-mismatch {
            margin-bottom: 20px;
            background: #fefce8;
            border-color: #fef08a;
        }
        .broker-mismatch > i {
            display: grid;
            place-items: center;
            width: 32px;
            height: 32px;
            font-size: 20px;
            border: 1px solid #fde68a;
            border-radius: 8px;
            background: #fef3c7;
            color: #92400e;
        }
        .broker-mismatch strong {
            font-size: 15px;
            line-height: 18.75px;
        }
        .broker-mismatch p,
        .broker-mismatch p + p {
            font-size: 14px;
            line-height: 21px;
            margin-top: 0;
        }
        .broker-mapping-card {
            padding: 24px;
        }
        .broker-mapping-card > .broker-card-heading {
            padding: 0 0 12px;
            margin-bottom: 16px;
        }
        .broker-mapping-card > .broker-card-heading h4 {
            font-size: 20px;
            line-height: 28px;
        }
        .broker-mapping-card > .broker-mapping-guide {
            margin: 0 0 16px;
            padding: 10px;
            font-size: 12px;
            line-height: 18px;
        }
        .broker-basic-fields {
            padding: 0;
            gap: 0;
        }
        .broker-mapping-row {
            padding: 12px 0;
            border: 0;
            border-bottom: 1px solid var(--app-border-subtle);
            border-radius: 0;
        }
        .broker-mapping-row.needs-mapping {
            margin: 8px 0;
            padding: 12px;
            border: 1px solid #fca5a5;
            border-radius: 12px;
        }
        .broker-mapping-label {
            margin-bottom: 6px;
        }
        .broker-mapping-label > label {
            font-size: 13px;
            line-height: 18px;
        }
        .broker-detail-fields {
            margin: 16px 0 0;
        }
    }
    @media (max-width: 640px) {
        .broker-mismatch {
            padding: 14px;
            background: #fefce8;
            border-color: #fde68a;
            margin-bottom: 16px;
        }
        .broker-mismatch > i {
            display: grid;
            place-items: center;
            width: 28px;
            height: 28px;
            font-size: 20px;
            border: 1px solid #fde68a;
            border-radius: 8px;
            background: #fef3c7;
            color: #92400e;
        }
        .broker-mismatch strong {
            font-size: 14px;
            line-height: 21px;
        }
        .broker-mismatch p {
            font-size: 13px;
            line-height: 19.5px;
        }
        .broker-field-index {
            display: inline;
        }
        .broker-mapping-label > label {
            font-size: 13px;
            line-height: 19.5px;
            font-weight: 700;
        }
        .broker-mapping-label {
            margin-bottom: 8px;
        }
        .broker-mapping-card > .broker-card-heading p {
            display: none;
        }
        .broker-mapping-card > .broker-card-heading {
            border-bottom: 0;
            padding-bottom: 0;
            gap: 8px;
        }
        .broker-mapping-card > .broker-card-heading > .broker-state {
            font-size: 11px;
            line-height: 16.5px;
            padding: 2px 8px;
        }
        .broker-mapping-guide {
            font-size: 11px;
            line-height: 16.5px;
            padding: 10px;
        }
    }

    .broker-file-name {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .broker-file-name .broker-file-badge {
        margin: 0;
    }
    @media (min-width: 1024px) {
        .broker-heading .broker-eyebrow {
            line-height: 16px;
        }
        .broker-file-name {
            gap: 8px;
        }
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        .broker-heading .broker-eyebrow {
            line-height: 16px;
        }
        .broker-steps {
            line-height: 16px;
        }
    }
    @media (max-width: 640px) {
        .broker-heading .broker-eyebrow {
            line-height: 16.5px;
            margin-bottom: 12px !important;
        }
    }

    :deep(.p-select-label) {
        font-size: inherit;
        display: flex;
        align-items: center;
        padding: 0 12px;
    }
    @media (min-width: 1024px) {
        :deep(.p-select-label) {
            line-height: 16px;
        }
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        :deep(.p-select-label) {
            line-height: 20px;
        }
    }
    @media (max-width: 640px) {
        :deep(.p-select-label) {
            line-height: 19.5px;
        }
    }

    .broker-preview-notes {
        padding: 12px;
        margin-top: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        font-size: 11px;
        line-height: 16.5px;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .broker-preview-notes p {
        font-size: 10px;
        margin: 0 0 6px;
        line-height: 15px;
    }
    .broker-preview-notes ul {
        padding: 0 0 0 14px;
        margin: 0;
        display: grid;
        gap: 6px;
    }

    .broker-optional-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        padding-top: 12px;
        margin-top: 8px;
        border-top: 1px solid var(--app-border-subtle);
    }
    .broker-optional-row {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
        padding: 0;
    }
    .broker-optional-row:last-child {
        grid-column: 1 / -1;
    }
    .broker-optional-row label {
        font-size: 12px;
        line-height: 16px;
    }
    .broker-optional-row :deep(.p-select) {
        font-size: 12px;
        height: 36px;
    }
    @media (max-width: 640px) {
        .broker-optional-grid {
            grid-template-columns: 1fr;
        }
        .broker-optional-row :deep(.p-select) {
            height: 40px;
        }
    }

    .broker-mapping-title-tablet {
        display: none;
    }
    @media (min-width: 641px) and (max-width: 1023px) {
        .broker-mapping-title-main {
            display: none;
        }
        .broker-mapping-title-tablet {
            display: inline;
        }
        .broker-mapping-card > .broker-card-heading p {
            font-size: 11px;
            line-height: 16px;
            margin-top: 2px;
        }
        .broker-mapping-row {
            border-bottom: 0;
        }
        .broker-mapping-row + .broker-mapping-row {
            border-top: 1px solid var(--app-border-subtle);
        }
        .broker-mapping-row.needs-mapping {
            margin: 0 -8px;
            border-radius: 8px;
        }
        .broker-mapping-label > label {
            display: flex;
            flex-direction: row;
            align-items: center;
            gap: 6px;
        }
        .broker-mapping-label small {
            padding: 0;
            background: none;
            line-height: 16px;
        }
        .broker-mapping-label code {
            margin: 0;
            line-height: 16px;
        }
        .broker-field-state {
            line-height: 16.5px;
        }
        .broker-field-note {
            line-height: 16.5px;
        }
        .broker-required-note {
            font-size: 12px;
            line-height: 16px;
            margin-top: 8px;
        }
    }

    .broker-field-state {
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }
    .broker-field-state i {
        font-size: 13px;
        line-height: 13px;
    }
    .broker-preview-scroll {
        margin: 8px 0 0;
        text-align: right;
        font-size: 10px;
        line-height: 15px;
        color: var(--app-accent);
    }
    .broker-preview-scroll > span {
        display: inline-block;
        padding: 2px 6px;
        border: 1px solid var(--app-border);
        border-radius: 4px;
        background: var(--app-accent-light);
    }
</style>
