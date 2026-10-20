<script setup>
    import { computed, ref } from 'vue';
    import Button from 'primevue/button';
    import FileUpload from 'primevue/fileupload';
    import InputText from 'primevue/inputtext';
    import Message from 'primevue/message';
    import Select from 'primevue/select';

    defineProps({
        accountLabel: { type: String, required: true },
        passwordConfigured: Boolean,
        isOwner: Boolean,
        busy: Boolean,
        reviewing: Boolean,
        error: { type: String, default: '' },
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
    ]);
    const uploader = ref(null);
    const errorNotice = ref(null);
    const passwordInput = ref(null);
    const showPassword = ref(false);
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
    defineExpose({ clear, focusError });
</script>

<template>
    <div class="import-layout">
        <form
            class="import-form"
            aria-label="파일 업로드"
            @submit.prevent="emit('preview')">
            <fieldset :disabled="busy" class="import-fields">
                <article class="import-card">
                    <div class="card-heading">
                        <h3>
                            <span class="step-number">1</span>자료 종류 및 파일
                            형식 선택
                        </h3>
                        <span class="status-pill">필수 지정</span>
                    </div>
                    <div class="field-grid">
                        <div class="import-field">
                            <label for="import-kind">자료 종류</label>
                            <Select
                                v-model="kind"
                                input-id="import-kind"
                                :options="kindOptions"
                                option-label="label"
                                option-value="value"
                                aria-label="자료 종류"
                                :disabled="busy" />
                            <small>{{
                                kind === 'transactions'
                                    ? '매수·매도·배당 등 일자별 거래를 불러옵니다.'
                                    : '기준일의 전체 보유 종목과 수량을 불러옵니다.'
                            }}</small>
                        </div>
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
                                >거래내역서 조회 기간의 마지막 날입니다.</small
                            >
                        </div>
                    </div>
                    <div class="import-notice">
                        <i class="pi pi-info-circle" aria-hidden="true" />
                        <p v-if="isPdf">
                            <strong>토스 거래내역 PDF 안내</strong> · 최대
                            10,000행을 추출하며 저장은 200행씩 나눠 진행합니다.
                            조회 종료일은 PDF에서 추출된 마지막 거래일로 자동
                            입력됩니다.
                        </p>
                        <p v-else>
                            <strong>표준 CSV·XLSX 안내</strong> · 최대 200행,
                            파일당 2MB를 지원합니다.
                            {{
                                kind === 'holdings'
                                    ? '잔고는 기준일의 전체 보유 종목을 입력하세요. 새 잔고는 해당 계좌의 이전 잔고를 대체합니다.'
                                    : '거래 고유번호는 같은 계좌에서 다시 업로드해도 동일해야 합니다.'
                            }}
                        </p>
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
                                    <span class="file-icon"
                                        ><i
                                            :class="
                                                isPdf
                                                    ? 'pi pi-file-pdf'
                                                    : 'pi pi-file-excel'
                                            "
                                            aria-hidden="true"
                                    /></span>
                                    <div class="file-info">
                                        <strong>{{ file.name }}</strong
                                        ><small
                                            >{{ fileSize(file.size) }} ·
                                            {{ fileExtension }} · 추출
                                            대기</small
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
                    <p class="field-note">
                        파일당 최대 <strong>2MB</strong> ·
                        {{
                            isPdf
                                ? 'PDF 최대 20개 · 파일당 10,000행'
                                : '파일 1개 · 최대 200행'
                        }}
                    </p>
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
                            label="추출·미리보기"
                            icon="pi pi-arrow-right"
                            icon-pos="right"
                            :loading="busy"
                            :disabled="busy"
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
            <article class="import-card guide-card">
                <div class="card-heading">
                    <h3>자료 등록 단계</h3>
                    <span class="status-pill"
                        >{{ reviewing ? '2' : '1' }} / 3 단계</span
                    >
                </div>
                <ol class="import-progress">
                    <li
                        :aria-current="!reviewing ? 'step' : undefined"
                        :class="{ current: !reviewing }">
                        <span>1</span>
                        <div>
                            <strong>파일 선택 및 추출</strong
                            ><small>자료 종류와 파일을 확인합니다.</small>
                        </div>
                    </li>
                    <li
                        :aria-current="reviewing ? 'step' : undefined"
                        :class="{ current: reviewing }">
                        <span>2</span>
                        <div>
                            <strong>저장 전 검토</strong
                            ><small>추출된 내용과 오류를 확인합니다.</small>
                        </div>
                    </li>
                    <li>
                        <span>3</span>
                        <div>
                            <strong>포트폴리오에 저장</strong
                            ><small>검토를 마친 자료를 저장합니다.</small>
                        </div>
                    </li>
                </ol>
            </article>
            <article class="import-card guide-card">
                <h3>
                    <i class="pi pi-book" aria-hidden="true" />양식과 거래 유형
                    가이드
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
                            추출 후 종목 코드·거래 유형·금액을 검토하세요. 조회
                            종료일은 마지막 거래일로 자동 입력됩니다.
                        </p>
                    </div>
                </details>
                <details>
                    <summary>잔고 CSV 등록 시 주의사항</summary>
                    <div class="guide-detail">
                        <strong>전체 잔고 대체</strong>
                        <p>
                            기준일의 전체 보유 종목을 넣으세요. 새 잔고는 해당
                            계좌의 이전 잔고를 대체합니다. 빠진 종목은 새
                            잔고에서 제외됩니다.
                        </p>
                        <p>
                            잔고 amount는 기준일 평가액이며 모르면 비워둡니다.
                            현금 종목은 CASH를 사용하세요.
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
                            거래 유형: buy, sell, dividend, dividend_reversal,
                            cash_in, cash_out, transfer_in, transfer_out, split.
                            잔고는 type,externalId 열이 필요 없습니다.
                        </p>
                        <p>
                            매수 자금 배분에는 수수료 포함 정산액이 필요합니다.
                            nativeSettlementAmount(USD) 또는
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
                            증권사별 양식이나 CP949 파일은 ‘증권사 CSV·XLSX 열
                            연결’에서 열과 인코딩을 지정하세요.
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
                    예시 행을 실제 자료로 바꿔 사용하세요. 엑셀·구글 시트에서도
                    열 수 있습니다.
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
</style>
