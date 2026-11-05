<script setup>
    import { computed, ref } from 'vue';
    import Button from 'primevue/button';
    import FileUpload from 'primevue/fileupload';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';
    import Select from 'primevue/select';
    import RadioButton from 'primevue/radiobutton';
    import Tag from 'primevue/tag';
    import StitchSymbol from './StitchSymbol.vue';
    import { transactionTypeLabel } from '@/services/tossImportReview.js';

    const props = defineProps({
        accountLabel: { type: String, required: true },
        passwordConfigured: Boolean,
        isOwner: Boolean,
        busy: Boolean,
        reviewing: Boolean,
        error: { type: String, default: '' },
        previewReview: { type: Object, default: null },
        kindOptions: { type: Array, required: true },
        formatOptions: { type: Array, required: true },
        selectedFiles: { type: Array, required: true },
    });
    const kind = defineModel('kind', { type: String, required: true });
    const format = defineModel('format', { type: String, required: true });
    const asOf = defineModel('asOf', { type: String, required: true });
    const password = defineModel('password', { type: String, required: true });
    const rememberPassword = defineModel('rememberPassword', { type: Boolean });
    const confirmed = defineModel('confirmed', { type: Boolean });
    const emit = defineEmits([
        'select',
        'clear',
        'preview',
        'removePassword',
        'reset',
        'manual',
    ]);
    const uploader = ref(null);
    const errorNotice = ref(null);
    const passwordInput = ref(null);
    const showPassword = ref(false);
    const previewHeading = ref(null);
    const previewReady = computed(() =>
        Array.isArray(props.previewReview?.rows)
    );
    const previewRows = computed(
        () => props.previewReview?.rows?.slice(0, 3) || []
    );
    function previewType(row) {
        return props.previewReview?.kind === 'holdings'
            ? '보유 잔고'
            : row.rawType || transactionTypeLabel(row.type);
    }
    function previewCell(value) {
        return value === null || value === undefined || value === ''
            ? '미제공'
            : String(value);
    }
    function revealRequiredField(event) {
        const settings = event.target.closest('details');
        if (settings) settings.open = true;
    }
    function previewAmount(value) {
        const text = previewCell(value);
        const parts = /^([+-]?)(\d+)(\.\d+)?$/.exec(text);
        return parts
            ? parts[1] +
                  parts[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
                  (parts[3] || '')
            : text;
    }
    function focusPreview() {
        previewHeading.value?.focus({ preventScroll: true });
        previewHeading.value?.scrollIntoView({ block: 'center' });
    }
    const isPdf = computed(() => format.value === 'toss-pdf');
    const fileExtension = computed(() =>
        isPdf.value ? 'PDF' : format.value === 'standard-xlsx' ? 'XLSX' : 'CSV'
    );
    const accept = computed(() =>
        isPdf.value
            ? '.pdf,application/pdf'
            : format.value === 'standard-xlsx'
              ? '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : '.csv,text/csv'
    );
    const samples = [
        {
            name: '거래내역_표준서식.csv',
            text: 'date,symbol,quantity,amount,currency,type,externalId\n2026-10-15,AAPL,2,500,USD,buy,broker-trade-001\n',
        },
        {
            name: '보유잔고_입력서식.csv',
            text: 'date,symbol,quantity,amount,currency\n2026-10-15,AAPL,2,500,USD\n',
        },
    ].map((sample) => ({
        ...sample,
        href: `data:text/csv;charset=utf-8,${encodeURIComponent('\uFEFF' + sample.text)}`,
    }));
    function clear() {
        showPassword.value = false;
        uploader.value?.clear();
    }
    function focusPassword() {
        passwordInput.value?.$el?.focus();
    }
    function fileSize(bytes) {
        return bytes < 1024 * 1024
            ? `${(bytes / 1024).toFixed(1)} KB`
            : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    function focusError() {
        errorNotice.value?.focus({ preventScroll: true });
        errorNotice.value?.scrollIntoView({ block: 'center' });
    }
    defineExpose({ clear, focusError, focusPreview });
</script>

<template>
    <div class="import-layout">
        <header class="upload-heading">
            <div class="upload-badges">
                <Tag value="데이터 가져오기 및 등록" /><Tag
                    severity="secondary"
                    value="모으멍 포트폴리오" /><slot name="badges" />
            </div>
            <div class="upload-heading-row">
                <div>
                    <h2>증권 데이터 등록</h2>
                    <p>
                        증권사 거래내역 및 잔고 스냅샷을 안전하게 불러와
                        배당달력 포트폴리오를 구성합니다. 모든 데이터는 검토 후
                        저장됩니다.
                    </p>
                </div>
                <Button
                    type="button"
                    label="직접 수기 입력"
                    outlined
                    severity="secondary"
                    :disabled="busy"
                    @click="emit('manual')">
                    <template #icon><StitchSymbol name="edit_note" /></template>
                </Button>
            </div>
            <ol class="upload-steps" aria-label="자료 등록 단계">
                <template
                    v-for="(label, index) in [
                        '파일 업로드',
                        '데이터 검토',
                        '저장 결과',
                    ]"
                    :key="label">
                    <li
                        :aria-current="
                            index === (reviewing ? 1 : 0) ? 'step' : undefined
                        ">
                        <span>{{ index + 1 }}</span>
                        <div>
                            <strong>{{ label }}</strong
                            ><small>{{
                                index === 0
                                    ? '거래/잔고 (진행중)'
                                    : index === 1
                                      ? '필수 항목 확인 (대기)'
                                      : '포트폴리오 적재 (대기)'
                            }}</small>
                        </div>
                    </li>
                    <li
                        v-if="index < 2"
                        aria-hidden="true"
                        class="upload-step-connector" />
                </template>
            </ol>
        </header>
        <form
            class="import-form"
            aria-label="파일 업로드"
            @invalid.capture="revealRequiredField"
            @submit.prevent="emit('preview')">
            <fieldset :disabled="busy" class="import-fields">
                <article class="import-card">
                    <div class="card-heading">
                        <h3>데이터 유형 선택</h3>
                        <span class="status-pill">필수 지정</span>
                    </div>
                    <div class="field-grid">
                        <fieldset
                            class="import-kind-choice"
                            role="radiogroup"
                            aria-label="자료 종류">
                            <legend>자료 종류</legend>
                            <label
                                v-for="option in kindOptions"
                                :key="option.value"
                                :for="`import-kind-${option.value}`"
                                :class="{ selected: kind === option.value }"
                                ><RadioButton
                                    v-model="kind"
                                    :input-id="`import-kind-${option.value}`"
                                    name="import-kind"
                                    :value="option.value"
                                    :disabled="busy" /><StitchSymbol
                                    :name="
                                        option.value === 'transactions'
                                            ? 'receipt_long'
                                            : 'inventory_2'
                                    " /><span>{{ option.label }}</span></label
                            >
                        </fieldset>
                        <p class="upload-kind-guidance">
                            거래내역과 배당 입금 또는 기준일 보유 잔고를
                            불러옵니다. 전체 자료는 검토 화면에서 확인하고
                            수정합니다.
                        </p>
                        <details class="upload-settings" :open="!previewReady">
                            <summary>파일 형식·기준일 설정</summary>
                            <div class="settings-field-grid">
                                <div class="import-field">
                                    <label for="import-format">파일 형식</label>
                                    <Select
                                        v-model="format"
                                        input-id="import-format"
                                        :options="formatOptions"
                                        option-label="label"
                                        option-value="value"
                                        aria-label="파일 형식"
                                        :disabled="busy" />
                                    <small>{{
                                        isPdf
                                            ? '토스 앱에서 발급받은 거래내역 PDF를 선택하세요.'
                                            : '표준 양식의 열 이름과 자료 형식을 확인하세요.'
                                    }}</small>
                                </div>
                                <div v-if="!isPdf" class="import-field">
                                    <label for="import-date">{{
                                        kind === 'transactions'
                                            ? '조회 종료일'
                                            : '잔고 기준일'
                                    }}</label>
                                    <InputText
                                        id="import-date"
                                        v-model="asOf"
                                        type="date"
                                        required
                                        :disabled="busy" />
                                    <small v-if="kind === 'transactions'"
                                        >거래내역서 조회 기간의 마지막
                                        날입니다.</small
                                    >
                                </div>
                            </div>
                            <div class="import-notice">
                                <i
                                    class="pi pi-info-circle"
                                    aria-hidden="true" />
                                <p v-if="isPdf">
                                    <strong>토스 거래내역 PDF 안내</strong> ·
                                    최대 10,000행을 추출하며 저장은 200행씩 나눠
                                    진행합니다. 조회 종료일은 PDF에서 추출된
                                    마지막 거래일로 자동 입력됩니다.
                                </p>
                                <p v-else>
                                    <strong>표준 CSV·XLSX 안내</strong> · 최대
                                    200행, 파일당 2MB를 지원합니다.
                                    {{
                                        kind === 'holdings'
                                            ? '잔고는 기준일의 전체 보유 종목을 입력하세요. 새 잔고는 해당 계좌의 이전 잔고를 대체합니다.'
                                            : '거래 고유번호는 같은 계좌에서 다시 업로드해도 동일해야 합니다.'
                                    }}
                                </p>
                            </div>
                        </details>
                    </div>
                </article>

                <article class="import-card">
                    <div class="card-heading">
                        <h3><span class="step-number">2</span>파일 업로드</h3>
                        <span class="status-pill">{{
                            selectedFiles.length
                                ? `${selectedFiles.length}개 선택됨`
                                : '파일 선택 전'
                        }}</span>
                    </div>
                    <FileUpload
                        ref="uploader"
                        name="portfolioFile"
                        :disabled="busy"
                        :multiple="isPdf"
                        :file-limit="isPdf ? 20 : 1"
                        :max-file-size="2097152"
                        :accept="accept"
                        :show-upload-button="false"
                        :show-cancel-button="false"
                        invalid-file-size-message="{0}: 파일 크기는 2MB 이하여야 합니다."
                        invalid-file-type-message="{0}: 선택한 파일 형식과 일치하는 파일을 올려 주세요."
                        invalid-file-limit-message="선택 가능한 파일 수는 최대 {0}개입니다."
                        :pt="{
                            input: { 'aria-label': '파일' },
                            header: { class: 'import-uploader-header' },
                            content: { class: 'import-uploader-content' },
                        }"
                        :dt="{
                            borderColor: 'transparent',
                            background: 'transparent',
                            content: { padding: '0' },
                            header: { padding: '0' },
                        }"
                        custom-upload
                        @select="emit('select', $event)"
                        @remove="emit('select', $event)"
                        @clear="emit('clear')">
                        <template
                            #header="{ chooseCallback, clearCallback, files }">
                            <Button
                                type="button"
                                :label="
                                    files.length
                                        ? isPdf
                                            ? '파일 추가'
                                            : '파일 변경'
                                        : '파일 선택'
                                "
                                icon="pi pi-plus"
                                :disabled="busy"
                                @click="
                                    () => {
                                        if (!isPdf) clearCallback();
                                        chooseCallback();
                                    }
                                " />
                            <Button
                                v-if="files.length"
                                type="button"
                                label="모두 제거"
                                severity="secondary"
                                text
                                :disabled="busy"
                                @click="clearCallback" />
                        </template>
                        <template
                            #content="{ files, removeFileCallback, messages }">
                            <Message
                                v-for="problem in messages"
                                :key="problem"
                                severity="error"
                                :closable="false"
                                >{{ problem }}</Message
                            >
                            <ul
                                v-if="files.length"
                                class="import-file-list"
                                aria-label="선택한 파일">
                                <li
                                    v-for="(file, index) in files"
                                    :key="`${file.name}:${file.size}:${file.lastModified}`"
                                    class="import-file">
                                    <span class="file-icon">{{
                                        fileExtension
                                    }}</span>
                                    <div class="file-info">
                                        <strong>{{ file.name }}</strong
                                        ><small
                                            >{{ fileSize(file.size) }} ·
                                            {{ fileExtension }} ·
                                            {{
                                                previewReady
                                                    ? `${previewReview.rows.length}건 추출 · 검토 전`
                                                    : '추출 대기'
                                            }}</small
                                        >
                                    </div>
                                    <Button
                                        type="button"
                                        icon="pi pi-trash"
                                        :aria-label="`${file.name} 제거`"
                                        severity="danger"
                                        text
                                        :disabled="busy"
                                        @click="removeFileCallback(index)" />
                                </li>
                            </ul>
                        </template>
                        <template #empty>
                            <button
                                type="button"
                                class="import-dropzone"
                                :aria-label="`${fileExtension} 파일 선택`"
                                :disabled="busy"
                                @click="uploader?.choose()">
                                <span class="dropzone-icon"
                                    ><i
                                        class="pi pi-cloud-upload"
                                        aria-hidden="true"
                                /></span>
                                <strong class="dropzone-desktop"
                                    >{{ fileExtension }} 파일을 이곳에 끌어다
                                    놓으세요</strong
                                >
                                <span
                                    class="dropzone-desktop dropzone-description">
                                    또는 위의 파일 선택 버튼으로 컴퓨터에서
                                    선택하세요.
                                </span>
                                <strong class="dropzone-touch"
                                    >눌러서 {{ fileExtension }} 파일
                                    선택</strong
                                >
                                <span
                                    class="dropzone-touch dropzone-description">
                                    휴대폰이나 클라우드에 저장된 파일을
                                    선택하세요.
                                </span>
                            </button>
                        </template>
                    </FileUpload>
                    <div class="upload-file-rules">
                        <h4>파일 규격 및 분할 처리 기준</h4>
                        <div>
                            <section>
                                <strong>일반 스프레드시트 (CSV / XLSX)</strong>
                                <p>파일 1개 · 최대 2MB · 최대 200행 / 50열</p>
                            </section>
                            <section>
                                <strong>거래명세서 PDF</strong>
                                <p>
                                    최대 20개 파일 · 파일당 2MB · 10,000행 추출
                                    · 200행씩 분할 저장
                                </p>
                            </section>
                        </div>
                        <p>
                            {{
                                format === 'standard-xlsx'
                                    ? '표준 XLSX는 첫 시트·첫 행 제목을 사용합니다. 다른 시트나 증권사 양식은 열 연결에서 지정하세요.'
                                    : isPdf
                                      ? 'PDF 조회 종료일은 추출된 마지막 거래일로 입력됩니다.'
                                      : '표준 CSV는 UTF-8을 사용하며 시트 선택이 없습니다. 인식 상태와 행수는 추출 후 확인합니다.'
                            }}
                        </p>
                    </div>
                </article>

                <article v-if="isPdf" class="import-card">
                    <div class="card-heading">
                        <h3><span class="step-number">3</span>PDF 비밀번호</h3>
                        <span v-if="passwordConfigured" class="status-pill"
                            ><i class="pi pi-key" aria-hidden="true" />기본
                            비밀번호 저장됨</span
                        >
                    </div>
                    <div class="password-box">
                        <div class="import-field">
                            <label for="import-password">PDF 비밀번호</label>
                            <div class="password-control">
                                <InputText
                                    id="import-password"
                                    ref="passwordInput"
                                    v-model="password"
                                    :type="showPassword ? 'text' : 'password'"
                                    autocomplete="off"
                                    :disabled="busy"
                                    :placeholder="
                                        passwordConfigured
                                            ? '저장된 비밀번호 사용 · 변경할 때만 입력'
                                            : '생년월일 6자리'
                                    "
                                    aria-describedby="password-help" />
                                <Button
                                    type="button"
                                    :icon="
                                        showPassword
                                            ? 'pi pi-eye-slash'
                                            : 'pi pi-eye'
                                    "
                                    :aria-label="
                                        showPassword
                                            ? '비밀번호 숨기기'
                                            : '비밀번호 표시'
                                    "
                                    :aria-pressed="showPassword"
                                    text
                                    severity="secondary"
                                    :disabled="busy"
                                    @click="showPassword = !showPassword" />
                            </div>
                        </div>
                        <label
                            v-if="isOwner"
                            class="import-check"
                            for="import-remember">
                            <input
                                id="import-remember"
                                v-model="rememberPassword"
                                type="checkbox" />
                            <span>이 계좌의 기본 비밀번호로 암호화 저장</span>
                        </label>
                        <p id="password-help" class="field-note">
                            {{
                                passwordConfigured
                                    ? '계좌 기본 비밀번호가 암호화 저장되어 있습니다. 입력란을 비우면 자동 사용합니다.'
                                    : '문서에 설정된 비밀번호를 입력하세요. 저장 옵션은 계좌 소유자만 변경할 수 있습니다.'
                            }}
                        </p>
                        <div
                            v-if="passwordConfigured && isOwner"
                            class="password-actions">
                            <Button
                                type="button"
                                label="비밀번호 변경"
                                text
                                :disabled="busy"
                                @click="focusPassword" />
                            <Button
                                type="button"
                                label="저장된 비밀번호 삭제"
                                severity="danger"
                                text
                                :disabled="busy"
                                @click="emit('removePassword')" />
                        </div>
                    </div>
                </article>

                <article v-if="!isPdf" class="import-card password-unneeded">
                    <StitchSymbol name="lock_open" />
                    <div>
                        <h3>
                            {{
                                format === 'standard-xlsx'
                                    ? '표준 XLSX 암호 입력 미지원'
                                    : '문서 암호 입력 불필요'
                            }}
                        </h3>
                        <p>
                            {{
                                format === 'standard-xlsx'
                                    ? '표준 XLSX는 첫 시트·첫 행 제목을 사용합니다. 암호가 설정된 XLSX는 지원하지 않습니다.'
                                    : '현재 CSV 형식에는 문서 암호를 입력하지 않습니다.'
                            }}
                            PDF를 선택하면 기존 암호 입력을 사용할 수 있습니다.
                        </p>
                    </div>
                    <Tag severity="secondary" value="선택 사항 미적용" />
                </article>
                <article class="import-card import-submit">
                    <div
                        v-if="error"
                        ref="errorNotice"
                        tabindex="-1"
                        class="import-error">
                        <Message severity="error" :closable="false">
                            <strong>추출을 완료하지 못했습니다.</strong>
                            <p>{{ error }}</p>
                            <p v-if="selectedFiles.length">
                                선택한 파일은 유지됩니다. 내용을 확인한 뒤 다시
                                시도해 주세요.
                            </p>
                        </Message>
                    </div>
                    <div class="upload-account-label">
                        <StitchSymbol name="account_balance_wallet" /><span
                            >매칭 대상 계좌</span
                        ><strong>{{ accountLabel }}</strong>
                    </div>
                    <label
                        v-if="!isPdf && selectedFiles.length"
                        class="import-check"
                        for="import-confirmed">
                        <input
                            id="import-confirmed"
                            v-model="confirmed"
                            type="checkbox"
                            required />
                        <span
                            ><strong>{{ accountLabel }}</strong
                            >의 자료임을 확인했습니다. 파일에서 확실히 확인할 수
                            없으면 저장하지 않습니다.</span
                        >
                    </label>
                    <div class="submit-actions">
                        <Button
                            type="button"
                            label="초기화"
                            severity="secondary"
                            :disabled="busy"
                            @click="emit('reset')" />
                        <Button
                            type="submit"
                            :label="
                                previewReady
                                    ? '다음: 데이터 검토'
                                    : '추출·미리보기'
                            "
                            icon="pi pi-arrow-right"
                            icon-pos="right"
                            :loading="busy"
                            :disabled="
                                busy ||
                                (!isPdf &&
                                    selectedFiles.length > 0 &&
                                    !confirmed)
                            "
                            class="preview-button" />
                    </div>
                    <p class="field-note submit-note">
                        <i class="pi pi-shield" aria-hidden="true" />추출 후
                        내용을 확인하고 저장합니다. 이 단계에서는 거래·잔고
                        원장에 저장되지 않습니다.
                    </p>
                </article>
            </fieldset>
        </form>

        <aside class="import-guide" aria-label="자료 업로드 도움말">
            <article
                class="import-card upload-preview"
                aria-label="원본 미리보기 제공 상태">
                <div class="card-heading">
                    <h3 ref="previewHeading" tabindex="-1">
                        <StitchSymbol name="preview" />원본 데이터 미리보기
                    </h3>
                    <Tag
                        severity="secondary"
                        :value="
                            previewReady ? '상위 3행 · 검토 전' : '추출 전'
                        " />
                </div>
                <p class="field-note">
                    {{
                        previewReady
                            ? `총 ${previewReview.rows.length}건 중 상위 ${previewRows.length}건입니다. 전체 행의 수정·확정은 다음 검토 화면에서 진행합니다.`
                            : '파일을 추출하면 상위 3행을 먼저 확인할 수 있습니다. 현재 행수·통화·금액은 미확인 상태입니다.'
                    }}
                </p>
                <div class="upload-preview-table">
                    <table>
                        <thead>
                            <tr>
                                <th>거래일자</th>
                                <th>종목/티커</th>
                                <th>유형</th>
                                <th>원문 금액</th>
                                <th>통화</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="(row, index) in previewRows"
                                :key="index"
                                class="upload-sample-row">
                                <td>{{ previewCell(row.date) }}</td>
                                <td>
                                    {{
                                        previewCell(
                                            row.securityName || row.symbol
                                        )
                                    }}
                                </td>
                                <td>
                                    <span class="upload-type-pill">{{
                                        previewType(row)
                                    }}</span>
                                </td>
                                <td>{{ previewAmount(row.amount) }}</td>
                                <td>{{ row.currency || '미지정' }}</td>
                            </tr>
                            <tr v-if="!previewRows.length">
                                <td colspan="5">
                                    <StitchSymbol name="description" /><strong
                                        >아직 추출하지 않았습니다.</strong
                                    >
                                    <p>행수·통화·금액은 미확인 상태입니다.</p>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div v-if="previewRows.length" class="upload-preview-cards">
                    <article
                        v-for="(row, index) in previewRows"
                        :key="index"
                        class="upload-sample-card">
                        <div>
                            <strong>{{
                                previewCell(row.securityName || row.symbol)
                            }}</strong
                            ><span>{{ previewType(row) }}</span>
                        </div>
                        <div>
                            <span>{{ previewCell(row.symbol) }}</span
                            ><span>{{ previewCell(row.date) }}</span>
                        </div>
                        <div>
                            <span>검토 전 추출 금액</span
                            ><strong
                                >{{ previewAmount(row.amount) }}
                                {{ row.currency || '(통화 미지정)' }}</strong
                            >
                        </div>
                    </article>
                </div>
                <p class="upload-data-note">
                    통화가 없거나 금액이 비어 있으면 검토 화면에서 확인하세요.
                    미제공 값을 0이나 기본 통화로 표시하지 않습니다.
                </p>
            </article>
            <article class="import-card upload-account-info">
                <h3><StitchSymbol name="verified_user" />자료 대상 확인</h3>
                <dl>
                    <div>
                        <dt>매칭 대상 계좌</dt>
                        <dd>{{ accountLabel }}</dd>
                    </div>
                    <div>
                        <dt>자료 대상 확인</dt>
                        <dd>
                            {{
                                isPdf
                                    ? 'PDF 추출 후 명의 확인'
                                    : confirmed
                                      ? '사용자 확인 표시됨'
                                      : '필수 확인 체크 필요'
                            }}
                        </dd>
                    </div>
                    <div>
                        <dt>자료 인식 상태</dt>
                        <dd>
                            {{
                                previewReady
                                    ? `${previewReview.rows.length}건 추출 · 검토 필요`
                                    : '추출 전 · 미확인'
                            }}
                        </dd>
                    </div>
                </dl>
                <p class="field-note">
                    확인 체크는 사용자 확인 표시입니다. 금융기관의 계좌 소유권
                    검증 완료를 뜻하지 않습니다.
                </p>
            </article>
            <details class="upload-existing-guides">
                <summary>지원 규격·양식과 거래 유형 안내</summary>
                <article class="import-card guide-card">
                    <h3>
                        <i class="pi pi-book" aria-hidden="true" />양식과 거래
                        유형 가이드
                    </h3>
                    <details :open="isPdf">
                        <summary>토스 거래내역 PDF 추출 안내</summary>
                        <div class="guide-detail">
                            <strong>대용량 추출 규칙</strong>
                            <p>
                                파일당 최대 10,000행을 추출하고 200행씩 나누어
                                저장합니다. 여러 파일의 중복 거래는 저장 시
                                확인합니다.
                            </p>
                            <p>
                                추출 후 종목 코드·거래 유형·금액을 검토하세요.
                                조회 종료일은 마지막 거래일로 자동 입력됩니다.
                            </p>
                        </div>
                    </details>
                    <details>
                        <summary>잔고 CSV 등록 시 주의사항</summary>
                        <div class="guide-detail">
                            <strong>전체 잔고 대체</strong>
                            <p>
                                기준일의 전체 보유 종목을 넣으세요. 새 잔고는
                                해당 계좌의 이전 잔고를 대체합니다. 빠진 종목은
                                새 잔고에서 제외됩니다.
                            </p>
                            <p>
                                잔고 amount는 기준일 평가액이며 모르면
                                비워둡니다. 현금 종목은 CASH를 사용하세요.
                            </p>
                        </div>
                    </details>
                    <details>
                        <summary>CSV 양식과 거래 유형</summary>
                        <div class="guide-detail">
                            <p>
                                거래 amount는 거래 금액입니다. 거래 고유번호
                                externalId는 같은 계좌에서 재업로드·조회기간
                                변경에도 같아야 합니다.
                            </p>
                            <pre>
date,symbol,quantity,amount,currency,type,externalId
2026-10-15,AAPL,2,500,USD,buy,broker-trade-001</pre
                            >
                            <p>
                                거래 유형: buy, sell, dividend,
                                dividend_reversal, cash_in, cash_out,
                                transfer_in, transfer_out, split. 잔고는
                                type,externalId 열이 필요 없습니다.
                            </p>
                            <p>
                                매수 자금 배분에는 수수료 포함 정산액이
                                필요합니다. nativeSettlementAmount(USD) 또는
                                settlementAmount(KRW)를 추가할 수 있습니다. 현금
                                CASH 행의 cashKind가 exchange이면 계좌 내 환전
                                후보로 분류합니다.
                            </p>
                        </div>
                    </details>
                    <details>
                        <summary>UTF-8 CSV·XLSX 지원 규격</summary>
                        <div class="guide-detail">
                            <p>
                                표준 CSV는 UTF-8, XLSX는 첫 시트·첫 행 제목을
                                사용합니다. 최대 200행·50열·2MB를 지원합니다.
                            </p>
                            <p>
                                증권사별 양식이나 CP949 파일은 ‘증권사 CSV·XLSX
                                열 연결’에서 열과 인코딩을 지정하세요.
                            </p>
                        </div>
                    </details>
                </article>
                <article class="import-card guide-card">
                    <h3>
                        <i class="pi pi-download" aria-hidden="true" />표준 샘플
                        양식 다운로드
                    </h3>
                    <p class="field-note">
                        예시 행을 실제 자료로 바꿔 사용하세요. 엑셀·구글
                        시트에서도 열 수 있습니다.
                    </p>
                    <a
                        v-for="sample in samples"
                        :key="sample.name"
                        :href="sample.href"
                        :download="sample.name"
                        class="sample-link"
                        ><i class="pi pi-file" aria-hidden="true" /><span>{{
                            sample.name
                        }}</span
                        ><i class="pi pi-download" aria-hidden="true"
                    /></a>
                </article>
            </details>
        </aside>
    </div>
</template>

<style scoped>
    .import-layout {
        --import-tint: color-mix(
            in srgb,
            var(--app-accent) 7%,
            var(--app-surface)
        );
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
        gap: 24px;
        align-items: start;
    }
    .import-form,
    .import-fields,
    .import-guide {
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
    }
    .import-fields,
    .import-guide {
        display: grid;
        gap: 24px;
    }
    .import-card {
        min-width: 0;
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
        box-shadow: 0 1px 3px rgb(23 32 51 / 3%);
    }
    .card-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
    }
    h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 18px;
        line-height: 1.5;
        letter-spacing: -0.02em;
    }
    .step-number {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 26px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        color: var(--app-accent-contrast);
        background: var(--app-accent);
        font-size: 14px;
    }
    .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 9px;
        border-radius: 20px;
        background: var(--import-tint);
        color: var(--app-accent);
        font-size: 11px;
        font-weight: 650;
    }
    .field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 20px 16px;
    }
    .import-field {
        display: grid;
        align-content: start;
        gap: 6px;
        min-width: 0;
    }
    .import-field > label {
        font-size: 13px;
        font-weight: 650;
    }
    .import-field > .p-select,
    .import-field > .p-inputtext {
        width: 100%;
        min-width: 0;
    }
    small,
    .field-note {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.7;
    }
    p {
        margin: 0;
    }
    .import-notice {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        padding: 14px;
        margin-top: 20px;
        border-radius: 9px;
        background: var(--import-tint);
        color: var(--app-muted);
        font-size: 13px;
    }
    .import-notice > i {
        color: var(--app-accent);
        margin-top: 4px;
    }
    .import-notice strong {
        color: var(--app-text);
    }
    /* Public FileUpload PT sections keep drag/drop and validation in PrimeVue. */
    :deep(.import-uploader-header) {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding-bottom: 14px;
    }
    :deep(.import-uploader-content) {
        min-width: 0;
        padding: 16px;
        border: 1px dashed var(--app-border);
        border-radius: 12px;
        background: var(--import-tint);
    }
    :deep(.import-uploader-content[data-p-highlight='true']) {
        border-color: var(--app-accent);
    }
    .import-dropzone {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 22px 10px;
        text-align: center;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--app-text);
        font: inherit;
        cursor: pointer;
    }
    .import-dropzone:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 4px;
        border-radius: 8px;
    }
    .import-dropzone:disabled {
        cursor: default;
    }
    .dropzone-touch {
        display: none;
    }
    .dropzone-icon {
        display: grid;
        place-items: center;
        width: 60px;
        height: 60px;
        margin-bottom: 6px;
        background: var(--app-surface);
        color: var(--app-accent);
        border-radius: 50%;
    }
    .dropzone-icon i {
        font-size: 28px;
    }
    .dropzone-description {
        color: var(--app-muted);
        font-size: 13px;
    }
    @media (max-width: 767px), (hover: none), (pointer: coarse) {
        .dropzone-desktop {
            display: none;
        }
        .dropzone-touch {
            display: block;
        }
    }
    .import-file-list {
        display: grid;
        gap: 10px;
        list-style: none;
        margin: 0;
        padding: 0;
    }
    .import-file {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--app-surface);
        border-radius: 9px;
    }
    .file-icon {
        display: grid;
        place-items: center;
        flex-shrink: 0;
        width: 42px;
        height: 44px;
        border-radius: 8px;
        color: var(--app-accent);
        background: var(--import-tint);
    }
    .file-icon i {
        font-size: 24px;
    }
    .file-info {
        flex: 1;
        min-width: 0;
    }
    .file-info strong {
        display: block;
        overflow-wrap: anywhere;
        font-size: 14px;
    }
    .field-note {
        margin-top: 12px;
    }
    .password-box {
        display: grid;
        gap: 14px;
        padding: 16px;
        border-radius: 12px;
        background: var(--import-tint);
    }
    .password-control {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .password-control .p-inputtext {
        flex: 1;
        width: 100%;
        min-width: 0;
    }
    .password-box .field-note {
        margin: 0;
    }
    .import-check {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        font-size: 13px;
        line-height: 1.7;
        cursor: pointer;
    }
    .import-check input {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin: 3px 0 0;
        accent-color: var(--app-accent);
    }
    .password-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .password-actions .p-button {
        padding: 4px 0;
        margin-right: 14px;
        font-size: 12px;
    }
    .submit-actions {
        display: flex;
        gap: 12px;
        margin-top: 20px;
    }
    .preview-button {
        flex: 1;
    }
    .submit-note {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        justify-content: center;
    }
    .submit-note i {
        margin-top: 4px;
        color: var(--app-accent);
    }
    .guide-card {
        padding: 18px;
    }
    .guide-card h3 {
        font-size: 16px;
    }
    .guide-card h3 > i {
        color: var(--app-accent);
    }
    .import-progress {
        list-style: none;
        margin: 0;
        padding: 0;
    }
    .import-progress li {
        display: flex;
        gap: 12px;
        position: relative;
        padding-bottom: 20px;
    }
    .import-progress li:last-child {
        padding-bottom: 0;
    }
    .import-progress li:not(:last-child)::before {
        content: '';
        position: absolute;
        left: 15px;
        top: 30px;
        bottom: 0;
        border-left: 2px solid var(--app-border);
    }
    .import-progress li > span {
        display: grid;
        place-items: center;
        flex: 0 0 32px;
        height: 32px;
        border-radius: 50%;
        background: var(--import-tint);
        color: var(--app-muted);
        font-size: 13px;
        font-weight: 650;
    }
    .import-progress strong {
        display: block;
        font-size: 14px;
    }
    .import-progress small {
        display: block;
        font-size: 12px;
    }
    .import-progress .current > span {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
        box-shadow: 0 0 0 4px var(--import-tint);
    }
    .import-progress .current strong {
        color: var(--app-accent);
    }
    details {
        margin-top: 8px;
        padding: 12px;
        border-radius: 9px;
        background: var(--import-tint);
        font-size: 13px;
    }
    .guide-card > details:first-of-type {
        margin-top: 16px;
    }
    summary {
        cursor: pointer;
        font-weight: 650;
    }
    .guide-detail {
        padding: 12px;
        margin-top: 10px;
        border-radius: 6px;
        background: var(--app-surface);
        color: var(--app-muted);
    }
    .guide-detail p + p {
        margin-top: 10px;
    }
    .guide-detail strong {
        color: var(--app-text);
    }
    pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-size: 11px;
    }
    .sample-link {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        margin-top: 8px;
        border-radius: 8px;
        background: var(--import-tint);
        color: var(--app-text);
        text-decoration: none;
        font-size: 13px;
    }
    .sample-link span {
        flex: 1;
        overflow-wrap: anywhere;
    }
    .sample-link:hover {
        color: var(--app-accent);
    }
    a:focus-visible,
    summary:focus-visible,
    input[type='checkbox']:focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 4px;
    }
    @media (max-width: 1100px) {
        .import-layout {
            grid-template-columns: minmax(0, 1fr);
        }
        .import-guide {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
    }
    @media (max-width: 600px) {
        .import-layout,
        .import-fields,
        .import-guide {
            gap: 16px;
        }
        .import-guide,
        .field-grid {
            grid-template-columns: minmax(0, 1fr);
        }
        .import-card {
            padding: 18px 16px;
        }
        h3 {
            font-size: 16px;
        }
        .card-heading {
            gap: 8px;
        }
        .submit-actions {
            flex-direction: column-reverse;
        }
        .import-file {
            padding: 8px;
            gap: 8px;
        }
        .file-icon {
            display: none;
        }
    }

    /* Preserve existing file/password/validation flows in the reference content shell. */
    .import-layout {
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 20px;
    }
    .upload-heading {
        grid-column: 1/-1;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas: 'meta meta' 'copy action' 'steps steps';
        column-gap: 12px;
        row-gap: 8px;
        align-items: center;
    }
    .upload-badges {
        grid-area: meta;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .upload-badges :deep(.p-tag) {
        font-size: 12px;
        line-height: 16px;
        padding: 2px 8px;
        border: 1px solid var(--app-accent-border, var(--app-accent));
        background: var(--import-tint);
        color: var(--app-accent);
        border-radius: 4px;
    }
    .upload-badges :deep(.p-tag-secondary) {
        border-color: var(--app-warning-border, var(--app-warning-text));
        background: var(--app-warning-light);
        color: var(--app-warning-text);
    }
    .upload-heading-row {
        display: contents;
    }
    .upload-heading-row > div {
        grid-area: copy;
    }
    .upload-heading-row h2 {
        font-size: 24px;
        line-height: 32px;
        margin: 0;
        color: var(--app-brand-brown);
    }
    .upload-heading-row p {
        font-size: 12px;
        line-height: 19.5px;
        color: var(--app-muted);
        margin: 4px 0 0;
    }
    .upload-heading-row :deep(.p-button) {
        grid-area: action;
        font-size: 12px;
        min-height: 44px;
        padding: 8px 14px;
        border-radius: 8px;
        color: var(--app-accent);
        border-color: var(--app-accent);
        gap: 6px;
    }
    .upload-heading-row .stitch-symbol {
        font-size: 16px;
    }
    .upload-steps {
        grid-area: steps;
        display: flex;
        align-items: center;
        list-style: none;
        padding: 12px;
        margin: 8px 0 0;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
    }
    .upload-steps li {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--app-muted);
    }
    .upload-steps .upload-step-connector {
        display: block;
        flex: 0 0 32px;
        height: 1px;
        margin: 0 8px;
        background: var(--app-border);
    }
    .upload-steps li > span {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid var(--app-border);
        font-size: 12px;
        flex-shrink: 0;
    }
    .upload-steps [aria-current] {
        color: var(--app-accent);
    }
    .upload-steps [aria-current] > span {
        background: var(--app-accent);
        color: var(--app-accent-contrast);
    }
    .upload-steps strong {
        display: block;
        font-size: 12px;
        line-height: 16px;
    }
    .upload-steps small {
        display: block;
        font-size: 10px;
        line-height: 16px;
        font-weight: 400;
    }
    .import-form {
        grid-column: 1 / span 7;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
        min-width: 0;
    }
    .import-fields {
        gap: 16px;
    }
    .import-form .import-card {
        padding: 0;
        border: 0;
        box-shadow: none;
        background: transparent;
    }
    .import-form .card-heading {
        margin-bottom: 6px;
        gap: 8px;
    }
    .import-form h3,
    .import-guide h3 {
        font-size: 14px;
        line-height: 20px;
        gap: 8px;
    }
    .import-form .step-number {
        display: none;
    }
    .import-form .status-pill {
        font-size: 11px;
        padding: 2px 6px;
    }
    .field-grid {
        gap: 12px;
    }
    .import-field label {
        font-size: 12px;
    }
    .import-kind-choice {
        grid-column: 1/-1;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px;
        background: var(--app-bg);
        border: 1px solid var(--app-border);
        border-radius: 8px;
        padding: 4px;
        min-width: 0;
        margin: 0;
    }
    .import-kind-choice legend {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip-path: inset(50%);
    }
    .import-kind-choice label {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
        padding: 10px 8px;
        border-radius: 6px;
        color: var(--app-muted);
        border: 1px solid transparent;
    }
    .import-kind-choice .stitch-symbol {
        font-size: 20px;
    }
    .import-kind-choice :deep(.p-radiobutton) {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
    }
    .import-kind-choice label:focus-within {
        outline: 2px solid var(--app-accent);
        outline-offset: 1px;
    }
    .import-kind-choice label.selected {
        color: var(--app-accent);
        background: var(--app-surface);
        border-color: var(--app-accent);
    }
    .import-notice {
        margin-top: 12px;
        font-size: 11px;
        line-height: 18px;
        padding: 10px;
        border-radius: 8px;
    }
    .import-notice p {
        font-size: 11px;
        line-height: 18px;
    }
    .import-file {
        padding: 12px;
        gap: 10px;
        border-radius: 8px;
    }
    .file-icon {
        width: 36px;
        height: 42px;
        border-radius: 6px;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .file-info strong {
        font-size: 12px;
        line-height: 18px;
    }
    .file-info small {
        font-size: 11px;
        line-height: 16px;
    }
    .import-form .password-unneeded {
        display: flex;
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        align-items: flex-start;
    }
    .password-unneeded > .stitch-symbol {
        font-size: 24px;
        color: var(--app-muted);
        flex-shrink: 0;
    }
    .password-unneeded p {
        font-size: 11px;
        line-height: 18px;
        margin: 4px 0 0;
        color: var(--app-muted);
    }
    .password-unneeded :deep(.p-tag) {
        font-size: 10px;
        flex-shrink: 0;
    }
    .upload-account-label {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        background: var(--app-bg);
        padding: 10px;
        border-radius: 6px;
        margin-bottom: 12px;
    }
    .upload-account-label .stitch-symbol {
        font-size: 16px;
        color: var(--app-accent);
    }
    .upload-account-label strong {
        margin-inline-start: auto;
        overflow-wrap: anywhere;
    }
    .import-check {
        font-size: 12px;
        line-height: 20px;
    }
    .import-check span {
        font-size: 12px;
        line-height: 20px;
    }
    .submit-actions {
        margin-top: 14px;
        gap: 8px;
    }
    .submit-actions :deep(.p-button) {
        font-size: 12px;
        min-height: 40px;
    }
    .import-guide {
        grid-column: 8 / span 5;
        gap: 16px;
    }
    .import-guide .import-card {
        padding: 16px;
        border-radius: 12px;
    }
    .import-guide .card-heading {
        margin-bottom: 12px;
        gap: 6px;
    }
    .upload-preview .card-heading {
        align-items: flex-start;
    }
    .upload-preview :deep(.p-tag) {
        font-size: 10px;
        line-height: 14px;
        white-space: nowrap;
    }
    .upload-preview .field-note {
        font-size: 11px;
        line-height: 18px;
    }
    .upload-preview-table {
        overflow-x: auto;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        margin: 12px 0;
    }
    .upload-preview-table table {
        width: 100%;
        font-size: 10px;
        border-collapse: collapse;
    }
    .upload-preview-table th {
        padding: 8px 4px;
        background: var(--app-bg);
        text-align: left;
        white-space: nowrap;
    }
    .upload-preview-table td {
        padding: 24px 12px;
        text-align: center;
        color: var(--app-muted);
    }
    .upload-preview-table td > .stitch-symbol {
        display: block;
        font-size: 28px;
        margin: 0 auto 12px;
    }
    .upload-preview-table td strong {
        font-size: 12px;
        line-height: 18px;
    }
    .upload-preview-table td p {
        font-size: 11px;
        line-height: 18px;
        margin: 4px 0 0;
    }
    .upload-data-note {
        padding: 12px;
        font-size: 11px;
        line-height: 18px;
        background: var(--app-warning-light);
        color: var(--app-warning-text);
        border-radius: 8px;
        margin: 0;
    }
    .upload-account-info dl {
        display: grid;
        gap: 10px;
        font-size: 11px;
        line-height: 18px;
        margin: 12px 0 0;
    }
    .upload-account-info dl > div {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }
    .upload-account-info dt {
        color: var(--app-muted);
    }
    .upload-account-info dd {
        text-align: right;
        margin: 0;
        overflow-wrap: anywhere;
    }
    .upload-account-info .field-note {
        font-size: 10px;
        line-height: 16px;
        margin-top: 12px;
    }
    .upload-existing-guides > summary {
        font-size: 12px;
        cursor: pointer;
        color: var(--app-muted);
        padding: 12px;
    }
    .upload-existing-guides .guide-card {
        margin-top: 8px;
    }
    @media (max-width: 767px) {
        .import-form,
        .import-guide {
            grid-column: 1/-1;
        }
    }
    @media (max-width: 640px) {
        .import-layout {
            gap: 16px;
            padding-bottom: 48px;
        }
        .upload-heading {
            grid-template-areas: 'meta action' 'copy copy' 'steps steps';
            gap: 16px 8px;
        }
        .upload-badges {
            gap: 6px;
        }
        .upload-badges :deep(.p-tag) {
            font-size: 11px;
            line-height: 16.5px;
        }
        .upload-heading-row :deep(.p-button) {
            padding: 6px 14px;
            white-space: nowrap;
            font-size: 12px;
        }
        .upload-heading-row h2 {
            font-size: 20px;
            line-height: 28px;
        }
        .upload-heading-row p {
            font-size: 12px;
            line-height: 19.5px;
        }
        .upload-steps {
            padding: 12px;
            margin: 0;
            gap: 0;
        }
        .upload-steps .upload-step-connector {
            flex-basis: 16px;
            margin: 0;
        }
        .upload-steps li {
            flex-direction: row;
            gap: 6px;
            text-align: left;
            min-width: 0;
        }
        .upload-steps li > span {
            font-size: 11px;
        }
        .upload-steps strong {
            font-size: 11px;
            line-height: 16px;
        }
        .upload-steps small {
            font-size: 9px;
            line-height: 13.5px;
        }
        .import-form {
            padding: 14px;
        }
        .import-fields {
            gap: 16px;
        }
        .field-grid {
            grid-template-columns: minmax(0, 1fr);
        }
        .import-kind-choice label {
            font-size: 11px;
            padding: 10px 6px;
            gap: 4px;
        }
        .import-kind-choice .stitch-symbol {
            font-size: 18px;
        }
        .import-form .password-unneeded {
            flex-wrap: wrap;
        }
        .import-guide .import-card {
            padding: 14px;
        }
        .upload-account-label strong {
            width: 100%;
            margin: 0;
        }
        .submit-actions :deep(.p-button) {
            min-height: 44px;
        }
    }

    .import-guide {
        grid-template-columns: minmax(0, 1fr);
    }
    .upload-file-rules {
        margin-top: 14px;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
    }
    .upload-file-rules h4 {
        font-size: 12px;
        line-height: 18px;
        margin: 0 0 10px;
    }
    .upload-file-rules > div {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }
    .upload-file-rules section {
        padding: 8px;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 6px;
        min-width: 0;
    }
    .upload-file-rules strong {
        font-size: 11px;
        line-height: 16px;
    }
    .upload-file-rules p {
        font-size: 10px;
        line-height: 16px;
        color: var(--app-muted);
        margin: 4px 0 0;
    }
    .upload-file-rules > p {
        margin-top: 8px;
    }
    :global(.p-dark) .upload-heading-row h2 {
        color: var(--app-text);
    }
    @media (max-width: 640px) {
        .upload-file-rules > div {
            grid-template-columns: minmax(0, 1fr);
        }
    }

    .import-uploader-header {
        background: transparent;
        padding: 0;
    }
    .import-uploader-header :deep(.p-button) {
        font-size: 12px;
        min-height: 36px;
        padding: 8px 12px;
    }
    .import-uploader-content {
        padding: 0;
        border: 0;
        background: transparent;
    }
    .import-file-list {
        margin: 12px 0 0;
        gap: 8px;
    }
    :global(html:not(.p-dark)) .upload-heading-row h2 {
        color: #382418;
    }
    .upload-sample-row td {
        text-align: left;
        padding: 10px 8px;
        font-size: 11px;
        line-height: 18px;
        overflow-wrap: anywhere;
    }
    .upload-preview-cards {
        display: none;
    }
    @media (max-width: 640px) {
        .upload-preview:has(.upload-preview-cards) .upload-preview-table {
            display: none;
        }
        .upload-preview-cards {
            display: grid;
            gap: 10px;
        }
        .upload-sample-card {
            padding: 10px;
            border: 1px solid var(--app-border);
            border-radius: 8px;
            background: var(--app-bg);
            min-width: 0;
        }
        .upload-sample-card > div {
            display: flex;
            justify-content: space-between;
            gap: 8px;
            font-size: 11px;
            line-height: 18px;
            margin-bottom: 6px;
            overflow-wrap: anywhere;
        }
        .upload-sample-card > div:first-child {
            font-size: 12px;
        }
        .upload-sample-card > div:last-child {
            border-top: 1px solid var(--app-border);
            padding-top: 6px;
            margin-bottom: 0;
        }
        .upload-sample-card strong {
            color: var(--app-text);
        }
    }
    .import-form h3 {
        font-size: 12px;
        line-height: 18px;
    }
    .import-kind-choice label {
        min-height: 44px;
    }
    .upload-settings {
        grid-column: 1/-1;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        min-width: 0;
    }
    .upload-settings > summary {
        padding: 8px 10px;
        font-size: 11px;
        line-height: 18px;
        font-weight: 600;
        cursor: pointer;
        color: var(--app-muted);
    }
    .settings-field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        padding: 4px 10px 10px;
    }
    @media (max-width: 640px) {
        .settings-field-grid {
            grid-template-columns: minmax(0, 1fr);
        }
    }
    .upload-kind-guidance {
        grid-column: 1/-1;
        font-size: 11px;
        line-height: 18px;
        color: var(--app-muted);
        margin: 0;
    }
    .upload-settings .import-notice {
        margin: 0 10px 10px;
    }
    .upload-type-pill {
        display: inline-flex;
        padding: 2px 6px;
        border: 1px solid var(--app-accent);
        border-radius: 4px;
        color: var(--app-accent);
        background: var(--import-tint);
        line-height: 16px;
        word-break: keep-all;
    }
</style>
