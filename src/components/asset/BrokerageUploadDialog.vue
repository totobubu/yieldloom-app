<!-- src/components/asset/BrokerageUploadDialog.vue -->
<template>
    <Dialog
        v-model:visible="isVisible"
        modal
        :header="currentStep === 'select' ? '증권사 선택' : '거래내역서 업로드'"
        :style="{ width: '600px' }"
        :closable="!isProcessing">
        <!-- Step 1: 증권사 선택 -->
        <div v-if="currentStep === 'select'" class="flex flex-column gap-4">
            <div class="field">
                <label class="font-bold mb-2 block"
                    >증권사를 선택해주세요</label
                >
                <Dropdown
                    v-model="selectedBrokerage"
                    :options="brokerageOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="증권사 선택"
                    class="w-full"
                    :disabled="isProcessing" />
            </div>

            <Message v-if="selectedBrokerage" severity="info">
                <div class="flex flex-column gap-2">
                    <strong>{{
                        getBrokerageInfo(selectedBrokerage).name
                    }}</strong>
                    <p class="m-0">
                        {{ getBrokerageInfo(selectedBrokerage).description }}
                    </p>
                    <p class="m-0 text-sm">
                        지원 파일:
                        {{ getBrokerageInfo(selectedBrokerage).fileFormat }}
                    </p>
                </div>
            </Message>
        </div>

        <!-- Step 2: PDF 업로드 -->
        <div v-if="currentStep === 'upload'" class="flex flex-column gap-4">
            <div class="field">
                <label class="font-bold mb-2 block">
                    {{ getBrokerageInfo(selectedBrokerage).name }} 거래내역서
                    업로드
                </label>
                <FileUpload
                    ref="fileUploadRef"
                    mode="basic"
                    accept="application/pdf"
                    :maxFileSize="10000000"
                    :auto="false"
                    chooseLabel="PDF 선택"
                    @select="onFileSelect"
                    :disabled="isProcessing"
                    multiple
                    class="w-full" />
            </div>

            <div v-if="selectedFiles.length > 0" class="flex flex-column gap-2">
                <Message
                    v-for="file in selectedFiles"
                    :key="file.name"
                    severity="success">
                    <div class="flex align-items-center gap-2">
                        <i class="pi pi-file-pdf text-2xl"></i>
                        <div>
                            <strong>{{ file.name }}</strong>
                            <p class="m-0 text-sm">
                                {{ formatFileSize(file.size) }}
                            </p>
                        </div>
                    </div>
                </Message>
            </div>

            <Message v-if="uploadError" severity="error">
                {{ uploadError }}
            </Message>

            <div v-if="isProcessing" class="flex flex-column gap-2">
                <Skeleton height="1rem" />
                <Skeleton height="1rem" />
                <Skeleton height="1rem" />
            </div>

            <Message
                v-else-if="analysisComplete && extractedData"
                severity="success"
                :closable="false">
                <div class="flex flex-column gap-1">
                    <span class="text-sm text-color-secondary"
                        >분석이 완료되었습니다.</span
                    >
                    <strong
                        >거래 건수: {{ extractedData.total_count }}건</strong
                    >
                </div>
            </Message>
        </div>

        <!-- Step 3: 계좌 정보 확인 -->
        <div v-if="currentStep === 'confirm'" class="flex flex-column gap-4">
            <Message severity="success">
                <i class="pi pi-check-circle"></i> 거래내역서를 성공적으로
                분석했습니다!
            </Message>

            <div class="surface-50 p-4 border-round">
                <h4 class="mt-0 mb-3">추출된 정보</h4>
                <div class="flex flex-column gap-2">
                    <div class="flex justify-content-between">
                        <span class="text-color-secondary">증권사:</span>
                        <strong>{{
                            getBrokerageInfo(selectedBrokerage).name
                        }}</strong>
                    </div>
                    <div class="flex justify-content-between">
                        <span class="text-color-secondary">계좌번호:</span>
                        <strong>{{
                            extractedData?.metadata?.account_number
                        }}</strong>
                    </div>
                    <div class="flex justify-content-between">
                        <span class="text-color-secondary">거래 기간:</span>
                        <strong>{{ extractedData?.metadata?.period }}</strong>
                    </div>
                    <div class="flex justify-content-between">
                        <span class="text-color-secondary">거래 건수:</span>
                        <strong>{{ extractedData?.total_count }}건</strong>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex justify-content-end gap-2">
                <Button
                    v-if="currentStep === 'select'"
                    label="취소"
                    severity="secondary"
                    @click="closeDialog"
                    :disabled="isProcessing" />
                <Button
                    v-if="currentStep === 'select'"
                    label="다음"
                    @click="goToUploadStep"
                    :disabled="!selectedBrokerage || isProcessing" />

                <Button
                    v-if="currentStep === 'upload'"
                    label="이전"
                    severity="secondary"
                    @click="currentStep = 'select'"
                    :disabled="isProcessing" />
                <Button
                    v-if="currentStep === 'upload' && !analysisComplete"
                    label="분석하기"
                    @click="analyzeFile"
                    :disabled="selectedFiles.length === 0 || isProcessing"
                    :loading="isProcessing" />
                <Button
                    v-if="currentStep === 'upload' && analysisComplete"
                    label="결과 확인"
                    icon="pi pi-check"
                    @click="currentStep = 'confirm'"
                    :disabled="isProcessing" />

                <Button
                    v-if="currentStep === 'confirm'"
                    label="취소"
                    severity="secondary"
                    @click="closeDialog"
                    :disabled="isProcessing" />
                <Button
                    v-if="currentStep === 'confirm'"
                    label="등록하기"
                    @click="registerAccount"
                    :loading="isProcessing" />
            </div>
        </template>
    </Dialog>
</template>

<script setup>
    import { ref, computed, watch } from 'vue';
    import Dialog from 'primevue/dialog';
    import Dropdown from 'primevue/dropdown';
    import FileUpload from 'primevue/fileupload';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import Skeleton from 'primevue/skeleton';
    import InputText from 'primevue/inputtext';
    import axios from 'axios';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        memberId: {
            type: String,
            required: true,
        },
    });

    const emit = defineEmits(['update:visible', 'upload-complete']);

    const isVisible = computed({
        get: () => props.visible,
        set: (value) => emit('update:visible', value),
    });

    // 증권사 옵션
    const brokerageOptions = [
        { label: '토스증권', value: 'toss' },
        { label: 'kb자산운용 (준비중)', value: 'kb', disabled: true },
        { label: '미래에셋증권 (준비중)', value: 'mirae', disabled: true },
        { label: '삼성증권 (준비중)', value: 'samsung', disabled: true },
    ];

    // 증권사 정보
    const brokerageInfoMap = {
        toss: {
            name: '토스증권',
            description:
                '토스증권 거래내역서를 자동으로 분석하여 계좌와 거래내역을 등록합니다.',
            fileFormat: 'PDF',
        },
        kb: {
            name: 'kb자산운용',
            description: 'kb자산운용 거래내역서를 지원합니다. (준비중)',
            fileFormat: 'PDF, Excel',
        },
    };

    const getBrokerageInfo = (brokerage) => {
        return (
            brokerageInfoMap[brokerage] || {
                name: '',
                description: '',
                fileFormat: '',
            }
        );
    };

    // 상태
    const currentStep = ref('select'); // 'select', 'upload', 'confirm'
    const selectedBrokerage = ref(null);
    const selectedFiles = ref([]);
    const fileUploadRef = ref(null);
    const isProcessing = ref(false);
    const uploadError = ref(null);
    const extractedData = ref(null);
    const analysisComplete = ref(false);
    const accountName = ref('');

    // 파일 선택
    const onFileSelect = (event) => {
        selectedFiles.value = event.files;
        uploadError.value = null;
        analysisComplete.value = false;
        extractedData.value = null;
    };

    // 파일 크기 포맷팅
    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (
            Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
        );
    };

    // 다음 단계로
    const goToUploadStep = () => {
        currentStep.value = 'upload';
    };

    // PDF 분석
    const analyzeFile = async () => {
        if (!selectedFiles.value.length) return;

        isProcessing.value = true;
        uploadError.value = null;
        analysisComplete.value = false;
        extractedData.value = null;

        try {
            // 모든 파일에 대해 병렬 요청
            const promises = selectedFiles.value.map((file) => {
                const formData = new FormData();
                formData.append('file', file);
                formData.append('brokerage', selectedBrokerage.value);

                return axios.post('/api/parsePdfTransaction', formData, {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                });
            });

            const results = await Promise.all(promises);

            // 결과 합치기
            let combinedTransactions = [];
            let metadata = null;

            results.forEach((response) => {
                const data = response.data;
                if (data) {
                    // 메타데이터는 첫 번째 성공한 응답의 것을 사용 (또는 병합 로직 필요 시 수정)
                    if (!metadata && data.metadata) {
                        metadata = data.metadata;
                    }
                    if (data.transactions) {
                        combinedTransactions = combinedTransactions.concat(
                            data.transactions
                        );
                    }
                }
            });

            extractedData.value = {
                metadata: metadata,
                transactions: combinedTransactions,
                total_count: combinedTransactions.length,
            };

            analysisComplete.value = true;

            // 계좌 이름 자동 생성 (계좌번호만 사용)
            if (extractedData.value?.metadata?.account_number) {
                accountName.value = extractedData.value.metadata.account_number;
            }
        } catch (error) {
            console.error('PDF 분석 실패:', error);
            uploadError.value =
                error.response?.data?.error ||
                'PDF 분석에 실패했습니다. 다시 시도해주세요.';
            analysisComplete.value = false;
        } finally {
            isProcessing.value = false;
        }
    };

    // 계좌 등록
    const registerAccount = async () => {
        isProcessing.value = true;

        try {
            emit('upload-complete', {
                brokerage: selectedBrokerage.value,
                brokerageName: getBrokerageInfo(selectedBrokerage.value).name,
                accountNumber: extractedData.value.metadata.account_number,
                accountName: accountName.value,
                extractedData: extractedData.value,
            });

            closeDialog();
        } catch (error) {
            console.error('계좌 등록 실패:', error);
            uploadError.value = '계좌 등록에 실패했습니다. 다시 시도해주세요.';
        } finally {
            isProcessing.value = false;
        }
    };

    // 다이얼로그 닫기
    const closeDialog = () => {
        isVisible.value = false;
        // 상태 초기화
        setTimeout(() => {
            currentStep.value = 'select';
            selectedBrokerage.value = null;
            selectedFiles.value = [];
            uploadError.value = null;
            extractedData.value = null;
            accountName.value = '';
            analysisComplete.value = false;
        }, 300);
    };

    // visible 변경 시 초기화
    watch(isVisible, (newVal) => {
        if (!newVal) {
            setTimeout(() => {
                currentStep.value = 'select';
                selectedBrokerage.value = null;
                selectedFiles.value = [];
                uploadError.value = null;
                extractedData.value = null;
                accountName.value = '';
                analysisComplete.value = false;
            }, 300);
        }
    });
</script>

<style scoped>
    .field {
        margin-bottom: 1rem;
    }
</style>
