<!-- src/components/asset/AddAssetModal.vue -->
<script setup>
    import { ref, onMounted, watch, computed } from 'vue';
    import { user } from '@/store/auth';
    import {
        useFamilyMembers,
        useBrokerages,
        useAccounts,
    } from '@/composables/asset/useAssetFirestore';
    import { useToast } from 'primevue/usetoast';

    // 환율 데이터 로드
    let exchangeRates = null;
    const loadExchangeRates = async () => {
        if (!exchangeRates) {
            const response = await fetch('/exchange-rates.json');
            exchangeRates = await response.json();
        }
        return exchangeRates;
    };

    // 특정 날짜의 환율 조회
    const getExchangeRateForDate = async (dateString) => {
        const rates = await loadExchangeRates();
        if (!dateString) return 1;

        // 날짜 포맷 변환 (YYYY-MM-DD)
        const date = new Date(dateString);
        const formattedDate = date.toISOString().split('T')[0];

        // 해당 날짜의 환율 찾기
        const rateData = rates.find((r) => r.date === formattedDate);

        // 없으면 가장 가까운 과거 날짜 찾기
        if (!rateData) {
            const availableRates = rates.filter((r) => r.date <= formattedDate);
            if (availableRates.length > 0) {
                return availableRates[availableRates.length - 1].rate;
            }
        }

        return rateData?.rate || 1;
    };

    import Dialog from 'primevue/dialog';
    import Button from 'primevue/button';
    import Dropdown from 'primevue/dropdown';
    import InputText from 'primevue/inputtext';
    import InputNumber from 'primevue/inputnumber';
    import Textarea from 'primevue/textarea';
    import InputGroup from 'primevue/inputgroup';
    import InputGroupAddon from 'primevue/inputgroupaddon';

    const props = defineProps({
        visible: {
            type: Boolean,
            default: false,
        },
        ticker: {
            type: String,
            default: '',
        },
        price: {
            type: Number,
            default: 0,
        },
        showAssetType: {
            type: Boolean,
            default: false, // AssetView에서 사용 시 true
        },
    });

    const emit = defineEmits(['update:visible', 'saved']);

    const toast = useToast();
    const { familyMembers, loadFamilyMembers } = useFamilyMembers();
    const { loadBrokerages } = useBrokerages();
    const { loadAccounts } = useAccounts();

    // 자산 종류 옵션
    const assetTypes = [
        { label: '주식', value: '주식' },
        { label: '현금', value: '현금' },
        { label: '외환예금', value: '외환예금' },
        { label: '코인', value: '코인' },
    ];

    // 폼 데이터
    const form = ref({
        assetType: '', // AssetView에서 사용
        symbol: '', // 심볼
        familyMemberId: null,
        brokerageId: null,
        accountId: null,
        tradeDate: null,
        tradeTime: '00:00',
        currency: 'KRW',
        averagePrice: 0,
        holdings: 0,
        totalAmount: 0,
        exchangeRate: 1,
        notes: '',
    });

    // 증권사 및 계좌 데이터
    const brokerages = ref([]);
    const accounts = ref([]);

    // 로드된 브로커 데이터 캐시
    const brokerageDataCache = ref({});

    // 통화 옵션 (KRW와 USD만 사용)
    const currencies = [
        { label: 'KRW (원화)', value: 'KRW' },
        { label: 'USD (달러)', value: 'USD' },
    ];

    // 가족 멤버 옵션
    const familyMemberOptions = computed(() => {
        return familyMembers.value.map((m) => ({
            label: `${m.name} (${m.relationship})`,
            value: m.id,
        }));
    });

    // 증권사 옵션
    const brokerageOptions = computed(() => {
        if (!form.value.familyMemberId) return [];
        return brokerages.value.map((b) => ({
            label: b.name,
            value: b.id,
        }));
    });

    // 계좌 옵션
    const accountOptions = computed(() => {
        if (!form.value.familyMemberId || !form.value.brokerageId) return [];
        return accounts.value
            .filter((acc) => acc.brokerageId === form.value.brokerageId)
            .map((a) => ({
                label: `${a.name}${a.accountNumber ? ' (' + a.accountNumber + ')' : ''}`,
                value: a.id,
            }));
    });

    // 거래일 변경 시 환율 자동 로드
    watch(
        () => form.value.tradeDate,
        async (newDate) => {
            if (newDate && form.value.currency !== 'KRW') {
                const rate = await getExchangeRateForDate(newDate);
                form.value.exchangeRate = rate;
            }
        }
    );

    // 통화 변경 시 환율 초기화
    watch(
        () => form.value.currency,
        () => {
            if (form.value.currency === 'KRW') {
                form.value.exchangeRate = 1;
            } else if (form.value.tradeDate) {
                // 거래일이 있으면 해당 날짜의 환율 로드
                getExchangeRateForDate(form.value.tradeDate).then((rate) => {
                    form.value.exchangeRate = rate;
                });
            }
        }
    );

    // 보유액 자동 계산
    watch(
        [
            () => form.value.averagePrice,
            () => form.value.holdings,
            () => form.value.exchangeRate,
        ],
        () => {
            if (form.value.currency === 'KRW') {
                form.value.totalAmount =
                    form.value.averagePrice * form.value.holdings;
            } else {
                form.value.totalAmount =
                    form.value.averagePrice *
                    form.value.holdings *
                    form.value.exchangeRate;
            }
        }
    );

    // 가족 멤버 변경 시 증권사 로드
    watch(
        () => form.value.familyMemberId,
        async (newVal) => {
            if (!newVal) {
                brokerages.value = [];
                accounts.value = [];
                return;
            }
            await loadMemberData(newVal);
        }
    );

    // 증권사 변경 시 계좌 로드
    watch(
        () => form.value.brokerageId,
        async (newVal) => {
            if (!newVal || !form.value.familyMemberId) {
                accounts.value = [];
                return;
            }
            await loadAccountsForBrokerage(newVal);
        }
    );

    const loadMemberData = async (memberId) => {
        try {
            brokerages.value = await loadBrokerages(user.value.uid, memberId);
            form.value.brokerageId = null;
            form.value.accountId = null;
        } catch (error) {
            console.error('Failed to load brokerages:', error);
        }
    };

    const loadAccountsForBrokerage = async (brokerageId) => {
        try {
            accounts.value = await loadAccounts(
                user.value.uid,
                form.value.familyMemberId,
                brokerageId
            );
            form.value.accountId = null;
        } catch (error) {
            console.error('Failed to load accounts:', error);
        }
    };

    onMounted(async () => {
        if (user.value) {
            await loadFamilyMembers(user.value.uid);
        }

        // 초기 가격 설정
        if (props.price > 0) {
            form.value.averagePrice = props.price;
        }
    });

    const close = () => {
        emit('update:visible', false);
        resetForm();
    };

    const resetForm = () => {
        form.value = {
            assetType: '',
            symbol: '',
            familyMemberId: null,
            brokerageId: null,
            accountId: null,
            tradeDate: new Date().toISOString().split('T')[0], // 오늘 날짜
            tradeTime: '00:00', // 기본값 자정
            currency: 'KRW',
            averagePrice: props.price || 0,
            holdings: 0,
            totalAmount: 0,
            exchangeRate: 1,
            notes: '',
        };
    };

    const save = async () => {
        // AssetView에서 사용 시 자산 종류 검증
        if (props.showAssetType && !form.value.assetType) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '자산 종류를 선택해주세요.',
                life: 3000,
            });
            return;
        }

        if (!form.value.familyMemberId) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '가족 멤버를 선택해주세요.',
                life: 3000,
            });
            return;
        }
        if (!form.value.brokerageId) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '증권사를 선택해주세요.',
                life: 3000,
            });
            return;
        }
        if (!form.value.accountId) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '계좌를 선택해주세요.',
                life: 3000,
            });
            return;
        }

        emit('saved', {
            ...form.value,
            ticker: props.ticker || form.value.symbol,
            type: props.ticker ? '주식' : form.value.assetType || '주식',
        });

        toast.add({
            severity: 'success',
            summary: '저장 완료',
            detail: '자산이 저장되었습니다.',
            life: 3000,
        });

        close();
    };
</script>

<template>
    <Dialog
        :visible="visible"
        modal
        :style="{ width: '40rem' }"
        @update:visible="$emit('update:visible', $event)">
        <template #header>
            <div class="flex align-items-center gap-2">
                <i class="pi pi-wallet"></i>
                <span class="font-bold text-lg">자산 추가</span>
            </div>
        </template>

        <div class="flex flex-column gap-4">
            <!-- Ticker 정보 -->
            <div v-if="ticker" class="p-3 border-round">
                <div class="flex align-items-center justify-content-between">
                    <span class="font-semibold">Ticker: {{ ticker }}</span>
                    <span v-if="price">{{ price.toLocaleString() }} 원</span>
                </div>
            </div>

            <!-- 자산 종류 선택 (AssetView에서만 표시) -->
            <div v-if="showAssetType" class="flex flex-column gap-2">
                <label for="assetType" class="font-semibold">
                    자산 종류 <span class="text-red-500">*</span>
                </label>
                <Dropdown
                    id="assetType"
                    v-model="form.assetType"
                    :options="assetTypes"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="자산 종류를 선택하세요"
                    class="w-full" />
            </div>

            <!-- 가족 멤버 선택 -->
            <div class="flex flex-column gap-2">
                <label for="familyMember" class="font-semibold">
                    가족 멤버 <span class="text-red-500">*</span>
                </label>
                <Dropdown
                    id="familyMember"
                    v-model="form.familyMemberId"
                    :options="familyMemberOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="가족 멤버를 선택하세요"
                    class="w-full" />
            </div>

            <!-- 증권사 선택 -->
            <div v-if="form.familyMemberId" class="flex flex-column gap-2">
                <label for="brokerage" class="font-semibold">
                    증권사 <span class="text-red-500">*</span>
                </label>
                <Dropdown
                    id="brokerage"
                    v-model="form.brokerageId"
                    :options="brokerageOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="증권사를 선택하세요"
                    class="w-full" />
            </div>

            <!-- 계좌 선택 -->
            <div v-if="form.brokerageId" class="flex flex-column gap-2">
                <label for="account" class="font-semibold">
                    계좌 <span class="text-red-500">*</span>
                </label>
                <Dropdown
                    id="account"
                    v-model="form.accountId"
                    :options="accountOptions"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="계좌를 선택하세요"
                    class="w-full" />
            </div>

            <!-- 심볼 (AssetView에서만 표시) -->
            <div
                v-if="showAssetType && form.assetType === '주식'"
                class="flex flex-column gap-2">
                <label for="symbol" class="font-semibold">
                    심볼 <span class="text-red-500">*</span>
                </label>
                <InputText
                    id="symbol"
                    v-model="form.symbol"
                    placeholder="예: AAPL, TSLA"
                    class="w-full" />
            </div>

            <div class="flex gap-2">
                <!-- 거래일 -->
                <div class="flex-1 flex flex-column gap-2">
                    <label for="tradeDate" class="font-semibold">
                        거래일 <span class="text-red-500">*</span>
                    </label>
                    <InputText
                        id="tradeDate"
                        v-model="form.tradeDate"
                        type="date"
                        placeholder="거래일 선택"
                        class="w-full" />
                </div>

                <!-- 거래시간 -->
                <div class="flex-1 flex flex-column gap-2">
                    <label for="tradeTime" class="font-semibold"
                        >거래시간</label
                    >
                    <InputText
                        id="tradeTime"
                        v-model="form.tradeTime"
                        type="time"
                        placeholder="거래시간 선택"
                        class="w-full" />
                </div>
            </div>

            <div class="flex gap-2">
                <!-- 통화 -->
                <div class="flex-1 flex flex-column gap-2">
                    <label for="currency" class="font-semibold">통화</label>
                    <Dropdown
                        id="currency"
                        v-model="form.currency"
                        :options="currencies"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="통화 선택"
                        class="w-full" />
                </div>

                <!-- 매수평단가 -->
                <div class="flex-1 flex flex-column gap-2">
                    <label for="averagePrice" class="font-semibold"
                        >매수평단가</label
                    >
                    <InputGroup>
                        <InputNumber
                            id="averagePrice"
                            v-model="form.averagePrice"
                            :min="0"
                            :maxFractionDigits="2"
                            placeholder="매수평단가"
                            class="w-full" />
                        <InputGroupAddon>
                            {{ form.currency === 'KRW' ? '원' : '$' }}
                        </InputGroupAddon>
                    </InputGroup>
                </div>
            </div>

            <div class="flex gap-2">
                <!-- 보유량 -->
                <div class="flex-1 flex flex-column gap-2">
                    <label for="holdings" class="font-semibold">보유량</label>
                    <InputNumber
                        id="holdings"
                        v-model="form.holdings"
                        :min="0"
                        :maxFractionDigits="4"
                        placeholder="보유량"
                        class="w-full" />
                </div>

                <!-- 보유액 자동계산 표시 추가 -->
                <div class="flex-1 flex flex-column gap-2">
                    <label class="font-semibold text-sm"
                        >보유액 (자동계산)</label
                    >
                    <InputText
                        :value="
                            form.totalAmount.toLocaleString() +
                            ' ' +
                            form.currency
                        "
                        :readonly="true"
                        class="w-full" />
                </div>

                <!-- 환율 (달러 등 외화) -->
                <div
                    v-if="form.currency !== 'KRW'"
                    class="flex-1 flex flex-column gap-2">
                    <label for="exchangeRate" class="font-semibold">환율</label>
                    <InputNumber
                        id="exchangeRate"
                        v-model="form.exchangeRate"
                        :min="0"
                        :maxFractionDigits="2"
                        placeholder="환율"
                        class="w-full" />
                </div>
            </div>

            <!-- 메모 -->
            <div class="flex flex-column gap-2">
                <label for="notes" class="font-semibold">메모</label>
                <Textarea
                    id="notes"
                    v-model="form.notes"
                    rows="3"
                    placeholder="추가 정보를 입력하세요" />
            </div>
        </div>

        <template #footer>
            <Button label="취소" severity="secondary" @click="close" />
            <Button label="저장" @click="save" />
        </template>
    </Dialog>
</template>
