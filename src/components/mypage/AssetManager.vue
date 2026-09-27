<!-- src/components/mypage/AssetManager.vue -->
<script setup>
    import { ref, computed, onMounted } from 'vue';
    import { useRouter } from 'vue-router';
    import { user } from '@/store/auth';
    import {
        useFamilyMembers,
        useBrokerages,
        useAccounts,
        useAssets,
    } from '@/composables/asset/useAssetFirestore';
    import { useToast } from 'primevue/usetoast';
    import { useConfirm } from 'primevue/useconfirm';

    import Card from 'primevue/card';
    import Button from 'primevue/button';
    import InputText from 'primevue/inputtext';
    import Dialog from 'primevue/dialog';
    import Accordion from 'primevue/accordion';
    import AccordionTab from 'primevue/accordiontab';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import Dropdown from 'primevue/dropdown';
    import InputNumber from 'primevue/inputnumber';
    import Textarea from 'primevue/textarea';
    import Tag from 'primevue/tag';

    const toast = useToast();
    const confirm = useConfirm();

    const {
        familyMembers,
        isLoading: isLoadingMembers,
        loadFamilyMembers,
        addFamilyMember,
        updateFamilyMember,
        deleteFamilyMember,
    } = useFamilyMembers();

    const { loadBrokerages, addBrokerage, updateBrokerage, deleteBrokerage } =
        useBrokerages();

    const { loadAccounts, addAccount, updateAccount, deleteAccount } =
        useAccounts();

    const { loadAssets, addAsset, updateAsset, deleteAsset } = useAssets();

    // 선택된 계층 구조
    const selectedMemberId = ref(null);
    const selectedBrokerageId = ref(null);
    const selectedAccountId = ref(null);

    // 확장된 항목들
    const expandedMembers = ref({});
    const expandedBrokerages = ref({});
    const expandedAccounts = ref({});

    // 로드된 데이터 캐시
    const loadedBrokerages = ref({});
    const loadedAccounts = ref({});
    const loadedAssets = ref({});

    // 다이얼로그 상태
    const showMemberDialog = ref(false);
    const showBrokerageDialog = ref(false);
    const showAccountDialog = ref(false);
    const showAssetDialog = ref(false);

    // 폼 데이터
    const memberForm = ref({ name: '', relationship: '본인' });
    const brokerageForm = ref({ name: '' });
    const accountForm = ref({ name: '', accountNumber: '' });
    const assetForm = ref({
        type: '주식',
        symbol: '',
        amount: 0,
        currency: 'KRW',
        notes: '',
    });

    // 수정 모드
    const editMode = ref({
        member: null,
        brokerage: null,
        account: null,
        asset: null,
    });

    const relationships = [
        { label: '본인', value: '본인' },
        { label: '배우자', value: '배우자' },
        { label: '자녀', value: '자녀' },
        { label: '부모', value: '부모' },
        { label: '기타', value: '기타' },
    ];

    const assetTypes = [
        { label: '주식', value: '주식' },
        { label: '현금', value: '현금' },
        { label: '외환예금 (달러)', value: '외환예금 (달러)' },
        { label: '코인', value: '코인' },
    ];

    const currencies = [
        { label: '원 (KRW)', value: 'KRW' },
        { label: '달러 (USD)', value: 'USD' },
    ];

    onMounted(async () => {
        if (user.value) {
            await loadFamilyMembers(user.value.uid);

            // 첫 번째 멤버가 있으면 자동으로 펼치기
            if (familyMembers.value.length > 0) {
                const firstMember = familyMembers.value[0];

                // 첫 번째 멤버의 증권사 로드
                const brokerages = await loadBrokerages(
                    user.value.uid,
                    firstMember.id
                );
                loadedBrokerages.value[firstMember.id] = brokerages;

                if (brokerages.length > 0) {
                    const firstBrokerage = brokerages[0];
                    const brokerageKey = `${firstMember.id}-${firstBrokerage.id}`;
                    expandedBrokerages.value[brokerageKey] = true;

                    // 첫 번째 증권사의 계좌 로드 및 펼치기
                    const accounts = await loadAccounts(
                        user.value.uid,
                        firstMember.id
                    );
                    loadedAccounts.value[brokerageKey] = accounts;

                    if (accounts.length > 0) {
                        const firstAccount = accounts[0];
                        const accountKey = `${firstMember.id}-${firstBrokerage.id}-${firstAccount.id}`;
                        expandedAccounts.value[accountKey] = true;

                        // 자산 로드 (전체 자산 로드)
                        const assets = await loadAssets(user.value.uid);
                        loadedAssets.value[accountKey] = assets;
                    }
                }
            }
        }
    });

    // 가족 멤버 관련
    const openAddMemberDialog = () => {
        memberForm.value = { name: '', relationship: '본인' };
        editMode.value.member = null;
        showMemberDialog.value = true;
    };

    const openEditMemberDialog = (member) => {
        memberForm.value = { ...member };
        editMode.value.member = member;
        showMemberDialog.value = true;
    };

    const saveMember = async () => {
        if (!memberForm.value.name) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '이름을 입력해주세요.',
                life: 3000,
            });
            return;
        }

        try {
            if (editMode.value.member) {
                await updateFamilyMember(
                    user.value.uid,
                    editMode.value.member.id,
                    memberForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '가족 멤버가 수정되었습니다.',
                    life: 3000,
                });
            } else {
                await addFamilyMember(user.value.uid, memberForm.value);
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '가족 멤버가 추가되었습니다.',
                    life: 3000,
                });
            }
            await loadFamilyMembers(user.value.uid);
            showMemberDialog.value = false;
        } catch (error) {
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '저장에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const removeMember = (member) => {
        confirm.require({
            message: `${member.name}님의 모든 데이터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
            header: '가족 멤버 삭제',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: '삭제',
            rejectLabel: '취소',
            accept: async () => {
                try {
                    await deleteFamilyMember(user.value.uid, member.id);
                    await loadFamilyMembers(user.value.uid);
                    toast.add({
                        severity: 'info',
                        summary: '완료',
                        detail: '가족 멤버가 삭제되었습니다.',
                        life: 3000,
                    });
                } catch (error) {
                    toast.add({
                        severity: 'error',
                        summary: '오류',
                        detail: '삭제에 실패했습니다.',
                        life: 3000,
                    });
                }
            },
        });
    };

    // 증권사 관련
    const toggleMember = async (memberId) => {
        expandedMembers.value[memberId] = !expandedMembers.value[memberId];
        if (expandedMembers.value[memberId]) {
            loadedBrokerages.value[memberId] = await loadBrokerages(
                user.value.uid,
                memberId
            );
        }
    };

    const openAddBrokerageDialog = (memberId) => {
        selectedMemberId.value = memberId;
        brokerageForm.value = { name: '' };
        editMode.value.brokerage = null;
        showBrokerageDialog.value = true;
    };

    const openEditBrokerageDialog = (memberId, brokerage) => {
        selectedMemberId.value = memberId;
        brokerageForm.value = { ...brokerage };
        editMode.value.brokerage = brokerage;
        showBrokerageDialog.value = true;
    };

    const saveBrokerage = async () => {
        if (!brokerageForm.value.name) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '증권사명을 입력해주세요.',
                life: 3000,
            });
            return;
        }

        try {
            if (editMode.value.brokerage) {
                await updateBrokerage(
                    user.value.uid,
                    selectedMemberId.value,
                    editMode.value.brokerage.id,
                    brokerageForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '증권사가 수정되었습니다.',
                    life: 3000,
                });
            } else {
                await addBrokerage(
                    user.value.uid,
                    selectedMemberId.value,
                    brokerageForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '증권사가 추가되었습니다.',
                    life: 3000,
                });
            }
            loadedBrokerages.value[selectedMemberId.value] =
                await loadBrokerages(user.value.uid, selectedMemberId.value);
            showBrokerageDialog.value = false;
        } catch (error) {
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '저장에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const removeBrokerage = async (memberId, brokerage) => {
        confirm.require({
            message: `${brokerage.name}의 모든 계좌와 자산을 삭제하시겠습니까?`,
            header: '증권사 삭제',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: '삭제',
            rejectLabel: '취소',
            accept: async () => {
                try {
                    await deleteBrokerage(
                        user.value.uid,
                        memberId,
                        brokerage.id
                    );
                    loadedBrokerages.value[memberId] = await loadBrokerages(
                        user.value.uid,
                        memberId
                    );
                    toast.add({
                        severity: 'info',
                        summary: '완료',
                        detail: '증권사가 삭제되었습니다.',
                        life: 3000,
                    });
                } catch (error) {
                    toast.add({
                        severity: 'error',
                        summary: '오류',
                        detail: '삭제에 실패했습니다.',
                        life: 3000,
                    });
                }
            },
        });
    };

    // 계좌 관련
    const toggleBrokerage = async (memberId, brokerageId) => {
        const key = `${memberId}-${brokerageId}`;
        expandedBrokerages.value[key] = !expandedBrokerages.value[key];
        if (expandedBrokerages.value[key]) {
            loadedAccounts.value[key] = await loadAccounts(
                user.value.uid,
                memberId,
                brokerageId
            );
        }
    };

    const openAddAccountDialog = (memberId, brokerageId) => {
        selectedMemberId.value = memberId;
        selectedBrokerageId.value = brokerageId;
        accountForm.value = { name: '', accountNumber: '' };
        editMode.value.account = null;
        showAccountDialog.value = true;
    };

    const openEditAccountDialog = (memberId, brokerageId, account) => {
        selectedMemberId.value = memberId;
        selectedBrokerageId.value = brokerageId;
        accountForm.value = { ...account };
        editMode.value.account = account;
        showAccountDialog.value = true;
    };

    const saveAccount = async () => {
        if (!accountForm.value.name) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '계좌명을 입력해주세요.',
                life: 3000,
            });
            return;
        }

        try {
            if (editMode.value.account) {
                await updateAccount(
                    user.value.uid,
                    selectedMemberId.value,
                    selectedBrokerageId.value,
                    editMode.value.account.id,
                    accountForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '계좌가 수정되었습니다.',
                    life: 3000,
                });
            } else {
                await addAccount(
                    user.value.uid,
                    selectedMemberId.value,
                    selectedBrokerageId.value,
                    accountForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '계좌가 추가되었습니다.',
                    life: 3000,
                });
            }
            const key = `${selectedMemberId.value}-${selectedBrokerageId.value}`;
            loadedAccounts.value[key] = await loadAccounts(
                user.value.uid,
                selectedMemberId.value,
                selectedBrokerageId.value
            );
            showAccountDialog.value = false;
        } catch (error) {
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '저장에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const removeAccount = async (memberId, brokerageId, account) => {
        confirm.require({
            message: `${account.name}의 모든 자산을 삭제하시겠습니까?`,
            header: '계좌 삭제',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: '삭제',
            rejectLabel: '취소',
            accept: async () => {
                try {
                    await deleteAccount(
                        user.value.uid,
                        memberId,
                        brokerageId,
                        account.id
                    );
                    const key = `${memberId}-${brokerageId}`;
                    loadedAccounts.value[key] = await loadAccounts(
                        user.value.uid,
                        memberId,
                        brokerageId
                    );
                    toast.add({
                        severity: 'info',
                        summary: '완료',
                        detail: '계좌가 삭제되었습니다.',
                        life: 3000,
                    });
                } catch (error) {
                    toast.add({
                        severity: 'error',
                        summary: '오류',
                        detail: '삭제에 실패했습니다.',
                        life: 3000,
                    });
                }
            },
        });
    };

    // 자산 관련
    const toggleAccount = async (memberId, brokerageId, accountId) => {
        const key = `${memberId}-${brokerageId}-${accountId}`;
        expandedAccounts.value[key] = !expandedAccounts.value[key];
        if (expandedAccounts.value[key]) {
            loadedAssets.value[key] = await loadAssets(
                user.value.uid,
                memberId,
                brokerageId,
                accountId
            );
        }
    };

    const openAddAssetDialog = (memberId, brokerageId, accountId) => {
        selectedMemberId.value = memberId;
        selectedBrokerageId.value = brokerageId;
        selectedAccountId.value = accountId;
        assetForm.value = {
            type: '주식',
            symbol: '',
            amount: 0,
            currency: 'KRW',
            notes: '',
        };
        editMode.value.asset = null;
        showAssetDialog.value = true;
    };

    const openEditAssetDialog = (memberId, brokerageId, accountId, asset) => {
        selectedMemberId.value = memberId;
        selectedBrokerageId.value = brokerageId;
        selectedAccountId.value = accountId;
        assetForm.value = { ...asset };
        editMode.value.asset = asset;
        showAssetDialog.value = true;
    };

    const saveAsset = async () => {
        if (!assetForm.value.type) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '자산 종류를 선택해주세요.',
                life: 3000,
            });
            return;
        }

        try {
            if (editMode.value.asset) {
                await updateAsset(
                    user.value.uid,
                    selectedMemberId.value,
                    selectedBrokerageId.value,
                    selectedAccountId.value,
                    editMode.value.asset.id,
                    assetForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '자산이 수정되었습니다.',
                    life: 3000,
                });
            } else {
                await addAsset(
                    user.value.uid,
                    selectedMemberId.value,
                    selectedBrokerageId.value,
                    selectedAccountId.value,
                    assetForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '자산이 추가되었습니다.',
                    life: 3000,
                });
            }
            const key = `${selectedMemberId.value}-${selectedBrokerageId.value}-${selectedAccountId.value}`;
            loadedAssets.value[key] = await loadAssets(
                user.value.uid,
                selectedMemberId.value,
                selectedBrokerageId.value,
                selectedAccountId.value
            );
            showAssetDialog.value = false;
        } catch (error) {
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '저장에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const removeAsset = async (memberId, brokerageId, accountId, asset) => {
        confirm.require({
            message: `이 자산을 삭제하시겠습니까?`,
            header: '자산 삭제',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: '삭제',
            rejectLabel: '취소',
            accept: async () => {
                try {
                    await deleteAsset(
                        user.value.uid,
                        memberId,
                        brokerageId,
                        accountId,
                        asset.id
                    );
                    const key = `${memberId}-${brokerageId}-${accountId}`;
                    loadedAssets.value[key] = await loadAssets(
                        user.value.uid,
                        memberId,
                        brokerageId,
                        accountId
                    );
                    toast.add({
                        severity: 'info',
                        summary: '완료',
                        detail: '자산이 삭제되었습니다.',
                        life: 3000,
                    });
                } catch (error) {
                    toast.add({
                        severity: 'error',
                        summary: '오류',
                        detail: '삭제에 실패했습니다.',
                        life: 3000,
                    });
                }
            },
        });
    };

    const getAssetTypeIcon = (type) => {
        const icons = {
            주식: 'pi pi-chart-line',
            현금: 'pi pi-wallet',
            '외환예금 (달러)': 'pi pi-money-bill',
            코인: 'pi pi-bitcoin',
        };
        return icons[type] || 'pi pi-tag';
    };
</script>

<template>
    <div id="t-asset-manager">
        <div class="flex justify-content-between align-items-center mb-4">
            <h2 class="text-2xl font-bold">가족 자산 관리</h2>
            <Button
                label="가족 멤버 추가"
                icon="pi pi-plus"
                @click="openAddMemberDialog" />
        </div>

        <!-- 가족 멤버 목록 -->
        <div class="flex flex-column gap-3">
            <Card
                v-for="member in familyMembers"
                :key="member.id"
                class="w-full">
                <template #header>
                    <div
                        class="flex justify-content-between align-items-center p-3">
                        <div class="flex align-items-center gap-2">
                            <i class="pi pi-user text-xl"></i>
                            <span class="font-bold text-xl">{{
                                member.name
                            }}</span>
                            <Tag :value="member.relationship" severity="info" />
                        </div>
                        <div class="flex gap-2">
                            <Button
                                icon="pi pi-pencil"
                                severity="secondary"
                                rounded
                                @click="openEditMemberDialog(member)" />
                            <Button
                                icon="pi pi-trash"
                                severity="danger"
                                rounded
                                @click="removeMember(member)" />
                        </div>
                    </div>
                </template>

                <template #content>
                    <!-- 증권사 목록 -->
                    <div class="flex flex-column gap-2 mt-3">
                        <div
                            class="flex justify-content-between align-items-center mb-2">
                            <h4 class="text-lg font-semibold">증권사</h4>
                            <Button
                                label="추가"
                                icon="pi pi-plus"
                                size="small"
                                @click="openAddBrokerageDialog(member.id)" />
                        </div>

                        <div
                            v-for="brokerage in loadedBrokerages[member.id] ||
                            []"
                            :key="brokerage.id"
                            class="border-round border-2 border-200 p-3">
                            <div
                                class="flex justify-content-between align-items-center">
                                <div class="flex align-items-center gap-2">
                                    <i class="pi pi-building text-lg"></i>
                                    <span class="font-semibold">{{
                                        brokerage.name
                                    }}</span>
                                </div>
                                <div class="flex gap-2">
                                    <Button
                                        icon="pi pi-pencil"
                                        size="small"
                                        severity="secondary"
                                        rounded
                                        @click="
                                            openEditBrokerageDialog(
                                                member.id,
                                                brokerage
                                            )
                                        " />
                                    <Button
                                        icon="pi pi-trash"
                                        size="small"
                                        severity="danger"
                                        rounded
                                        @click="
                                            removeBrokerage(
                                                member.id,
                                                brokerage
                                            )
                                        " />
                                    <Button
                                        :icon="
                                            expandedBrokerages[
                                                `${member.id}-${brokerage.id}`
                                            ]
                                                ? 'pi pi-chevron-up'
                                                : 'pi pi-chevron-down'
                                        "
                                        size="small"
                                        rounded
                                        @click="
                                            toggleBrokerage(
                                                member.id,
                                                brokerage.id
                                            )
                                        " />
                                </div>
                            </div>

                            <!-- 계좌 목록 -->
                            <div
                                v-if="
                                    expandedBrokerages[
                                        `${member.id}-${brokerage.id}`
                                    ]
                                "
                                class="mt-3 pl-4 border-left-3 border-primary">
                                <div
                                    class="flex justify-content-between align-items-center mb-2">
                                    <h5 class="text-sm font-semibold">계좌</h5>
                                    <Button
                                        label="추가"
                                        icon="pi pi-plus"
                                        size="small"
                                        text
                                        @click="
                                            openAddAccountDialog(
                                                member.id,
                                                brokerage.id
                                            )
                                        " />
                                </div>

                                <div
                                    v-for="account in loadedAccounts[
                                        `${member.id}-${brokerage.id}`
                                    ] || []"
                                    :key="account.id"
                                    class="border-round border-1 border-200 p-2 mb-2">
                                    <div
                                        class="flex justify-content-between align-items-center">
                                        <div class="flex flex-column">
                                            <span class="font-semibold">{{
                                                account.name
                                            }}</span>
                                            <span
                                                v-if="account.accountNumber"
                                                class="text-xs"
                                                >계좌번호:
                                                {{
                                                    account.accountNumber
                                                }}</span
                                            >
                                        </div>
                                        <div class="flex gap-2">
                                            <Button
                                                icon="pi pi-pencil"
                                                size="small"
                                                severity="secondary"
                                                rounded
                                                @click="
                                                    openEditAccountDialog(
                                                        member.id,
                                                        brokerage.id,
                                                        account
                                                    )
                                                " />
                                            <Button
                                                icon="pi pi-trash"
                                                size="small"
                                                severity="danger"
                                                rounded
                                                @click="
                                                    removeAccount(
                                                        member.id,
                                                        brokerage.id,
                                                        account
                                                    )
                                                " />
                                            <Button
                                                :icon="
                                                    expandedAccounts[
                                                        `${member.id}-${brokerage.id}-${account.id}`
                                                    ]
                                                        ? 'pi pi-chevron-up'
                                                        : 'pi pi-chevron-down'
                                                "
                                                size="small"
                                                rounded
                                                @click="
                                                    toggleAccount(
                                                        member.id,
                                                        brokerage.id,
                                                        account.id
                                                    )
                                                " />
                                        </div>
                                    </div>

                                    <!-- 자산 목록 -->
                                    <div
                                        v-if="
                                            expandedAccounts[
                                                `${member.id}-${brokerage.id}-${account.id}`
                                            ]
                                        "
                                        class="mt-2 pl-3 border-left-2 border-300">
                                        <div
                                            class="flex justify-content-between align-items-center mb-2">
                                            <h6 class="text-xs font-semibold">
                                                자산
                                            </h6>
                                            <Button
                                                label="추가"
                                                icon="pi pi-plus"
                                                size="small"
                                                text
                                                @click="
                                                    openAddAssetDialog(
                                                        member.id,
                                                        brokerage.id,
                                                        account.id
                                                    )
                                                " />
                                        </div>

                                        <div
                                            v-for="asset in loadedAssets[
                                                `${member.id}-${brokerage.id}-${account.id}`
                                            ] || []"
                                            :key="asset.id"
                                            class="border-round border-1 border-300 p-2 mb-2">
                                            <div
                                                class="flex justify-content-between align-items-center">
                                                <div
                                                    class="flex align-items-center gap-2">
                                                    <i
                                                        :class="`pi ${getAssetTypeIcon(asset.type)}`"></i>
                                                    <span>{{
                                                        asset.type
                                                    }}</span>
                                                    <span
                                                        v-if="asset.symbol"
                                                        class="font-semibold"
                                                        >{{
                                                            asset.symbol
                                                        }}</span
                                                    >
                                                    <span
                                                        >{{
                                                            asset.amount.toLocaleString()
                                                        }}
                                                        {{
                                                            asset.currency
                                                        }}</span
                                                    >
                                                </div>
                                                <div class="flex gap-2">
                                                    <Button
                                                        icon="pi pi-pencil"
                                                        size="small"
                                                        severity="secondary"
                                                        rounded
                                                        @click="
                                                            openEditAssetDialog(
                                                                member.id,
                                                                brokerage.id,
                                                                account.id,
                                                                asset
                                                            )
                                                        " />
                                                    <Button
                                                        icon="pi pi-trash"
                                                        size="small"
                                                        severity="danger"
                                                        rounded
                                                        @click="
                                                            removeAsset(
                                                                member.id,
                                                                brokerage.id,
                                                                account.id,
                                                                asset
                                                            )
                                                        " />
                                                </div>
                                            </div>
                                            <div
                                                v-if="asset.notes"
                                                class="text-xs mt-1">
                                                {{ asset.notes }}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </Card>

            <Card v-if="familyMembers.length === 0">
                <template #content>
                    <div class="flex flex-column align-items-center gap-3 p-4">
                        <i class="pi pi-inbox text-6xl"></i>
                        <p>등록된 가족 멤버가 없습니다.</p>
                        <Button
                            label="첫 번째 가족 멤버 추가하기"
                            icon="pi pi-plus"
                            @click="openAddMemberDialog" />
                    </div>
                </template>
            </Card>
        </div>

        <!-- 가족 멤버 다이얼로그 -->
        <Dialog
            v-model:visible="showMemberDialog"
            modal
            header="가족 멤버"
            :style="{ width: '25rem' }">
            <div class="flex flex-column gap-3">
                <div class="flex flex-column gap-2">
                    <label for="memberName">이름</label>
                    <InputText
                        id="memberName"
                        v-model="memberForm.name"
                        placeholder="이름을 입력하세요" />
                </div>
                <div class="flex flex-column gap-2">
                    <label for="memberRelationship">관계</label>
                    <Dropdown
                        id="memberRelationship"
                        v-model="memberForm.relationship"
                        :options="relationships"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="관계를 선택하세요" />
                </div>
            </div>
            <template #footer>
                <Button
                    label="취소"
                    severity="secondary"
                    @click="showMemberDialog = false" />
                <Button label="저장" @click="saveMember" />
            </template>
        </Dialog>

        <!-- 증권사 다이얼로그 -->
        <Dialog
            v-model:visible="showBrokerageDialog"
            modal
            header="증권사"
            :style="{ width: '25rem' }">
            <div class="flex flex-column gap-2">
                <label for="brokerageName">증권사명</label>
                <InputText
                    id="brokerageName"
                    v-model="brokerageForm.name"
                    placeholder="예: kb자산운용, 미래에셋" />
            </div>
            <template #footer>
                <Button
                    label="취소"
                    severity="secondary"
                    @click="showBrokerageDialog = false" />
                <Button label="저장" @click="saveBrokerage" />
            </template>
        </Dialog>

        <!-- 계좌 다이얼로그 -->
        <Dialog
            v-model:visible="showAccountDialog"
            modal
            header="계좌"
            :style="{ width: '25rem' }">
            <div class="flex flex-column gap-3">
                <div class="flex flex-column gap-2">
                    <label for="accountName">계좌명</label>
                    <InputText
                        id="accountName"
                        v-model="accountForm.name"
                        placeholder="예: 주식계좌, 원화계좌" />
                </div>
                <div class="flex flex-column gap-2">
                    <label for="accountNumber">계좌번호 (선택)</label>
                    <InputText
                        id="accountNumber"
                        v-model="accountForm.accountNumber"
                        placeholder="계좌번호를 입력하세요" />
                </div>
            </div>
            <template #footer>
                <Button
                    label="취소"
                    severity="secondary"
                    @click="showAccountDialog = false" />
                <Button label="저장" @click="saveAccount" />
            </template>
        </Dialog>

        <!-- 자산 다이얼로그 -->
        <Dialog
            v-model:visible="showAssetDialog"
            modal
            header="자산 추가"
            :style="{ width: '30rem' }">
            <div class="flex flex-column gap-3">
                <div class="flex flex-column gap-2">
                    <label for="assetType">자산 종류</label>
                    <Dropdown
                        id="assetType"
                        v-model="assetForm.type"
                        :options="assetTypes"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="자산 종류를 선택하세요" />
                </div>
                <div
                    v-if="assetForm.type === '주식'"
                    class="flex flex-column gap-2">
                    <label for="assetSymbol">심볼</label>
                    <InputText
                        id="assetSymbol"
                        v-model="assetForm.symbol"
                        placeholder="예: AAPL, TSLA" />
                </div>
                <div class="flex flex-column gap-2">
                    <label for="assetAmount">수량/금액</label>
                    <InputNumber
                        id="assetAmount"
                        v-model="assetForm.amount"
                        :min="0"
                        placeholder="수량 또는 금액" />
                </div>
                <div class="flex flex-column gap-2">
                    <label for="assetCurrency">통화</label>
                    <Dropdown
                        id="assetCurrency"
                        v-model="assetForm.currency"
                        :options="currencies"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="통화를 선택하세요" />
                </div>
                <div class="flex flex-column gap-2">
                    <label for="assetNotes">메모 (선택)</label>
                    <Textarea
                        id="assetNotes"
                        v-model="assetForm.notes"
                        rows="3"
                        placeholder="추가 정보를 입력하세요" />
                </div>
            </div>
            <template #footer>
                <Button
                    label="취소"
                    severity="secondary"
                    @click="showAssetDialog = false" />
                <Button label="저장" @click="saveAsset" />
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
    :deep(.p-card-body) {
        padding: 1rem;
    }
</style>
