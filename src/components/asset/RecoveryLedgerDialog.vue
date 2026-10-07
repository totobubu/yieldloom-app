<template>
    <Dialog
        :visible="visible"
        modal
        maximizable
        header="토스 원금 회수 원장"
        :style="{ width: 'min(1100px, 96vw)' }"
        @update:visible="$emit('update:visible', $event)">
        <Message severity="info" :closable="false" class="mb-3">
            PDF는 이 브라우저에서만 분석됩니다. 원본 파일은 업로드·저장하지 않으며,
            비밀번호도 이 대화상자 메모리에만 유지됩니다. 아래에서 승인한 원장 행만 계정에 저장됩니다.
        </Message>

        <div class="flex flex-wrap gap-3 align-items-center mb-3">
            <span class="field">
                <label>PDF 비밀번호</label>
                <input
                    v-model="statementPassword"
                    type="password"
                    autocomplete="current-password"
                    class="p-inputtext p-component"
                    placeholder="암호화 PDF에만 필요" />
            </span>
            <input
                ref="fileInput"
                type="file"
                accept="application/pdf"
                multiple
                class="hidden"
                @change="onFilesSelected" />
            <Button
                label="토스 PDF 선택"
                icon="pi pi-file-pdf"
                :loading="parsing"
                @click="fileInput?.click()" />
            <Button
                v-if="candidates.length"
                label="승인 행 저장"
                icon="pi pi-check"
                severity="success"
                :loading="saving"
                @click="saveApproved" />
            <small class="text-color-secondary">
                매매·배당·환전·입출금이 포함된 명세서를 각각 선택하세요.
            </small>
        </div>

        <div class="flex flex-wrap gap-2 align-items-end mb-3">
            <span class="field"><label>토스 accountSeq</label><InputNumber v-model="accountSeq" :useGrouping="false" /></span>
            <span class="field"><label>주문 시작일</label><input v-model="orderFrom" type="date" class="p-inputtext p-component" /></span>
            <Button label="API 종료주문 후보" icon="pi pi-download" outlined :loading="loadingOrders" :disabled="!accountSeq || !orderFrom" @click="loadOrderCandidates" />
            <small class="text-color-secondary">고정 IP가 있는 서버 또는 로컬 API 환경에서만 호출됩니다.</small>
        </div>

        <Message v-if="error" severity="error" class="mb-3">{{ error }}</Message>

        <div class="grid mb-3">
            <div class="col-12 md:col-3"><Card><template #content><small>누적 외부 투자금</small><strong class="block">{{ krw(summary.externalContributionsKrw) }}</strong></template></Card></div>
            <div class="col-12 md:col-3"><Card><template #content><small>세후 배당·이자</small><strong class="block text-green-600">{{ krw(summary.netIncomeKrw) }}</strong></template></Card></div>
            <div class="col-12 md:col-3"><Card><template #content><small>배당 기반 회수율</small><strong class="block">{{ percent(summary.incomeRecoveryRate) }}</strong></template></Card></div>
            <div class="col-12 md:col-3"><Card><template #content><small>계좌 외부 출금</small><strong class="block">{{ krw(summary.externalWithdrawalsKrw) }}</strong></template></Card></div>
        </div>

        <Message v-if="summary.missingFxCount" severity="warn" :closable="false" class="mb-3">
            USD 행 {{ summary.missingFxCount }}건은 실제 환율 또는 KRW 결제금액이 없어 회수율에서 제외됐습니다. 검토 후 입력하세요.
        </Message>

        <DataTable v-if="candidates.length" :value="candidates" size="small" scrollable scrollHeight="420px" class="mb-3">
            <Column header="저장" style="width: 76px">
                <template #body="{ data }"><Checkbox v-model="data.reviewStatus" binary true trueValue="approved" falseValue="needs_review" /></template>
            </Column>
            <Column field="occurredAt" header="일자" style="min-width: 105px" />
            <Column header="유형" style="min-width: 150px">
                <template #body="{ data }"><Select v-model="data.kind" :options="kindOptions" optionLabel="label" optionValue="value" class="w-full" /></template>
            </Column>
            <Column field="rawType" header="원문 유형" style="min-width: 130px" />
            <Column header="KRW 결제액" style="min-width: 150px"><template #body="{ data }"><InputNumber v-model="data.krwAmount" :minFractionDigits="0" :maxFractionDigits="0" class="w-full" /></template></Column>
            <Column header="USD 금액" style="min-width: 145px"><template #body="{ data }"><InputNumber v-model="data.usdAmount" :minFractionDigits="2" :maxFractionDigits="4" class="w-full" /></template></Column>
            <Column header="실제 환율" style="min-width: 130px"><template #body="{ data }"><InputNumber v-model="data.actualFxRate" :minFractionDigits="0" :maxFractionDigits="2" class="w-full" /></template></Column>
            <Column header="설명" style="min-width: 250px"><template #body="{ data }"><span :title="data.description">{{ data.description }}</span></template></Column>
        </DataTable>

        <Message v-else severity="secondary" :closable="false">
            아직 분석 후보가 없습니다. PDF를 선택하면 모든 행을 검토한 뒤 저장할 수 있습니다.
        </Message>

        <div v-if="fundingPreview.length" class="mt-3 text-sm text-color-secondary">
            배당 우선 재투자 후보 {{ fundingPreview.length }}건을 계산했습니다. 금액이 맞지 않는 매수는 저장 전 검토 대상으로 남습니다.
        </div>
    </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Card from 'primevue/card';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import InputNumber from 'primevue/inputnumber';
import axios from 'axios';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { parseTossStatementLocally } from '@/services/recovery/localStatementParser';
import { buildFundingPreview, calculateRecoverySummary } from '@/services/recovery/ledgerEngine';
import { useRecoveryLedger } from '@/composables/asset/useRecoveryLedger';

const props = defineProps({ visible: Boolean, userId: String });
const emit = defineEmits(['update:visible', 'saved']);
const fileInput = ref(null);
const candidates = ref([]);
const storedEntries = ref([]);
const parsing = ref(false);
const saving = ref(false);
const loadingOrders = ref(false);
const error = ref('');
const statementPassword = ref('');
const accountSeq = ref(null);
const orderFrom = ref('');
const { loadEntries, saveReviewedEntries } = useRecoveryLedger();

const kindOptions = [
    ['buy', '매수'], ['sell', '매도'], ['dividend', '배당'], ['interest', '이자'],
    ['deposit', '입금'], ['withdrawal', '출금'], ['exchange', '환전'],
    ['tax', '세금(별도)'], ['tax_refund', '세금 환급(별도)'], ['other', '기타'],
].map(([value, label]) => ({ value, label }));

const allEntries = computed(() => [...storedEntries.value, ...candidates.value.map((entry) => ({ ...entry, reviewStatus: entry.reviewStatus === 'approved' ? 'applied' : entry.reviewStatus }))]);
const summary = computed(() => calculateRecoverySummary(allEntries.value));
const fundingPreview = computed(() => buildFundingPreview(allEntries.value));

watch(() => props.visible, async (isVisible) => {
    if (isVisible && props.userId) {
        storedEntries.value = await loadEntries(props.userId);
    } else if (!isVisible) {
        statementPassword.value = '';
    }
});

async function onFilesSelected(event) {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    parsing.value = true;
    error.value = '';
    try {
        const parsed = (await Promise.all(
            files.map((file) => parseTossStatementLocally(file, statementPassword.value))
        )).flat();
        const seen = new Set(candidates.value.map((entry) => entry.fingerprint));
        const unique = parsed.filter((entry) => {
            if (seen.has(entry.fingerprint)) return false;
            seen.add(entry.fingerprint);
            return true;
        });
        candidates.value.push(...unique);
        if (!parsed.length) error.value = '인식 가능한 거래 행이 없습니다. 비식별 샘플 PDF 서식을 먼저 확인해주세요.';
    } catch (cause) {
        error.value = cause?.name === 'PasswordException'
            ? 'PDF 비밀번호를 확인한 뒤 다시 선택하세요.'
            : `PDF를 브라우저에서 분석하지 못했습니다: ${cause.message || '알 수 없는 오류'}`;
    } finally {
        parsing.value = false;
        event.target.value = '';
    }
}

async function saveApproved() {
    saving.value = true;
    error.value = '';
    try {
        const result = await saveReviewedEntries(props.userId, candidates.value);
        storedEntries.value = await loadEntries(props.userId);
        candidates.value = candidates.value.filter((entry) => entry.reviewStatus !== 'approved');
        emit('saved', result);
    } catch (cause) {
        error.value = `원장을 저장하지 못했습니다: ${cause.message || '알 수 없는 오류'}`;
    } finally {
        saving.value = false;
    }
}

async function loadOrderCandidates() {
    loadingOrders.value = true;
    error.value = '';
    try {
        const { data } = await axios.get('/api/toss-portfolio', {
            params: { action: 'orders', accountSeq: accountSeq.value, from: orderFrom.value, limit: 100 },
        });
        const seen = new Set(candidates.value.map((entry) => entry.fingerprint));
        const mapped = (data.orders || []).map((order) => ({
            occurredAt: String(order.occurredAt || '').slice(0, 10),
            kind: order.kind,
            rawType: order.rawType,
            currency: order.currency,
            krwAmount: order.currency === 'KRW' ? order.nativeAmount : null,
            usdAmount: order.currency === 'USD' ? order.nativeAmount : null,
            actualFxRate: null,
            feeKrw: order.currency === 'KRW' ? order.nativeFee : null,
            taxKrw: order.currency === 'KRW' ? order.nativeTax : null,
            description: `${order.symbol} · ${order.quantity}주 · Open API 주문`,
            source: order.source,
            orderId: order.orderId,
            fingerprint: `toss-order:${order.orderId}`,
            reviewStatus: 'needs_review',
        }));
        candidates.value.push(...mapped.filter((entry) => !seen.has(entry.fingerprint)));
    } catch (cause) {
        error.value = `주문 후보를 가져오지 못했습니다: ${cause.response?.data?.error || cause.message}`;
    } finally {
        loadingOrders.value = false;
    }
}

const krw = (value) => new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value || 0);
const percent = (value) => value == null ? '-' : `${(value * 100).toFixed(2)}%`;
</script>
