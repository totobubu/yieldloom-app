<!-- src/pages/AdminView.vue -->
<script setup>
    import { ref, computed, onMounted } from 'vue';
    import { useHead } from '@vueuse/head';
    import { collection, getDocs } from 'firebase/firestore';
    import { db } from '@/firebase';
    import { useAdmin } from '@/composables/asset/useAdmin';
    import {
        useKoNameApprovals,
        approveKoName,
        rejectKoName,
        syncApprovedToMappings,
    } from '@/composables/asset/useAssetAdmin';
    import { useToast } from 'primevue/usetoast';
    import { useRouter } from 'vue-router';

    import Card from 'primevue/card';
    import Button from 'primevue/button';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Tag from 'primevue/tag';
    import InputText from 'primevue/inputtext';
    import ProgressSpinner from 'primevue/progressspinner';
    import Dropdown from 'primevue/dropdown';
    import Message from 'primevue/message';
    // import ToggleButton from 'primevue/togglebutton'; // removed - replaced by Dropdown filter

    import TabView from 'primevue/tabview';
    import TabPanel from 'primevue/tabpanel';
    import AdminMigrationPage from '@/pages/AdminMigrationPage.vue';

    useHead({ title: '관리자 - koName 승인' });

    const router = useRouter();
    const toast = useToast();
    const { isAdmin } = useAdmin();
    const { pendingApprovals, isLoading, loadPendingApprovals } =
        useKoNameApprovals();

    // Filter mode: all / missing ISIN / missing koName
    const filterMode = ref('all');
    const filterOptions = [
        { label: '전체', value: 'all' },
        { label: 'ISIN 없음만', value: 'missingIsin' },
        { label: '한국어 없음', value: 'missingKoName' },
    ];

    const filteredApprovals = computed(() => {
        if (filterMode.value === 'all') {
            return pendingApprovals.value;
        }
        if (filterMode.value === 'missingIsin') {
            return pendingApprovals.value.filter(
                (approval) => !approval.isin || approval.isin.trim() === ''
            );
        }
        // missingKoName
        return pendingApprovals.value.filter(
            (approval) => !approval.koName || approval.koName.trim() === ''
        );
    });

    // 관리자 체크는 라우터 가드에서 처리됨

    const handleApprove = async (approval) => {
        if (!approval.symbol || !approval.symbol.trim()) {
            toast.add({
                severity: 'warn',
                summary: '입력 확인',
                detail: '티커(Symbol)를 입력해주세요.',
                life: 3000,
            });
            return;
        }

        try {
            await approveKoName(
                approval.userId,
                approval.memberId,
                approval.brokerageId,
                approval.accountId,
                approval.id,
                approval.koName,
                approval.symbol,
                approval.isin
            );

            toast.add({
                severity: 'success',
                summary: '승인 완료',
                detail: `${approval.koName}이(가) 승인되었습니다.`,
                life: 3000,
            });

            await loadPendingApprovals();
        } catch (error) {
            console.error('승인 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '승인 처리에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const handleReject = async (approval) => {
        try {
            await rejectKoName(
                approval.userId,
                approval.memberId,
                approval.brokerageId,
                approval.accountId,
                approval.id
            );

            toast.add({
                severity: 'info',
                summary: '거부 완료',
                detail: `${approval.koName}이(가) 거부되었습니다.`,
                life: 3000,
            });

            await loadPendingApprovals();
        } catch (error) {
            console.error('거부 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '거부 처리에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const handleSync = async () => {
        try {
            const count = await syncApprovedToMappings();
            toast.add({
                severity: 'success',
                summary: '동기화 완료',
                detail: `${count}개의 항목이 동기화되었습니다.`,
                life: 3000,
            });
        } catch (error) {
            console.error('동기화 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '동기화에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const fetchLocalData = async () => {
        const markets = ['NASDAQ', 'NYSE', 'AMEX'];
        const chars = [
            ...Array.from({ length: 10 }, (_, i) => i.toString()),
            ...Array.from({ length: 26 }, (_, i) =>
                String.fromCharCode(97 + i)
            ),
        ];

        const localData = new Map(); // key: `${market}_${symbol}`, value: item

        const promises = [];
        for (const market of markets) {
            for (const char of chars) {
                promises.push(
                    fetch(`/nav/${market}/${char}.json`)
                        .then((res) => {
                            if (!res.ok) return [];
                            return res.json();
                        })
                        .then((data) => {
                            data.forEach((item) => {
                                if (item.symbol) {
                                    localData.set(
                                        `${market}_${item.symbol}`,
                                        item
                                    );
                                }
                            });
                        })
                        .catch(() => {
                            // Ignore 404s or errors
                        })
                );
            }
        }

        await Promise.all(promises);
        return localData;
    };

    const exportMappings = async () => {
        try {
            toast.add({
                severity: 'info',
                summary: '데이터 준비 중',
                detail: '로컬 데이터와 비교 중입니다...',
                life: 3000,
            });

            const [querySnapshot, localData] = await Promise.all([
                getDocs(collection(db, 'stockMappings')),
                fetchLocalData(),
            ]);

            const mappings = [];
            let filteredCount = 0;

            querySnapshot.forEach((doc) => {
                const mapping = doc.data();
                const market = mapping.stockInfo?.market || 'NASDAQ'; // Default to NASDAQ if missing, or logic to determine market
                // Note: stockMappings doesn't explicitly store 'market' at top level usually,
                // but let's assume we can infer it or it's in stockInfo.
                // Actually, the user's request implies we should check if it matches *any* local data or specific market.
                // Let's try to find it in the localData map using the symbol.
                // Since symbol might not be unique across markets (rare but possible), ideally we need market.
                // However, mapping key is `brokerage_stockName`.
                // Let's assume systemTicker is unique enough or we check all markets.

                // Better approach: The mapping has `systemTicker`. We check if we have this ticker in our local data.
                // But we stored localData with market prefix.
                // We need to find the item in localData.

                // Let's iterate markets to find the symbol in localData
                let localItem = null;
                const markets = ['NASDAQ', 'NYSE', 'AMEX'];
                for (const m of markets) {
                    const key = `${m}_${mapping.systemTicker}`;
                    if (localData.has(key)) {
                        localItem = localData.get(key);
                        break;
                    }
                }

                if (localItem) {
                    // Check if it matches exactly
                    const isSymbolMatch =
                        localItem.symbol === mapping.systemTicker;
                    const isIsinMatch =
                        !mapping.brokerageTicker ||
                        localItem.isin === mapping.brokerageTicker; // If mapping has no ISIN, ignore ISIN check? Or strict? User said "symbol, isin, koName"
                    // Let's be strict if mapping has ISIN.
                    // brokerageStockName is the koName from the approval
                    // [수정] brokerageStockName이 koName의 앞부분과 일치하는 경우(잘린 경우)도 매칭으로 간주
                    const isKoNameMatch =
                        localItem.koName === mapping.brokerageStockName ||
                        (localItem.koName &&
                            localItem.koName.startsWith(
                                mapping.brokerageStockName
                            ));

                    if (isSymbolMatch && isIsinMatch && isKoNameMatch) {
                        filteredCount++;
                        return; // Skip adding to export
                    }
                }

                mappings.push(mapping);
            });

            if (mappings.length === 0) {
                toast.add({
                    severity: 'info',
                    summary: '내보내기 없음',
                    detail: '모든 데이터가 이미 정확하게 매핑되어 있습니다.',
                    life: 3000,
                });
                return;
            }

            const dataStr =
                'data:text/json;charset=utf-8,' +
                encodeURIComponent(JSON.stringify(mappings, null, 4));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute('href', dataStr);
            downloadAnchorNode.setAttribute('download', 'mappings.json');
            document.body.appendChild(downloadAnchorNode); // required for firefox
            downloadAnchorNode.click();
            downloadAnchorNode.remove();

            toast.add({
                severity: 'success',
                summary: '내보내기 완료',
                detail: `${mappings.length}개의 매핑 데이터가 다운로드되었습니다. (${filteredCount}개 제외됨)`,
                life: 3000,
            });
        } catch (error) {
            console.error('내보내기 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '데이터 내보내기에 실패했습니다.',
                life: 3000,
            });
        }
    };

    onMounted(async () => {
        if (isAdmin.value) {
            try {
                await loadPendingApprovals();
            } catch (error) {
                console.error('관리자 페이지 로드 실패:', error);
                toast.add({
                    severity: 'error',
                    summary: '오류',
                    detail: `승인 대기 목록을 불러오는데 실패했습니다: ${error.message}`,
                    life: 5000,
                });
            }
        }
    });
</script>

<template>
    <div id="t-admin-view">
        <TabView>
            <TabPanel header="종목 승인 관리">
                <Card>
                    <template #header>
                        <div
                            class="flex justify-content-between align-items-center p-3">
                            <h2 class="m-0">종목 승인 관리</h2>
                            <div class="flex gap-2">
                                <Dropdown
                                    v-model="filterMode"
                                    :options="filterOptions"
                                    optionLabel="label"
                                    placeholder="필터 선택"
                                    class="w-48" />
                                <Button
                                    label="매핑 데이터 내보내기"
                                    icon="pi pi-download"
                                    severity="secondary"
                                    @click="exportMappings" />
                                <Button
                                    label="매핑 동기화"
                                    icon="pi pi-sync"
                                    severity="help"
                                    @click="handleSync" />
                                <Button
                                    label="새로고침"
                                    icon="pi pi-refresh"
                                    @click="loadPendingApprovals" />
                            </div>
                        </div>
                    </template>
                    <template #content>
                        <div
                            v-if="isLoading"
                            class="flex justify-content-center p-4">
                            <ProgressSpinner />
                        </div>

                        <Message
                            v-else-if="filteredApprovals.length === 0"
                            severity="info"
                            :closable="false">
                            해당 필터에 맞는 항목이 없습니다.
                        </Message>

                        <DataTable
                            v-else
                            :value="filteredApprovals"
                            :paginator="true"
                            :rows="20"
                            :rowsPerPageOptions="[10, 20, 50]"
                            responsiveLayout="scroll">
                            <Column field="isin" header="ISIN" sortable>
                                <template #body="{ data }">
                                    <InputText
                                        v-model="data.isin"
                                        class="p-inputtext-sm w-full"
                                        placeholder="ISIN 입력 (선택)"
                                        :class="{
                                            'border-orange-500': !data.isin,
                                        }" />
                                </template>
                            </Column>
                            <Column field="symbol" header="SYMBOL" sortable>
                                <template #body="{ data }">
                                    <InputText
                                        v-model="data.symbol"
                                        class="p-inputtext-sm w-full"
                                        placeholder="티커 입력" />
                                </template>
                            </Column>
                            <Column
                                field="koName"
                                header="한국어 종목명"
                                sortable>
                                <template #body="{ data }">
                                    <InputText
                                        v-model="data.koName"
                                        class="p-inputtext-sm w-full"
                                        placeholder="한국어 종목명 입력"
                                        :class="{
                                            'border-orange-500': !data.koName,
                                        }" />
                                </template>
                            </Column>

                            <Column field="currency" header="통화" sortable />
                            <Column field="userId" header="사용자 ID">
                                <template #body="{ data }">
                                    <code class="text-xs"
                                        >{{
                                            data.userId.substring(0, 8)
                                        }}...</code
                                    >
                                </template>
                            </Column>
                            <Column header="액션" style="width: 200px">
                                <template #body="{ data }">
                                    <div class="flex gap-2">
                                        <Button
                                            label="승인"
                                            icon="pi pi-check"
                                            severity="success"
                                            size="small"
                                            @click="handleApprove(data)" />
                                        <Button
                                            label="거부"
                                            icon="pi pi-times"
                                            severity="danger"
                                            size="small"
                                            @click="handleReject(data)" />
                                    </div>
                                </template>
                            </Column>
                        </DataTable>
                    </template>
                </Card>
            </TabPanel>
            <TabPanel header="자산 Symbol 마이그레이션">
                <AdminMigrationPage />
            </TabPanel>
        </TabView>
    </div>
</template>

<style scoped>
    code {
        font-family: 'Courier New', monospace;
        background-color: var(--surface-100);
        padding: 2px 6px;
        border-radius: 4px;
    }
</style>
