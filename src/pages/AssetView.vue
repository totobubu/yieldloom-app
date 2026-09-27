<!-- src/pages/AssetView.vue -->
<script setup>
    import { ref, computed, onMounted, watch } from 'vue';
    import { useHead } from '@vueuse/head';
    import { useRouter, useRoute } from 'vue-router';
    import { user } from '@/store/auth';
    import {
        useFamilyMembers,
        useBrokerages,
        useAccounts,
        useAssets,
        useTransactions,
    } from '@/composables/asset/useAssetFirestore';
    import { useLocalStockData } from '@/composables/data/useLocalStockData';
    import {
        normalizeTransactionType,
        TRANSACTION_TYPES,
    } from '@/utils/transactionTypeMapper';
    import { useToast } from 'primevue/usetoast';
    import { useConfirm } from 'primevue/useconfirm';
    import brokeragesData from '@/../public/brokerage/brokerages.json';

    import Card from 'primevue/card';
    import Button from 'primevue/button';
    import SplitButton from 'primevue/splitbutton';
    import InputText from 'primevue/inputtext';
    import Dialog from 'primevue/dialog';
    import Dropdown from 'primevue/dropdown';
    import InputNumber from 'primevue/inputnumber';
    import Textarea from 'primevue/textarea';
    import Tag from 'primevue/tag';
    import Avatar from 'primevue/avatar';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import FileUpload from 'primevue/fileupload';
    import InputSwitch from 'primevue/inputswitch';
    import Image from 'primevue/image';

    // Components
    import FamilyMemberList from '@/components/asset/FamilyMemberList.vue';
    import AssetViewModeToggle from '@/components/asset/AssetViewModeToggle.vue';
    import AssetListView from '@/components/asset/AssetListView.vue';
    import AddAssetModal from '@/components/asset/AddAssetModal.vue';
    import BrokerageUploadDialog from '@/components/asset/BrokerageUploadDialog.vue';
    import StockMappingDialog from '@/components/asset/StockMappingDialog.vue';
    import AssetTypeDataTable from '@/components/asset/AssetTypeDataTable.vue';
    import LoadingOverlay from '@/components/common/LoadingOverlay.vue';
    import AccountTransactionDialog from '@/components/asset/AccountTransactionDialog.vue';
    import AssetTransactionDialog from '@/components/asset/AssetTransactionDialog.vue';
    import BrokerageTransactionDialog from '@/components/asset/BrokerageTransactionDialog.vue';
    import EnhancedTransactionDialog from '@/components/asset/EnhancedTransactionDialog.vue';

    useHead({ title: '자산관리' });

    const toast = useToast();
    const confirm = useConfirm();
    const router = useRouter();
    const route = useRoute();

    const familyMembersComposable = useFamilyMembers();
    const familyMembers = familyMembersComposable.familyMembers;
    const isLoadingMembers = familyMembersComposable.isLoading;
    const loadFamilyMembers = familyMembersComposable.loadFamilyMembers;
    const addFamilyMember = familyMembersComposable.addFamilyMember;
    const updateFamilyMember = familyMembersComposable.updateFamilyMember;
    const deleteFamilyMember = familyMembersComposable.deleteFamilyMember;

    const { loadAccounts, addAccount, updateAccount, deleteAccount } =
        useAccounts();

    const { addBrokerage, updateBrokerage, deleteBrokerage } = useBrokerages();

    const {
        loadAssets,
        addAsset,
        updateAsset,
        deleteAsset,
        deleteAssetHolding,
    } = useAssets();
    const { loadTransactions, addTransaction } = useTransactions();
    const { findStockByIsin } = useLocalStockData();

    // 선택된 탭 (Member ID)
    const selectedMemberId = ref(null);

    // View 모드 (증권사/계좌 기준 vs 종목 기준)
    const viewMode = ref('account');

    // 현재 선택된 멤버
    const selectedMember = computed(() => {
        if (!selectedMemberId.value) return null;
        return (
            familyMembers.value.find((m) => m.id === selectedMemberId.value) ||
            null
        );
    });

    // 다이얼로그 상태
    const showMemberDialog = ref(false);
    const showBrokerageDialog = ref(false);
    const showAccountDialog = ref(false);
    const showAssetDialog = ref(false);
    const showUploadDialog = ref(false);
    const showBrokerageUploadDialog = ref(false);
    const showStockMappingDialog = ref(false);
    const showTransactionDialog = ref(false); // Account Transaction Dialog
    const showAssetTransactionDialog = ref(false);
    const showBrokerageTransactionDialog = ref(false);
    const showEnhancedTransactionDialog = ref(false);

    // 거래내역 다이얼로그 열기
    const openAssetTransactionDialog = async (asset, accountId = null) => {
        isLoadingData.value = true;
        try {
            // 자산 ID 결정 (ISIN, CASH_{currency}, COIN_{symbol})
            let assetId = asset.id;
            if (!assetId) {
                // ID가 없으면 생성
                if (asset.type === '주식') {
                    assetId = asset.isin || `STOCK_${asset.symbol}`;
                } else if (asset.type === '현금') {
                    assetId = `CASH_${asset.currency}`;
                } else if (asset.type === '코인') {
                    assetId = `COIN_${asset.symbol}`;
                }
            }

            console.log(
                '[openAssetTransactionDialog] Loading transactions for asset:',
                assetId,
                'accountId:',
                accountId,
                'asset data:',
                asset,
                'asset.symbol:',
                asset.symbol,
                'asset.koName:',
                asset.koName,
                'asset.name:',
                asset.name
            );

            // 거래내역 로드 (기본 3개월치만 로드하여 속도 개선)
            const transactions = await loadTransactions(
                user.value.uid,
                assetId,
                accountId, // accountId가 있으면 해당 계좌만 필터링
                3 // 기본 3개월
            );

            console.log(
                '[openAssetTransactionDialog] Loaded transactions:',
                transactions.length
            );

            // 거래내역에 자산 정보 추가 (종목명 표시용)
            const enrichedTransactions = transactions.map((tx) => ({
                ...tx,
                assetName: asset.name || asset.symbol,
                assetSymbol: asset.symbol,
                assetCurrency: asset.currency,
            }));

            // 다이얼로그 제목 생성
            let dialogTitle;

            // symbol과 koName 추출 (다양한 필드명 고려)
            let symbol = asset.symbol || asset.ticker || null;
            let koName = asset.koName || asset.koreanName || asset.name || null;

            // asset 객체에 symbol이 없으면 거래내역에서 찾기
            if (!symbol && enrichedTransactions.length > 0) {
                const firstTx = enrichedTransactions[0];
                symbol =
                    firstTx.assetSymbol || firstTx.symbol || firstTx.ticker;
            }

            // koName도 거래내역에서 찾기
            if (!koName && enrichedTransactions.length > 0) {
                const firstTx = enrichedTransactions[0];
                koName =
                    firstTx.assetKoName ||
                    firstTx.koName ||
                    firstTx.koreanName ||
                    firstTx.assetName;
            }

            console.log(
                '[Title Generation] symbol:',
                symbol,
                'koName:',
                koName,
                'asset.id:',
                asset.id
            );

            // 해외주식 판단
            const isForeignStock = asset.currency && asset.currency !== 'KRW';

            if (symbol && koName && isForeignStock) {
                // 해외주식: 한글명 (심볼) 형식
                dialogTitle = `${koName} (${symbol}) 거래내역`;
            } else if (symbol) {
                // 심볼만 있는 경우
                dialogTitle = `${symbol} 거래내역`;
            } else if (koName) {
                // 한글명만 있는 경우
                dialogTitle = `${koName} 거래내역`;
            } else {
                // fallback: asset.id 사용 (ISIN일 수 있음)
                console.warn('[Title] No symbol/koName found, using asset.id');
                dialogTitle = `${asset.id} 거래내역`;
            }

            // 다이얼로그 데이터 설정
            transactionDialogData.value = {
                mode: accountId ? 'account' : 'asset',
                accountId: accountId,
                assetId: assetId,
                title: dialogTitle,
                transactions: enrichedTransactions,
                currentPrice: asset.currentPrice || asset.price || 0,
            };

            // 다이얼로그는 호출하는 쪽에서 열도록 함 (중복 방지)
        } catch (error) {
            console.error('거래내역 로드 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '거래내역을 불러오는 중 오류가 발생했습니다.',
                life: 3000,
            });
        } finally {
            isLoadingData.value = false;
        }
    };

    // 거래내역 다이얼로그 열기 (새 Google Sheets 스타일)
    const openTransactionDialog = async (
        asset,
        accountId = null,
        enhanced = false
    ) => {
        await openAssetTransactionDialog(asset, accountId);

        // 새 다이얼로그는 배당 포함 모든 거래내역 표시
        // 배당 제외하지 않음 (Google Sheets 스타일)

        // 다이얼로그 열기
        if (enhanced) {
            showEnhancedTransactionDialog.value = true;
        } else {
            // 항상 새로운 AssetTransactionDialog 사용
            showAssetTransactionDialog.value = true;
        }
    };

    // 거래내역 다이얼로그 데이터
    const transactionDialogData = ref({
        mode: 'account', // 'account' or 'asset'
        accountId: null,
        assetId: null,
        title: '',
        transactions: [],
    });

    // 보유 수량 0인 항목 보기 토글 상태
    const showZeroBalanceAssets = ref(false);

    // 로딩 상태 관리
    const isLoadingData = ref(false);
    const loadingMessage = ref('자산 데이터를 불러오는 중...');

    // 자산 데이터 캐시 (탭 전환 시 재로딩 방지)
    const cachedAllAssets = ref(null);

    // 업로드 대상 자산
    const uploadTargetAsset = ref(null);

    // 거래내역서 업로드 데이터
    const uploadedTransactionData = ref(null);
    const uploadBrokerage = ref(null);

    // 폼 데이터
    const memberForm = ref({ name: '', relationship: '본인' });
    const brokerageForm = ref({ name: '' });
    const accountForm = ref({ name: '', accountNumber: '', brokerage: '' });
    const assetForm = ref({
        type: '주식',
        symbol: '',
        amount: 0,
        currency: 'KRW',
        notes: '',
    });

    // 편집 모드
    const editMode = ref({
        member: null,
        brokerage: null,
        account: null,
        asset: null,
    });

    // 선택된 노드
    const selectedNode = ref(null);

    // 관계 옵션
    const relationships = [
        { label: '본인', value: '본인' },
        { label: '배우자', value: '배우자' },
        { label: '자녀', value: '자녀' },
        { label: '부모', value: '부모' },
        { label: '기타', value: '기타' },
    ];

    // 자산 종류 옵션
    const assetTypes = [
        { label: '주식', value: '주식' },
        { label: '현금', value: '현금' },
        { label: '외환예금', value: '외환예금' },
        { label: '코인', value: '코인' },
    ];

    // 통화 옵션
    const currencies = [
        { label: 'KRW', value: 'KRW' },
        { label: 'USD', value: 'USD' },
        { label: 'EUR', value: 'EUR' },
        { label: 'JPY', value: 'JPY' },
    ];

    // 관계별 색상
    const getRelationshipColor = (relationship) => {
        const colors = {
            본인: 'success',
            배우자: 'warning',
            자녀: 'info',
            부모: 'help',
            기타: 'secondary',
        };
        return colors[relationship] || 'secondary';
    };

    // 로드된 데이터 캐시
    const loadedMemberData = ref({});

    // 선택된 멤버 감시
    watch(selectedMember, (member) => {
        if (member) {
            router.push({ query: { memberId: member.id } });
        }
    });

    // 확장된 노드 키 (증권사는 항상 펼쳐짐)
    const expandedKeys = ref({});

    // 증권사/은행/거래소 목록 생성
    const brokerageOptions = computed(() => {
        const all = [
            ...brokeragesData.증권사,
            ...brokeragesData.은행,
            ...brokeragesData.거래소,
        ];
        return all.map((item) => ({
            label: item.name,
            value: item.name,
            fileName: item.fileName,
            type: item.type,
        }));
    });

    // 증권사/은행 로고 이미지 경로 가져오기
    const getBrokerageLogo = (brokerageName) => {
        if (!brokerageName) return null;

        // JSON에서 해당 증권사/은행 찾기
        const brokerage = brokerageOptions.value.find(
            (b) => b.value === brokerageName
        );

        if (brokerage) {
            return `/brokerage/${brokerage.fileName}`;
        }

        // JSON에 없으면 기존 방식으로 fallback
        const fileName = brokerageName.replace(/\s+/g, '').toLowerCase();
        return `/brokerage/${fileName}.png`;
    };

    // 평탄화된 테이블 데이터 생성 (증권사/계좌를 컬럼으로)
    const createFlatTableData = (memberId) => {
        const data = loadedMemberData.value[memberId];
        console.log('[createFlatTableData] memberId:', memberId, 'data:', data);
        if (!data) {
            console.log(
                '[createFlatTableData] No data found for member:',
                memberId
            );
            return [];
        }

        const flatData = [];

        console.log(
            '[createFlatTableData] accounts:',
            data.accounts.length,
            'assets:',
            data.assets.length
        );

        // 각 자산을 평탄화된 행으로 변환
        data.assets.forEach((asset) => {
            // 보유 수량 0 필터링 (현금/예수금은 항상 표시)
            if (
                !showZeroBalanceAssets.value &&
                asset.amount === 0 &&
                asset.type !== '현금'
            ) {
                console.log(
                    '[createFlatTableData] Filtering out asset with 0 amount:',
                    asset.id,
                    asset.symbol
                );
                return;
            }

            // 해당 자산의 계좌 찾기
            const account = data.accounts.find(
                (acc) => acc.id === asset.accountId
            );
            if (!account) {
                console.log(
                    '[createFlatTableData] Account not found for asset:',
                    asset.id
                );
                return;
            }

            const brokerageName = account.brokerage || '기타';
            // 그룹화 키: "증권사 - 계좌"
            const groupKey = `${brokerageName} - ${account.name}`;

            console.log(
                '[createFlatTableData] Adding asset to table:',
                asset.id,
                asset.symbol,
                asset.amount
            );

            // 자산 타입 분류
            let assetCategory = '';
            if (asset.type === '현금') {
                assetCategory =
                    asset.currency === 'KRW'
                        ? '예수금 (원화)'
                        : '예수금 (외화)';
            } else if (asset.type === '주식') {
                const isKorean =
                    asset.symbol &&
                    (asset.symbol.match(/^\d{6}$/) ||
                        asset.market === 'KRX' ||
                        asset.market === 'KOSPI' ||
                        asset.market === 'KOSDAQ');
                assetCategory = isKorean ? '국내주식' : '해외주식';
            } else if (asset.type === '코인') {
                assetCategory = '코인';
            } else {
                assetCategory = '기타';
            }

            flatData.push({
                id: asset.id,
                accountId: account.id, // 계좌 ID 추가
                groupKey, // 그룹화 키 추가
                brokerage: brokerageName,
                brokerageLogo: getBrokerageLogo(brokerageName),
                account: account.name,
                accountNumber: account.accountNumber,
                assetCategory,
                assetType: asset.type,
                symbol: asset.symbol,
                name: asset.name || asset.symbol,
                displayName: asset.symbol
                    ? `${asset.name || asset.symbol} (${asset.symbol})`
                    : asset.name || asset.type,
                amount: asset.amount,
                avgPrice: asset.avgPrice,
                currency: asset.currency,
                icon: getAssetTypeIcon(asset.type),
            });
        });

        console.log(
            '[createFlatTableData] Created table with',
            flatData.length,
            'rows'
        );
        return flatData;
    };

    // 트리 데이터 생성 (증권사 → 계좌 → 자산 타입 → 개별 자산)
    const createTreeData = (memberId) => {
        const data = loadedMemberData.value[memberId];
        console.log('[createTreeData] memberId:', memberId, 'data:', data);
        if (!data) {
            console.log('[createTreeData] No data found for member:', memberId);
            return { tree: [], expandedKeys: {} };
        }

        const tree = [];
        const brokerageMap = new Map();
        const newExpandedKeys = {};

        console.log(
            '[createTreeData] accounts:',
            data.accounts.length,
            'assets:',
            data.assets.length
        );

        // 1. 증권사별로 그룹화
        data.accounts.forEach((account) => {
            const brokerageName = account.brokerage || '기타';

            if (!brokerageMap.has(brokerageName)) {
                brokerageMap.set(brokerageName, {
                    key: `brokerage-${brokerageName}`,
                    data: {
                        name: brokerageName,
                        type: '증권사',
                        icon: 'pi pi-building',
                        amount: 0,
                        currency: 'KRW',
                    },
                    children: [],
                });
            }

            const brokerageNode = brokerageMap.get(brokerageName);

            // 2. 계좌 노드 생성
            const accountNode = {
                key: account.id,
                data: {
                    id: account.id,
                    name: account.name,
                    accountNumber: account.accountNumber,
                    type: '계좌',
                    icon: 'pi pi-wallet',
                    amount: 0,
                    currency: 'KRW',
                },
                children: [],
            };

            // 3. 자산 타입별로 그룹화 (예수금, 국내주식, 해외주식)
            const assetTypeGroups = new Map();

            // 해당 계좌의 자산 찾기
            const accountAssets = data.assets.filter(
                (asset) => asset.accountId === account.id
            );

            accountAssets.forEach((asset) => {
                let assetTypeKey = '';
                let assetTypeName = '';
                let assetTypeIcon = '';

                // 자산 타입 분류
                if (asset.type === '현금') {
                    // 예수금 그룹
                    if (asset.currency === 'KRW') {
                        assetTypeKey = 'cash-krw';
                        assetTypeName = '예수금 (원화)';
                        assetTypeIcon = 'pi pi-money-bill';
                    } else {
                        assetTypeKey = 'cash-foreign';
                        assetTypeName = '예수금 (외화)';
                        assetTypeIcon = 'pi pi-dollar';
                    }
                } else if (asset.type === '주식') {
                    // 주식 - 국내/해외 구분
                    const isKorean =
                        asset.symbol &&
                        (asset.symbol.match(/^\d{6}$/) || // 6자리 숫자 (한국 종목코드)
                            asset.market === 'KRX' ||
                            asset.market === 'KOSPI' ||
                            asset.market === 'KOSDAQ');

                    if (isKorean) {
                        assetTypeKey = 'stock-domestic';
                        assetTypeName = '국내주식';
                        assetTypeIcon = 'pi pi-chart-line';
                    } else {
                        assetTypeKey = 'stock-foreign';
                        assetTypeName = '해외주식';
                        assetTypeIcon = 'pi pi-globe';
                    }
                } else if (asset.type === '코인') {
                    assetTypeKey = 'coin';
                    assetTypeName = '코인';
                    assetTypeIcon = 'pi pi-bitcoin';
                } else {
                    assetTypeKey = 'other';
                    assetTypeName = '기타';
                    assetTypeIcon = 'pi pi-circle';
                }

                // 자산 타입 그룹 생성
                if (!assetTypeGroups.has(assetTypeKey)) {
                    assetTypeGroups.set(assetTypeKey, {
                        key: `${account.id}-${assetTypeKey}`,
                        data: {
                            name: assetTypeName,
                            type: '자산타입',
                            assetType: asset.type,
                            icon: assetTypeIcon,
                            amount: 0,
                            currency: asset.currency || 'KRW',
                        },
                        children: [],
                    });
                }

                const assetTypeGroup = assetTypeGroups.get(assetTypeKey);

                // 4. 개별 자산 노드 추가
                const assetDisplayName = asset.symbol
                    ? `${asset.name || asset.symbol} (${asset.symbol})`
                    : asset.name || asset.type;

                // 보유 수량 0 필터링: 토글이 꺼져있고(false) amount가 0이면 제외 (현금/예수금은 항상 표시)
                if (
                    !showZeroBalanceAssets.value &&
                    asset.amount === 0 &&
                    asset.type !== '현금'
                ) {
                    // 토글 꺼짐 + 수량 0 = 제외
                    console.log(
                        '[createTreeData] Filtering out asset with 0 amount:',
                        asset.id,
                        asset.symbol
                    );
                    return;
                }

                console.log(
                    '[createTreeData] Adding asset to tree:',
                    asset.id,
                    asset.symbol,
                    asset.amount
                );

                assetTypeGroup.children.push({
                    key: asset.id,
                    data: {
                        ...asset, // Spread first so we can override
                        id: asset.id,
                        name: assetDisplayName, // Override name with display name
                        symbol: asset.symbol,
                        amount: asset.amount,
                        currency: asset.currency,
                        accountId: account.id,
                        type: '자산',
                        icon: getAssetTypeIcon(asset.type),
                    },
                });
            });

            // 자산 타입 그룹을 계좌에 추가 (자산이 있는 경우에만)
            assetTypeGroups.forEach((typeGroup) => {
                if (typeGroup.children.length > 0) {
                    accountNode.children.push(typeGroup);
                }
            });

            brokerageNode.children.push(accountNode);
        });

        brokerageMap.forEach((node) => {
            // 증권사 노드는 항상 펼쳐짐
            newExpandedKeys[node.key] = true;
            tree.push(node);
        });

        console.log(
            '[createTreeData] Created tree with',
            tree.length,
            'root nodes (brokerages)'
        );
        console.log(
            '[createTreeData] Expanded keys:',
            Object.keys(newExpandedKeys)
        );

        // 확장된 키 업데이트 (computed 외부에서 처리하도록 이동)
        // expandedKeys는 watch에서 업데이트

        return { tree, expandedKeys: newExpandedKeys };
    };

    // 자산별 데이터 생성 (Flat List for DataTable)
    const createAssetTypeData = (memberId) => {
        const data = loadedMemberData.value[memberId];
        if (!data) return [];

        const result = [];
        console.log(
            `[createAssetTypeData] Processing assets for member ${memberId}`,
            data.assets
        );

        data.assets.forEach((asset) => {
            let groupKey = '';
            let groupName = '';

            console.log(`[createAssetTypeData] Checking asset:`, asset);

            if (asset.type === '코인') {
                groupKey = 'coin';
                groupName = '코인';
            } else if (asset.type === '주식') {
                if (asset.currency === 'KRW') {
                    groupKey = 'domesticStock';
                    groupName = '국내주식';
                } else {
                    groupKey = 'overseasStock';
                    groupName = '해외주식';
                }
            } else if (asset.type === '현금' || asset.type === '외환예금') {
                if (asset.currency === 'KRW') {
                    groupKey = 'krw';
                    groupName = '원화';
                } else {
                    groupKey = 'foreign';
                    groupName = '외화';
                }
            }

            if (groupKey) {
                // 1. 현재가 가져오기 (로컬 데이터 또는 API)
                // TODO: 실시간 시세 연동 필요. 현재는 로컬 데이터의 종가(close)나 0으로 처리
                let currentPrice = asset.currentPrice || 0;
                const localStock = findStockByIsin(asset.symbol); // ISIN이 symbol에 저장되어 있다고 가정
                if (localStock && localStock.close) {
                    currentPrice = parseFloat(localStock.close);
                }

                // 2. 원금 및 평단가 계산 (거래내역 기반)
                // asset.transactions가 있다면 그것을 사용, 없다면 asset.amount * asset.avgPrice 사용
                let principal = 0;
                let totalQuantity = 0;

                // Firestore에서 불러온 자산 객체에 transactions가 포함되어 있는지 확인 필요
                // 현재 구조상 assets 컬렉션 하위에 transactions 컬렉션이 있어서 별도로 불러와야 할 수도 있음.
                // 하지만 handleMappingComplete에서 메모리 상의 assetData에는 transactions가 있음.
                // 여기서는 이미 저장된 데이터를 보여주는 것이므로, transactions를 별도로 로드하거나
                // 자산 저장 시 avgPrice와 principal을 업데이트하는 것이 좋음.

                // 임시: asset에 저장된 avgPrice가 있다면 사용
                if (asset.avgPrice) {
                    principal = asset.avgPrice * asset.amount;
                } else {
                    // 평단가 정보가 없으면 원금을 0으로 두거나, (평가금 = 원금)으로 가정?
                    // 사용자가 "거래내역서를 통해 나온 금액은 평가금이 아니고 원금임"이라고 했으므로
                    // 초기 업로드 시 asset.amount는 수량이고, 금액 정보는 별도로 저장했어야 함.
                    // 현재 addAsset에서는 amount(수량)만 저장함.
                }

                // 3. 평가금 계산
                // 평가금 = 현재가 * 수량
                // 현재가가 0이면 평가금도 0이 됨. 이 경우 원금을 평가금으로 보여줄지 결정 필요.
                let valuation = currentPrice * asset.amount;

                if (currentPrice === 0 && principal > 0) {
                    // 현재가가 없으면 평가금을 원금과 동일하게 표시 (수익률 0%)
                    valuation = principal;
                }

                const profitAmount = valuation - principal;
                const profitRate =
                    principal > 0 ? (profitAmount / principal) * 100 : 0;

                // 보유 수량 0 필터링: 토글이 꺼져있고(false) amount가 0이면 제외 (현금/예수금은 항상 표시)
                if (
                    !showZeroBalanceAssets.value &&
                    asset.amount === 0 &&
                    asset.type !== '현금'
                ) {
                    return;
                }

                // asset의 name과 symbol 보정 (ISIN만 있을 경우 대비)
                let displayName = asset.name || asset.koName || asset.symbol;
                let displaySymbol = asset.symbol || asset.ticker;

                // name이 ISIN 형식이면 symbol로 대체
                if (
                    !displayName ||
                    (displayName && displayName.match(/^[A-Z]{2}[A-Z0-9]{10}$/))
                ) {
                    displayName = displaySymbol || asset.id;
                }

                // symbol이 없으면 빈 문자열
                if (
                    !displaySymbol ||
                    displaySymbol.match(/^[A-Z]{2}[A-Z0-9]{10}$/)
                ) {
                    displaySymbol = '';
                }

                result.push({
                    ...asset,
                    name: displayName,
                    symbol: displaySymbol,
                    groupKey,
                    groupName,
                    currentPrice,
                    avgPrice: asset.avgPrice || 0,
                    principal,
                    valuation,
                    profitAmount,
                    profitRate,
                    memberId,
                });
            }
        });

        return result;
    };

    // 자산별 트리 데이터 생성
    const createAssetTypeTreeData = (memberId) => {
        const data = loadedMemberData.value[memberId];
        if (!data) return [];

        const groups = {
            krw: {
                key: 'krw',
                data: {
                    name: '원화',
                    type: '자산그룹',
                    icon: 'pi pi-money-bill',
                    amount: 0,
                    currency: 'KRW',
                },
                children: [],
            },
            foreign: {
                key: 'foreign',
                data: {
                    name: '외화',
                    type: '자산그룹',
                    icon: 'pi pi-dollar',
                    amount: 0,
                    currency: 'USD', // 대표 통화
                },
                children: [],
            },
            domesticStock: {
                key: 'domesticStock',
                data: {
                    name: '국내주식',
                    type: '자산그룹',
                    icon: 'pi pi-chart-line',
                    amount: 0,
                    currency: 'KRW',
                },
                children: [],
            },
            overseasStock: {
                key: 'overseasStock',
                data: {
                    name: '해외주식',
                    type: '자산그룹',
                    icon: 'pi pi-globe',
                    amount: 0,
                    currency: 'USD', // 대표 통화
                },
                children: [],
            },
            coin: {
                key: 'coin',
                data: {
                    name: '코인',
                    type: '자산그룹',
                    icon: 'pi pi-bitcoin',
                    amount: 0,
                    currency: 'KRW', // 대표 통화
                },
                children: [],
            },
        };

        data.assets.forEach((asset) => {
            let groupKey = '';

            if (asset.type === '코인') {
                groupKey = 'coin';
            } else if (asset.type === '주식') {
                if (asset.currency === 'KRW') {
                    groupKey = 'domesticStock';
                } else {
                    groupKey = 'overseasStock';
                }
            } else if (asset.type === '현금' || asset.type === '외환예금') {
                if (asset.currency === 'KRW') {
                    groupKey = 'krw';
                } else {
                    groupKey = 'foreign';
                }
            }

            if (groupKey) {
                // 자산 노드 생성
                const assetNode = {
                    key: asset.id,
                    data: {
                        ...asset,
                        name: `${asset.symbol ? asset.symbol : asset.name} - ${asset.amount} ${asset.currency}`,
                        type: '자산',
                        icon: getAssetTypeIcon(asset.type),
                    },
                };
                groups[groupKey].children.push(assetNode);

                // 그룹 합계 계산 (단순 합산은 통화가 다를 수 있어 주의 필요, 일단은 표시용으로 0 유지하거나 별도 로직 필요)
                // 여기서는 개별 자산의 금액을 보여주는 것에 집중하고 그룹 합계는 추후 고도화
            }
        });

        // 비어있는 그룹 제외하고 배열로 변환
        return Object.values(groups).filter(
            (group) => group.children.length > 0
        );
    };

    // 자산별 데이터 맵
    const assetTypeDataMap = computed(() => {
        const map = {};
        familyMembers.value.forEach((member) => {
            map[member.id] = createAssetTypeData(member.id);
        });
        return map;
    });

    // 평탄화된 테이블 데이터 맵
    const flatTableDataMap = computed(() => {
        const map = {};
        familyMembers.value.forEach((member) => {
            map[member.id] = createFlatTableData(member.id);
        });
        return map;
    });

    // 트리 데이터 맵 (기존 로직 유지, asset_type 모드에서는 사용 안 함)
    const treeDataMap = computed(() => {
        const map = {};
        familyMembers.value.forEach((member) => {
            const result = createTreeData(member.id);
            map[member.id] = result.tree;
            // expandedKeys 업데이트
            if (
                result.expandedKeys &&
                Object.keys(result.expandedKeys).length > 0
            ) {
                expandedKeys.value = {
                    ...expandedKeys.value,
                    ...result.expandedKeys,
                };
            }
        });
        return map;
    });

    // 멤버 데이터 로드 (Asset-Centric Structure with Holdings)
    const loadMemberData = async (memberId) => {
        if (loadedMemberData.value[memberId]) return;

        isLoadingData.value = true;
        loadingMessage.value = '계좌 정보를 불러오는 중...';
        console.time('loadMemberData');
        console.log('🔍 [loadMemberData] Loading data for member:', memberId);

        try {
            loadingMessage.value = '데이터를 불러오는 중...';
            console.time('loadDataParallel');

            // 1. 계좌 목록 로드 Promise
            const accountsPromise = loadAccounts(user.value.uid, memberId);

            // 2. 모든 자산 로드 Promise (캐시 사용)
            let assetsPromise;
            if (cachedAllAssets.value) {
                console.log('📦 [loadMemberData] Using cached assets');
                assetsPromise = Promise.resolve(cachedAllAssets.value);
            } else {
                assetsPromise = loadAssets(user.value.uid).then((assets) => {
                    cachedAllAssets.value = assets;
                    return assets;
                });
            }

            // 병렬 실행
            const [accounts, allAssets] = await Promise.all([
                accountsPromise,
                assetsPromise,
            ]);
            console.timeEnd('loadDataParallel');

            const accountIds = new Set(accounts.map((acc) => acc.id));
            console.log(
                '🔍 [loadMemberData] Loaded accounts:',
                accounts.length,
                accountIds
            );
            console.log(
                '🔍 [loadMemberData] All assets loaded:',
                allAssets.length
            );

            // 3. holdings 필드를 확인하여 이 멤버의 계좌에 속한 자산만 필터링
            loadingMessage.value = '데이터 정리 중...';
            console.time('processAssets');
            const memberAssets = [];

            allAssets.forEach((asset) => {
                if (!asset.holdings) {
                    // console.log(
                    //     '⚠️ [loadMemberData] Asset without holdings:',
                    //     asset.id
                    // );
                    return;
                }

                // 이 자산의 holdings 중 이 멤버의 계좌가 있는지 확인
                // amount > 0 조건 제거: 모든 자산을 불러오고 UI에서 토글로 필터링
                Object.entries(asset.holdings).forEach(
                    ([accountId, holding]) => {
                        if (accountIds.has(accountId)) {
                            const account = accounts.find(
                                (acc) => acc.id === accountId
                            );
                            // console.log(
                            //     '✅ [loadMemberData] Adding asset:',
                            //     asset.id,
                            //     'for account:',
                            //     accountId,
                            //     'amount:',
                            //     holding.amount
                            // );
                            memberAssets.push({
                                ...asset,
                                accountId,
                                brokerage: account?.brokerage,
                                amount: holding.amount,
                                avgPrice: holding.avgPrice,
                            });
                        }
                    }
                );
            });
            console.timeEnd('processAssets');

            console.log(
                '🔍 [loadMemberData] Filtered member assets:',
                memberAssets.length
            );

            loadedMemberData.value[memberId] = {
                accounts,
                assets: memberAssets,
            };
        } catch (error) {
            console.error('Error loading member data:', error);
            toast.add({
                severity: 'error',
                summary: '데이터 로드 실패',
                detail: '자산 데이터를 불러오는 중 오류가 발생했습니다.',
                life: 3000,
            });
        } finally {
            isLoadingData.value = false;
            loadingMessage.value = '자산 데이터를 불러오는 중...'; // Reset message
            console.timeEnd('loadMemberData');
        }
    };

    onMounted(async () => {
        console.log('🔵 AssetView mounted, user:', user.value);
        if (user.value) {
            isLoadingData.value = true;
            try {
                console.log(
                    '🟡 Loading family members for user:',
                    user.value.uid
                );
                await loadFamilyMembers(user.value.uid);
                console.log('🟢 Loaded family members:', familyMembers.value);
                console.log(
                    '🟢 familyMembers.length:',
                    familyMembers.value.length
                );

                if (familyMembers.value.length > 0) {
                    // URL query에 memberId가 있으면 그것을 사용, 없으면 첫 번째 멤버 (본인 우선 정렬 필요하지만 일단 첫번째)
                    // FamilyMemberList에서 정렬 로직이 있으므로, 여기서도 "본인"을 찾아서 기본값으로 설정하는 것이 좋음
                    const me = familyMembers.value.find(
                        (m) => m.relationship === '본인'
                    );
                    const initialMemberId = me
                        ? me.id
                        : familyMembers.value[0].id;

                    console.log(
                        '🟢 Loading data for initial member:',
                        initialMemberId
                    );
                    selectedMemberId.value = initialMemberId;
                    await loadMemberData(initialMemberId);
                } else {
                    console.log('⚠️ No family members found');
                }
            } finally {
                isLoadingData.value = false;
            }
        } else {
            console.log('❌ No user logged in');
        }
    });

    // 탭 변경 처리
    const handleMemberSelect = async (memberId) => {
        console.log('handleMemberSelect called with:', memberId);
        selectedMemberId.value = memberId;

        if (memberId && !loadedMemberData.value[memberId]) {
            isLoadingData.value = true;
            try {
                await loadMemberData(memberId);
            } finally {
                isLoadingData.value = false;
            }
        }
    };

    // 가족 멤버 관련
    const openAddMemberDialog = () => {
        memberForm.value = { name: '', relationship: '본인' };
        editMode.value.member = null;
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
            console.error('saveMember error:', error);
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
                    delete loadedMemberData.value[member.id];
                    await loadFamilyMembers(user.value.uid);
                    if (
                        parseInt(selectedTabIndex.value) >=
                        familyMembers.value.length
                    ) {
                        selectedTabIndex.value = String(
                            Math.max(0, familyMembers.value.length - 1)
                        );
                    }
                    toast.add({
                        severity: 'info',
                        summary: '완료',
                        detail: '가족 멤버가 삭제되었습니다.',
                        life: 3000,
                    });
                } catch (error) {
                    console.error('removeMember error:', error);
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
            현금: 'pi pi-money-bill',
            외환예금: 'pi pi-dollar',
            코인: 'pi pi-bitcoin',
        };
        return icons[type] || 'pi pi-circle';
    };

    const formatCurrency = (amount, currency) => {
        return new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: currency || 'KRW',
        }).format(amount);
    };

    const onRowSelect = (event) => {
        selectedNode.value = event.node;
    };

    const toggleNode = (node) => {
        if (expandedKeys.value[node.key]) {
            delete expandedKeys.value[node.key];
        } else {
            expandedKeys.value[node.key] = true;
        }
    };

    const editNode = (node) => {
        const data = node.data;
        const memberId = selectedMember.value?.id;
        if (!memberId) return;

        if (data.type === '자산') {
            const asset = loadedMemberData.value[memberId]?.assets.find(
                (a) => a.id === data.id
            );
            if (asset) {
                openEditAssetDialog(
                    memberId,
                    data.brokerageId,
                    data.accountId,
                    asset
                );
            }
        }
    };

    const deleteNode = (node) => {
        confirm.require({
            message: `${node.data.name}을(를) 삭제하시겠습니까?`,
            header: '삭제 확인',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: '삭제',
            rejectLabel: '취소',
            accept: async () => {
                const data = node.data;
                console.log('🗑️ deleteNode:', data);
                const memberId = selectedMember.value?.id;
                if (!memberId) return;

                if (data.type === '증권사') {
                    // Brokerage node is a virtual group, so we delete all accounts under it
                    const accountsToDelete = loadedMemberData.value[
                        memberId
                    ]?.accounts.filter((acc) => acc.brokerage === data.name);

                    if (accountsToDelete && accountsToDelete.length > 0) {
                        console.log(
                            `Deleting ${accountsToDelete.length} accounts for brokerage ${data.name}`
                        );
                        for (const acc of accountsToDelete) {
                            await deleteAccount(
                                user.value.uid,
                                memberId,
                                acc.id
                            );
                        }
                    } else {
                        console.warn(
                            'No accounts found for brokerage:',
                            data.name
                        );
                    }
                    // await deleteBrokerage(user.value.uid, memberId, data.id); // data.id is undefined for virtual group
                } else if (data.type === '계좌') {
                    await deleteAccount(
                        user.value.uid,
                        memberId,
                        data.brokerageId,
                        data.id
                    );
                } else if (data.type === '자산') {
                    await deleteAssetHolding(
                        user.value.uid,
                        data.id, // assetId (ISIN or CASH_XXX)
                        data.accountId
                    );
                }

                delete loadedMemberData.value[memberId];
                await loadMemberData(memberId);
            },
        });
    };

    const addChild = (node) => {
        const data = node.data;
        const memberId = selectedMember.value?.id;
        if (!memberId) return;

        if (data.type === '증권사') {
            openAddAccountDialog(memberId, data.id);
        } else if (data.type === '계좌') {
            // 기존 Dialog 대신 AddAssetModal 사용
            openAddAssetModalFromTree(memberId, data.brokerageId, data.id);
        }
    };

    // 업로드 다이얼로그 열기
    const openUploadDialog = (node) => {
        uploadTargetAsset.value = node;
        showUploadDialog.value = true;
    };

    // 파일 업로드 처리
    const handleFileUpload = async (event) => {
        const files = event.files;
        if (!files || files.length === 0) return;

        console.log('파일 업로드:', files);

        // TODO: PDF/Excel 파싱 로직 구현
        // 현재는 파일명과 형식만 확인
        for (const file of files) {
            console.log(
                `파일명: ${file.name}, 크기: ${file.size}, 형식: ${file.type}`
            );
        }

        toast.add({
            severity: 'info',
            summary: '업로드 완료',
            detail: `${files.length}개의 파일이 업로드되었습니다. (파싱 기능은 개발 중입니다)`,
            life: 3000,
        });
    };

    // 증권사 관련
    const openAddBrokerageDialog = (memberId) => {
        brokerageForm.value = { name: '' };
        editMode.value.brokerage = null;
        showBrokerageDialog.value = true;
    };

    const saveBrokerage = async () => {
        if (!brokerageForm.value.name) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '증권사 이름을 입력해주세요.',
                life: 3000,
            });
            return;
        }

        const memberId = selectedMember.value.id;

        try {
            if (editMode.value.brokerage) {
                await updateBrokerage(
                    user.value.uid,
                    memberId,
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
                    memberId,
                    brokerageForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '증권사가 추가되었습니다.',
                    life: 3000,
                });
            }
            delete loadedMemberData.value[memberId];
            await loadMemberData(memberId);
            showBrokerageDialog.value = false;
        } catch (error) {
            console.error('saveBrokerage error:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '저장에 실패했습니다.',
                life: 3000,
            });
        }
    };

    const removeBrokerage = (memberId, brokerageId) => {
        confirm.require({
            message:
                '이 증권사의 모든 계좌와 자산이 삭제됩니다. 계속하시겠습니까?',
            header: '증권사 삭제',
            icon: 'pi pi-exclamation-triangle',
            acceptLabel: '삭제',
            rejectLabel: '취소',
            accept: async () => {
                await deleteBrokerage(user.value.uid, memberId, brokerageId);
                delete loadedMemberData.value[memberId];
                await loadMemberData(memberId);
            },
        });
    };

    // 계좌 관련
    const openAddAccountDialog = (memberId, brokerageId) => {
        accountForm.value = { name: '', accountNumber: '', brokerage: '' };
        editMode.value.account = null;
        selectedNode.value = { data: { brokerageId } };
        showAccountDialog.value = true;
    };

    const saveAccount = async () => {
        if (!accountForm.value.brokerage) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '증권사/은행을 입력해주세요.',
                life: 3000,
            });
            return;
        }
        if (!accountForm.value.name) {
            toast.add({
                severity: 'warn',
                summary: '경고',
                detail: '계좌 닉네임을 입력해주세요.',
                life: 3000,
            });
            return;
        }

        const memberId = selectedMember.value.id;
        const brokerageId =
            editMode.value.account?.brokerageId ||
            selectedNode.value?.data.brokerageId;

        try {
            if (editMode.value.account) {
                await updateAccount(
                    user.value.uid,
                    memberId,
                    brokerageId,
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
                    memberId,
                    brokerageId,
                    accountForm.value
                );
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '계좌가 추가되었습니다.',
                    life: 3000,
                });
            }
            delete loadedMemberData.value[memberId];
            await loadMemberData(memberId);
            showAccountDialog.value = false;
        } catch (error) {
            console.error('saveAccount error:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '저장에 실패했습니다.',
                life: 3000,
            });
        }
    };

    // AddAssetModal 상태
    const showAddAssetModal = ref(false);
    const addAssetModalTarget = ref({
        memberId: null,
        brokerageId: null,
        accountId: null,
    });

    // 자산 관련
    const openAddAssetDialog = (memberId, brokerageId, accountId) => {
        assetForm.value = {
            type: '주식',
            symbol: '',
            amount: 0,
            currency: 'KRW',
            notes: '',
        };
        editMode.value.asset = null;
        selectedNode.value = { data: { brokerageId, accountId } };
        showAssetDialog.value = true;
    };

    const openAddAssetModalFromTree = (memberId, brokerageId, accountId) => {
        addAssetModalTarget.value = { memberId, brokerageId, accountId };
        showAddAssetModal.value = true;
    };

    const handleAssetSaved = async (data) => {
        console.log('Asset saved from modal:', data);
        // TODO: Firestore에 실제로 저장하는 로직 추가
        toast.add({
            severity: 'success',
            summary: '저장 완료',
            detail: '자산이 저장되었습니다.',
            life: 3000,
        });

        // 선택된 멤버의 데이터 다시 로드
        if (addAssetModalTarget.value.memberId) {
            delete loadedMemberData.value[addAssetModalTarget.value.memberId];
            await loadMemberData(addAssetModalTarget.value.memberId);
        }
    };

    const openEditAssetDialog = (memberId, brokerageId, accountId, asset) => {
        assetForm.value = { ...asset };
        editMode.value.asset = asset;
        showAssetDialog.value = true;
    };

    // TODO: saveAsset 함수를 새 구조에 맞게 리팩토링 필요
    // 현재는 거래내역 업로드만 지원
    const saveAsset = async () => {
        toast.add({
            severity: 'warn',
            summary: '알림',
            detail: '수동 자산 추가는 현재 지원하지 않습니다. 거래내역서 업로드를 이용해주세요.',
            life: 3000,
        });
        showAssetDialog.value = false;
    };

    // 거래내역서 업로드 다이얼로그 열기
    const openBrokerageUploadDialog = () => {
        showBrokerageUploadDialog.value = true;
    };

    // 계좌별 거래내역 보기
    const openAccountTransactions = async (
        accountId,
        accountName,
        brokerageName
    ) => {
        if (!user.value) return;

        isLoadingData.value = true;
        try {
            // 해당 계좌의 모든 자산에 대한 거래내역 수집
            const allTransactions = [];
            const memberId = selectedMember.value?.id;
            if (!memberId) return;

            const memberData = loadedMemberData.value[memberId];
            if (!memberData) return;

            // 해당 계좌의 모든 자산 찾기
            const accountAssets = memberData.assets.filter(
                (asset) => asset.accountId === accountId
            );

            // 각 자산의 거래내역 로드
            for (const asset of accountAssets) {
                const transactions = await loadTransactions(
                    user.value.uid,
                    asset.id,
                    accountId
                );
                allTransactions.push(
                    ...transactions.map((tx) => ({
                        ...tx,
                        assetName: asset.name || asset.symbol,
                        assetSymbol: asset.symbol,
                        assetType: asset.type,
                    }))
                );
            }

            // 날짜순 정렬 (최신순)
            allTransactions.sort((a, b) => {
                const dateA = a.date?.toDate
                    ? a.date.toDate()
                    : new Date(a.date);
                const dateB = b.date?.toDate
                    ? b.date.toDate()
                    : new Date(b.date);
                return dateB - dateA;
            });

            transactionDialogData.value = {
                mode: 'account',
                accountId,
                assetId: null,
                title: `${brokerageName} - ${accountName}`,
                transactions: allTransactions,
            };
            showTransactionDialog.value = true;
        } catch (error) {
            console.error('계좌 거래내역 로드 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '거래내역을 불러오는데 실패했습니다.',
                life: 3000,
            });
        } finally {
            isLoadingData.value = false;
        }
    };

    // 자산별 거래내역 보기 (전체 계좌 통합)
    const openAssetTransactions = async (assetId, assetName) => {
        if (!user.value) return;

        isLoadingData.value = true;
        try {
            // 해당 자산의 모든 계좌 거래내역 로드
            const transactions = await loadTransactions(
                user.value.uid,
                assetId,
                null // accountId를 null로 하면 모든 계좌의 거래내역
            );

            // 날짜순 정렬 (최신순)
            transactions.sort((a, b) => {
                const dateA = a.date?.toDate
                    ? a.date.toDate()
                    : new Date(a.date);
                const dateB = b.date?.toDate
                    ? b.date.toDate()
                    : new Date(b.date);
                return dateB - dateA;
            });

            transactionDialogData.value = {
                mode: 'asset',
                accountId: null,
                assetId,
                title: assetName,
                transactions,
            };
            showAssetTransactionDialog.value = true;
        } catch (error) {
            console.error('자산 거래내역 로드 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '거래내역을 불러오는데 실패했습니다.',
                life: 3000,
            });
        } finally {
            isLoadingData.value = false;
        }
    };

    // 거래내역서 업로드 완료 처리
    const handleTransactionUploadComplete = async (data) => {
        uploadedTransactionData.value = data;
        uploadBrokerage.value = data.brokerage;

        const memberId = selectedMember.value.id;

        // [Refactor] 증권사 컬렉션 제거로 인해 로직 변경
        // 계좌 생성 시 brokerage 필드로 처리하므로 별도 증권사 생성 불필요

        // 계좌 찾기 또는 생성
        let accountId = null;
        try {
            // 기존 계좌 목록 조회
            const accounts = await loadAccounts(user.value.uid, memberId);

            const existingAccount = accounts.find(
                (acc) =>
                    acc.accountNumber === data.accountNumber &&
                    acc.brokerage === data.brokerageName
            );

            if (existingAccount) {
                accountId = existingAccount.id;
                console.log('기존 계좌 사용:', accountId);
                toast.add({
                    severity: 'info',
                    summary: '알림',
                    detail: '기존 계좌에 거래내역을 추가합니다.',
                    life: 3000,
                });
            } else {
                // 신규 계좌 생성
                accountId = await addAccount(user.value.uid, memberId, {
                    name: data.accountName,
                    accountNumber: data.accountNumber,
                    brokerage: data.brokerageName, // 증권사 정보 추가
                });
                console.log('신규 계좌 생성:', accountId);
                toast.add({
                    severity: 'success',
                    summary: '성공',
                    detail: '새 계좌가 등록되었습니다.',
                    life: 3000,
                });
            }

            uploadedTransactionData.value.accountId = accountId;
            uploadedTransactionData.value.brokerageName = data.brokerageName;

            // 종목명 매핑 다이얼로그 열기
            showStockMappingDialog.value = true;
        } catch (error) {
            console.error('계좌 처리 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '계좌 처리에 실패했습니다.',
                life: 3000,
            });
        }
    };

    // 종목명 매핑 완료 처리 (Asset-Centric with Holdings)
    const handleMappingComplete = async (mappingMap) => {
        const memberId = selectedMember.value.id;
        const accountId = uploadedTransactionData.value.accountId;
        const transactions =
            uploadedTransactionData.value.extractedData.transactions;

        toast.add({
            severity: 'info',
            summary: '처리 중',
            detail: '거래내역을 등록하고 있습니다...',
            life: 5000,
        });

        console.log('[handleMappingComplete] Starting transaction processing', {
            memberId,
            accountId,
            transactionCount: transactions.length,
        });

        try {
            // 거래내역을 자산별로 그룹화
            const assetMap = new Map();

            transactions.forEach((transaction) => {
                let assetId = null; // ISIN or CASH_{currency}
                let assetType = '주식';
                let currency = 'USD';
                let isin = null;
                let symbol = null;
                let name = null;

                const mapping = mappingMap.get(transaction.stock_name);

                if (mapping) {
                    // 주식 매핑 있음
                    isin = mapping.isin;
                    // symbol은 mapping.symbol을 우선 사용 (sidebar-tickers.json 기준)
                    symbol = mapping.symbol || mapping.systemTicker;
                    name = mapping.name || transaction.stock_name;
                    currency = mapping.currency || 'USD';
                    assetType = '주식';

                    // ISIN이 있으면 ISIN을 사용, 없으면 symbol 사용
                    if (isin) {
                        assetId = isin;
                    } else if (symbol) {
                        assetId = `STOCK_${symbol}`;
                    } else {
                        console.warn(
                            `No ISIN or symbol for ${transaction.stock_name}, skipping`
                        );
                        return;
                    }
                } else if (
                    transaction.ticker &&
                    transaction.ticker.startsWith('US')
                ) {
                    // 매핑은 없지만 PDF에서 추출된 ISIN(ticker)이 있는 경우
                    isin = transaction.ticker;
                    symbol = transaction.ticker; // 심볼을 모르므로 ISIN을 임시로 사용
                    name = transaction.stock_name;
                    currency = 'USD'; // US ISIN이므로 USD로 가정
                    assetType = '주식';
                    assetId = isin;
                } else {
                    // 매핑 없음 - 현금 거래인지 확인
                    const isCash =
                        !transaction.stock_name ||
                        ['현금', '예수금', 'Deposit', 'Withdrawal'].some((k) =>
                            transaction.stock_name.includes(k)
                        ) ||
                        ['입금', '출금', '환전', 'Deposit', 'Withdrawal'].some(
                            (k) =>
                                transaction.type && transaction.type.includes(k)
                        );

                    if (isCash) {
                        currency = transaction.currency || 'USD';
                        if (currency === 'KRW' || currency === '원') {
                            currency = 'KRW';
                        }
                        assetId = `CASH_${currency}`;
                        assetType = '현금';
                        name =
                            currency === 'KRW'
                                ? '원화 예수금'
                                : `${currency} 예수금`;
                    } else {
                        return; // 매핑도 없고 현금도 아니면 스킵
                    }
                }

                if (!assetMap.has(assetId)) {
                    assetMap.set(assetId, {
                        assetId,
                        type: assetType,
                        isin,
                        symbol,
                        name,
                        currency,
                        transactions: [],
                    });
                }

                assetMap.get(assetId).transactions.push(transaction);
            });

            // 각 자산 처리
            let successCount = 0;
            for (const [assetId, assetData] of assetMap.entries()) {
                try {
                    console.log(
                        `[handleMappingComplete] Processing asset: ${assetId}`,
                        assetData
                    );

                    // 평단가 및 수량 계산
                    let totalBuyAmount = 0;
                    let totalBuyQuantity = 0;
                    let totalQuantity = 0;

                    assetData.transactions.forEach((t) => {
                        // 거래 타입 정규화
                        const rawType = t.type ? t.type.trim() : '';
                        const brokerage =
                            uploadedTransactionData.value.brokerageName ||
                            '토스증권';
                        const normalizedType = normalizeTransactionType(
                            rawType,
                            brokerage
                        );

                        // 정규화된 타입 저장
                        t.type = normalizedType;
                        t.rawType = rawType;
                        t.brokerage = brokerage;

                        // 알 수 없는 타입 처리
                        if (normalizedType === TRANSACTION_TYPES.UNKNOWN) {
                            console.warn(
                                `Unknown transaction type: "${rawType}" from "${brokerage}"`
                            );
                            toast.add({
                                severity: 'warn',
                                summary: '새로운 거래 타입 발견',
                                detail: `"${rawType}" 거래가 발견되었습니다.`,
                                life: 3000,
                            });
                        }

                        const isBuy = normalizedType === TRANSACTION_TYPES.BUY;
                        const isSell =
                            normalizedType === TRANSACTION_TYPES.SELL;

                        let amount = t.amount;
                        if (amount === undefined || amount === null) {
                            if (t.price && t.quantity) {
                                amount = t.price * t.quantity;
                            } else if (t.totalPrice) {
                                amount = t.totalPrice;
                            } else if (t.krwAmount) {
                                amount = t.krwAmount;
                            } else {
                                amount = 0;
                            }
                        }

                        if (assetData.type === '주식') {
                            if (isBuy) {
                                totalBuyAmount += Math.abs(amount);
                                totalBuyQuantity += t.quantity || 0;
                                totalQuantity += t.quantity || 0;
                            } else if (isSell) {
                                totalQuantity -= t.quantity || 0;
                            }
                        } else {
                            // 현금은 amount 누적
                            if (
                                normalizedType === TRANSACTION_TYPES.WITHDRAWAL
                            ) {
                                totalQuantity -= Math.abs(amount);
                            } else if (
                                normalizedType === TRANSACTION_TYPES.DEPOSIT
                            ) {
                                totalQuantity += Math.abs(amount);
                            }
                        }
                    });

                    const avgPrice =
                        totalBuyQuantity > 0
                            ? totalBuyAmount / totalBuyQuantity
                            : 0;

                    // 중복 체크: symbol로 기존 자산 찾기
                    const allUserAssets = await loadAssets(user.value.uid);
                    let existingAsset = null;
                    let needsMigration = false;

                    // 1. 정확한 assetId로 찾기
                    existingAsset = allUserAssets.find((a) => a.id === assetId);

                    // 2. assetId로 못 찾았고 symbol이 있으면 symbol로 찾기
                    if (!existingAsset && assetData.symbol) {
                        existingAsset = allUserAssets.find(
                            (a) =>
                                a.symbol === assetData.symbol &&
                                a.type === assetData.type
                        );

                        // Symbol로 찾았는데 ID가 다르면 마이그레이션 필요
                        if (existingAsset && existingAsset.id !== assetId) {
                            needsMigration = true;
                            console.log(
                                `[Deduplication] Found existing asset with different ID:`,
                                {
                                    oldId: existingAsset.id,
                                    newId: assetId,
                                    symbol: assetData.symbol,
                                }
                            );
                        }
                    }

                    // 자산 생성/업데이트 (holdings 사용)
                    if (existingAsset && needsMigration) {
                        // 마이그레이션: 기존 holdings를 새 ID로 복사
                        const mergedHoldings = { ...existingAsset.holdings };

                        // 현재 계좌의 holdings 업데이트
                        if (mergedHoldings[accountId]) {
                            mergedHoldings[accountId].amount += totalQuantity;
                            // 평단가 재계산 (가중평균)
                            const oldTotal =
                                mergedHoldings[accountId].amount *
                                mergedHoldings[accountId].avgPrice;
                            const newTotal = totalQuantity * avgPrice;
                            mergedHoldings[accountId].avgPrice =
                                (oldTotal + newTotal) /
                                (mergedHoldings[accountId].amount +
                                    totalQuantity);
                        } else {
                            mergedHoldings[accountId] = {
                                amount: totalQuantity,
                                avgPrice: avgPrice,
                            };
                        }

                        // 새 ID로 자산 생성
                        await addAsset(user.value.uid, {
                            type: assetData.type,
                            isin: assetData.isin,
                            symbol: assetData.symbol,
                            name: assetData.name,
                            currency: assetData.currency,
                            holdings: mergedHoldings,
                        });

                        console.log(
                            `[Migration] Migrated asset from ${existingAsset.id} to ${assetId}`
                        );

                        // TODO: 기존 자산 삭제는 나중에 처리 (거래내역 마이그레이션 필요)
                    } else {
                        // 일반 생성/업데이트
                        await addAsset(user.value.uid, {
                            type: assetData.type,
                            isin: assetData.isin,
                            symbol: assetData.symbol,
                            name: assetData.name,
                            currency: assetData.currency,
                            holdings: {
                                [accountId]: {
                                    amount: totalQuantity,
                                    avgPrice: avgPrice,
                                },
                            },
                        });
                    }

                    console.log(
                        `[handleMappingComplete] Asset created/updated: ${assetId}`
                    );

                    // 거래내역 저장
                    for (const transaction of assetData.transactions) {
                        try {
                            const cleanTransaction = JSON.parse(
                                JSON.stringify(transaction)
                            );

                            if (cleanTransaction.amount === undefined) {
                                if (
                                    cleanTransaction.price &&
                                    cleanTransaction.quantity
                                ) {
                                    cleanTransaction.amount =
                                        cleanTransaction.price *
                                        cleanTransaction.quantity;
                                } else if (cleanTransaction.totalPrice) {
                                    cleanTransaction.amount =
                                        cleanTransaction.totalPrice;
                                } else {
                                    cleanTransaction.amount = 0;
                                }
                            }

                            await addTransaction(user.value.uid, assetId, {
                                ...cleanTransaction,
                                accountId, // Include accountId in transaction
                            });
                        } catch (txError) {
                            console.error(
                                `[handleMappingComplete] Failed to save transaction:`,
                                txError
                            );
                        }
                    }

                    successCount++;
                } catch (error) {
                    console.error(`자산 등록 실패 (${assetId}):`, error);
                }
            }

            toast.add({
                severity: 'success',
                summary: '완료',
                detail: `${successCount}개 자산의 거래내역이 등록되었습니다.`,
                life: 3000,
            });

            // 데이터 다시 로드
            delete loadedMemberData.value[memberId];
            await loadMemberData(memberId);
            showStockMappingDialog.value = false;
        } catch (error) {
            console.error('거래내역 저장 실패:', error);
            toast.add({
                severity: 'error',
                summary: '오류',
                detail: '거래내역 저장에 실패했습니다.',
                life: 3000,
            });
        }
    };

    // --- 데이터 마이그레이션 (임시) ---
    import { collection, getDocs, addDoc } from 'firebase/firestore';
    import { db } from '@/firebase';

    const migrateData = async () => {
        if (!user.value) return;
        const userId = user.value.uid;

        try {
            toast.add({
                severity: 'info',
                summary: '마이그레이션 시작',
                detail: '데이터 구조를 변경합니다...',
                life: 5000,
            });

            // 1. 가족 멤버 조회
            const membersRef = collection(
                db,
                `userAssets/${userId}/familyMembers`
            );
            const membersSnapshot = await getDocs(membersRef);

            for (const memberDoc of membersSnapshot.docs) {
                const memberId = memberDoc.id;
                console.log(`Migrating member: ${memberId}`);

                // 2. 증권사 조회 (구 구조)
                const brokeragesRef = collection(
                    db,
                    `userAssets/${userId}/familyMembers/${memberId}/brokerages`
                );
                const brokeragesSnapshot = await getDocs(brokeragesRef);

                for (const brokerageDoc of brokeragesSnapshot.docs) {
                    const brokerageId = brokerageDoc.id;
                    const brokerageData = brokerageDoc.data();
                    const brokerageName =
                        brokerageData.name || 'Unknown Brokerage';
                    console.log(
                        `  Migrating brokerage: ${brokerageName} (${brokerageId})`
                    );

                    // 3. 계좌 조회 (구 구조)
                    const accountsRef = collection(
                        db,
                        `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}/accounts`
                    );
                    const accountsSnapshot = await getDocs(accountsRef);

                    for (const accountDoc of accountsSnapshot.docs) {
                        const accountId = accountDoc.id; // ID 유지 시도? 아니면 새로 생성? -> 새로 생성하는게 안전 (ID 충돌 방지)
                        // 하지만 ID를 유지하지 않으면 복잡해짐. 일단 새로 생성.
                        const accountData = accountDoc.data();
                        console.log(
                            `    Migrating account: ${accountData.name}`
                        );

                        // 4. 새 구조로 계좌 생성
                        const newAccountRef = await addAccount(
                            userId,
                            memberId,
                            {
                                ...accountData,
                                brokerage: brokerageName,
                            }
                        );
                        const newAccountId = newAccountRef; // addAccount returns ID string based on my update? No, addAccount returns void in current code?
                        // Wait, addAccount in useAssetFirestore returns docRef (which is an object), I need to check.
                        // Actually, I updated addAccount to return docRef. So I need to get .id from it.
                        // Let's check useAssetFirestore.js again.
                        // It returns `docRef`. So `newAccountId = docRef.id`.

                        // 5. 자산 조회 (구 구조)
                        const assetsRef = collection(
                            db,
                            `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}/accounts/${accountId}/assets`
                        );
                        const assetsSnapshot = await getDocs(assetsRef);

                        for (const assetDoc of assetsSnapshot.docs) {
                            const assetData = assetDoc.data();
                            // 6. 새 구조로 자산 생성
                            const newAssetId = await addAsset(
                                userId,
                                memberId,
                                newAccountId,
                                {
                                    ...assetData,
                                    brokerage: brokerageName,
                                }
                            );

                            // 7. 트랜잭션 조회 (구 구조)
                            const transactionsRef = collection(
                                db,
                                `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}/accounts/${accountId}/assets/${assetDoc.id}/transactions`
                            );
                            const transactionsSnapshot =
                                await getDocs(transactionsRef);

                            for (const txDoc of transactionsSnapshot.docs) {
                                const txData = txDoc.data();
                                // 8. 새 구조로 트랜잭션 생성
                                await addTransaction(
                                    userId,
                                    memberId,
                                    newAccountId,
                                    newAssetId,
                                    txData
                                );
                            }
                        }
                    }
                }
            }

            toast.add({
                severity: 'success',
                summary: '마이그레이션 완료',
                detail: '데이터가 성공적으로 이동되었습니다.',
                life: 3000,
            });
            // 새로고침
            window.location.reload();
        } catch (error) {
            console.error('Migration failed:', error);
            toast.add({
                severity: 'error',
                summary: '마이그레이션 실패',
                detail: error.message,
                life: 5000,
            });
        }
    };
</script>

<template>
    <div id="t-asset-view">
        <!-- DEBUG: 상태 정보 -->
        <Card class="mb-3">
            <template #content>
                <div class="p-3">
                    <h4>🔍 Debug 정보</h4>
                    <div class="flex gap-2 mb-2">
                        <Button
                            label="데이터 마이그레이션 (구조 변경)"
                            severity="warning"
                            size="small"
                            @click="migrateData" />
                    </div>
                    <p>familyMembers.length: {{ familyMembers.length }}</p>
                    <p>isLoadingMembers: {{ isLoadingMembers }}</p>
                    <p>selectedTabIndex: {{ selectedTabIndex }}</p>
                    <p>showZeroBalanceAssets: {{ showZeroBalanceAssets }}</p>
                    <p v-if="selectedMember">
                        선택된 멤버 ID: {{ selectedMember.id }}
                    </p>
                    <p
                        v-if="
                            selectedMember &&
                            loadedMemberData[selectedMember.id]
                        ">
                        로드된 계좌 수:
                        {{
                            loadedMemberData[selectedMember.id].accounts.length
                        }}
                    </p>
                    <p
                        v-if="
                            selectedMember &&
                            loadedMemberData[selectedMember.id]
                        ">
                        로드된 자산 수:
                        {{ loadedMemberData[selectedMember.id].assets.length }}
                    </p>
                    <p v-if="selectedMember && treeDataMap[selectedMember.id]">
                        트리 노드 수:
                        {{ treeDataMap[selectedMember.id].length }}
                    </p>
                    <p
                        v-if="
                            selectedMember &&
                            flatTableDataMap[selectedMember.id]
                        ">
                        테이블 행 수:
                        {{ flatTableDataMap[selectedMember.id].length }}
                    </p>
                </div>
            </template>
        </Card>

        <!-- 가족 멤버가 없을 때 -->
        <Card v-if="familyMembers.length === 0 && !isLoadingMembers">
            <template #content>
                <div
                    class="flex flex-column align-items-center justify-content-center p-8 gap-4">
                    <i class="pi pi-wallet text-8xl"></i>
                    <h4 class="text-2xl font-bold">자산관리를 시작하세요</h4>
                    <p>
                        가족 구성원을 추가하여 자산을 체계적으로 관리할 수
                        있습니다.
                    </p>
                    <Button
                        label="첫 번째 가족 추가하기"
                        icon="pi pi-plus"
                        size="large"
                        @click="openAddMemberDialog" />
                </div>
            </template>
        </Card>
        <!-- 증권사 추가 버튼 (제거 또는 계좌 추가로 변경) -->
        <div v-if="selectedMember" class="flex justify-content-end gap-2 mb-3">
            <Button
                label="거래내역서 업로드"
                icon="pi pi-upload"
                severity="success"
                @click="openBrokerageUploadDialog" />
            <Button
                label="계좌 직접 추가"
                icon="pi pi-plus"
                @click="openAddAccountDialog(selectedMember.id)" />
        </div>

        <div class="flex justify-content-between align-items-center gap-3">
            <!-- 가족 멤버 리스트 -->
            <FamilyMemberList
                v-if="familyMembers.length > 0"
                :members="familyMembers"
                :selectedMemberId="selectedMemberId"
                @select="handleMemberSelect"
                @add="openAddMemberDialog" />
            <AssetViewModeToggle
                v-if="selectedMember"
                v-model:mode="viewMode" />
        </div>

        <!-- 선택된 멤버의 자산 관리 -->
        <div v-if="selectedMember" class="mt-3">
            <!-- DataTable with Row Grouping (증권사별 그룹화) -->
            <Card v-if="viewMode === 'account'">
                <template #header>
                    <div
                        class="flex justify-content-between align-items-center p-3">
                        <h3 class="m-0">{{ selectedMember.name }}님의 자산</h3>
                        <div class="flex gap-2">
                            <Tag
                                severity="info"
                                :value="`계좌 ${loadedMemberData[selectedMember.id]?.accounts?.length || 0}개`" />
                            <Tag
                                severity="warning"
                                :value="`보유종목 ${loadedMemberData[selectedMember.id]?.assets?.length || 0}개`" />
                        </div>
                    </div>
                </template>
                <template #content>
                    <!-- Empty State -->
                    <div
                        v-if="
                            !loadedMemberData[selectedMember.id]?.accounts
                                ?.length
                        "
                        class="flex flex-column align-items-center justify-content-center p-6 text-center">
                        <i
                            class="pi pi-inbox text-6xl mb-4"
                            style="color: var(--text-color-secondary)"></i>
                        <h3 class="mb-2">아직 등록된 계좌가 없습니다</h3>
                        <p class="text-color-secondary mb-4">
                            거래내역서를 업로드하거나 계좌를 직접 추가해보세요.
                        </p>
                        <div class="flex gap-2">
                            <Button
                                label="거래내역서 업로드"
                                icon="pi pi-upload"
                                severity="success"
                                @click="openBrokerageUploadDialog" />
                            <Button
                                label="계좌 직접 추가"
                                icon="pi pi-plus"
                                @click="
                                    openAddAccountDialog(selectedMember.id)
                                " />
                        </div>
                    </div>
                    <DataTable
                        :value="flatTableDataMap[selectedMember.id] || []"
                        rowGroupMode="subheader"
                        groupRowsBy="groupKey"
                        sortMode="single"
                        sortField="groupKey"
                        :sortOrder="1"
                        :metaKeySelection="false"
                        class="p-datatable-sm">
                        <template #header>
                            <!-- View 모드 및 필터 토글 -->
                            <div
                                class="flex flex-wrap justify-content-end align-items-center gap-3">
                                <InputSwitch
                                    v-model="showZeroBalanceAssets"
                                    inputId="showZeroBalance" />
                                <label
                                    for="showZeroBalance"
                                    class="cursor-pointer select-none"
                                    >보유 수량 0인 항목 보기</label
                                >
                            </div>
                        </template>
                        <!-- 그룹 헤더 (증권사 - 계좌) -->
                        <template #groupheader="{ data }">
                            <div
                                class="flex justify-content-between align-items-center p-2">
                                <div class="flex align-items-center gap-3">
                                    <img
                                        v-if="data.brokerageLogo"
                                        :src="data.brokerageLogo"
                                        :alt="data.brokerage"
                                        @error="
                                            (e) =>
                                                (e.target.style.display =
                                                    'none')
                                        "
                                        style="
                                            width: 2rem;
                                            height: 2rem;
                                            object-fit: contain;
                                        " />
                                    <i
                                        v-else
                                        class="pi pi-building text-2xl"></i>
                                    <div class="flex">
                                        <span class="font-bold text-xl mr-3">{{
                                            data.brokerage
                                        }}</span>
                                        <div
                                            class="flex align-items-center gap-2 mt-1">
                                            <span class="text-lg">{{
                                                data.account
                                            }}</span>
                                            <span
                                                v-if="
                                                    data.accountNumber &&
                                                    data.accountNumber !==
                                                        data.account
                                                "
                                                class="text-sm text-color-secondary">
                                                ({{ data.accountNumber }})
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    label="거래내역"
                                    icon="pi pi-list"
                                    size="small"
                                    @click="
                                        openAccountTransactions(
                                            data.accountId,
                                            data.account,
                                            data.brokerage
                                        )
                                    " />
                            </div>
                        </template>

                        <!-- 자산 분류 -->
                        <Column
                            header="분류"
                            field="assetCategory"
                            style="min-width: 120px">
                            <template #body="{ data }">
                                <Tag
                                    :value="data.assetCategory"
                                    :severity="
                                        data.assetCategory.includes('주식')
                                            ? 'success'
                                            : data.assetCategory.includes(
                                                    '예수금'
                                                )
                                              ? 'info'
                                              : data.assetCategory.includes(
                                                      '코인'
                                                  )
                                                ? 'warning'
                                                : 'secondary'
                                    " />
                            </template>
                        </Column>

                        <!-- 종목명 -->
                        <Column
                            header="종목"
                            field="displayName"
                            style="min-width: 200px">
                            <template #body="{ data }">
                                <div class="flex align-items-center gap-2">
                                    <i :class="data.icon"></i>
                                    <span>{{ data.displayName }}</span>
                                </div>
                            </template>
                        </Column>

                        <!-- 수량/금액 -->
                        <Column
                            header="수량"
                            field="amount"
                            style="min-width: 100px">
                            <template #body="{ data }">
                                <span>{{ data.amount.toLocaleString() }}</span>
                            </template>
                        </Column>

                        <!-- 평단가 -->
                        <Column
                            header="평단가"
                            field="avgPrice"
                            style="min-width: 120px">
                            <template #body="{ data }">
                                <span v-if="data.avgPrice">
                                    {{
                                        formatCurrency(
                                            data.avgPrice,
                                            data.currency
                                        )
                                    }}
                                </span>
                                <span v-else>-</span>
                            </template>
                        </Column>

                        <!-- 통화 -->
                        <Column
                            header="통화"
                            field="currency"
                            style="min-width: 80px">
                            <template #body="{ data }">
                                <Tag
                                    :value="data.currency"
                                    severity="secondary" />
                            </template>
                        </Column>

                        <!-- 액션 -->
                        <Column header="액션" style="width: 120px">
                            <template #body="{ data }">
                                <div class="flex gap-1">
                                    <Button
                                        icon="pi pi-pencil"
                                        size="small"
                                        rounded
                                        text
                                        severity="secondary"
                                        v-tooltip="'수정'" />
                                    <Button
                                        icon="pi pi-trash"
                                        size="small"
                                        rounded
                                        text
                                        severity="danger"
                                        v-tooltip="'삭제'" />
                                    <Button
                                        v-tooltip="'거래내역'"
                                        icon="pi pi-list"
                                        size="small"
                                        severity="secondary"
                                        rounded
                                        text
                                        @click="
                                            openTransactionDialog(
                                                data,
                                                data.accountId,
                                                false
                                            )
                                        " />
                                </div>
                            </template>
                        </Column>

                        <!-- 그룹 푸터 (증권사별 요약 정보 - 선택사항) -->
                        <template #groupfooter="{ data }">
                            <div class="flex justify-content-end p-2">
                                <span class="text-sm text-color-secondary">
                                    <!-- 증권사별 합계 표시 가능 -->
                                </span>
                            </div>
                        </template>

                        <template #empty>
                            <div
                                class="flex flex-column align-items-center gap-3 p-4">
                                <i class="pi pi-inbox text-6xl"></i>
                                <p>등록된 자산이 없습니다.</p>
                                <Button
                                    label="첫 번째 계좌 추가하기"
                                    icon="pi pi-plus"
                                    @click="
                                        openAddAccountDialog(selectedMember.id)
                                    " />
                            </div>
                        </template>
                    </DataTable>
                </template>
            </Card>

            <!-- 자산별 기준 보기 (DataTable) -->
            <div v-if="viewMode === 'asset_type'" class="mt-4">
                <AssetTypeDataTable
                    :assets="assetTypeDataMap[selectedMember.id] || []"
                    @view-transactions="
                        (asset) => openAssetTransactionDialog(asset, null)
                    " />
            </div>

            <!-- 종목 기준 보기 (별도 패널) -->
            <div v-if="viewMode === 'stock'" class="mt-4">
                <AssetListView
                    :viewMode="viewMode"
                    :treeData="treeDataMap[selectedMember.id] || []" />
            </div>
        </div>

        <!-- 가족 추가 패널 -->
        <div v-if="selectedTabIndex === String(familyMembers.length)">
            <Card>
                <template #content>
                    <div
                        class="flex flex-column align-items-center justify-content-center p-8 gap-4">
                        <i class="pi pi-user-plus text-8xl"></i>
                        <h4 class="text-2xl font-bold">
                            새로운 가족을 추가하세요
                        </h4>
                        <p>배우자, 자녀, 부모님 등 가족의 자산을 관리하세요.</p>
                        <Button
                            label="가족 추가하기"
                            icon="pi pi-plus"
                            size="large"
                            @click="openAddMemberDialog" />
                    </div>
                </template>
            </Card>
        </div>

        <!-- 가족 멤버 다이얼로그 -->
        <Dialog
            v-model:visible="showMemberDialog"
            modal
            :style="{ width: '30rem' }">
            <template #header>
                <span class="font-bold text-lg">{{
                    editMode.member ? '가족 멤버 수정' : '가족 멤버 추가'
                }}</span>
            </template>
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
            :style="{ width: '30rem' }">
            <template #header>
                <span class="font-bold text-lg">증권사 추가</span>
            </template>
            <div class="flex flex-column gap-3">
                <div class="flex flex-column gap-2">
                    <label for="brokerageName">증권사 이름</label>
                    <InputText
                        id="brokerageName"
                        v-model="brokerageForm.name"
                        placeholder="예: kb자산운용, 미래에셋" />
                </div>
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
            :style="{ width: '30rem' }">
            <template #header>
                <span class="font-bold text-lg">계좌 추가</span>
            </template>
            <div class="flex flex-column gap-3">
                <div class="flex flex-column gap-2">
                    <label for="brokerageName">증권사 / 은행 / 거래소</label>
                    <Dropdown
                        id="brokerageName"
                        v-model="accountForm.brokerage"
                        :options="brokerageOptions"
                        optionLabel="label"
                        optionValue="value"
                        placeholder="선택하세요"
                        filter
                        :filterPlaceholder="'검색...'"
                        showClear
                        class="w-full">
                        <template #option="{ option }">
                            <div class="flex align-items-center gap-2">
                                <Tag
                                    :value="option.type"
                                    :severity="
                                        option.type === '증권'
                                            ? 'success'
                                            : option.type === '은행'
                                              ? 'info'
                                              : 'warning'
                                    "
                                    size="small" />
                                <span>{{ option.label }}</span>
                            </div>
                        </template>
                    </Dropdown>
                </div>
                <div class="flex flex-column gap-2">
                    <label for="accountName">계좌 닉네임</label>
                    <InputText
                        id="accountName"
                        v-model="accountForm.name"
                        placeholder="주식계좌, ISA계좌 등" />
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
            :style="{ width: '30rem' }">
            <template #header>
                <span class="font-bold text-lg">자산 추가</span>
            </template>
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

        <!-- 파일 업로드 다이얼로그 -->
        <Dialog
            v-model:visible="showUploadDialog"
            modal
            :style="{ width: '40rem' }"
            header="파일 업로드">
            <div class="flex flex-column gap-4">
                <div v-if="uploadTargetAsset">
                    <Tag :value="uploadTargetAsset.data.name" severity="info" />
                    <p>
                        {{ uploadTargetAsset.data.name }}에 파일을 업로드합니다.
                    </p>
                </div>

                <FileUpload
                    mode="basic"
                    name="upload[]"
                    accept=".pdf,.xlsx,.xls,.csv"
                    :maxFileSize="5000000"
                    @upload="handleFileUpload"
                    :auto="false"
                    chooseLabel="파일 선택"
                    class="w-full">
                    <template #empty>
                        <p class="text-center">
                            드래그하여 파일을 업로드하거나 클릭하여 선택하세요.
                        </p>
                    </template>
                </FileUpload>

                <div class="flex flex-column gap-2">
                    <h5 class="font-semibold">업로드 가능한 파일 형식:</h5>
                    <ul class="list-none pl-0">
                        <li class="flex align-items-center gap-2">
                            <i class="pi pi-file" /> 입출금 내역 (CSV, XLSX,
                            PDF)
                        </li>
                        <li class="flex align-items-center gap-2">
                            <i class="pi pi-file" /> 매수/매도 내역 (CSV, XLSX,
                            PDF)
                        </li>
                        <li class="flex align-items-center gap-2">
                            <i class="pi pi-file" /> 환율 정보 (CSV, XLSX)
                        </li>
                    </ul>
                </div>
            </div>
            <template #footer>
                <Button
                    label="취소"
                    severity="secondary"
                    @click="showUploadDialog = false" />
            </template>
        </Dialog>
        <!-- Add Asset Modal -->
        <AddAssetModal
            v-model:visible="showAddAssetModal"
            :showAssetType="true"
            @saved="handleAssetSaved" />

        <!-- 거래내역서 업로드 다이얼로그 -->
        <BrokerageUploadDialog
            v-if="selectedMember"
            v-model:visible="showBrokerageUploadDialog"
            :memberId="selectedMember.id"
            @upload-complete="handleTransactionUploadComplete" />

        <!-- 종목명 매핑 다이얼로그 -->
        <StockMappingDialog
            v-if="uploadedTransactionData"
            v-model:visible="showStockMappingDialog"
            :transactions="uploadedTransactionData.extractedData.transactions"
            :brokerage="uploadBrokerage"
            @mapping-complete="handleMappingComplete" />

        <!-- 거래내역 다이얼로그 (계좌별) -->
        <AccountTransactionDialog
            v-model:visible="showTransactionDialog"
            :title="transactionDialogData.title"
            :transactions="transactionDialogData.transactions"
            :isLoading="isLoadingData" />

        <!-- 거래내역 다이얼로그 (자산별) -->
        <AssetTransactionDialog
            v-model:visible="showAssetTransactionDialog"
            :title="transactionDialogData.title"
            :transactions="transactionDialogData.transactions"
            :isLoading="isLoadingData" />

        <!-- 거래내역 다이얼로그 (증권사별) -->
        <BrokerageTransactionDialog
            v-model:visible="showBrokerageTransactionDialog"
            :title="transactionDialogData.title"
            :transactions="transactionDialogData.transactions"
            :isLoading="isLoadingData" />

        <!-- 거래내역 다이얼로그 (고급 - 수익 분석) -->
        <EnhancedTransactionDialog
            v-model:visible="showEnhancedTransactionDialog"
            :title="transactionDialogData.title"
            :transactions="transactionDialogData.transactions"
            :currentPrice="transactionDialogData.currentPrice || 0"
            :isLoading="isLoadingData" />

        <!-- 로딩 오버레이 -->
        <LoadingOverlay :visible="isLoadingData" :message="loadingMessage" />
    </div>
</template>
