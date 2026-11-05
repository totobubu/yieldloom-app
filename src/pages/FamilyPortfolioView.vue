<script setup>
    import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
    import { formatStoredAmount } from '@/utils/formatStoredAmount.js';
    import { groupStoredPositions } from '@/services/holdingsPresentation.js';
    import { capitalAccountLabel } from '@/services/accountDisplay.js';
    import { useAssetManagement } from '@/composables/useAssetManagement.js';
    import AssetMemberSelector from '@/components/portfolio/AssetMemberSelector.vue';
    import AssetAccountList from '@/components/portfolio/AssetAccountList.vue';
    import AssetCurrencySummary from '@/components/portfolio/AssetCurrencySummary.vue';
    import AssetMemberDialog from '@/components/portfolio/AssetMemberDialog.vue';
    import AssetAccountRegistration from '@/components/portfolio/AssetAccountRegistration.vue';
    import AccountTossConnection from '@/components/portfolio/AccountTossConnection.vue';
    import AccountEvidencePanel from '@/components/portfolio/AccountEvidencePanel.vue';
    import { accountToss, localToss } from '@/services/accountToss.js';
    import AssetUploadDialog from '@/components/portfolio/AssetUploadDialog.vue';
    import { createScopedRefresh } from '@/services/scopedRefresh.js';
    import AccountRecoveryOverview from '@/components/portfolio/AccountRecoveryOverview.vue';
    import PortfolioCapitalPanel from '@/components/portfolio/PortfolioCapitalPanel.vue';
    import PurchaseFundingEditor from '@/components/portfolio/PurchaseFundingEditor.vue';
    import PortfolioExportDialog from '@/components/portfolio/PortfolioExportDialog.vue';
    import PortfolioImportResult from '@/components/portfolio/PortfolioImportResult.vue';
    import PortfolioLoadingRegion from '@/components/portfolio/PortfolioLoadingRegion.vue';
    import ManualHoldingsForm from '@/components/portfolio/ManualHoldingsForm.vue';
    import HoldingsChanges from '@/components/portfolio/HoldingsChanges.vue';
    import SnapshotHistory from '@/components/portfolio/SnapshotHistory.vue';
    import BrokerSpreadsheetForm from '@/components/portfolio/BrokerSpreadsheetForm.vue';
    import StatementIdentityReview from '@/components/portfolio/StatementIdentityReview.vue';
    import PortfolioImportReview from '@/components/portfolio/PortfolioImportReview.vue';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import { portfolioMappingRequest } from '@/services/portfolioMappings.js';
    import {
        applyIsinResolutions,
        inferExchangeFunding,
        transactionTypeLabel,
        transactionTypeOptions,
        unresolvedIsins,
    } from '@/services/tossImportReview.js';
    import { useRoute, useRouter } from 'vue-router';
    import PortfolioDividendCalendar from '@/components/portfolio/PortfolioDividendCalendar.vue';
    import PortfolioValuation from '@/components/portfolio/PortfolioValuation.vue';
    import PortfolioHoldingCards from '@/components/portfolio/PortfolioHoldingCards.vue';
    import PortfolioInsights from '@/components/portfolio/PortfolioInsights.vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import InputText from 'primevue/inputtext';
    import PortfolioFileImportForm from '@/components/portfolio/PortfolioFileImportForm.vue';
    import Select from 'primevue/select';
    import SelectButton from 'primevue/selectbutton';
    import Message from 'primevue/message';
    import Tag from 'primevue/tag';
    import Dialog from 'primevue/dialog';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import { authLoading, firebaseUser } from '@/services/firebaseClient';
    import { familyRequest } from '@/services/familyPortfolio';
    import { useRequestCooldown } from '@/composables/useRequestCooldown.js';

    const router = useRouter();
    const route = useRoute();
    const portfolioTabs = ['overview', 'calendar', 'insights', 'assets'];
    const portfolioTab = computed({
        get: () =>
            portfolioTabs.includes(route.query.tab)
                ? route.query.tab
                : 'overview',
        set: (tab) => router.replace({ query: { ...route.query, tab } }),
    });
    watch(
        () => route.query.tab,
        (tab) => {
            if (tab === 'settings') portfolioTab.value = 'overview';
            else if (['accounts', 'family', 'upload'].includes(tab))
                portfolioTab.value = 'assets';
        },
        { immediate: true }
    );
    const overviewViews = ['summary', 'holdings', 'capital'];
    const recoveryOverviewOpen = ref(false);
    const overviewView = computed({
        get: () =>
            overviewViews.includes(route.query.view)
                ? route.query.view
                : 'summary',
        set: (view) =>
            router.push({
                query: { ...route.query, tab: 'overview', view },
            }),
    });
    const exportVisible = ref(false),
        exportKind = ref('holdings'),
        importReceipt = ref(null);
    const kindOptions = [
        { label: '거래내역', value: 'transactions' },
        { label: '잔고내역', value: 'holdings' },
    ];
    const formatOptions = [
        { label: '표준 CSV', value: 'standard-csv' },
        { label: '표준 XLSX (첫 시트·첫 행 제목)', value: 'standard-xlsx' },
        { label: '토스 거래내역 PDF', value: 'toss-pdf' },
    ];
    const families = ref([]),
        familyId = ref('__all__'),
        accounts = ref([]),
        rawSummary = ref(null);
    const requestedCalculations = new Set();
    const busy = ref(false),
        operationProgress = ref(null),
        error = ref(''),
        message = ref('');
    const operationInDialog = ref(false);
    const accountsState = ref('loading'),
        accountLoadError = ref('');
    const contentBusy = computed(
        () => busy.value || accountsState.value === 'loading'
    );
    const accountLoadIssue = ref(null);
    const accountCooldown = useRequestCooldown(accountLoadIssue);
    const retryTime = computed(() =>
        accountCooldown.retryAt.value === null
            ? ''
            : new Intl.DateTimeFormat('ko-KR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZoneName: 'short',
              }).format(accountCooldown.retryAt.value)
    );
    const tossOpenRequest = ref(0);
    const selectedAccount = ref(''),
        kind = ref('transactions'),
        asOf = ref(''),
        format = ref('standard-csv');
    const rememberPassword = ref(true);
    watch(format, () => {
        review.value = null;
        confirmed.value = false;
        selectedFiles.value = [];
        fileUpload.value?.clear();
        if (format.value === 'toss-pdf') kind.value = 'transactions';
    });
    const inputMethod = ref('file');
    const inputMethodOptions = [
        { label: '파일 업로드', value: 'file' },
        { label: '수동 잔고 입력', value: 'manual' },
        { label: '증권사 CSV·XLSX 열 연결', value: 'broker' },
    ];
    watch(inputMethod, () => {
        review.value = null;
        importReceipt.value = null;
    });
    function updateReviewRow({ index, field, value }) {
        if (!review.value?.rows[index]) return;
        review.value.rows[index][field] = value;
        if (
            field === 'symbol' &&
            review.value.rows[index]._mappingIsin &&
            value !== review.value.rows[index]._mappingIsin
        )
            review.value.rows[index]._mappingStatus = 'manual';
        if (review.value.source === 'toss-pdf')
            review.value.rows = inferExchangeFunding(review.value.rows);
    }
    async function enrichTossReview(rows) {
        const isins = unresolvedIsins(rows);
        if (!isins.length)
            return {
                rows: inferExchangeFunding(applyIsinResolutions(rows, [])),
            };
        const results = [];
        try {
            for (let offset = 0; offset < isins.length; offset += 50) {
                const response = await portfolioMappingRequest(
                    firebaseUser.value,
                    {
                        action: 'resolveBatch',
                        isins: isins.slice(offset, offset + 50),
                    }
                );
                results.push(...response.results);
            }
            return {
                rows: inferExchangeFunding(applyIsinResolutions(rows, results)),
            };
        } catch (reason) {
            return {
                rows: inferExchangeFunding(applyIsinResolutions(rows, [])),
                mappingWarning: `종목 자동 조회를 완료하지 못했습니다. ISIN을 직접 확인해 주세요. (${reason.message})`,
            };
        }
    }
    async function entryId(externalId) {
        const bytes = new TextEncoder().encode(externalId);
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(digest)]
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
    }
    async function saveMatchedFunding(current) {
        const inferred = current.rows.filter(
            (row) => row._fundingSuggestion?.basis === 'date_pool'
        ).length;
        const matches = current.rows.filter(
            (row) =>
                row._fundingStatus === 'matched_exchange' &&
                row._fundingSuggestion.basis !== 'date_pool'
        );
        let saved = 0,
            failed = 0;
        for (const row of matches) {
            const suggestion = row._fundingSuggestion;
            const krw = current.rows[suggestion.krwIndex];
            const usd = current.rows[suggestion.usdIndex];
            try {
                await portfolioCapitalRequest(
                    firebaseUser.value,
                    {
                        action: 'saveFunding',
                        assetId: 'ACCOUNT',
                        transactionId: await entryId(row.externalId),
                        basisKey: JSON.stringify([
                            row.date,
                            row.rawType || row.type,
                            'USD',
                            Number(row.nativeSettlementAmount),
                            row.settlementAmount == null
                                ? null
                                : Number(row.settlementAmount),
                        ]),
                        revision: 0,
                        parts: [
                            {
                                method: 'krw_conversion',
                                amount: suggestion.amount,
                                paidKrw: suggestion.paidKrw,
                                source: 'unknown',
                            },
                        ],
                        evidenceIds: [
                            await entryId(krw.externalId),
                            await entryId(usd.externalId),
                        ],
                        note: '토스 PDF의 같은 날짜 원화 환전 출금·달러 입금·매수 정산액이 일대일로 일치했습니다. 원화의 최초 출처는 확인이 필요합니다.',
                    },
                    current.accountId
                );
                saved++;
            } catch {
                failed++;
            }
        }
        return { saved, failed, inferred };
    }
    const capitalPanel = ref(null);
    const capital = ref({ entries: [], classifications: [], allocations: [] });
    const capitalLoading = ref(false),
        capitalError = ref(''),
        fundingEntry = ref(null),
        fundingDialog = ref(false),
        fundingMessage = ref('');
    let capitalGeneration = 0,
        capitalScope = '';
    async function loadCapital({ force = false } = {}) {
        const nextScope = `${firebaseUser.value?.uid}:${selectedAccount.value}`;
        if (capitalLoading.value && nextScope === capitalScope) return;
        const user = firebaseUser.value,
            accountId = selectedAccount.value,
            generation = ++capitalGeneration;
        const scope = `${user?.uid}:${accountId}`;
        if (scope !== capitalScope) {
            capital.value = {
                entries: [],
                classifications: [],
                allocations: [],
            };
            capitalScope = scope;
        }
        capitalError.value = '';
        if (
            !user ||
            !accountId ||
            (!fundingDialog.value &&
                (portfolioTab.value !== 'overview' ||
                    overviewView.value !== 'capital'))
        ) {
            capitalLoading.value = false;
            return;
        }
        capitalLoading.value = true;
        try {
            const state = await portfolioCapitalRequest(
                user,
                undefined,
                accountId,
                { force }
            );
            if (generation === capitalGeneration) capital.value = state;
        } catch (reason) {
            if (generation === capitalGeneration)
                capitalError.value = reason.message;
        } finally {
            if (generation === capitalGeneration) capitalLoading.value = false;
        }
    }
    watch(
        [selectedAccount, firebaseUser, overviewView, portfolioTab],
        () => {
            fundingEntry.value = null;
            fundingDialog.value = false;
            loadCapital();
        },
        { immediate: true }
    );
    async function openFunding(entry) {
        fundingEntry.value = {
            ...entry.row,
            id: entry.id,
            accountId: selectedAccount.value,
        };
        fundingMessage.value = '';
        await nextTick();
        fundingDialog.value = true;
        await loadCapital();
    }
    async function fundingSaved() {
        await loadCapital();
        fundingMessage.value = capitalError.value
            ? ''
            : '자금 구성을 저장했습니다.';
    }
    const importReview = ref(null);
    const importResult = ref(null);
    const importHeading = ref(null);
    const filePreviewError = ref('');
    let focusFilePreview = false;
    let focusSavedResult = false;
    const fileUpload = ref(null),
        selectedFiles = ref([]),
        password = ref(''),
        confirmed = ref(false),
        statementConfirmed = ref(false),
        review = ref(null);
    watch(
        [selectedFiles, password, format, selectedAccount, inputMethod],
        () => {
            filePreviewError.value = '';
        }
    );
    async function focusPreviewFeedback() {
        if (focusSavedResult) {
            focusSavedResult = false;
            await nextTick();
            if (importReceipt.value) importResult.value?.focusHeading();
        }
        if (!focusFilePreview) return;
        focusFilePreview = false;
        await nextTick();
        if (review.value) importReview.value?.focusHeading();
        else fileUpload.value?.focusError();
    }
    const statementBlocked = computed(
        () =>
            review.value?.source === 'toss-pdf' &&
            (!review.value.statementFiles?.length ||
                review.value.statementFiles.some(
                    (file) =>
                        !file.maskedNumber ||
                        !['matched', 'unregistered'].includes(file.accountMatch)
                ))
    );
    watch(review, () => {
        statementConfirmed.value = false;
    });
    function resetFileInput() {
        fileUpload.value?.clear();
        selectedFiles.value = [];
        password.value = '';
        confirmed.value = false;
        rememberPassword.value = true;
        asOf.value = '';
        review.value = null;
        importReceipt.value = null;
        error.value = '';
        message.value = '';
    }
    function selectImportFiles(event) {
        confirmed.value = false;
        review.value = null;
        const files = event.files || [];
        selectedFiles.value =
            format.value === 'toss-pdf' ? files : files.slice(-1);
    }
    const accountFilter = ref(''),
        ownerFilter = ref(''),
        symbolFilter = ref(''),
        entries = ref([]),
        nextCursor = ref(null),
        legacy = ref(false),
        entriesLoaded = ref(false);
    const entryDialog = ref(false);
    const entryMutation = ref({
        operation: 'add',
        entryId: '',
        reason: '',
        row: {},
    });
    const transactionTypes = transactionTypeOptions;
    const singleAccountConfirmed = ref(false);
    const ownUid = computed(() => firebaseUser.value?.uid);
    const {
        profiles,
        selectedProfile,
        selectedMember,
        memberAccounts,
        memberDialog,
        accountDialog,
        uploadDialog,
        registerMember,
        registerAccount,
        accountProfileKey,
    } = useAssetManagement({
        families,
        accounts,
        user: firebaseUser,
        request: familyRequest,
        refresh: () => refresh(),
    });
    const space = computed(
        () =>
            families.value.find(
                (f) => f.id === activeAccount.value?.familyId
            ) || families.value.find((f) => f.kind === 'personal')
    );
    const visibleAccounts = computed(() => accounts.value);
    const registrationMember = ref(null);
    const registrationMemberName = computed(
        () =>
            registrationMember.value?.name ||
            firebaseUser.value?.displayName ||
            '본인'
    );
    const modalVisible = computed({
        get: () => accountDialog.value || uploadDialog.value,
        set: (value) => {
            if (!value && !busy.value) {
                accountDialog.value = false;
                uploadDialog.value = false;
            }
        },
    });
    watch(selectedProfile, () => {
        if (!memberAccounts.value.some((a) => a.id === selectedAccount.value))
            selectedAccount.value = memberAccounts.value[0]?.id || '';
    });
    watch(modalVisible, (visible) => {
        if (!visible) resetFileInput();
    });
    function openAccountRegistration() {
        registrationMember.value = selectedMember.value || null;
        error.value = '';
        accountDialog.value = true;
    }
    async function addManagedMember(name) {
        await run(async () => {
            await registerMember(name);
            assetAllOwners.value = false;
            memberDialog.value = false;
        });
    }
    function openUpload(id) {
        resetFileInput();
        error.value = '';
        const account = accounts.value.find((a) => a.id === id);
        if (!account) return;
        selectedProfile.value = accountProfileKey(account);
        assetAllOwners.value = false;
        selectedAccount.value = id;
        accountDialog.value = false;
        uploadDialog.value = true;
    }
    const summaryAccountId = ref('');
    // Reuse the existing projection unchanged for the summary-only account scope.
    // Filtering does not alter account selection, ledger loading or other pages.
    const summarizeSelection = (selectedAccounts) => {
        if (!rawSummary.value) return null;
        const ids = new Set(selectedAccounts.map((a) => a.id));
        const positions = rawSummary.value.positions.filter((p) =>
            ids.has(p.accountId)
        );
        const dates = selectedAccounts
            .filter((a) => a.calculatedSnapshot)
            .map((a) => a.calculatedSnapshot.asOf)
            .filter(Boolean)
            .sort();
        const missing = selectedAccounts
            .filter(
                (a) =>
                    !a.calculatedSnapshot ||
                    a.calculatedSnapshot.entriesRevision !==
                        (a.entriesRevision || 0) ||
                    a.calculatedSnapshot.snapshotRevision !==
                        (a.snapshotRevision || 0)
            )
            .map((a) => a.id);
        const totals = {};
        for (const p of positions)
            if (p.amount !== null)
                totals[p.currency] = (totals[p.currency] || 0) + p.amount;
        return {
            ...rawSummary.value,
            positions,
            knownValueByCurrency: totals,
            missingSnapshotAccounts: missing,
            mixedDates: new Set(dates).size > 1,
            oldestAsOf: dates[0] || null,
            newestAsOf: dates.at(-1) || null,
            valueComplete:
                !missing.length && positions.every((p) => p.amount !== null),
            notice: rawSummary.value.notice,
        };
    };
    const summary = computed(() => summarizeSelection(visibleAccounts.value));
    const assetAllOwners = ref(true);
    const assetVisibleAccounts = computed(() =>
        assetAllOwners.value ? visibleAccounts.value : memberAccounts.value
    );
    const assetSummary = computed(() =>
        summarizeSelection(assetVisibleAccounts.value)
    );
    watch(ownUid, () => {
        assetAllOwners.value = true;
    });
    function selectAssetAccount(id) {
        const account = assetVisibleAccounts.value.find((row) => row.id === id);
        if (!account) return;
        selectedProfile.value = accountProfileKey(account);
        selectedAccount.value = id;
    }
    async function focusAccountAlias(id) {
        selectAssetAccount(id);
        await nextTick();
        document.getElementById('asset-account-alias')?.focus();
    }
    const valuationAccounts = computed(() =>
        summaryAccountId.value
            ? visibleAccounts.value.filter(
                  (account) => account.id === summaryAccountId.value
              )
            : visibleAccounts.value
    );
    const valuationSummary = computed(() =>
        summaryAccountId.value
            ? summarizeSelection(valuationAccounts.value)
            : summary.value
    );
    watch(
        ownUid,
        () => {
            summaryAccountId.value = '';
        },
        { flush: 'sync' }
    );
    watch(visibleAccounts, () => {
        if (
            !visibleAccounts.value.some(
                (account) => account.id === summaryAccountId.value
            )
        )
            summaryAccountId.value = '';
    });
    watch(visibleAccounts, () => {
        if (!visibleAccounts.value.some((a) => a.id === selectedAccount.value))
            selectedAccount.value = memberAccounts.value[0]?.id || '';
    });
    const activeAccount = computed(() =>
        visibleAccounts.value.find((a) => a.id === selectedAccount.value)
    );
    const editableAccounts = computed(() =>
        accounts.value.filter((a) =>
            ['owner', 'editor'].includes(a.permissions[firebaseUser.value?.uid])
        )
    );
    const calculationIssues = computed(() =>
        visibleAccounts.value.flatMap((account) =>
            (account.calculatedSnapshot?.issues || []).map((issue) => ({
                ...issue,
                accountId: account.id,
            }))
        )
    );
    const canConfigure = computed(() => {
        const uid = firebaseUser.value?.uid;
        const account = activeAccount.value;
        return Boolean(
            uid &&
                account?.authorityUid === uid &&
                ['owner', 'editor'].includes(account.permissions?.[uid])
        );
    });
    const holdingsView = ref('holder');
    const positions = computed(() =>
        (summary.value?.positions || []).filter(
            (p) =>
                (!accountFilter.value || p.accountId === accountFilter.value) &&
                (!ownerFilter.value || p.ownerId === ownerFilter.value) &&
                (!symbolFilter.value ||
                    p.symbol.includes(symbolFilter.value.toUpperCase()))
        )
    );
    async function openHoldingEvidence(accountId) {
        const account = visibleAccounts.value.find(
            (row) => row.id === accountId
        );
        if (!account) return;
        selectedProfile.value = accountProfileKey(account);
        assetAllOwners.value = false;
        selectedAccount.value = accountId;
        await router.replace({ query: { ...route.query, tab: 'assets' } });
        await nextTick();
        document.getElementById('selected-account-management')?.focus();
    }
    const symbols = computed(() => groupStoredPositions(positions.value));
    const label = (id) => accounts.value.find((a) => a.id === id)?.alias || id;
    const ownerName = (id) =>
        families.value.map((f) => f.profiles?.[id]).find(Boolean)?.name ||
        '미확인';
    const num = (v) =>
        v === null || v === undefined
            ? '미확인'
            : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
    async function run(work, { onError } = {}) {
        if (busy.value) return;
        const user = firebaseUser.value;
        operationInDialog.value = modalVisible.value || memberDialog.value;
        busy.value = true;
        operationProgress.value = null;
        error.value = '';
        message.value = '';
        try {
            await work();
        } catch (e) {
            if (firebaseUser.value !== user) return;
            if (onError) onError(e);
            else error.value = e.message;
        } finally {
            busy.value = false;
            operationInDialog.value = false;
            operationProgress.value = null;
            if (firebaseUser.value === user && modalVisible.value)
                await focusPreviewFeedback();
        }
    }
    async function refreshData({
        scope: [user, requestedFamily],
        signal,
        isCurrent,
    }) {
        if (accountCooldown.coolingDown.value) {
            accountsState.value = 'error';
            accountLoadError.value =
                accountLoadIssue.value?.message ||
                '권장 대기 시간 후 다시 시도해 주세요.';
            return;
        }
        const requestedUid = user?.uid;
        accountsState.value = 'loading';
        accountLoadError.value = '';
        accountLoadIssue.value = null;
        try {
            const data = await familyRequest(
                '',
                undefined,
                requestedFamily ? { familyId: requestedFamily } : {},
                { signal }
            );
            if (!isCurrent()) return;
            families.value = data.families;
            accounts.value = data.accounts || [];
            rawSummary.value = data.summary || null;
            if (!route.query.tab || route.query.tab === 'overview') {
                const hasRecords = accounts.value.some(
                    (account) =>
                        (account.entriesRevision || 0) > 0 || account.snapshot
                );
                portfolioTab.value = !accounts.value.length
                    ? 'assets'
                    : hasRecords
                      ? 'overview'
                      : 'assets';
            }
            if (
                !visibleAccounts.value.some(
                    (a) => a.id === selectedAccount.value
                )
            )
                selectedAccount.value = visibleAccounts.value[0]?.id || '';
            accountsState.value = 'ready';
            await loadCapital({ force: true });
            const stale = accounts.value.filter((account) => {
                const key = `${account.id}:${account.entriesRevision || 0}:${account.snapshotRevision || 0}`;
                const calculated = account.calculatedSnapshot;
                const needsCalculation =
                    (account.entriesRevision || account.snapshotRevision) &&
                    (!calculated ||
                        calculated.entriesRevision !==
                            (account.entriesRevision || 0) ||
                        calculated.snapshotRevision !==
                            (account.snapshotRevision || 0));
                return (
                    needsCalculation &&
                    ['owner', 'editor'].includes(
                        account.permissions?.[requestedUid]
                    ) &&
                    !requestedCalculations.has(key)
                );
            });
            if (stale.length) {
                for (const account of stale) {
                    const key = `${account.id}:${account.entriesRevision || 0}:${account.snapshotRevision || 0}`;
                    requestedCalculations.add(key);
                    await familyRequest('rebuildCalculatedHoldings', {
                        accountId: account.id,
                    });
                }
                await refresh();
            }
        } catch (reason) {
            if (!isCurrent()) return;
            if ([401, 403].includes(reason.status)) {
                accounts.value = [];
                families.value = [];
                rawSummary.value = null;
                uploadDialog.value =
                    accountDialog.value =
                    memberDialog.value =
                        false;
            }
            accountsState.value = 'error';
            accountLoadError.value = reason.message;
            accountLoadIssue.value = reason;
        }
    }
    const refresh = createScopedRefresh({
        getScope: () => [firebaseUser.value, familyId.value],
        load: refreshData,
    });
    const unsubscribeRefresh = familyRequest.onInvalidate((_user, reason) => {
        // The active refresh must still publish its own permission error.
        if (reason !== 'access') refresh.invalidate();
    });
    onScopeDispose(() => {
        unsubscribeRefresh();
        refresh.invalidate();
    });
    watch(
        [firebaseUser, authLoading],
        ([user, waiting]) => {
            refresh.invalidate();
            // Clear private state when the authenticated identity changes.
            families.value = [];
            accounts.value = [];
            rawSummary.value = null;
            entries.value = [];
            review.value = null;
            importReceipt.value = null;
            exportVisible.value = false;
            familyId.value = '__all__';
            selectedAccount.value = '';
            password.value = '';
            accountsState.value = 'loading';
            accountLoadError.value = '';
            accountLoadIssue.value = null;
            if (waiting) return;
            if (!user)
                router.replace({
                    path: '/admin/login',
                    query: { redirect: route.fullPath },
                });
            else run(refresh);
        },
        { immediate: true }
    );
    watch(selectedAccount, () => {
        importReceipt.value = null;
        review.value = null;
        entries.value = [];
        confirmed.value = false;
        singleAccountConfirmed.value = false;
        legacy.value = false;
        nextCursor.value = null;
        password.value = '';
        rememberPassword.value = true;
    });
    async function mutate(action, body) {
        await run(async () => {
            await familyRequest(action, body);
            message.value = '저장했습니다.';
            await refresh();
        });
    }
    async function createAccount(form, document) {
        await run(async () => {
            const result = await registerAccount(
                form,
                registrationMember.value
            );
            assetAllOwners.value = false;
            selectedAccount.value = result.accountId;
            accountDialog.value = false;
            uploadDialog.value = true;
            if (document) {
                inputMethod.value = 'file';
                format.value = 'toss-pdf';
                await nextTick();
                selectedFiles.value = [document.file];
                password.value = document.password;
                rememberPassword.value = false;
                confirmed.value = true;
            }
        });
        if (document && uploadDialog.value && selectedFiles.value.length)
            await preview();
    }
    async function preview() {
        if (busy.value) return;
        filePreviewError.value = '';
        focusFilePreview = true;
        await run(
            async () => {
                importReceipt.value = null;
                const a = activeAccount.value;
                const uid = ownUid.value;
                const importKind = kind.value;
                const files = selectedFiles.value;
                if (!a || !files.length)
                    throw new Error('계좌와 파일을 선택하세요.');
                if (files.length > 20)
                    throw new Error('PDF는 한 번에 최대 20개까지 선택하세요.');
                if (format.value !== 'toss-pdf' && !confirmed.value)
                    throw new Error('명의자·금융기관·계좌를 확인하세요.');
                if (files.some((file) => file.size > 2 * 1024 * 1024))
                    throw new Error('2MB 이하 파일을 선택하세요.');
                const results = [];
                operationProgress.value = {
                    stage: 'extract',
                    completed: 0,
                    total: files.length,
                    detail: '',
                };
                for (const [fileIndex, file] of files.entries()) {
                    operationProgress.value.detail = file.name;
                    operationProgress.value.message =
                        '기기에서 파일을 읽고 있습니다.';
                    const form = new FormData();
                    Object.entries({
                        accountId: a.id,
                        ownerId: a.ownerId,
                        institution: a.institution,
                        kind: kind.value,
                        asOf: asOf.value,
                        format: format.value,
                        identityConfirmed: String(confirmed.value),
                        password: password.value,
                        rememberPassword:
                            fileIndex === 0 &&
                            rememberPassword.value &&
                            a.permissions?.[ownUid.value] === 'owner'
                                ? 'true'
                                : 'false',
                    }).forEach(([key, value]) => form.append(key, value));
                    // Snapshot the bytes before fetch: mobile document providers can
                    // revoke/change the selected file handle during body streaming.
                    let bytes;
                    try {
                        bytes = await file.arrayBuffer();
                    } catch {
                        throw new Error(
                            '선택한 파일을 읽을 수 없습니다. 휴대폰에 PDF를 다운로드한 뒤 파일을 다시 선택해 주세요.'
                        );
                    }
                    form.append(
                        'file',
                        new Blob([bytes], { type: file.type }),
                        file.name
                    );
                    operationProgress.value.message =
                        '서버로 전송하고 거래내역을 추출하고 있습니다.';
                    results.push({
                        ...(await familyRequest('preview', form)),
                        fileName: file.name,
                    });
                    operationProgress.value.completed = fileIndex + 1;
                }
                const result = results.reduce(
                    (combined, item) => {
                        const offset = combined.rows.length;
                        combined.rows.push(...item.rows);
                        combined.errors.push(
                            ...item.errors.map((problem) => ({
                                ...problem,
                                row: problem.row ? problem.row + offset : 0,
                            }))
                        );
                        combined.batches.push(
                            ...item.batches.map((batch) => ({
                                ...batch,
                                start: batch.start + offset,
                            }))
                        );
                        if (item.source === 'toss-pdf')
                            combined.statementFiles.push({
                                fileName: item.fileName,
                                ...item.statementIdentity,
                            });
                        combined.asOf = [combined.asOf, item.asOf]
                            .filter(Boolean)
                            .sort()
                            .at(-1);
                        return combined;
                    },
                    {
                        reviewId: results[0].reviewId,
                        source: results[0].source,
                        rows: [],
                        errors: [],
                        batches: [],
                        asOf: null,
                        fileCount: results.length,
                        statementFiles: [],
                    }
                );
                if (result.source === 'toss-pdf') {
                    operationProgress.value = {
                        stage: 'resolve',
                        completed: 0,
                        total: 0,
                        detail: '종목 코드와 환전 흐름을 확인하고 있습니다.',
                    };
                    Object.assign(result, await enrichTossReview(result.rows));
                }
                if (ownUid.value === uid && selectedAccount.value === a.id)
                    review.value = {
                        ...result,
                        accountId: a.id,
                        kind: importKind,
                        asOf: result.asOf || asOf.value,
                        accountAlias: a.alias,
                    };
                if (format.value === 'toss-pdf' && result.asOf)
                    asOf.value = result.asOf;
                password.value = '';
                selectedFiles.value = [];
                fileUpload.value?.clear();
                if (results.some((item) => item.passwordSaved)) await refresh();
            },
            {
                onError: (e) => {
                    const detail =
                        e.message === 'Failed to fetch'
                            ? '서버에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
                            : e.message ||
                              '파일을 추출하지 못했습니다. 다시 시도해 주세요.';
                    if (review.value) error.value = detail;
                    else filePreviewError.value = detail;
                },
            }
        );
    }
    async function previewManualHoldings(body) {
        await run(async () => {
            const a = activeAccount.value;
            const user = firebaseUser.value;
            const selectedFamily = familyId.value;
            if (!a || !editableAccounts.value.some((item) => item.id === a.id))
                throw new Error('편집 가능한 계좌를 선택하세요.');
            importReceipt.value = null;
            const result = await familyRequest('previewManualHoldings', {
                ...body,
                accountId: a.id,
            });
            if (
                firebaseUser.value === user &&
                selectedAccount.value === a.id &&
                familyId.value === selectedFamily &&
                inputMethod.value === 'manual'
            ) {
                review.value = {
                    ...result,
                    accountId: a.id,
                    kind: 'holdings',
                    asOf: body.asOf,
                    accountAlias: a.alias,
                };
            }
        });
    }
    async function previewBroker({ form, kind: importKind, asOf: importAsOf }) {
        await run(async () => {
            const a = activeAccount.value,
                user = firebaseUser.value,
                family = familyId.value;
            if (!a || form.get('accountId') !== a.id)
                throw new Error('선택 계좌가 변경되었습니다.');
            importReceipt.value = null;
            const result = await familyRequest('preview', form);
            if (
                firebaseUser.value === user &&
                selectedAccount.value === a.id &&
                familyId.value === family &&
                inputMethod.value === 'broker'
            ) {
                review.value = {
                    ...result,
                    accountId: a.id,
                    kind: importKind,
                    asOf: importAsOf,
                    accountAlias: a.alias,
                };
            }
        });
    }
    async function commit() {
        await run(async () => {
            const current = review.value;
            if (!current) throw new Error('저장할 자료를 먼저 검토해 주세요.');
            if (
                current.source === 'toss-pdf' &&
                (statementBlocked.value || !statementConfirmed.value)
            )
                throw new Error(
                    'PDF에서 추출한 명의자·계좌번호와 저장 대상 계좌를 확인하세요.'
                );
            const uid = ownUid.value;
            importReceipt.value = null;
            const batches = current.batches || [
                {
                    reviewId: current.reviewId,
                    start: 0,
                    count: current.rows.length,
                },
            ];
            const result = { inserted: 0, duplicates: 0 };
            operationProgress.value = {
                stage: 'validate',
                completed: 0,
                total: batches.length,
                detail: '모든 자료의 오류를 확인한 뒤 저장합니다.',
            };
            for (const batch of batches) {
                await familyRequest('validateImport', {
                    identityConfirmed: statementConfirmed.value,
                    accountId: current.accountId,
                    reviewId: batch.reviewId,
                    rows: current.rows.slice(
                        batch.start,
                        batch.start + batch.count
                    ),
                });
                operationProgress.value.completed++;
            }
            operationProgress.value = {
                stage: 'save',
                completed: 0,
                total: batches.length,
                detail: '거래내역을 계좌에 반영하고 있습니다.',
            };
            for (const [index, batch] of batches.entries()) {
                const saved = await familyRequest('commit', {
                    identityConfirmed: statementConfirmed.value,
                    accountId: current.accountId,
                    reviewId: batch.reviewId,
                    rows: current.rows.slice(
                        batch.start,
                        batch.start + batch.count
                    ),
                });
                result.inserted += saved.inserted;
                result.duplicates += saved.duplicates;
                operationProgress.value.completed = index + 1;
            }
            operationProgress.value = {
                stage: 'finalize',
                completed: 0,
                total: 0,
                detail: '잔고와 거래 기록을 갱신하고 있습니다.',
            };
            let funding = { saved: 0, failed: 0, inferred: 0 };
            if (current.source === 'toss-pdf') {
                funding.inferred = current.rows.filter(
                    (row) => row._fundingSuggestion?.basis === 'date_pool'
                ).length;
                if (result.inserted > 0)
                    funding = await saveMatchedFunding(current);
            }
            if (
                ownUid.value !== uid ||
                selectedAccount.value !== current.accountId
            )
                return;
            review.value = null;
            message.value = `저장 ${result.inserted}행 · 중복 ${result.duplicates}행${funding.saved + funding.inferred ? ` · 환전 결제 ${funding.saved + funding.inferred}건 연결` : ''}${funding.failed ? ` · 환전 결제 ${funding.failed}건은 원장에서 확인 필요` : ''}`;
            importReceipt.value = {
                ...result,
                accountAlias: current.accountAlias,
                kind: current.kind,
                asOf: current.asOf,
            };
            focusSavedResult = true;
            await refresh();
        });
    }
    function openExport(selectedKind = 'holdings') {
        exportKind.value = selectedKind;
        exportVisible.value = true;
    }
    async function viewImported() {
        uploadDialog.value = false;
        if (importReceipt.value?.kind === 'holdings')
            portfolioTab.value = 'overview';
        else {
            portfolioTab.value = 'assets';
            legacy.value = false;
            await loadEntries();
        }
    }
    async function anotherFile() {
        resetFileInput();
        await nextTick();
        importHeading.value?.focus({ preventScroll: true });
        importHeading.value?.scrollIntoView({ block: 'start' });
    }
    function openTransactionsUpload() {
        kind.value = 'transactions';
        const target =
            editableAccounts.value.find(
                (a) => a.id === selectedAccount.value
            ) || editableAccounts.value[0];
        if (target) openUpload(target.id);
        else portfolioTab.value = 'assets';
    }
    async function removePdfPassword() {
        await run(async () => {
            await familyRequest('pdfPassword', {
                accountId: selectedAccount.value,
                remove: true,
            });
            password.value = '';
            await refresh();
            message.value = '저장된 PDF 기본 비밀번호를 삭제했습니다.';
        });
    }
    watch([legacy, selectedAccount, ownUid, familyId], () => {
        entries.value = [];
        nextCursor.value = null;
        entriesLoaded.value = false;
    });
    const migrationDate = (value) => {
        const date = new Date(value);
        return value && !Number.isNaN(date.getTime())
            ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
            : '미확인';
    };
    async function viewMigratedEntries() {
        legacy.value = true;
        await nextTick();
        await loadEntries();
    }
    async function loadEntries(more = false) {
        await run(async () => {
            const accountId = selectedAccount.value;
            const uid = ownUid.value;
            const family = familyId.value;
            const preserved = legacy.value;
            entriesLoaded.value = false;
            const result = await familyRequest('', undefined, {
                accountId,
                legacy: String(preserved),
                ...(more && nextCursor.value
                    ? { cursor: nextCursor.value }
                    : {}),
            });
            if (
                selectedAccount.value !== accountId ||
                ownUid.value !== uid ||
                familyId.value !== family ||
                legacy.value !== preserved
            )
                return;
            entriesLoaded.value = true;
            entries.value = more
                ? [...entries.value, ...result.entries]
                : result.entries;
            nextCursor.value = result.nextCursor;
        });
    }
    function editEntry(operation, entry = null) {
        entryMutation.value = {
            operation,
            entryId: entry?.id || '',
            reason: '',
            row:
                operation === 'replace'
                    ? {
                          ...entry.row,
                          externalId: `${entry.row.externalId}-replacement-${Date.now()}`,
                      }
                    : {
                          date: new Date().toISOString().slice(0, 10),
                          type: 'buy',
                          symbol: '',
                          quantity: null,
                          amount: null,
                          currency: 'KRW',
                          externalId: `manual-${Date.now()}`,
                      },
        };
        entryDialog.value = true;
    }
    const entryDelta = computed(() => {
        const item = entryMutation.value;
        const row = item.row || {};
        const sign = ['sell', 'transfer_out'].includes(row.type) ? -1 : 1;
        return row.quantity == null ? null : sign * Number(row.quantity);
    });
    async function saveEntryMutation() {
        await run(async () => {
            const item = entryMutation.value;
            await familyRequest('mutateEntry', {
                accountId: selectedAccount.value,
                requestId: crypto.randomUUID().replaceAll('-', ''),
                operation: item.operation,
                entryId: item.entryId || undefined,
                reason: item.reason,
                row: ['add', 'replace'].includes(item.operation)
                    ? item.row
                    : undefined,
            });
            entryDialog.value = false;
            await refresh();
            await loadEntries();
            message.value = '거래 원장과 계산 잔고를 갱신했습니다.';
        });
    }
    // Resolve submenu destinations after async account content has rendered.
    // Scrolling/focus never opens an upload flow or issues a data mutation.
    const submenuTargets = new Set([
        'asset-concentration',
        'dividend-growth',
        'manual-balance',
        'capital-details-heading',
    ]);
    watch(
        [() => route.hash, contentBusy, () => visibleAccounts.value.length],
        async () => {
            const id = route.hash.slice(1);
            if (!submenuTargets.has(id) || contentBusy.value) return;
            await nextTick();
            const target = document.getElementById(id);
            if (target) {
                target.scrollIntoView({ block: 'start' });
                target.focus({ preventScroll: true });
            }
        },
        { immediate: true, flush: 'post' }
    );
</script>

<template>
    <PortfolioLoadingRegion
        class="family-page"
        :data-stitch-view="
            accountDialog
                ? 'account-registration'
                : portfolioTab === 'overview'
                  ? overviewView
                  : portfolioTab
        "
        :busy="
            contentBusy && !operationInDialog && !modalVisible && !memberDialog
        "
        :progress="operationProgress"
        @after-hide="focusPreviewFeedback">
        <Teleport to="#portfolio-header-actions">
            <Button
                class="portfolio-header-refresh"
                icon="pi pi-refresh"
                aria-label="새로고침"
                severity="secondary"
                text
                rounded
                :loading="busy"
                :disabled="accountCooldown.coolingDown.value"
                @click="run(refresh)" />
        </Teleport>
        <header
            v-if="
                !accountDialog &&
                portfolioTab === 'overview' &&
                overviewView === 'holdings' &&
                (!families.length || !summary)
            "
            class="portfolio-heading">
            <div>
                <h1>보유 종목</h1>
                <p>저장된 계좌 자료의 보유 종목과 통화별 잔고를 확인하세요.</p>
            </div>
        </header>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <Message v-if="message && !busy" severity="success" :closable="false">{{
            message
        }}</Message>
        <Message
            v-if="accountsState === 'error'"
            severity="error"
            :closable="false"
            ><p>{{ accountLoadError }}</p>
            <template v-if="accountLoadIssue?.status === 429">
                <p>
                    현재 응답만으로는 하루 사용량 소진 여부와 실제 제한 해제
                    시각을 확인할 수 없습니다.
                </p>
                <p
                    class="retry-countdown"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true">
                    <strong>{{
                        accountCooldown.coolingDown.value
                            ? `권장 재시도 대기: ${accountCooldown.remainingSeconds.value}초`
                            : '권장 대기 시간이 지났습니다. 계좌 목록을 다시 조회할 수 있습니다.'
                    }}</strong>
                    <span v-if="accountCooldown.coolingDown.value"
                        >{{ retryTime }}부터 다시 시도할 수 있습니다.</span
                    >
                </p>
                <details>
                    <summary>대기시간 안내</summary>
                    <p>
                        이 시간은 복구 예정 시각이 아니라 재시도 간격입니다.
                        다시 제한되면 더 기다려야 할 수 있습니다. 하루 한도에
                        도달한 경우에는 한도 초기화 또는 관리자 확인이
                        필요합니다.
                    </p>
                    <p>
                        Firestore 무료 일일 한도에 해당한다면 미국 태평양 자정
                        무렵(한국시간 오후 4~5시)에 초기화됩니다. 현재 오류가 이
                        한도인지는 확인되지 않았습니다.
                        <a
                            href="https://firebase.google.com/docs/firestore/quotas#free-quota"
                            target="_blank"
                            rel="noopener noreferrer"
                            >공식 한도 안내</a
                        >
                    </p>
                </details>
            </template>
            <p>
                계좌 목록 조회에 실패했습니다. 등록된 계좌가 없다는 뜻이
                아닙니다. 기존 계좌나 PDF를 다시 등록할 필요는 없습니다.
            </p>
            <Button
                :label="
                    accountCooldown.coolingDown.value
                        ? `${accountCooldown.remainingSeconds.value}초 후 다시 시도`
                        : '계좌 목록 다시 시도'
                "
                severity="danger"
                outlined
                :loading="busy"
                :disabled="accountCooldown.coolingDown.value"
                @click="run(refresh)"
        /></Message>
        <div
            v-if="
                !accountDialog &&
                portfolioTab !== 'assets' &&
                !(portfolioTab === 'overview' && overviewView === 'holdings')
            "
            class="portfolio-tools">
            <template
                v-if="
                    portfolioTab === 'overview' && overviewView === 'summary'
                ">
                <label class="summary-scope"
                    >계좌 범위
                    <select
                        v-model="summaryAccountId"
                        aria-label="평가 계좌 범위"
                        :disabled="busy || accountsState !== 'ready'">
                        <option value="">전체 계좌</option>
                        <option
                            v-for="account in visibleAccounts"
                            :key="account.id"
                            :value="account.id">
                            {{ account.alias }} ·
                            {{ account.maskedNumber || '끝자리 미확인' }}
                        </option>
                    </select>
                </label>
                <Button
                    label="자료 업로드"
                    icon="pi pi-upload"
                    severity="secondary"
                    outlined
                    size="small"
                    :disabled="busy || !editableAccounts.length"
                    @click="openTransactionsUpload" />
            </template>
            <Button
                label="CSV 내보내기"
                icon="pi pi-download"
                severity="secondary"
                text
                size="small"
                :disabled="
                    busy || accountsState !== 'ready' || !visibleAccounts.length
                "
                @click="openExport()" />
        </div>
        <div v-show="!accountDialog" class="portfolio-tabs">
            <div class="portfolio-panels">
                <section
                    v-if="portfolioTab === 'overview'"
                    class="portfolio-panel"
                    aria-label="포트폴리오 개요">
                    <div
                        v-if="
                            accountsState === 'ready' &&
                            !busy &&
                            !visibleAccounts.length
                        "
                        class="portfolio-empty studio-empty">
                        <i class="pi pi-wallet" aria-hidden="true" />
                        <h2>첫 계좌를 등록해 보세요</h2>
                        <p>
                            계좌 등록 후 CSV 또는 PDF 자료를 올리면 잔고와 거래
                            기록을 확인할 수 있어요.
                        </p>
                        <Button
                            label="첫 계좌 등록"
                            icon="pi pi-plus"
                            @click="portfolioTab = 'assets'" /><small
                            class="studio-muted"
                            >계좌 등록 → 자료 업로드 → 검토 후 저장</small
                        >
                    </div>
                    <div
                        v-if="
                            accountsState === 'ready' && visibleAccounts.length
                        "
                        class="overview-tabs">
                        <div class="portfolio-panels">
                            <section
                                v-if="overviewView === 'summary'"
                                class="portfolio-panel"
                                aria-label="포트폴리오 요약">
                                <PortfolioValuation
                                    v-if="
                                        portfolioTab === 'overview' &&
                                        overviewView === 'summary' &&
                                        accountsState === 'ready' &&
                                        valuationSummary &&
                                        visibleAccounts.length
                                    "
                                    :key="`${ownUid}:${familyId}`"
                                    :positions="summary.positions"
                                    :scope-account-id="summaryAccountId"
                                    :accounts="valuationAccounts"
                                    :owner-name="ownerName"
                                    :missing-accounts="
                                        valuationSummary.missingSnapshotAccounts
                                            .length
                                    "
                                    :estimated-positions="
                                        valuationSummary.positions.filter(
                                            (row) =>
                                                row.calculationMode ===
                                                'estimated'
                                        ).length
                                    "
                                    @request-transactions="
                                        openTransactionsUpload
                                    ">
                                    <template #stored-values>
                                        <div
                                            v-if="
                                                overviewView === 'summary' &&
                                                valuationSummary &&
                                                Object.keys(
                                                    valuationSummary.knownValueByCurrency
                                                ).length
                                            "
                                            class="portfolio-value-grid"
                                            aria-label="통화별 자료상 보유 평가액">
                                            <Card
                                                v-for="(
                                                    value, currency
                                                ) in valuationSummary.knownValueByCurrency"
                                                :key="currency"
                                                class="portfolio-value-card"
                                                ><template #content
                                                    ><div
                                                        class="value-card-heading">
                                                        <span
                                                            >자료상 보유
                                                            평가액</span
                                                        ><Tag
                                                            :value="currency"
                                                            severity="secondary" />
                                                    </div>
                                                    <strong>{{
                                                        formatStoredAmount(
                                                            value,
                                                            currency
                                                        )
                                                    }}</strong>
                                                    <p>
                                                        자료 기준일
                                                        {{
                                                            valuationSummary.oldestAsOf ||
                                                            '미확인'
                                                        }}{{
                                                            valuationSummary.mixedDates
                                                                ? ` ~ ${valuationSummary.newestAsOf}`
                                                                : ''
                                                        }}
                                                    </p>
                                                    <span
                                                        class="value-card-note"
                                                        >{{
                                                            valuationSummary.valueComplete
                                                                ? '확인된 잔고 자료 기준'
                                                                : '일부 평가액 미확인 · 확인된 금액만 포함'
                                                        }}</span
                                                    ></template
                                                ></Card
                                            >
                                        </div>
                                    </template>
                                </PortfolioValuation>
                            </section>
                            <section
                                v-if="overviewView === 'capital'"
                                class="portfolio-panel"
                                aria-label="원금·자금">
                                <section
                                    v-if="
                                        space &&
                                        portfolioTab === 'overview' &&
                                        overviewView === 'capital'
                                    "
                                    class="capital-details"
                                    aria-labelledby="capital-details-heading">
                                    <header class="capital-page-heading">
                                        <div>
                                            <p class="capital-eyebrow">
                                                내 포트폴리오 · 정산 상세
                                            </p>
                                            <h2
                                                id="capital-details-heading"
                                                tabindex="-1">
                                                원금 회수 · 자금 상세
                                            </h2>
                                            <p>
                                                실제 계좌 입출금과 배당 회수
                                                흐름을 검토합니다.
                                            </p>
                                        </div>
                                        <span class="capital-currency-note"
                                            ><i
                                                class="pi pi-wallet"
                                                aria-hidden="true" />
                                            KRW / USD 분리 집계</span
                                        >
                                    </header>

                                    <section
                                        v-if="activeAccount"
                                        aria-label="회수 현황 계좌 선택">
                                        <label
                                            >회수 현황을 볼 계좌
                                            <Select
                                                v-model="selectedAccount"
                                                :disabled="busy"
                                                :options="
                                                    visibleAccounts.map(
                                                        (a) => ({
                                                            label: capitalAccountLabel(
                                                                a,
                                                                ownerName(
                                                                    a.ownerId
                                                                )
                                                            ),
                                                            value: a.id,
                                                        })
                                                    )
                                                "
                                                option-label="label"
                                                option-value="value"
                                                aria-label="계좌"
                                                placeholder="선택" />
                                        </label>
                                        <p>
                                            선택한 계좌의 전체 저장 내역
                                            기준입니다.
                                        </p>
                                    </section>
                                    <PortfolioCapitalPanel
                                        v-if="activeAccount"
                                        :key="`${ownUid}-${selectedAccount}`"
                                        ref="capitalPanel"
                                        :user="firebaseUser"
                                        :account-id="selectedAccount"
                                        :state="capital"
                                        :loading="capitalLoading"
                                        :error="capitalError"
                                        :read-only="
                                            !editableAccounts.some(
                                                (a) => a.id === selectedAccount
                                            )
                                        "
                                        @refresh="loadCapital" />
                                    <AccountEvidencePanel
                                        v-if="activeAccount"
                                        :key="`${ownUid}:${selectedAccount}`"
                                        :account="activeAccount"
                                        :state="capital"
                                        :loading="capitalLoading"
                                        :ledger-error="capitalError"
                                        :client="accountToss"
                                        @review-cash="
                                            capitalPanel?.openEntry(
                                                $event.id,
                                                $event.parts
                                            )
                                        " />
                                    <details
                                        class="all-account-recovery"
                                        @toggle="
                                            recoveryOverviewOpen =
                                                $event.target.open
                                        ">
                                        <summary>
                                            전체 계좌 회수 현황 · 자금 계보 상세
                                        </summary>
                                        <AccountRecoveryOverview
                                            v-if="recoveryOverviewOpen"
                                            :user="firebaseUser"
                                            :accounts="visibleAccounts"
                                            :refresh-account-id="
                                                capitalLoading || capitalError
                                                    ? ''
                                                    : selectedAccount
                                            "
                                            :refresh-state="capital" />
                                    </details>
                                </section>
                            </section>
                            <section
                                v-if="overviewView === 'holdings'"
                                class="portfolio-panel"
                                aria-label="보유 종목">
                                <template v-if="families.length">
                                    <section
                                        v-if="summary"
                                        class="holdings-page-content">
                                        <header class="holdings-page-heading">
                                            <div>
                                                <h1>보유 종목</h1>
                                                <p>
                                                    {{
                                                        visibleAccounts.length
                                                    }}개 증권 계좌 자료의 보유
                                                    원장입니다. 환율 변환 없이
                                                    계좌별 원본 통화 단위로
                                                    유지됩니다.
                                                </p>
                                            </div>
                                            <div class="holdings-page-actions">
                                                <Button
                                                    label="CSV 내보내기"
                                                    icon="pi pi-download"
                                                    severity="secondary"
                                                    :disabled="
                                                        busy ||
                                                        accountsState !==
                                                            'ready' ||
                                                        !visibleAccounts.length
                                                    "
                                                    @click="openExport()" />
                                                <Button
                                                    label="계좌 자료 업로드"
                                                    icon="pi pi-upload"
                                                    :disabled="
                                                        busy ||
                                                        !editableAccounts.length
                                                    "
                                                    @click="
                                                        openTransactionsUpload
                                                    " />
                                            </div>
                                        </header>
                                        <AssetCurrencySummary
                                            compact
                                            :summary="summary"
                                            :account-count="
                                                visibleAccounts.length
                                            "
                                            scope-name="권한 있는 전체 계좌 · 목록 필터와 별도" />
                                        <div class="holdings-filter-card">
                                            <div
                                                class="holdings-filter-heading">
                                                <SelectButton
                                                    v-model="holdingsView"
                                                    :options="[
                                                        {
                                                            label: '명의자·계좌별 잔고',
                                                            value: 'holder',
                                                        },
                                                        {
                                                            label: '종목 합산',
                                                            value: 'symbol',
                                                        },
                                                    ]"
                                                    option-label="label"
                                                    option-value="value"
                                                    :allow-empty="false"
                                                    aria-label="조회 방식" /><Button
                                                    label="선택 초기화"
                                                    icon="pi pi-refresh"
                                                    severity="secondary"
                                                    text
                                                    @click="
                                                        ownerFilter = '';
                                                        accountFilter = '';
                                                        symbolFilter = '';
                                                    " />
                                            </div>
                                            <div class="holdings-filter-grid">
                                                <label class="holdings-search"
                                                    ><span
                                                        class="studio-sr-only"
                                                        >종목 검색</span
                                                    ><i
                                                        class="pi pi-search"
                                                        aria-hidden="true" /><InputText
                                                        v-model="symbolFilter"
                                                        placeholder="종목명, 티커 검색"
                                                /></label>
                                                <label
                                                    ><span
                                                        class="studio-sr-only"
                                                        >명의자</span
                                                    >
                                                    <Select
                                                        v-model="ownerFilter"
                                                        :options="[
                                                            {
                                                                label: '명의자: 전체',
                                                                value: '',
                                                            },
                                                            ...profiles.map(
                                                                (p) => ({
                                                                    label: p.name,
                                                                    value: p.id,
                                                                })
                                                            ),
                                                        ]"
                                                        option-label="label"
                                                        option-value="value"
                                                        aria-label="명의자"
                                                        placeholder="전체 명의자" /></label
                                                ><label
                                                    ><span
                                                        class="studio-sr-only"
                                                        >계좌</span
                                                    >
                                                    <Select
                                                        v-model="accountFilter"
                                                        :options="[
                                                            {
                                                                label: `계좌: 전체 ${visibleAccounts.length}계좌`,
                                                                value: '',
                                                            },
                                                            ...visibleAccounts.map(
                                                                (a) => ({
                                                                    label: a.alias,
                                                                    value: a.id,
                                                                })
                                                            ),
                                                        ]"
                                                        option-label="label"
                                                        option-value="value"
                                                        aria-label="계좌"
                                                        placeholder="선택"
                                                /></label>
                                            </div>
                                        </div>
                                        <div class="holdings-notices">
                                            <p>{{ summary.notice }}</p>
                                            <p>
                                                자료 기준일:
                                                {{
                                                    summary.oldestAsOf ||
                                                    '미확인'
                                                }}
                                                ~
                                                {{
                                                    summary.newestAsOf ||
                                                    '미확인'
                                                }}
                                            </p>
                                            <p
                                                v-if="summary.mixedDates"
                                                class="warning">
                                                계좌별 자료 기준일이 다릅니다.
                                                일부 계좌만 갱신되었습니다.
                                            </p>
                                            <p
                                                v-if="
                                                    summary
                                                        .missingSnapshotAccounts
                                                        .length
                                                "
                                                class="warning">
                                                계산 대기 또는 확인 필요 계좌
                                                {{
                                                    summary
                                                        .missingSnapshotAccounts
                                                        .length
                                                }}개가 있습니다.
                                            </p>
                                            <Message
                                                v-if="calculationIssues.length"
                                                severity="warn"
                                                :closable="false">
                                                <strong
                                                    >추정 제외·확인 필요</strong
                                                >
                                                <ul>
                                                    <li
                                                        v-for="issue in calculationIssues"
                                                        :key="`${issue.accountId}:${issue.symbol}:${issue.reason}`">
                                                        {{
                                                            label(
                                                                issue.accountId
                                                            )
                                                        }}
                                                        · {{ issue.symbol }} ·
                                                        {{ issue.reason }}
                                                    </li>
                                                </ul>
                                            </Message>
                                            <p
                                                v-if="!summary.valueComplete"
                                                class="warning">
                                                미확인 평가액이 있어 합계는
                                                확인된 금액만 포함합니다.
                                            </p>
                                        </div>
                                        <div
                                            v-show="holdingsView === 'holder'"
                                            class="holdings-holder-view">
                                            <h2 class="studio-sr-only">
                                                명의자·계좌별 잔고
                                            </h2>
                                            <PortfolioHoldingCards
                                                :rows="positions"
                                                :owner-name="ownerName"
                                                :account-label="label"
                                                :account-access="
                                                    (id) =>
                                                        editableAccounts.some(
                                                            (account) =>
                                                                account.id ===
                                                                id
                                                        )
                                                            ? '편집 가능'
                                                            : '조회 전용'
                                                "
                                                :number="num"
                                                @evidence="
                                                    openHoldingEvidence
                                                " />
                                            <DataTable
                                                class="holdings-desktop-table"
                                                :value="positions"
                                                striped-rows
                                                paginator
                                                :rows="10"
                                                :page-link-size="3"
                                                paginator-template="PrevPageLink PageLinks NextPageLink"
                                                scrollable
                                                table-style="min-width: 640px"
                                                :table-props="{
                                                    'aria-label':
                                                        '명의자·계좌별 잔고',
                                                }"
                                                ><Column header="명의자 / 계좌"
                                                    ><template #body="{ data }"
                                                        ><div
                                                            class="holding-account-identity">
                                                            <strong>{{
                                                                ownerName(
                                                                    data.ownerId
                                                                )
                                                            }}</strong
                                                            ><span>{{
                                                                label(
                                                                    data.accountId
                                                                )
                                                            }}</span
                                                            ><small>{{
                                                                editableAccounts.some(
                                                                    (a) =>
                                                                        a.id ===
                                                                        data.accountId
                                                                )
                                                                    ? '편집 가능'
                                                                    : '조회 전용'
                                                            }}</small>
                                                        </div></template
                                                    ></Column
                                                >
                                                <Column header="종목 (티커)"
                                                    ><template #body="{ data }"
                                                        ><router-link
                                                            :to="{
                                                                name: 'ticker-stock',
                                                                params: {
                                                                    ticker: data.symbol,
                                                                },
                                                                query: {
                                                                    tab: 'details',
                                                                },
                                                            }"
                                                            >{{
                                                                data.symbol
                                                            }}</router-link
                                                        ></template
                                                    ></Column
                                                >
                                                <Column header="통화"
                                                    ><template #body="{ data }"
                                                        ><Tag
                                                            :value="
                                                                data.currency ||
                                                                '통화 미확인'
                                                            "
                                                            severity="secondary" /></template
                                                ></Column>
                                                <Column header="보유수량"
                                                    ><template
                                                        #body="{ data }"
                                                        >{{
                                                            num(data.quantity)
                                                        }}</template
                                                    ></Column
                                                >
                                                <Column header="자료 평가액"
                                                    ><template
                                                        #body="{ data }"
                                                        >{{
                                                            formatStoredAmount(
                                                                data.amount,
                                                                data.currency
                                                            )
                                                        }}</template
                                                    ></Column
                                                >
                                                <Column header="자료 기준일"
                                                    ><template
                                                        #body="{ data }"
                                                        >{{
                                                            data.asOf ||
                                                            '미확인'
                                                        }}</template
                                                    ></Column
                                                >
                                                <Column
                                                    header="상태 및 원본 출처"
                                                    ><template #body="{ data }"
                                                        >{{
                                                            data.source ||
                                                            '출처 미확인'
                                                        }}<Tag
                                                            v-if="
                                                                data.estimated ||
                                                                data.calculationMode ===
                                                                    'estimated'
                                                            "
                                                            value="추정"
                                                            severity="warn" /></template
                                                ></Column>
                                                <Column header="관리"
                                                    ><template #body="{ data }"
                                                        ><Button
                                                            label="자료 확인"
                                                            :aria-label="`${data.symbol} ${label(data.accountId)} 자료 확인`"
                                                            text
                                                            size="small"
                                                            @click="
                                                                openHoldingEvidence(
                                                                    data.accountId
                                                                )
                                                            " /></template></Column
                                                ><template #empty
                                                    >확인 가능한 잔고가
                                                    없습니다. 계좌 자료를
                                                    업로드해 주세요.</template
                                                ></DataTable
                                            >
                                        </div>
                                        <div
                                            v-show="holdingsView === 'symbol'"
                                            class="holdings-symbol-view">
                                            <h2 class="studio-sr-only">
                                                종목별 합산
                                            </h2>
                                            <p class="studio-muted">
                                                선택 범위의 자료 기준일이 서로
                                                다를 수 있습니다.
                                            </p>
                                            <DataTable
                                                :value="symbols"
                                                striped-rows
                                                :table-props="{
                                                    'aria-label': '종목별 합산',
                                                }"
                                                ><Column header="종목·통화"
                                                    ><template #body="{ data }"
                                                        >{{ data.symbol }} ·
                                                        {{
                                                            data.currency
                                                        }}</template
                                                    ></Column
                                                ><Column header="합산 수량"
                                                    ><template
                                                        #body="{ data }"
                                                        >{{
                                                            num(data.quantity)
                                                        }}</template
                                                    ></Column
                                                ><Column header="확인된 평가액"
                                                    ><template #body="{ data }"
                                                        >{{ num(data.amount) }}
                                                        {{
                                                            data.complete
                                                                ? ''
                                                                : data.amount ==
                                                                    null
                                                                  ? '(평가액 미확인)'
                                                                  : '(일부 미확인)'
                                                        }}</template
                                                    ></Column
                                                ><template #empty
                                                    >합산할 종목이
                                                    없습니다.</template
                                                ></DataTable
                                            >
                                        </div>
                                    </section>
                                </template>
                            </section>
                        </div>
                    </div>
                </section>
                <section
                    v-if="portfolioTab === 'calendar'"
                    class="portfolio-panel"
                    aria-label="배당 캘린더">
                    <PortfolioDividendCalendar
                        v-if="
                            portfolioTab === 'calendar' &&
                            accountsState === 'ready' &&
                            !busy
                        "
                        :accounts="visibleAccounts"
                        :positions="summary?.positions || []"
                        :family-id="familyId"
                        :date-basis="
                            route.query.basis === 'ex' ? 'ex' : 'payable'
                        " />
                    <p v-else-if="accountsState === 'loading'" role="status">
                        계좌 자료를 확인하고 있습니다.
                    </p>
                </section>
                <section
                    v-if="portfolioTab === 'insights'"
                    class="portfolio-panel"
                    aria-label="배당 분석">
                    <PortfolioInsights
                        v-if="
                            portfolioTab === 'insights' &&
                            accountsState === 'ready' &&
                            !busy
                        "
                        :key="`${ownUid}:${familyId}`"
                        :accounts="visibleAccounts"
                        :positions="summary?.positions || []"
                        :family-id="familyId" />
                    <p v-else-if="accountsState === 'loading'" role="status">
                        계좌 자료를 확인하고 있습니다.
                    </p>
                </section>
                <section
                    v-if="portfolioTab === 'assets'"
                    class="portfolio-panel"
                    aria-label="자산 관리">
                    <section class="asset-management-overview">
                        <header class="asset-overview-heading">
                            <div>
                                <h2>자산관리</h2>
                                <small class="asset-scope-label"
                                    >저장 자료 기준 · 권한 있는 계좌</small
                                >
                            </div>
                            <AssetMemberSelector
                                :profiles="profiles"
                                allow-all
                                :all-selected="assetAllOwners"
                                :selected="selectedProfile"
                                :busy="busy"
                                @select-all="assetAllOwners = true"
                                @select="
                                    assetAllOwners = false;
                                    selectedProfile = $event;
                                "
                                @add="
                                    error = '';
                                    memberDialog = true;
                                ">
                                <Button
                                    label="계좌 추가"
                                    icon="pi pi-building-columns"
                                    :disabled="
                                        busy ||
                                        accountsState !== 'ready' ||
                                        (!!selectedMember &&
                                            !selectedMember.manageable)
                                    "
                                    @click="openAccountRegistration" />
                            </AssetMemberSelector>
                        </header>
                        <AssetCurrencySummary
                            :summary="assetSummary"
                            :account-count="assetVisibleAccounts.length"
                            :scope-name="
                                assetAllOwners
                                    ? '전체 명의자 · 권한 있는 계좌'
                                    : selectedMember?.name || ''
                            " />
                        <div class="asset-list-heading">
                            <h3>
                                {{
                                    assetAllOwners
                                        ? '등록 계좌 목록'
                                        : `${selectedMember?.name || firebaseUser?.displayName || '본인'}의 계좌`
                                }}
                            </h3>
                            <small
                                >{{ assetVisibleAccounts.length }}개 계좌</small
                            >
                        </div>
                        <p
                            id="manual-balance"
                            tabindex="-1"
                            class="studio-muted">
                            수동 잔고 보정: 아래에서 계좌를 선택한 뒤 ‘자료
                            업로드 → 수동 잔고 입력’에서 검토하고 저장하세요.
                        </p>
                        <AssetAccountList
                            :owner-name="ownerName"
                            :number="num"
                            :accounts="assetVisibleAccounts"
                            :selected="selectedAccount"
                            :user-id="ownUid"
                            :busy="busy"
                            @select="selectAssetAccount"
                            @rename="focusAccountAlias"
                            @connect-toss="
                                selectAssetAccount($event);
                                tossOpenRequest++;
                            "
                            @upload="openUpload" />
                    </section>
                    <template v-if="space">
                        <section
                            v-if="activeAccount"
                            id="selected-account-management"
                            tabindex="-1">
                            <header class="asset-detail-heading">
                                <h2>선택 계좌: {{ activeAccount.alias }}</h2>
                                <label
                                    >계좌
                                    <Select
                                        v-model="selectedAccount"
                                        :disabled="busy"
                                        :options="
                                            memberAccounts.map((a) => ({
                                                label: `${ownerName(a.ownerId)} / ${a.alias}`,
                                                value: a.id,
                                            }))
                                        "
                                        option-label="label"
                                        option-value="value"
                                        aria-label="계좌"
                                        placeholder="선택"
                                /></label>
                                <Button
                                    label="CSV 내보내기"
                                    icon="pi pi-download"
                                    severity="secondary"
                                    size="small"
                                    :disabled="
                                        busy ||
                                        accountsState !== 'ready' ||
                                        !visibleAccounts.length
                                    "
                                    @click="openExport()" />
                            </header>
                            <div class="asset-detail-tools">
                                <Button
                                    v-if="
                                        editableAccounts.some(
                                            (a) => a.id === selectedAccount
                                        )
                                    "
                                    label="자료 업로드"
                                    icon="pi pi-upload"
                                    severity="secondary"
                                    :disabled="busy"
                                    @click="openUpload(selectedAccount)" />
                                <Button
                                    v-if="
                                        /토스|toss/i.test(
                                            activeAccount.institution || ''
                                        )
                                    "
                                    label="토스 API 설정"
                                    icon="pi pi-link"
                                    severity="secondary"
                                    :aria-label="`${activeAccount.alias} 토스 API 설정`"
                                    :disabled="busy"
                                    @click="tossOpenRequest++" />
                                <small
                                    v-if="
                                        !editableAccounts.some(
                                            (a) => a.id === selectedAccount
                                        )
                                    "
                                    >조회 전용 · 업로드 불가</small
                                >
                            </div>
                            <AccountTossConnection
                                v-if="
                                    /토스|toss/i.test(
                                        activeAccount.institution || ''
                                    )
                                "
                                :account-id="selectedAccount"
                                :account-label="`${activeAccount.alias} · ${activeAccount.maskedNumber}`"
                                :open-request="tossOpenRequest"
                                :local-client="localToss"
                                :client="accountToss" />
                            <template v-if="canConfigure">
                                <form
                                    @submit.prevent="
                                        mutate('renameAccount', {
                                            accountId: selectedAccount,
                                            alias: activeAccount.alias,
                                        })
                                    ">
                                    <label
                                        >계좌 별칭
                                        <InputText
                                            id="asset-account-alias"
                                            v-model="activeAccount.alias"
                                            required
                                            maxlength="100" /></label
                                    ><Button type="submit" :disabled="busy"
                                        >별칭 저장</Button
                                    >
                                </form>
                                <details
                                    v-if="
                                        !activeAccount.legacyMigration &&
                                        space.profiles?.[activeAccount.ownerId]
                                            ?.uid === ownUid
                                    ">
                                    <summary>
                                        이전 단일 계좌 데이터 보존 이전
                                    </summary>
                                    <p>
                                        본인 portfolios 원장을 별도 보관
                                        복사합니다. 기존 데이터는 유지하며,
                                        기준일 불명 잔고는 합산하지 않습니다.
                                        다른 이전 저장소는 자동 합치지 않습니다.
                                    </p>
                                    <label
                                        ><input
                                            v-model="singleAccountConfirmed"
                                            type="checkbox" />
                                        원본이 선택한 본인 계좌 한 개의 자료임을
                                        확인했습니다</label
                                    ><Button
                                        type="submit"
                                        :disabled="
                                            busy || !singleAccountConfirmed
                                        "
                                        @click="
                                            mutate('migrateLegacy', {
                                                accountId: selectedAccount,
                                                confirmedSingleAccount:
                                                    singleAccountConfirmed,
                                            })
                                        ">
                                        자료 없는 계좌로 보존 이전
                                    </Button>
                                </details>
                            </template>
                            <section
                                v-if="activeAccount.legacyMigration"
                                aria-label="이전 완료 내역">
                                <h3>이전 완료 내역</h3>
                                <Tag severity="success" value="이전 완료" />
                                <p>
                                    이전 일시:
                                    {{
                                        migrationDate(
                                            activeAccount.legacyMigration
                                                .migratedAt
                                        )
                                    }}
                                    (한국 시간)
                                </p>
                                <p>
                                    보존 종목
                                    {{ activeAccount.legacyMigration.assets }}개
                                    · 거래
                                    {{
                                        activeAccount.legacyMigration
                                            .transactions
                                    }}건
                                </p>
                                <p>
                                    이전 자료는 이 계좌에 보존되어 있습니다.
                                    잔고 기준일을 확인할 수 없어 현재 잔고
                                    합산에는 포함하지 않습니다. 최신 잔고내역을
                                    업로드해 주세요.
                                </p>
                                <Button
                                    type="button"
                                    label="보존 이전 원장 확인"
                                    :disabled="busy"
                                    @click="viewMigratedEntries" />
                            </section>
                            <h3>거래 원장</h3>
                            <Button
                                v-if="!legacy"
                                type="button"
                                label="거래 직접 추가"
                                icon="pi pi-plus"
                                :disabled="busy"
                                @click="editEntry('add')" />
                            <label
                                ><input v-model="legacy" type="checkbox" /> 보존
                                이전 원장</label
                            ><Button
                                type="submit"
                                :disabled="busy"
                                @click="loadEntries(false)">
                                조회
                            </Button>
                            <Button
                                type="submit"
                                v-if="nextCursor"
                                :disabled="busy"
                                @click="loadEntries(true)">
                                다음 200건 조회
                            </Button>
                            <p
                                v-if="entriesLoaded && !entries.length"
                                role="status">
                                {{
                                    legacy
                                        ? '보존 이전한 거래가 없습니다.'
                                        : '저장된 거래가 없습니다.'
                                }}
                            </p>
                            <div class="scroll">
                                <table
                                    v-if="entries.length"
                                    class="ledger-table">
                                    <thead>
                                        <tr>
                                            <th>일자</th>
                                            <th>유형</th>
                                            <th>종목</th>
                                            <th>수량</th>
                                            <th>상태·작업</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr
                                            v-for="entry in entries"
                                            :key="entry.id">
                                            <td>
                                                {{
                                                    entry.row?.date ||
                                                    entry.asOf ||
                                                    '미확인'
                                                }}
                                            </td>
                                            <td>
                                                {{
                                                    (entry.row?.type &&
                                                        transactionTypeLabel(
                                                            entry.row.type
                                                        )) ||
                                                    entry.source ||
                                                    'legacy'
                                                }}
                                            </td>
                                            <td>
                                                {{ entry.row?.symbol || '—' }}
                                            </td>
                                            <td>
                                                {{ num(entry.row?.quantity) }}
                                            </td>
                                            <td>
                                                <Tag
                                                    v-if="entry.voidedAt"
                                                    value="취소됨"
                                                    severity="secondary" />
                                                <Button
                                                    v-if="
                                                        !legacy &&
                                                        entry.row?.type ===
                                                            'buy'
                                                    "
                                                    type="button"
                                                    @click="openFunding(entry)">
                                                    자금 구성 확인
                                                </Button>
                                                <template v-if="!legacy">
                                                    <Button
                                                        v-if="!entry.voidedAt"
                                                        type="button"
                                                        label="취소"
                                                        severity="danger"
                                                        text
                                                        @click="
                                                            editEntry(
                                                                'void',
                                                                entry
                                                            )
                                                        " />
                                                    <Button
                                                        v-if="!entry.voidedAt"
                                                        type="button"
                                                        label="교체"
                                                        severity="secondary"
                                                        text
                                                        @click="
                                                            editEntry(
                                                                'replace',
                                                                entry
                                                            )
                                                        " />
                                                    <Button
                                                        v-else
                                                        type="button"
                                                        label="취소 복원"
                                                        severity="secondary"
                                                        text
                                                        @click="
                                                            editEntry(
                                                                'restore',
                                                                entry
                                                            )
                                                        " />
                                                </template>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </section>
                        <Dialog
                            v-model:visible="entryDialog"
                            append-to="self"
                            modal
                            header="거래 원장 정정"
                            :style="{ width: 'min(560px, 94vw)' }">
                            <form
                                class="entry-mutation-form"
                                @submit.prevent="saveEntryMutation">
                                <Message severity="warn" :closable="false">
                                    원본은 삭제하지 않고 감사 이력에 보존됩니다.
                                    <span v-if="entryDelta !== null">
                                        예상 수량 변화:
                                        {{ num(entryDelta) }}주</span
                                    >
                                </Message>
                                <template
                                    v-if="
                                        ['add', 'replace'].includes(
                                            entryMutation.operation
                                        )
                                    ">
                                    <label
                                        >거래일<input
                                            v-model="entryMutation.row.date"
                                            type="date"
                                            required
                                    /></label>
                                    <label
                                        >유형<Select
                                            v-model="entryMutation.row.type"
                                            :options="transactionTypes"
                                            option-label="label"
                                            option-value="value"
                                    /></label>
                                    <label
                                        >종목<input
                                            v-model.trim="
                                                entryMutation.row.symbol
                                            "
                                            required
                                            maxlength="40"
                                    /></label>
                                    <label
                                        >통화<input
                                            v-model.trim="
                                                entryMutation.row.currency
                                            "
                                            required
                                            maxlength="3"
                                    /></label>
                                    <label
                                        >수량<input
                                            v-model.number="
                                                entryMutation.row.quantity
                                            "
                                            type="number"
                                            min="0"
                                            step="any"
                                    /></label>
                                    <label
                                        >금액<input
                                            v-model.number="
                                                entryMutation.row.amount
                                            "
                                            type="number"
                                            min="0"
                                            step="any"
                                    /></label>
                                </template>
                                <label
                                    >변경 사유<input
                                        v-model.trim="entryMutation.reason"
                                        required
                                        maxlength="200"
                                /></label>
                                <div class="dialog-actions">
                                    <Button
                                        type="button"
                                        label="닫기"
                                        severity="secondary"
                                        outlined
                                        @click="entryDialog = false" /><Button
                                        type="submit"
                                        label="확인 후 반영"
                                        :loading="busy" />
                                </div>
                            </form>
                        </Dialog>
                        <Dialog
                            v-model:visible="fundingDialog"
                            append-to="self"
                            modal
                            header="계좌 매수 자금 상세"
                            :style="{ width: '850px' }"
                            :breakpoints="{ '900px': '94vw' }"
                            class="funding-dialog">
                            <template v-if="fundingEntry && activeAccount">
                                <div class="funding-title">
                                    <h2>
                                        {{ activeAccount.alias }} ·
                                        {{ fundingEntry.symbol }} ·
                                        {{ fundingEntry.date }}
                                    </h2>
                                    <Button
                                        type="button"
                                        @click="fundingDialog = false">
                                        상세 창 닫기
                                    </Button>
                                </div>
                                <p v-if="fundingMessage" role="status">
                                    {{ fundingMessage }}
                                </p>
                                <PurchaseFundingEditor
                                    :key="`${selectedAccount}-${fundingEntry.id}`"
                                    :user="firebaseUser"
                                    :transaction="fundingEntry"
                                    :asset="{ id: 'ACCOUNT' }"
                                    :account-id="selectedAccount"
                                    :state="capital"
                                    :loading="capitalLoading"
                                    :load-error="capitalError"
                                    :read-only="
                                        !editableAccounts.some(
                                            (a) => a.id === selectedAccount
                                        )
                                    "
                                    @saved="fundingSaved"
                                    @close="fundingDialog = false" />
                            </template>
                        </Dialog>
                    </template>
                </section>
            </div>
        </div>
        <AssetMemberDialog
            v-model:visible="memberDialog"
            :busy="busy"
            :error="error"
            @submit="addManagedMember" />
        <section
            v-if="accountDialog"
            class="account-registration-page"
            aria-labelledby="account-registration-title">
            <header>
                <h2 id="account-registration-title">계좌 등록</h2>
                <p class="registration-member-meta">
                    선택 명의자: <strong>{{ registrationMemberName }}</strong>
                </p>
                <Button
                    class="registration-back"
                    aria-label="계좌 목록으로 돌아가기"
                    title="계좌 목록으로 돌아가기"
                    icon="pi pi-arrow-left"
                    severity="secondary"
                    outlined
                    :disabled="busy"
                    @click="accountDialog = false" />
            </header>
            <AssetAccountRegistration
                :member-name="registrationMemberName"
                :show-member-name="false"
                :accounts="
                    accounts.map((a) => ({
                        ...a,
                        _role: a.permissions?.[ownUid],
                    }))
                "
                :busy="busy"
                :error="error"
                @submit="createAccount"
                @existing="openUpload" />
        </section>
        <AssetUploadDialog
            v-model:visible="uploadDialog"
            :title="`자료 업로드 · ${activeAccount?.alias || ''}`"
            :busy="busy">
            <p v-if="busy" role="status" aria-live="polite">
                {{ operationProgress?.detail || '자료를 처리하고 있습니다.' }}
                <span v-if="operationProgress?.total"
                    >{{ operationProgress.completed }} /
                    {{ operationProgress.total }}</span
                >
            </p>
            <template v-if="uploadDialog">
                <Message v-if="error" severity="error" :closable="false">{{
                    error
                }}</Message>
                <PortfolioImportResult
                    v-if="importReceipt"
                    ref="importResult"
                    :receipt="importReceipt"
                    :busy="busy"
                    :accounts-state="accountsState"
                    :latest-holdings-date="activeAccount?.snapshot?.asOf || ''"
                    @view="viewImported"
                    @export="openExport(importReceipt.kind)"
                    @calendar="
                        uploadDialog = false;
                        portfolioTab = 'calendar';
                    "
                    @another="anotherFile" />
                <Message
                    v-if="
                        !importReceipt &&
                        (!activeAccount ||
                            !editableAccounts.some(
                                (a) => a.id === selectedAccount
                            ))
                    "
                    severity="info"
                    :closable="false"
                    >편집 가능한 계좌를 먼저 선택해 주세요. 계좌 관리에서 계좌를
                    등록하거나 변경할 수 있습니다.</Message
                >
                <div
                    v-if="
                        !importReceipt &&
                        activeAccount &&
                        editableAccounts.some((a) => a.id === selectedAccount)
                    "
                    class="import-workspace">
                    <div v-if="!review" class="import-heading">
                        <div>
                            <h2 ref="importHeading" tabindex="-1">
                                자료 입력 · 저장 전 검토
                            </h2>
                            <p>
                                거래내역과 잔고 파일을 불러오고, 포트폴리오에
                                저장하기 전 내용을 확인하세요.
                            </p>
                        </div>
                        <div class="import-account">
                            <i class="pi pi-wallet" aria-hidden="true" />
                            <div>
                                <small>대상 계좌</small
                                ><strong
                                    >{{ activeAccount.institution }} ·
                                    {{ activeAccount.alias }}
                                    {{ activeAccount.maskedNumber }}</strong
                                >
                            </div>
                        </div>
                    </div>
                    <SelectButton
                        v-if="!review"
                        v-model="inputMethod"
                        :options="inputMethodOptions"
                        option-label="label"
                        option-value="value"
                        :allow-empty="false"
                        :disabled="busy"
                        aria-label="자료 입력 방법"
                        class="import-methods" />
                    <ManualHoldingsForm
                        v-if="inputMethod === 'manual' && !review"
                        :key="`${ownUid}:${familyId}:${selectedAccount}`"
                        :snapshot="activeAccount.snapshot || null"
                        :account-label="`${ownerName(activeAccount.ownerId)} · ${activeAccount.institution} · ${activeAccount.alias}`"
                        :busy="busy"
                        @preview="previewManualHoldings" />
                    <SnapshotHistory
                        v-if="inputMethod === 'manual' && !review"
                        :key="`history:${ownUid}:${familyId}:${selectedAccount}`"
                        :account-id="activeAccount.id"
                        :revision="activeAccount.snapshotRevision || ''" />
                    <BrokerSpreadsheetForm
                        v-if="inputMethod === 'broker' && !review"
                        :key="`broker:${ownUid}:${familyId}:${selectedAccount}`"
                        :account="activeAccount"
                        :busy="busy"
                        @preview="previewBroker" />
                    <PortfolioFileImportForm
                        v-if="inputMethod === 'file'"
                        v-show="!review"
                        ref="fileUpload"
                        v-model:kind="kind"
                        v-model:format="format"
                        v-model:as-of="asOf"
                        v-model:password="password"
                        v-model:remember-password="rememberPassword"
                        v-model:confirmed="confirmed"
                        :account-label="`${ownerName(activeAccount.ownerId)} · ${activeAccount.institution} · ${activeAccount.alias} · ${activeAccount.maskedNumber}`"
                        :password-configured="
                            activeAccount.pdfPasswordConfigured
                        "
                        :is-owner="
                            activeAccount.permissions?.[ownUid] === 'owner'
                        "
                        :busy="busy"
                        :reviewing="!!review"
                        :error="filePreviewError"
                        :kind-options="kindOptions"
                        :format-options="formatOptions"
                        :selected-files="selectedFiles"
                        @select="selectImportFiles"
                        @clear="selectedFiles = []"
                        @preview="preview"
                        @remove-password="removePdfPassword"
                        @reset="resetFileInput" />
                    <PortfolioImportReview
                        v-if="review"
                        ref="importReview"
                        :key="review.reviewId"
                        :review="review"
                        :save-disabled="
                            statementBlocked ||
                            (review.source === 'toss-pdf' &&
                                !statementConfirmed)
                        "
                        :account-label="`${ownerName(activeAccount.ownerId)} · ${activeAccount.institution} · ${activeAccount.alias} · ${activeAccount.maskedNumber}`"
                        :busy="busy"
                        @update-row="updateReviewRow"
                        @commit="commit"
                        @cancel="review = null">
                        <template #identity-review>
                            <StatementIdentityReview
                                v-if="review.source === 'toss-pdf'"
                                v-model:confirmed="statementConfirmed"
                                :files="review.statementFiles"
                                :account-label="`${ownerName(activeAccount.ownerId)} · ${activeAccount.institution} · ${activeAccount.maskedNumber}`"
                                :blocked="statementBlocked"
                                :busy="busy" />
                        </template>
                        <template #holdings-warning>
                            <div v-if="review.source === 'manual-holdings-v1'">
                                <Message severity="warn" :closable="false">
                                    기준일 {{ review.asOf }} ·
                                    {{ review.rows.length }}행의 전체 잔고로
                                    대체합니다. 빠진 종목은 새 잔고에서
                                    제외됩니다. 기존 거래는 유지됩니다.
                                </Message>
                                <p v-if="review.correction">
                                    같은 기준일 정정 · 사유:
                                    {{ review.correctionReason }}. 변경 전후
                                    자료를 이력에 보관합니다.
                                </p>
                                <HoldingsChanges
                                    :before="activeAccount.snapshot?.rows || []"
                                    :after="review.rows" />
                                <Button
                                    type="button"
                                    label="수동 입력 다시 작성"
                                    severity="secondary"
                                    :disabled="busy"
                                    @click="review = null" />
                            </div>
                        </template>
                    </PortfolioImportReview>
                </div>
            </template>
        </AssetUploadDialog>
        <PortfolioExportDialog
            v-model:visible="exportVisible"
            :accounts="visibleAccounts"
            :family-id="familyId"
            :initial-account-id="selectedAccount"
            :initial-kind="exportKind" />
    </PortfolioLoadingRegion>
</template>

<style scoped>
    .all-account-recovery {
        margin-top: 24px;
    }
    .all-account-recovery > summary {
        cursor: pointer;
        padding: 16px;
        border-radius: 12px;
        background: color-mix(
            in srgb,
            var(--app-accent) 6%,
            var(--app-surface)
        );
        color: var(--app-accent);
        font-weight: 600;
        font-size: 0.9rem;
    }

    .capital-page-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin: 12px 0 24px;
    }
    .capital-page-heading h2 {
        margin: 6px 0 9px;
        font-size: 1.6rem;
        letter-spacing: -0.025em;
    }
    .capital-page-heading p {
        margin: 0;
        color: var(--app-muted);
        font-size: 0.85rem;
    }
    .capital-page-heading .capital-eyebrow {
        font-size: 0.76rem;
        color: var(--app-accent);
    }
    .capital-currency-note {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 12px;
        background: color-mix(
            in srgb,
            var(--app-accent) 7%,
            var(--app-surface)
        );
        color: var(--app-muted);
        font-size: 0.8rem;
        white-space: nowrap;
    }
    @media (max-width: 700px) {
        .capital-page-heading {
            align-items: start;
            flex-direction: column;
            gap: 12px;
        }
        .capital-page-heading h2 {
            font-size: 1.35rem;
        }
        .capital-currency-note {
            font-size: 0.75rem;
        }
    }

    .asset-list-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        margin-top: 1.5rem;
    }
    .import-workspace {
        min-width: 0;
    }
    .import-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 24px;
    }
    .import-heading h2 {
        margin-bottom: 6px;
        font-size: 24px;
        scroll-margin-top: var(--portfolio-scroll-offset, 90px);
    }
    .import-heading p {
        margin: 0;
    }
    .import-account {
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 340px;
        padding: 10px 14px;
        border-radius: 12px;
        background: color-mix(
            in srgb,
            var(--app-accent) 7%,
            var(--app-surface)
        );
    }
    .import-account i {
        color: var(--app-accent);
    }
    .import-account small {
        display: block;
        color: var(--app-muted);
        font-size: 11px;
    }
    .import-account strong {
        display: block;
        font-size: 13px;
        overflow-wrap: anywhere;
    }
    .import-methods {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        max-width: 100%;
        margin-bottom: 24px;
        padding: 6px;
        border-radius: 12px;
        background: color-mix(
            in srgb,
            var(--app-accent) 5%,
            var(--app-surface)
        );
    }
    .import-methods :deep(.p-togglebutton) {
        border: 0;
        border-radius: 8px;
    }
    @media (max-width: 767px) {
        .family-page {
            --portfolio-scroll-offset: calc(
                var(--studio-header-height, 61px) + 69px
            );
        }
        .import-heading {
            flex-direction: column;
            align-items: stretch;
        }
        .import-account {
            max-width: none;
        }
        .import-methods {
            display: flex;
        }
        .import-methods :deep(.p-togglebutton) {
            flex: 1 1 auto;
        }
    }

    .entry-mutation-form {
        display: grid;
        gap: 0.9rem;
    }
    .entry-mutation-form label {
        display: grid;
        gap: 0.35rem;
        font-weight: 600;
    }
    .entry-mutation-form input {
        min-height: 2.75rem;
        border: 1px solid var(--p-surface-300);
        border-radius: 0.5rem;
        padding: 0.65rem;
        width: 100%;
    }
    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }
    .ledger-table td:last-child {
        min-width: 17rem;
    }
    .retry-countdown {
        margin: 12px 0;
    }
    .retry-countdown strong,
    .retry-countdown span {
        display: block;
    }
    .retry-countdown strong {
        font-size: 1.1rem;
    }
    .family-page {
        color: var(--app-text);
        line-height: 1.7;
        min-width: 0;
    }
    .portfolio-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 20px;
        margin-bottom: 24px;
    }
    .portfolio-heading h1 {
        font-size: 32px;
        margin: 10px 0 8px;
    }
    .portfolio-heading p {
        color: var(--app-muted);
        margin: 0;
    }
    .summary-scope {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-right: auto;
        font-size: 13px;
    }
    .summary-scope select {
        max-width: 100%;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-bg);
        color: var(--app-muted);
        padding: 10px 12px;
    }
    .portfolio-tools {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: flex-end;
        gap: 10px;
        margin: 8px 0;
    }
    .portfolio-scope {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin: 24px 0;
    }
    .portfolio-tabs :deep(.p-tabpanels) {
        background: transparent;
        padding: 24px 0 0;
    }
    .portfolio-tabs :deep(.p-tablist-tab-list) {
        background: transparent;
    }
    .portfolio-tabs :deep(.p-tab) {
        min-height: 52px;
    }
    .overview-tabs {
        min-width: 0;
    }
    .overview-tabs :deep(.p-tablist-tab-list) {
        gap: 4px;
        padding: 4px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface-muted);
    }
    .overview-tabs :deep(.p-tab) {
        min-height: 44px;
        border-radius: 8px;
    }
    .portfolio-tabs section:not(.portfolio-panel) {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 24px;
        background: var(--app-surface);
        min-width: 0;
    }
    .portfolio-tabs section section:not(.portfolio-panel) {
        margin: 16px 0 0;
    }
    .portfolio-tabs h2 {
        font-size: 20px;
        margin: 0 0 16px;
    }
    .portfolio-tabs h3 {
        font-size: 16px;
        margin: 24px 0 16px;
    }
    .portfolio-tabs p {
        font-size: 14px;
        color: var(--app-muted);
    }
    .portfolio-tabs form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 16px;
        margin: 20px 0;
    }
    .portfolio-tabs label {
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
        max-width: 100%;
        font-size: 14px;
    }
    .portfolio-tabs label:has(input[type='checkbox']) {
        flex-direction: row;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
    }
    .portfolio-tabs input[type='checkbox'] {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
        margin-top: 3px;
        accent-color: var(--app-accent);
    }
    .portfolio-tabs :deep(.p-inputtext),
    .portfolio-tabs :deep(.p-select) {
        max-width: 100%;
        min-width: 0;
    }
    .portfolio-tabs details {
        margin: 20px 0;
        padding: 16px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .portfolio-tabs summary {
        cursor: pointer;
        font-size: 14px;
        font-weight: 650;
    }
    .portfolio-tabs ul {
        padding-left: 20px;
    }
    .portfolio-tabs li {
        margin: 12px 0;
    }
    .portfolio-tabs a {
        color: var(--app-accent);
    }
    .portfolio-tabs pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-width: 100%;
        font-size: 13px;
    }
    .portfolio-tabs code {
        overflow-wrap: anywhere;
    }
    .scroll {
        overflow: auto;
        max-width: 100%;
        margin: 20px 0;
    }
    table {
        border-collapse: collapse;
        width: 100%;
        font-size: 14px;
    }
    th,
    td {
        padding: 12px;
        border-bottom: 1px solid var(--app-border);
        text-align: left;
    }
    th {
        background: var(--app-surface-muted);
        font-weight: 600;
        white-space: nowrap;
    }
    td :deep(.p-inputtext) {
        min-width: 100px;
        width: 140px;
    }
    .warning {
        color: var(--app-muted);
    }
    .error {
        color: var(--p-red-600);
    }
    .funding-title {
        display: flex;
        align-items: center;
        gap: 16px;
        justify-content: space-between;
        flex-wrap: wrap;
    }
    .portfolio-value-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
        gap: 16px;
        margin-bottom: 24px;
    }
    .portfolio-value-card {
        border: 1px solid var(--app-border);
    }
    .value-card-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: var(--app-muted);
        font-size: 14px;
    }
    .portfolio-value-card strong {
        display: block;
        margin: 18px 0 8px;
        font-size: 32px;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.03em;
    }
    .portfolio-value-card strong small {
        font-size: 16px;
        color: var(--app-muted);
    }
    .portfolio-value-card p,
    .value-card-note {
        margin: 4px 0;
        font-size: 13px;
        color: var(--app-muted);
    }
    .capital-details {
        margin-bottom: 24px;
    }
    .portfolio-empty {
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 16px;
        margin-bottom: 24px;
    }
    .family-page :deep(.portfolio-content-body > .p-message) {
        margin: 12px 0;
    }
    @media (max-width: 767px) {
        .portfolio-heading {
            flex-direction: column;
            align-items: stretch;
        }
        .portfolio-heading h1 {
            font-size: 26px;
        }
        .portfolio-tools {
            margin-bottom: 4px;
        }
        .portfolio-tabs :deep(.p-tablist) {
            position: sticky;
            top: var(--studio-header-height, 61px);
            z-index: 20;
            background: var(--app-bg);
            border-bottom: 1px solid var(--app-border);
            overflow-x: auto;
            overscroll-behavior-inline: contain;
            scrollbar-width: thin;
        }
        .portfolio-tabs :deep(.p-tablist-tab-list) {
            width: max-content;
            min-width: 100%;
        }
        .portfolio-tabs :deep(.p-tab) {
            padding: 12px 8px;
            flex: 0 0 auto;
            min-width: max-content;
            font-size: 13px;
            white-space: nowrap;
        }
        .portfolio-tabs .overview-tabs :deep(.p-tablist) {
            position: static;
            z-index: auto;
            background: transparent;
            border-bottom: 0;
        }
        .portfolio-tabs section {
            padding: 20px 16px;
        }
        .portfolio-tabs form {
            flex-direction: column;
            align-items: stretch;
        }
        .portfolio-tabs label {
            width: 100%;
        }
        .portfolio-tabs h2 {
            font-size: 18px;
        }
        .portfolio-tabs :deep(.p-selectbutton) {
            font-size: 13px;
        }
        .portfolio-scope :deep(.p-selectbutton) {
            width: 100%;
        }
        .portfolio-scope :deep(.p-togglebutton) {
            flex: 1;
        }
    }

    @media (max-width: 1023px) {
        .holdings-desktop-table {
            display: none;
        }
    }

    /* Stitch holdings and asset-management panels reuse the existing account/ledger contracts. */
    .family-page {
        --p-tabs-tabpanel-padding: 20px 0 0;
    }
    .family-page[data-stitch-view='holdings']
        .overview-tabs
        :deep(.portfolio-panel)
        > section,
    .family-page[data-stitch-view='assets']
        .portfolio-tabs
        :deep(.portfolio-panel)
        > section {
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 12px;
        background: var(--app-surface);
    }
    .family-page[data-stitch-view='holdings'] h3,
    .family-page[data-stitch-view='assets'] h2 {
        font-size: 18px;
        margin: 0 0 16px;
    }
    .family-page[data-stitch-view='holdings'] .holdings-filter-grid label {
        display: grid;
        gap: 0;
        margin: 0;
        font-size: 14px;
    }
    .family-page[data-stitch-view='holdings'] :deep(.p-datatable),
    .family-page[data-stitch-view='assets'] :deep(.p-datatable) {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        overflow: hidden;
        margin-block: 16px 24px;
    }
    .family-page :deep(.p-datatable-thead > tr > th) {
        font-size: 12px;
        font-weight: 500;
        background: var(--app-surface-muted);
        color: var(--app-muted);
    }
    .family-page :deep(.p-datatable-tbody > tr > td) {
        padding: 14px 16px;
        font-size: 13px;
    }
    .portfolio-value-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
    }
    .portfolio-value-card {
        border: 0;
        border-radius: 12px;
        background: var(--app-surface-muted);
        box-shadow: none;
    }
    .portfolio-value-card :deep(.p-card-body) {
        padding: 16px;
    }
    .portfolio-value-card strong {
        font-size: 24px;
    }
    @media (max-width: 640px) {
        .family-page[data-stitch-view='holdings']
            .overview-tabs
            :deep(.portfolio-panel)
            > section,
        .family-page[data-stitch-view='assets']
            .portfolio-tabs
            :deep(.portfolio-panel)
            > section {
            padding: 16px;
        }
        .portfolio-value-grid {
            grid-template-columns: 1fr;
        }
    }

    .account-registration-page {
        max-width: 960px;
        margin: auto;
        min-width: 0;
    }
    .account-registration-page > header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
    }
    .registration-member-meta {
        margin: 0 0 0 auto;
        font-size: 14px;
        color: var(--app-muted);
    }
    .registration-back {
        width: 44px;
        height: 44px;
        /* Preserve the touch target while matching the source's 30px header row. */
        margin-block: -7px;
        padding: 0;
        flex-shrink: 0;
    }
    .account-registration-page h2 {
        margin: 0;
        font-size: 20px;
        line-height: 30px;
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    @media (max-width: 640px) {
        .account-registration-page {
            max-width: none;
            margin-inline: -4px;
        }
    }

    .portfolio-panels {
        padding-top: 20px;
    }
    .portfolio-heading {
        margin-bottom: 20px;
    }
    .portfolio-heading h1 {
        font-size: 22px;
        margin: 0 0 6px;
    }
    .portfolio-heading .studio-eyebrow {
        display: none;
    }
    .portfolio-heading p {
        margin: 0;
        font-size: 13px;
    }

    .portfolio-tabs .portfolio-panel {
        padding: 0;
        margin: 0;
        border: 0;
        background: transparent;
        min-width: 0;
    }
    .portfolio-tabs section.valuation,
    .portfolio-tabs section.dividend-calendar,
    .portfolio-tabs section.insights {
        padding: 0;
        border: 0;
        margin: 0;
        background: transparent;
    }
    .family-page[data-stitch-view='assets']
        .portfolio-tabs
        .portfolio-panel
        > .asset-management-overview {
        padding: 0;
        border: 0;
        background: transparent;
    }
    .family-page[data-stitch-view='assets'] .asset-overview-heading h2 {
        font-size: 36px;
        line-height: 44px;
    }
    @media (max-width: 767px) {
        .family-page[data-stitch-view='assets'] .asset-overview-heading h2 {
            font-size: 24px;
            line-height: 32px;
            font-weight: 600;
        }
    }
    .family-page[data-stitch-view='holdings']
        .portfolio-tabs
        section.holdings-page-content {
        padding: 24px 16px;
        border: 0;
        margin: 0;
        background: transparent;
    }
    @media (min-width: 640px) {
        .family-page[data-stitch-view='holdings']
            .portfolio-tabs
            section.holdings-page-content {
            padding-inline: 24px;
        }
    }
    @media (min-width: 1024px) {
        .family-page[data-stitch-view='holdings']
            .portfolio-tabs
            section.holdings-page-content {
            padding-inline: 32px;
        }
    }
    .holdings-notices {
        padding: 12px 16px;
        border-radius: 12px;
        background: var(--app-surface-muted);
        margin-bottom: 20px;
    }
    .holdings-notices p {
        margin: 4px 0;
        font-size: 12px;
        line-height: 18px;
    }
    .holding-account-identity {
        display: grid;
        gap: 4px;
    }
    .holding-account-identity span,
    .holding-account-identity small {
        font-size: 11px;
        color: var(--app-muted);
    }
    .holdings-desktop-table :deep(th) {
        padding: 12px 16px;
        font-size: 11px;
        background: var(--app-bg);
    }
    .holdings-desktop-table :deep(td) {
        padding: 16px;
        font-size: 14px;
    }
    .holdings-page-heading {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
    }
    .holdings-page-heading > div:first-child {
        flex: 1;
        min-width: 0;
    }
    .holdings-page-heading h1 {
        margin: 0;
        font-size: 24px;
        line-height: 32px;
        font-weight: 600;
    }
    .holdings-page-actions {
        display: flex;
        gap: 10px;
        flex-shrink: 0;
    }
    .holdings-page-actions :deep(.p-button) {
        height: 44px;
        font-size: 16px;
        min-width: 0;
        padding-inline: 16px;
        white-space: normal;
    }
    .holdings-page-actions :deep(.p-button-label) {
        white-space: normal;
        line-height: 20px;
    }
    .holdings-page-heading p {
        margin: 8px 0 0;
        font-size: 14px;
        line-height: 20px;
        color: var(--app-muted);
    }
    .holdings-filter-card {
        padding: 20px;
        border: 0;
        box-shadow: 0 1px 2px rgb(0 0 0 / 5%);
        border-radius: 12px;
        background: var(--app-surface);
        margin: 20px 0;
    }
    .holdings-filter-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 16px;
        padding-bottom: 12px;
    }
    .holdings-filter-grid {
        display: grid;
        grid-template-columns: 5fr 3fr 4fr;
        gap: 12px;
        padding-top: 4px;
    }
    .holdings-filter-grid label {
        display: grid;
        min-width: 0;
        font-size: 12px;
        color: var(--app-muted);
    }
    .holdings-search {
        position: relative;
    }
    .holdings-search > i {
        position: absolute;
        left: 12px;
        top: 15px;
        z-index: 1;
    }
    .holdings-search :deep(.p-inputtext) {
        padding-left: 36px;
    }
    .holdings-filter-grid :deep(.p-select),
    .holdings-filter-grid :deep(.p-inputtext) {
        width: 100%;
        height: 44px;
    }
    .holdings-filter-heading :deep(.p-togglebutton) {
        font-size: 14px;
        min-width: 0;
        height: 36px;
        padding: 0 14px;
    }
    .holdings-filter-heading :deep(.p-selectbutton) {
        padding: 4px;
        width: fit-content;
        border-radius: 8px;
        background: var(--app-surface-muted);
    }
    .holdings-filter-heading > :deep(.p-button) {
        height: 36px;
        min-height: 36px;
        font-size: 12px;
    }
    .holdings-holder-view,
    .holdings-symbol-view {
        min-width: 0;
    }
    .holdings-desktop-table {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        overflow: hidden;
    }
    @media (max-width: 767px) {
        .holdings-page-heading {
            flex-direction: column;
            align-items: stretch;
        }
        .holdings-filter-grid {
            grid-template-columns: 1fr;
        }
        .holdings-filter-card {
            padding: 16px;
        }
        .holdings-filter-heading :deep(.p-selectbutton) {
            flex-wrap: wrap;
        }
    }
    @media (max-width: 639px) {
        .holdings-filter-heading {
            align-items: stretch;
            flex-direction: column;
            padding-bottom: 12px;
        }
        .holdings-filter-heading > :deep(.p-button) {
            align-self: flex-end;
        }
    }
    .asset-detail-tools {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 24px;
        align-items: center;
    }
    .asset-detail-tools :deep(.p-button) {
        height: 44px;
        font-size: 14px;
    }
    .asset-detail-tools small {
        color: var(--app-muted);
    }
    .asset-detail-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 24px;
    }
    .asset-detail-heading h2 {
        margin: 0;
        font-size: 20px;
        line-height: 28px;
    }
    .asset-detail-heading > label {
        min-width: 0;
        display: grid;
        gap: 6px;
        font-size: 12px;
    }
    .asset-detail-heading :deep(.p-select) {
        max-width: 100%;
        min-width: 0;
    }
    .asset-detail-heading > .p-button {
        margin-left: auto;
    }
    .asset-overview-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        margin-bottom: 24px;
    }
    .asset-overview-heading > div {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }
    .asset-overview-heading h2 {
        margin: 0;
    }
    .asset-scope-label {
        padding: 4px 10px;
        border-radius: 4px;
        background: var(--app-surface-muted);
        color: var(--app-muted);
        font-size: 11px;
    }
    .asset-list-heading {
        margin-top: 0;
        margin-bottom: 16px;
    }
    .asset-list-heading h3 {
        margin: 0;
        font-size: 20px;
        line-height: 28px;
        font-weight: 600;
    }
    .asset-list-heading small {
        font-size: 12px;
        color: var(--app-muted);
    }
    @media (max-width: 767px) {
        .asset-overview-heading {
            align-items: start;
            flex-direction: column;
        }
    }
    .portfolio-tabs > .portfolio-panels,
    .overview-tabs > .portfolio-panels {
        padding-top: 0;
    }

    .family-page[data-stitch-view='summary'] .portfolio-value-grid {
        margin: 0;
        padding-top: 8px;
    }
    .family-page[data-stitch-view='summary'] .value-card-heading {
        margin-bottom: 4px;
        font-size: 11px;
        line-height: 14px;
    }
    .family-page[data-stitch-view='summary']
        .portfolio-value-card
        :deep(.p-card-body) {
        gap: 0;
    }
    .family-page[data-stitch-view='summary'] .portfolio-value-card strong {
        margin: 0;
        font-family: 'JetBrains Mono', monospace;
        font-size: 24px;
        line-height: 32px;
        font-weight: 600;
        letter-spacing: -0.025em;
    }
    .family-page[data-stitch-view='summary'] .portfolio-value-card p,
    .family-page[data-stitch-view='summary'] .value-card-note {
        display: block;
        margin: 4px 0 0;
        font-size: 11px;
        line-height: 14px;
    }
</style>
