<!-- src/components/asset/TransactionHistoryDialog.vue -->
<template>
    <Dialog v-model:visible="isVisible" modal header="거래 내역" :style="{ width: '800px', maxHeight: '90vh' }"
        :closable="true">
        <div class="flex flex-column gap-4">
            <div v-if="isLoading" class="flex justify-content-center p-4">
                <ProgressSpinner />
            </div>

            <div v-else-if="transactions.length === 0" class="text-center p-4">
                <p class="text-color-secondary">거래 내역이 없습니다.</p>
            </div>

            <DataTable v-else :value="transactions" stripedRows paginator :rows="10" class="p-datatable-sm"
                sortField="date" :sortOrder="-1">
                <Column field="date" header="날짜" sortable>
                    <template #body="slotProps">
                        {{ formatDate(slotProps.data.date) }}
                    </template>
                </Column>
                <Column field="type" header="유형" sortable>
                    <template #body="slotProps">
                        <Tag :value="slotProps.data.type" :severity="getTransactionTypeSeverity(slotProps.data.type)
                            " />
                    </template>
                </Column>
                <Column field="quantity" header="수량" sortable>
                    <template #body="slotProps">
                        {{ formatNumber(slotProps.data.quantity) }}
                    </template>
                </Column>
                <Column field="price" header="단가" sortable>
                    <template #body="slotProps">
                        {{
                            formatCurrency(
                                slotProps.data.price,
                                slotProps.data.currency
                            )
                        }}
                    </template>
                </Column>
                <Column field="amount" header="금액" sortable>
                    <template #body="slotProps">
                        {{
                            formatCurrency(
                                slotProps.data.amount,
                                slotProps.data.currency
                            )
                        }}
                    </template>
                </Column>
            </DataTable>
        </div>
    </Dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import Dialog from 'primevue/dialog';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import ProgressSpinner from 'primevue/progressspinner';
import { useTransactions } from '@/composables/asset/useAssetFirestore';
import { user } from '@/store/auth';

const props = defineProps({
    visible: {
        type: Boolean,
        default: false,
    },
    accountId: {
        type: String,
        required: true,
    },
    assetId: {
        type: String,
        required: true,
    },
});

const emit = defineEmits(['update:visible']);

const isVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value),
});

const transactions = ref([]);
const { isLoading, loadTransactions } = useTransactions();

const fetchTransactions = async () => {
    if (!user.value?.uid) return;
    transactions.value = await loadTransactions(
        user.value.uid,
        props.assetId,
        props.accountId
    );
};

watch(
    () => props.visible,
    (newVal) => {
        if (newVal) {
            fetchTransactions();
        }
    }
);

const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    // YYYYMMDD or YYYY-MM-DD format handling
    if (dateStr.length === 8) {
        return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }
    return dateStr;
};

const formatNumber = (value) => {
    if (value === undefined || value === null) return '-';
    return new Intl.NumberFormat('ko-KR').format(value);
};

const formatCurrency = (value, currency) => {
    if (value === undefined || value === null) return '-';
    return new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: currency || 'KRW',
    }).format(value);
};

const getTransactionTypeSeverity = (type) => {
    switch (type) {
        case '매수':
        case '입금':
            return 'success';
        case '매도':
        case '출금':
            return 'danger';
        case '배당':
            return 'info';
        default:
            return 'secondary';
    }
};
</script>
