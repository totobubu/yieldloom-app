<script setup>
    import { computed, nextTick, onScopeDispose, ref, watch } from 'vue';
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
    import PortfolioInsights from '@/components/portfolio/PortfolioInsights.vue';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import Panel from 'primevue/panel';
    import InputText from 'primevue/inputtext';
    import PortfolioFileImportForm from '@/components/portfolio/PortfolioFileImportForm.vue';
    import Select from 'primevue/select';
    import SelectButton from 'primevue/selectbutton';
    import Message from 'primevue/message';
    import Tag from 'primevue/tag';
    import Tabs from 'primevue/tabs';
    import TabList from 'primevue/tablist';
    import Tab from 'primevue/tab';
    import TabPanels from 'primevue/tabpanels';
    import TabPanel from 'primevue/tabpanel';
    import Dialog from 'primevue/dialog';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import { authLoading, firebaseUser } from '@/services/firebaseClient';
    import { familyRequest } from '@/services/familyPortfolio';
    import { useRequestCooldown } from '@/composables/useRequestCooldown.js';

    const router = useRouter();
    const route = useRoute();
    const portfolioTabs = [
        'overview',
        'calendar',
        'insights',
        'accounts',
        'upload',
        'family',
    ];
    const portfolioTab = computed({
        get: () =>
            portfolioTabs.includes(route.query.tab)
                ? route.query.tab
                : 'overview',
        set: (tab) => router.replace({ query: { ...route.query, tab } }),
    });
    const exportVisible = ref(false),
        exportKind = ref('holdings'),
        importReceipt = ref(null);
    const scopeOptions = [
        { label: '내 계좌', value: 'personal' },
        { label: '가족 포트폴리오', value: 'family' },
    ];
    const accountTypeOptions = [
        { label: '일반', value: 'general' },
        { label: 'ISA', value: 'isa' },
        { label: '연금', value: 'pension' },
        { label: '기타', value: 'other' },
    ];
    const roleOptions = [
        { label: '조회', value: 'viewer' },
        { label: '조회·업로드', value: 'editor' },
        { label: '공유 취소', value: 'none' },
    ];
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
        familyId = ref(''),
        accounts = ref([]),
        rawSummary = ref(null);
    const requestedCalculations = new Set();
    const portfolioScope = ref('personal');
    const busy = ref(false),
        operationProgress = ref(null),
        error = ref(''),
        message = ref(''),
        invitation = ref('');
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
    const newFamily = ref(''),
        myName = ref(''),
        joinToken = ref(''),
        childName = ref(''),
        guardian = ref(false);
    const accountForm = ref({
        institution: '',
        alias: '',
        type: 'general',
        ownerId: '',
        last4: '',
    });
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
    const capital = ref({ entries: [], classifications: [], allocations: [] });
    const capitalCollapsed = ref(true);
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
                (capitalCollapsed.value || portfolioTab.value !== 'overview'))
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
        [selectedAccount, firebaseUser, capitalCollapsed, portfolioTab],
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
    const shareUid = ref(''),
        shareRole = ref('viewer'),
        singleAccountConfirmed = ref(false);
    const ownUid = computed(() => firebaseUser.value?.uid);
    const space = computed(() =>
        families.value.find((f) => f.id === familyId.value)
    );
    const profiles = computed(() =>
        Object.entries(space.value?.profiles || {}).map(([id, p]) => ({
            id,
            ...p,
        }))
    );
    const ownProfiles = computed(() =>
        profiles.value.filter(
            (p) =>
                p.uid === firebaseUser.value?.uid ||
                p.guardianUid === firebaseUser.value?.uid
        )
    );
    const selfProfile = computed(() =>
        profiles.value.find((p) => p.uid === ownUid.value)
    );
    const visibleAccounts = computed(() =>
        accounts.value.filter(
            (a) =>
                portfolioScope.value === 'family' ||
                space.value?.profiles[a.ownerId]?.uid === ownUid.value
        )
    );
    const summary = computed(() => {
        if (!rawSummary.value) return null;
        const ids = new Set(visibleAccounts.value.map((a) => a.id));
        const positions = rawSummary.value.positions.filter((p) =>
            ids.has(p.accountId)
        );
        const dates = visibleAccounts.value
            .filter((a) => a.calculatedSnapshot)
            .map((a) => a.calculatedSnapshot.asOf)
            .filter(Boolean)
            .sort();
        const missing = visibleAccounts.value
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
            notice:
                portfolioScope.value === 'personal'
                    ? '본인 명의 계좌의 잔고 자료입니다. 현재 평가액·수익률이 아니며 통화별로 구분합니다.'
                    : rawSummary.value.notice,
        };
    });
    watch([visibleAccounts, selfProfile], () => {
        if (!visibleAccounts.value.some((a) => a.id === selectedAccount.value))
            selectedAccount.value = visibleAccounts.value[0]?.id || '';
        if (
            portfolioScope.value === 'personal' ||
            !ownProfiles.value.some((p) => p.id === accountForm.value.ownerId)
        )
            accountForm.value.ownerId = selfProfile.value?.id || '';
    });
    watch(portfolioScope, () => {
        accountFilter.value = '';
        ownerFilter.value = '';
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
    const canConfigure = computed(
        () => activeAccount.value?.authorityUid === firebaseUser.value?.uid
    );
    const otherAdults = computed(() =>
        profiles.value.filter((p) => p.uid && p.uid !== firebaseUser.value?.uid)
    );
    const positions = computed(() =>
        (summary.value?.positions || []).filter(
            (p) =>
                (!accountFilter.value || p.accountId === accountFilter.value) &&
                (!ownerFilter.value || p.ownerId === ownerFilter.value) &&
                (!symbolFilter.value ||
                    p.symbol.includes(symbolFilter.value.toUpperCase()))
        )
    );
    const symbols = computed(() => {
        const grouped = new Map();
        for (const p of positions.value) {
            const key = `${p.symbol}:${p.currency}`;
            const item = grouped.get(key) || {
                symbol: p.symbol,
                currency: p.currency,
                quantity: 0,
                amount: 0,
                complete: true,
            };
            item.quantity += p.quantity;
            item.amount += p.amount ?? 0;
            item.complete &&= p.amount !== null;
            grouped.set(key, item);
        }
        return [...grouped.values()];
    });
    const label = (id) => accounts.value.find((a) => a.id === id)?.alias || id;
    const ownerName = (id) => space.value?.profiles[id]?.name || '미확인';
    const num = (v) =>
        v === null || v === undefined
            ? '미확인'
            : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
    async function run(work, { onError } = {}) {
        if (busy.value) return;
        busy.value = true;
        operationProgress.value = null;
        error.value = '';
        message.value = '';
        try {
            await work();
        } catch (e) {
            if (onError) onError(e);
            else error.value = e.message;
        } finally {
            busy.value = false;
            operationProgress.value = null;
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
            let data = await familyRequest(
                '',
                undefined,
                requestedFamily ? { familyId: requestedFamily } : {},
                { signal }
            );
            if (!isCurrent()) return;
            if (!requestedFamily && data.families.length) {
                familyId.value = (
                    data.families.find((f) => f.kind === 'personal') ||
                    data.families.find((f) => f.adminUid === requestedUid) ||
                    data.families[0]
                ).id;
                // The family watcher owns the selected-family request.
                return;
            }
            families.value = data.families;
            accounts.value = data.accounts || [];
            rawSummary.value = data.summary || null;
            if (!route.query.tab || route.query.tab === 'overview') {
                const hasRecords = accounts.value.some(
                    (account) =>
                        (account.entriesRevision || 0) > 0 || account.snapshot
                );
                portfolioTab.value = !accounts.value.length
                    ? 'accounts'
                    : hasRecords
                      ? 'overview'
                      : 'upload';
            }
            if (!familyId.value && families.value.length)
                familyId.value = families.value[0].id;
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
            familyId.value = '';
            selectedAccount.value = '';
            invitation.value = '';
            password.value = '';
            portfolioScope.value = 'personal';
            accountsState.value = 'loading';
            accountLoadError.value = '';
            accountLoadIssue.value = null;
            if (waiting) return;
            if (!user)
                router.replace({
                    path: '/login',
                    query: { redirect: route.fullPath },
                });
            else run(refresh);
        },
        { immediate: true }
    );
    watch(familyId, async () => {
        importReceipt.value = null;
        exportVisible.value = false;
        accountsState.value = 'loading';
        accountLoadError.value = '';
        accounts.value = [];
        rawSummary.value = null;
        invitation.value = '';
        nextCursor.value = null;
        review.value = null;
        entries.value = [];
        accountFilter.value = '';
        ownerFilter.value = '';
        // A selected family must load even while the initial list or a write owns `busy`.
        await refresh();
    });
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
    async function createFamily() {
        await run(async () => {
            const result = await familyRequest('createFamily', {
                name: newFamily.value,
                profileName: myName.value,
            });
            familyId.value = result.familyId;
            await refresh();
        });
    }
    async function join() {
        await run(async () => {
            const result = await familyRequest('join', {
                invitation: joinToken.value,
                name: myName.value,
            });
            joinToken.value = '';
            familyId.value = result.familyId;
            await refresh();
        });
    }
    async function mutate(action, body) {
        await run(async () => {
            const result = await familyRequest(action, {
                familyId: familyId.value,
                ...body,
            });
            if (result.invitation) invitation.value = result.invitation;
            else message.value = '저장했습니다.';
            await refresh();
        });
    }
    async function createAccount() {
        await run(async () => {
            if (!space.value) {
                const result = await familyRequest('ensurePersonal', {
                    profileName: firebaseUser.value?.displayName || '본인',
                });
                familyId.value = result.familyId;
                await refresh();
            }
            if (portfolioScope.value === 'personal')
                accountForm.value.ownerId = selfProfile.value.id;
            const result = await familyRequest('createAccount', {
                ...accountForm.value,
                familyId: familyId.value,
            });
            await refresh();
            selectedAccount.value = result.accountId;
            accountForm.value.last4 = '';
        });
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
        if (importReceipt.value?.kind === 'holdings')
            portfolioTab.value = 'overview';
        else {
            portfolioTab.value = 'accounts';
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
        portfolioTab.value = 'upload';
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
</script>

<template>
    <PortfolioLoadingRegion
        class="family-page"
        :busy="contentBusy"
        :progress="operationProgress"
        @after-hide="focusPreviewFeedback">
        <header class="portfolio-heading">
            <div>
                <span class="studio-eyebrow"
                    ><i class="pi pi-wallet" aria-hidden="true" /> MY
                    PORTFOLIO</span
                >
                <h1>내 포트폴리오</h1>
                <p>내 계좌의 기록을 모아, 투자 흐름을 살펴보세요.</p>
            </div>
            <div class="portfolio-actions">
                <Button
                    label="CSV 내보내기"
                    icon="pi pi-download"
                    severity="secondary"
                    outlined
                    :disabled="
                        busy ||
                        accountsState !== 'ready' ||
                        !visibleAccounts.length
                    "
                    @click="openExport()" />
                <Button
                    label="새로고침"
                    icon="pi pi-refresh"
                    severity="secondary"
                    outlined
                    :loading="busy"
                    :disabled="accountCooldown.coolingDown.value"
                    @click="run(refresh)" /><Button
                    label="자료 업로드"
                    icon="pi pi-upload"
                    :disabled="
                        !activeAccount ||
                        !editableAccounts.some((a) => a.id === selectedAccount)
                    "
                    @click="portfolioTab = 'upload'" />
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
        <div class="portfolio-scope">
            <SelectButton
                v-model="portfolioScope"
                :options="scopeOptions"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                :disabled="busy"
                aria-label="포트폴리오 범위" /><Tag
                value="업로드 자료 기준"
                severity="secondary" />
        </div>
        <Tabs v-model:value="portfolioTab" class="portfolio-tabs"
            ><TabList
                ><Tab value="overview">한눈에 보기</Tab
                ><Tab value="calendar">배당 캘린더</Tab
                ><Tab value="insights">배당 분석</Tab
                ><Tab value="accounts">계좌 관리</Tab
                ><Tab value="upload">자료 업로드</Tab
                ><Tab value="family">가족 관리</Tab></TabList
            ><TabPanels
                ><TabPanel value="overview"
                    ><div
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
                            @click="portfolioTab = 'accounts'" /><small
                            class="studio-muted"
                            >계좌 등록 → 자료 업로드 → 검토 후 저장</small
                        >
                    </div>
                    <PortfolioValuation
                        v-if="
                            portfolioTab === 'overview' &&
                            accountsState === 'ready' &&
                            summary &&
                            visibleAccounts.length
                        "
                        :key="`${ownUid}:${familyId}:${portfolioScope}`"
                        :positions="summary.positions"
                        :accounts="visibleAccounts"
                        :missing-accounts="
                            summary.missingSnapshotAccounts.length
                        "
                        :estimated-positions="
                            summary.positions.filter(
                                (row) => row.calculationMode === 'estimated'
                            ).length
                        "
                        @request-transactions="openTransactionsUpload" />
                    <div
                        v-if="
                            summary &&
                            Object.keys(summary.knownValueByCurrency).length
                        "
                        class="portfolio-value-grid"
                        aria-label="통화별 자료상 보유 평가액">
                        <Card
                            v-for="(
                                value, currency
                            ) in summary.knownValueByCurrency"
                            :key="currency"
                            class="portfolio-value-card"
                            ><template #content
                                ><div class="value-card-heading">
                                    <span>자료상 보유 평가액</span
                                    ><Tag
                                        :value="currency"
                                        severity="secondary" />
                                </div>
                                <strong
                                    >{{ num(value) }}
                                    <small>{{ currency }}</small></strong
                                >
                                <p>
                                    자료 기준일
                                    {{ summary.oldestAsOf || '미확인'
                                    }}{{
                                        summary.mixedDates
                                            ? ` ~ ${summary.newestAsOf}`
                                            : ''
                                    }}
                                </p>
                                <span class="value-card-note">{{
                                    summary.valueComplete
                                        ? '확인된 잔고 자료 기준'
                                        : '일부 평가액 미확인 · 확인된 금액만 포함'
                                }}</span></template
                            ></Card
                        >
                    </div>
                    <Panel
                        v-if="space"
                        header="원금 회수 · 자금 상세"
                        toggleable
                        v-model:collapsed="capitalCollapsed"
                        :pt="{ contentWrapper: { style: { minWidth: '0' } } }"
                        class="capital-details">
                        <template
                            v-if="
                                !capitalCollapsed && portfolioTab === 'overview'
                            ">
                            <AccountRecoveryOverview
                                :user="firebaseUser"
                                :accounts="visibleAccounts"
                                :refresh-account-id="
                                    capitalLoading || capitalError
                                        ? ''
                                        : selectedAccount
                                "
                                :refresh-state="capital" />
                            <section
                                v-if="activeAccount"
                                aria-label="회수 현황 계좌 선택">
                                <label
                                    >회수 현황을 볼 계좌
                                    <Select
                                        v-model="selectedAccount"
                                        :disabled="busy"
                                        :options="
                                            visibleAccounts.map((a) => ({
                                                label: `${ownerName(a.ownerId)} / ${a.alias}`,
                                                value: a.id,
                                            }))
                                        "
                                        option-label="label"
                                        option-value="value"
                                        aria-label="계좌"
                                        placeholder="선택" />
                                </label>
                                <p>선택한 계좌의 전체 저장 내역 기준입니다.</p>
                            </section>
                            <PortfolioCapitalPanel
                                v-if="activeAccount"
                                :key="`${ownUid}-${selectedAccount}`"
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
                        </template>
                    </Panel>
                    <template v-if="space">
                        <section v-if="summary">
                            <h2>
                                {{
                                    portfolioScope === 'personal'
                                        ? '내 포트폴리오 합산'
                                        : '가족 합산'
                                }}
                                · {{ visibleAccounts.length }}개 계좌
                            </h2>
                            <p>{{ summary.notice }}</p>
                            <p>
                                자료 기준일:
                                {{ summary.oldestAsOf || '미확인' }} ~
                                {{ summary.newestAsOf || '미확인' }}
                            </p>
                            <p v-if="summary.mixedDates" class="warning">
                                계좌별 자료 기준일이 다릅니다. 일부 계좌만
                                갱신되었습니다.
                            </p>
                            <p
                                v-if="summary.missingSnapshotAccounts.length"
                                class="warning">
                                계산 대기 또는 확인 필요 계좌
                                {{ summary.missingSnapshotAccounts.length }}개가
                                있습니다.
                            </p>
                            <Message
                                v-if="calculationIssues.length"
                                severity="warn"
                                :closable="false">
                                <strong>추정 제외·확인 필요</strong>
                                <ul>
                                    <li
                                        v-for="issue in calculationIssues"
                                        :key="`${issue.accountId}:${issue.symbol}:${issue.reason}`">
                                        {{ label(issue.accountId) }} ·
                                        {{ issue.symbol }} · {{ issue.reason }}
                                    </li>
                                </ul>
                            </Message>
                            <p v-if="!summary.valueComplete" class="warning">
                                미확인 평가액이 있어 합계는 확인된 금액만
                                포함합니다.
                            </p>
                            <p
                                v-for="(
                                    amount, currency
                                ) in summary.knownValueByCurrency"
                                :key="currency">
                                확인된 자료 평가액: {{ num(amount) }}
                                {{ currency }}
                            </p>
                            <label
                                >명의자
                                <Select
                                    v-model="ownerFilter"
                                    :options="[
                                        { label: '전체', value: '' },
                                        ...profiles.map((p) => ({
                                            label: p.name,
                                            value: p.id,
                                        })),
                                    ]"
                                    option-label="label"
                                    option-value="value"
                                    aria-label="명의자"
                                    placeholder="선택" /></label
                            ><label v-if="format !== 'toss-pdf'"
                                >계좌
                                <Select
                                    v-model="accountFilter"
                                    :options="[
                                        { label: '전체', value: '' },
                                        ...visibleAccounts.map((a) => ({
                                            label: a.alias,
                                            value: a.id,
                                        })),
                                    ]"
                                    option-label="label"
                                    option-value="value"
                                    aria-label="계좌"
                                    placeholder="선택" /></label
                            ><label v-if="format !== 'toss-pdf'"
                                >종목 검색 <InputText v-model="symbolFilter"
                            /></label>
                            <h3>명의자·계좌별 잔고</h3>
                            <DataTable
                                :value="positions"
                                striped-rows
                                paginator
                                :rows="10"
                                :page-link-size="3"
                                paginator-template="PrevPageLink PageLinks NextPageLink"
                                scrollable
                                table-style="min-width: 640px"
                                :table-props="{
                                    'aria-label': '명의자·계좌별 잔고',
                                }"
                                ><Column header="명의자"
                                    ><template #body="{ data }">{{
                                        ownerName(data.ownerId)
                                    }}</template></Column
                                ><Column header="계좌"
                                    ><template #body="{ data }">{{
                                        label(data.accountId)
                                    }}</template></Column
                                ><Column field="symbol" header="종목" /><Column
                                    header="수량"
                                    ><template #body="{ data }">{{
                                        num(data.quantity)
                                    }}</template></Column
                                ><Column header="자료 평가액"
                                    ><template #body="{ data }"
                                        >{{ num(data.amount) }}
                                        {{ data.currency }}</template
                                    ></Column
                                ><Column header="기준일·출처"
                                    ><template #body="{ data }"
                                        >{{ data.asOf }} · {{ data.source
                                        }}<Tag
                                            v-if="data.estimated"
                                            value="추정"
                                            severity="warn" /></template></Column
                                ><template #empty
                                    >확인 가능한 잔고가 없습니다. 계좌 자료를
                                    업로드해 주세요.</template
                                ></DataTable
                            >
                            <h3>종목별 합산</h3>
                            <p class="studio-muted">
                                선택 범위의 자료 기준일이 서로 다를 수 있습니다.
                            </p>
                            <DataTable
                                :value="symbols"
                                striped-rows
                                :table-props="{ 'aria-label': '종목별 합산' }"
                                ><Column header="종목·통화"
                                    ><template #body="{ data }"
                                        >{{ data.symbol }} ·
                                        {{ data.currency }}</template
                                    ></Column
                                ><Column header="합산 수량"
                                    ><template #body="{ data }">{{
                                        num(data.quantity)
                                    }}</template></Column
                                ><Column header="확인된 평가액"
                                    ><template #body="{ data }"
                                        >{{ num(data.amount) }}
                                        {{
                                            data.complete ? '' : '(일부 미확인)'
                                        }}</template
                                    ></Column
                                ><template #empty
                                    >합산할 종목이 없습니다.</template
                                ></DataTable
                            >
                        </section>
                    </template></TabPanel
                ><TabPanel value="calendar">
                    <PortfolioDividendCalendar
                        v-if="
                            portfolioTab === 'calendar' &&
                            accountsState === 'ready' &&
                            !busy
                        "
                        :accounts="visibleAccounts"
                        :positions="summary?.positions || []"
                        :family-id="familyId" />
                    <p v-else-if="accountsState === 'loading'" role="status">
                        계좌 자료를 확인하고 있습니다.
                    </p> </TabPanel
                ><TabPanel value="insights">
                    <PortfolioInsights
                        v-if="
                            portfolioTab === 'insights' &&
                            accountsState === 'ready' &&
                            !busy
                        "
                        :key="`${ownUid}:${familyId}:${portfolioScope}`"
                        :accounts="visibleAccounts"
                        :positions="summary?.positions || []"
                        :family-id="familyId" />
                    <p v-else-if="accountsState === 'loading'" role="status">
                        계좌 자료를 확인하고 있습니다.
                    </p> </TabPanel
                ><TabPanel value="accounts">
                    <section
                        v-if="accountsState === 'ready' || accounts.length">
                        <h2>
                            {{
                                portfolioScope === 'personal'
                                    ? '내 계좌 등록'
                                    : '계좌 등록'
                            }}
                        </h2>
                        <p>
                            여러 금융기관의 본인 계좌를 등록할 수 있습니다. 전체
                            계좌번호는 입력하지 마세요.
                        </p>
                        <form @submit.prevent="createAccount">
                            <p v-if="portfolioScope === 'personal'">
                                명의자:
                                {{
                                    selfProfile?.name ||
                                    firebaseUser?.displayName ||
                                    '본인'
                                }}
                            </p>
                            <label v-else
                                >명의자
                                <Select
                                    v-model="accountForm.ownerId"
                                    aria-required="true"
                                    :options="
                                        ownProfiles.map((p) => ({
                                            label: p.name,
                                            value: p.id,
                                        }))
                                    "
                                    option-label="label"
                                    option-value="value"
                                    aria-label="명의자"
                                    placeholder="선택"
                            /></label>
                            <label
                                >금융기관
                                <InputText
                                    v-model="accountForm.institution"
                                    required
                                    maxlength="100"
                                    placeholder="예: 토스증권"
                            /></label>
                            <label
                                >유형
                                <Select
                                    v-model="accountForm.type"
                                    :options="accountTypeOptions"
                                    option-label="label"
                                    option-value="value"
                                    aria-label="유형"
                                    placeholder="선택"
                            /></label>
                            <label
                                >별칭
                                <InputText
                                    v-model="accountForm.alias"
                                    required
                                    maxlength="100"
                            /></label>
                            <label
                                >계좌 끝 4자리 (선택)
                                <InputText
                                    v-model="accountForm.last4"
                                    maxlength="4"
                                    pattern="[0-9]{4}"
                                    inputmode="numeric"
                                    autocomplete="off"
                            /></label>
                            <Button type="submit" :disabled="busy"
                                >계좌 등록</Button
                            >
                        </form>
                        <ul>
                            <li v-for="a in visibleAccounts" :key="a.id">
                                <Button
                                    type="submit"
                                    :disabled="busy"
                                    severity="secondary"
                                    outlined
                                    @click="selectedAccount = a.id">
                                    {{ ownerName(a.ownerId) }} ·
                                    {{ a.institution }} · {{ a.alias }} ·
                                    {{ a.type }} · {{ a.maskedNumber }}
                                </Button>
                                · 자료 기준일 {{ a.asOf || '미확인' }} ·
                                {{ a.source }}
                                <Tag
                                    v-if="a.legacyMigration"
                                    severity="success"
                                    value="이전 완료" />
                            </li>
                        </ul>
                        <p
                            v-if="
                                accountsState === 'ready' &&
                                !visibleAccounts.length
                            ">
                            등록된 계좌가 없습니다. 위에서 본인 계좌를
                            추가하세요. 가족 계좌는 가족 포트폴리오에서 확인할
                            수 있습니다.
                        </p>
                    </section>
                    <template v-if="space">
                        <section v-if="activeAccount">
                            <h2>선택 계좌: {{ activeAccount.alias }}</h2>
                            <label
                                >계좌
                                <Select
                                    v-model="selectedAccount"
                                    :disabled="busy"
                                    :options="
                                        visibleAccounts.map((a) => ({
                                            label: `${ownerName(a.ownerId)} / ${a.alias}`,
                                            value: a.id,
                                        }))
                                    "
                                    option-label="label"
                                    option-value="value"
                                    aria-label="계좌"
                                    placeholder="선택"
                            /></label>
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
                                            v-model="activeAccount.alias"
                                            required
                                            maxlength="100" /></label
                                    ><Button type="submit" :disabled="busy"
                                        >별칭 저장</Button
                                    >
                                </form>
                                <details class="sharing-options">
                                    <summary>가족에게 계좌 공유 (선택)</summary>
                                    <h3>계좌별 공유 권한</h3>
                                    <p>
                                        가족 관리자에게 자동 공유되지 않습니다.
                                        편집자는 업로드할 수 있습니다.
                                    </p>
                                    <ul>
                                        <li
                                            v-for="(
                                                role, uid
                                            ) in activeAccount.permissions"
                                            :key="uid">
                                            {{
                                                profiles.find(
                                                    (p) => p.uid === uid
                                                )?.name || uid
                                            }}: {{ role }}
                                        </li>
                                    </ul>
                                    <form
                                        @submit.prevent="
                                            mutate('grant', {
                                                accountId: selectedAccount,
                                                uid: shareUid,
                                                role: shareRole,
                                            })
                                        ">
                                        <label
                                            >성인 구성원
                                            <Select
                                                v-model="shareUid"
                                                aria-required="true"
                                                :options="
                                                    otherAdults.map((p) => ({
                                                        label: p.name,
                                                        value: p.uid,
                                                    }))
                                                "
                                                option-label="label"
                                                option-value="value"
                                                aria-label="성인 구성원"
                                                placeholder="선택" /></label
                                        ><label
                                            >권한
                                            <Select
                                                v-model="shareRole"
                                                :options="roleOptions"
                                                option-label="label"
                                                option-value="value"
                                                aria-label="권한"
                                                placeholder="선택" /></label
                                        ><Button type="submit" :disabled="busy"
                                            >권한 저장</Button
                                        >
                                    </form>
                                </details>
                                <details v-if="!activeAccount.legacyMigration">
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
                    </template> </TabPanel
                ><TabPanel value="upload"
                    ><PortfolioImportResult
                        v-if="importReceipt"
                        ref="importResult"
                        :receipt="importReceipt"
                        :busy="busy"
                        :accounts-state="accountsState"
                        :latest-holdings-date="
                            activeAccount?.snapshot?.asOf || ''
                        "
                        @view="viewImported"
                        @export="openExport(importReceipt.kind)"
                        @calendar="portfolioTab = 'calendar'"
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
                        >편집 가능한 계좌를 먼저 선택해 주세요. 계좌 관리에서
                        계좌를 등록하거나 변경할 수 있습니다.</Message
                    >
                    <div
                        v-if="
                            !importReceipt &&
                            activeAccount &&
                            editableAccounts.some(
                                (a) => a.id === selectedAccount
                            )
                        "
                        class="import-workspace">
                        <div v-if="!review" class="import-heading">
                            <div>
                                <h2 ref="importHeading" tabindex="-1">
                                    자료 입력 · 저장 전 검토
                                </h2>
                                <p>
                                    거래내역과 잔고 파일을 불러오고,
                                    포트폴리오에 저장하기 전 내용을 확인하세요.
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
                                <div
                                    v-if="
                                        review.source === 'manual-holdings-v1'
                                    ">
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
                                        :before="
                                            activeAccount.snapshot?.rows || []
                                        "
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
                    </div> </TabPanel
                ><TabPanel value="family">
                    <div class="family-options">
                        <Message severity="info" :closable="false"
                            >가족 참여와 계좌 공유는 별도입니다. 가족 관리자에게
                            계좌가 자동 공유되지 않습니다.</Message
                        >
                        <section>
                            <h2>가족 공간 만들기 / 참여</h2>
                            <label
                                >내 프로필 이름
                                <InputText v-model="myName" maxlength="100"
                            /></label>
                            <form @submit.prevent="createFamily">
                                <label
                                    >가족 이름
                                    <InputText
                                        v-model="newFamily"
                                        required
                                        maxlength="100" /></label
                                ><Button type="submit" :disabled="busy"
                                    >공간 만들기</Button
                                >
                            </form>
                            <form @submit.prevent="join">
                                <label
                                    >초대 코드
                                    <InputText
                                        v-model="joinToken"
                                        required
                                        autocomplete="off" /></label
                                ><Button type="submit" :disabled="busy"
                                    >본인 계정으로 참여</Button
                                >
                            </form>
                        </section>
                        <section v-if="space">
                            <h2>가족·구성원 관리</h2>
                            <label
                                >가족 공간
                                <Select
                                    v-model="familyId"
                                    :disabled="busy"
                                    :options="
                                        families.map((f) => ({
                                            label: f.name,
                                            value: f.id,
                                        }))
                                    "
                                    option-label="label"
                                    option-value="value"
                                    aria-label="가족 공간"
                                    placeholder="선택"
                            /></label>
                            <form
                                v-if="space.adminUid === ownUid"
                                @submit.prevent="
                                    mutate('renameFamily', { name: space.name })
                                ">
                                <label
                                    >공간 이름
                                    <InputText
                                        v-model="space.name"
                                        required
                                        maxlength="100" /></label
                                ><Button type="submit" :disabled="busy"
                                    >이름 저장</Button
                                >
                            </form>
                            <ul>
                                <li v-for="p in profiles" :key="p.id">
                                    {{ p.name }} ·
                                    {{
                                        p.kind === 'minor'
                                            ? '미성년 · 보호자 관리'
                                            : '성인 · 본인 참여'
                                    }}
                                    <form
                                        v-if="
                                            ownProfiles.some(
                                                (o) => o.id === p.id
                                            )
                                        "
                                        @submit.prevent="
                                            mutate('renameProfile', {
                                                profileId: p.id,
                                                name: p.name,
                                            })
                                        ">
                                        <label
                                            >프로필 이름
                                            <InputText
                                                v-model="p.name"
                                                required /></label
                                        ><Button type="submit" :disabled="busy"
                                            >수정</Button
                                        >
                                    </form>
                                </li>
                            </ul>
                            <Button
                                type="submit"
                                v-if="space.adminUid === ownUid"
                                :disabled="busy"
                                @click="mutate('invite', {})">
                                성인 초대 코드 발급
                            </Button>
                            <p v-if="invitation">
                                48시간 · 1회용 코드 (직접 전달):
                                <code>{{ invitation }}</code>
                            </p>
                            <form
                                @submit.prevent="
                                    mutate('addMinor', {
                                        name: childName,
                                        guardianAttestation: guardian,
                                    })
                                ">
                                <label
                                    >자녀 이름
                                    <InputText
                                        v-model="childName"
                                        required
                                        maxlength="100" /></label
                                ><label
                                    ><input
                                        v-model="guardian"
                                        type="checkbox"
                                        required />
                                    법정 보호자로 관리할 권한이 있습니다</label
                                ><Button type="submit" :disabled="busy"
                                    >미성년 프로필 추가</Button
                                >
                            </form>
                        </section>
                    </div>
                </TabPanel></TabPanels
            ></Tabs
        >
        <PortfolioExportDialog
            v-model:visible="exportVisible"
            :accounts="visibleAccounts"
            :family-id="familyId"
            :initial-account-id="selectedAccount"
            :initial-kind="exportKind" />
    </PortfolioLoadingRegion>
</template>

<style scoped>
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
    .portfolio-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
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
    .portfolio-tabs section {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        padding: 24px;
        margin-bottom: 24px;
        background: var(--app-surface);
        min-width: 0;
    }
    .portfolio-tabs section section {
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
        .portfolio-actions > .p-button {
            flex: 1 1 0;
            min-width: 0;
            flex-direction: column;
            gap: 8px;
            padding: 12px 8px;
        }
        .portfolio-actions :deep(.p-button-label) {
            flex: 0 1 auto;
            word-break: keep-all;
            white-space: normal;
        }
        .portfolio-tabs :deep(.p-tablist) {
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
</style>
