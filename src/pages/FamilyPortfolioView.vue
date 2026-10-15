<script setup>
    import { computed, nextTick, ref, watch } from 'vue';
    import AccountRecoveryOverview from '@/components/portfolio/AccountRecoveryOverview.vue';
    import PortfolioCapitalPanel from '@/components/portfolio/PortfolioCapitalPanel.vue';
    import PurchaseFundingEditor from '@/components/portfolio/PurchaseFundingEditor.vue';
    import { portfolioCapitalRequest } from '@/services/portfolioCapital.js';
    import { useRouter } from 'vue-router';
    import { authLoading, firebaseUser } from '@/services/firebaseClient';
    import { familyRequest } from '@/services/familyPortfolio';

    const router = useRouter();
    const families = ref([]),
        familyId = ref(''),
        accounts = ref([]),
        summary = ref(null);
    const busy = ref(false),
        error = ref(''),
        message = ref(''),
        invitation = ref('');
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
    const capital = ref({ entries: [], classifications: [], allocations: [] });
    const capitalLoading = ref(false),
        capitalError = ref(''),
        fundingEntry = ref(null),
        fundingDialog = ref(null),
        fundingMessage = ref('');
    let capitalGeneration = 0,
        capitalScope = '';
    async function loadCapital() {
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
        if (!user || !accountId) {
            capitalLoading.value = false;
            return;
        }
        capitalLoading.value = true;
        try {
            const state = await portfolioCapitalRequest(
                user,
                undefined,
                accountId
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
        [selectedAccount, firebaseUser],
        () => {
            fundingEntry.value = null;
            fundingDialog.value?.close();
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
        fundingDialog.value?.showModal();
    }
    async function fundingSaved() {
        await loadCapital();
        fundingMessage.value = capitalError.value
            ? ''
            : '자금 구성을 저장했습니다.';
    }
    const fileInput = ref(null),
        password = ref(''),
        confirmed = ref(false),
        review = ref(null);
    const accountFilter = ref(''),
        ownerFilter = ref(''),
        symbolFilter = ref(''),
        entries = ref([]),
        nextCursor = ref(null),
        legacy = ref(false);
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
    const activeAccount = computed(() =>
        accounts.value.find((a) => a.id === selectedAccount.value)
    );
    const editableAccounts = computed(() =>
        accounts.value.filter((a) =>
            ['owner', 'editor'].includes(a.permissions[firebaseUser.value?.uid])
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
    async function run(work) {
        if (busy.value) return;
        busy.value = true;
        error.value = '';
        message.value = '';
        try {
            await work();
        } catch (e) {
            error.value = e.message;
        } finally {
            busy.value = false;
        }
    }
    async function refresh() {
        const requestedUid = firebaseUser.value?.uid;
        let data = await familyRequest(
            '',
            undefined,
            familyId.value ? { familyId: familyId.value } : {}
        );
        if (firebaseUser.value?.uid !== requestedUid) return;
        if (!familyId.value && data.families.length) {
            familyId.value = data.families[0].id;
            data = await familyRequest('', undefined, {
                familyId: familyId.value,
            });
            if (firebaseUser.value?.uid !== requestedUid) return;
        }
        families.value = data.families;
        accounts.value = data.accounts || [];
        summary.value = data.summary || null;
        if (!familyId.value && families.value.length)
            familyId.value = families.value[0].id;
        if (!accounts.value.some((a) => a.id === selectedAccount.value))
            selectedAccount.value = accounts.value[0]?.id || '';
        await loadCapital();
    }
    watch(
        [firebaseUser, authLoading],
        ([user, waiting]) => {
            // Clear private state when the authenticated identity changes.
            families.value = [];
            accounts.value = [];
            summary.value = null;
            entries.value = [];
            review.value = null;
            familyId.value = '';
            selectedAccount.value = '';
            invitation.value = '';
            password.value = '';
            if (waiting) return;
            if (!user) router.replace('/login');
            else run(refresh);
        },
        { immediate: true }
    );
    watch(familyId, () => {
        accounts.value = [];
        summary.value = null;
        invitation.value = '';
        nextCursor.value = null;
        review.value = null;
        entries.value = [];
        accountFilter.value = '';
        ownerFilter.value = '';
        run(refresh);
    });
    watch(selectedAccount, () => {
        review.value = null;
        entries.value = [];
        confirmed.value = false;
        singleAccountConfirmed.value = false;
        nextCursor.value = null;
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
        await run(async () => {
            const a = activeAccount.value;
            const file = fileInput.value?.files?.[0];
            if (!a || !file) throw new Error('계좌와 파일을 선택하세요.');
            if (!confirmed.value)
                throw new Error('명의자·금융기관·계좌를 확인하세요.');
            if (file.size > 2 * 1024 * 1024)
                throw new Error('2MB 이하 파일을 선택하세요.');
            const form = new FormData();
            Object.entries({
                accountId: a.id,
                ownerId: a.ownerId,
                institution: a.institution,
                kind: kind.value,
                asOf: asOf.value,
                format: format.value,
                identityConfirmed: 'true',
                password: password.value,
            }).forEach(([key, value]) => form.append(key, value));
            form.append('file', file);
            const result = await familyRequest('preview', form);
            if (selectedAccount.value === a.id)
                review.value = { ...result, accountId: a.id };
            password.value = '';
            fileInput.value.value = '';
        });
    }
    async function commit() {
        await run(async () => {
            const result = await familyRequest('commit', {
                accountId: review.value.accountId,
                reviewId: review.value.reviewId,
                rows: review.value.rows,
            });
            review.value = null;
            message.value = `저장 ${result.inserted}행 · 중복 ${result.duplicates}행`;
            await refresh();
        });
    }
    watch(legacy, () => {
        entries.value = [];
        nextCursor.value = null;
    });
    async function loadEntries(more = false) {
        await run(async () => {
            const result = await familyRequest('', undefined, {
                accountId: selectedAccount.value,
                legacy: String(legacy.value),
                ...(more && nextCursor.value
                    ? { cursor: nextCursor.value }
                    : {}),
            });
            entries.value = more
                ? [...entries.value, ...result.entries]
                : result.entries;
            nextCursor.value = result.nextCursor;
        });
    }
</script>

<template>
    <div class="family-page">
        <header>
            <h1>가족 포트폴리오</h1>
            <p>
                가족 공간 참여와 계좌 공유 권한은 별개입니다. 허용받은 계좌만
                조회합니다.
            </p>
            <router-link to="/mypage/legacy"
                >이전 단일 계좌 자료 보기</router-link
            >
            <button :disabled="busy" @click="run(refresh)">새로고침</button>
        </header>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <p v-if="message" role="status">{{ message }}</p>
        <p v-if="busy" role="status">처리 중…</p>
        <section>
            <h2>가족 공간 만들기 / 참여</h2>
            <label
                >내 프로필 이름 <input v-model="myName" maxlength="100"
            /></label>
            <form @submit.prevent="createFamily">
                <label
                    >가족 이름
                    <input
                        v-model="newFamily"
                        required
                        maxlength="100" /></label
                ><button :disabled="busy">공간 만들기</button>
            </form>
            <form @submit.prevent="join">
                <label
                    >초대 코드
                    <input
                        v-model="joinToken"
                        required
                        autocomplete="off" /></label
                ><button :disabled="busy">본인 계정으로 참여</button>
            </form>
        </section>
        <template v-if="space">
            <AccountRecoveryOverview
                :user="firebaseUser"
                :accounts="accounts"
                :refresh-state="capital" />
            <section v-if="activeAccount" aria-label="회수 현황 계좌 선택">
                <label
                    >회수 현황을 볼 계좌
                    <select v-model="selectedAccount" :disabled="busy">
                        <option v-for="a in accounts" :key="a.id" :value="a.id">
                            {{ ownerName(a.ownerId) }} / {{ a.alias }}
                        </option>
                    </select>
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
                    !editableAccounts.some((a) => a.id === selectedAccount)
                "
                @refresh="loadCapital" />

            <section>
                <h2>가족·구성원 관리</h2>
                <label
                    >가족 공간
                    <select v-model="familyId" :disabled="busy">
                        <option v-for="f in families" :key="f.id" :value="f.id">
                            {{ f.name }}
                        </option>
                    </select></label
                >
                <form
                    v-if="space.adminUid === ownUid"
                    @submit.prevent="
                        mutate('renameFamily', { name: space.name })
                    ">
                    <label
                        >공간 이름
                        <input
                            v-model="space.name"
                            required
                            maxlength="100" /></label
                    ><button :disabled="busy">이름 저장</button>
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
                            v-if="ownProfiles.some((o) => o.id === p.id)"
                            @submit.prevent="
                                mutate('renameProfile', {
                                    profileId: p.id,
                                    name: p.name,
                                })
                            ">
                            <label
                                >프로필 이름
                                <input v-model="p.name" required /></label
                            ><button :disabled="busy">수정</button>
                        </form>
                    </li>
                </ul>
                <button
                    v-if="space.adminUid === ownUid"
                    :disabled="busy"
                    @click="mutate('invite', {})">
                    성인 초대 코드 발급
                </button>
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
                        <input
                            v-model="childName"
                            required
                            maxlength="100" /></label
                    ><label
                        ><input v-model="guardian" type="checkbox" required />
                        법정 보호자로 관리할 권한이 있습니다</label
                    ><button :disabled="busy">미성년 프로필 추가</button>
                </form>
            </section>
            <section>
                <h2>계좌 등록</h2>
                <p>
                    성인은 본인 계좌, 보호자는 자녀 계좌를 등록합니다. 전체
                    계좌번호는 입력하지 마세요.
                </p>
                <form @submit.prevent="createAccount">
                    <label
                        >명의자
                        <select v-model="accountForm.ownerId" required>
                            <option value="">선택</option>
                            <option
                                v-for="p in ownProfiles"
                                :key="p.id"
                                :value="p.id">
                                {{ p.name }}
                            </option>
                        </select></label
                    >
                    <label
                        >금융기관
                        <input
                            v-model="accountForm.institution"
                            required
                            maxlength="100"
                            placeholder="예: 토스증권"
                    /></label>
                    <label
                        >유형
                        <select v-model="accountForm.type">
                            <option value="general">일반</option>
                            <option value="isa">ISA</option>
                            <option value="pension">연금</option>
                            <option value="other">기타</option>
                        </select></label
                    >
                    <label
                        >별칭
                        <input
                            v-model="accountForm.alias"
                            required
                            maxlength="100"
                    /></label>
                    <label
                        >계좌 끝 4자리 (선택)
                        <input
                            v-model="accountForm.last4"
                            maxlength="4"
                            pattern="[0-9]{4}"
                            inputmode="numeric"
                            autocomplete="off"
                    /></label>
                    <button :disabled="busy">계좌 등록</button>
                </form>
                <ul>
                    <li v-for="a in accounts" :key="a.id">
                        <button
                            :disabled="busy"
                            @click="selectedAccount = a.id">
                            {{ ownerName(a.ownerId) }} · {{ a.institution }} ·
                            {{ a.alias }} · {{ a.type }} · {{ a.maskedNumber }}
                        </button>
                        · 자료 기준일 {{ a.asOf || '미확인' }} · {{ a.source }}
                    </li>
                </ul>
                <p v-if="!accounts.length">
                    접근 가능한 계좌가 없습니다. 등록하거나 명의자에게 공유를
                    요청하세요.
                </p>
            </section>
            <section v-if="activeAccount">
                <h2>선택 계좌: {{ activeAccount.alias }}</h2>
                <label
                    >계좌
                    <select v-model="selectedAccount" :disabled="busy">
                        <option v-for="a in accounts" :key="a.id" :value="a.id">
                            {{ ownerName(a.ownerId) }} / {{ a.institution }} /
                            {{ a.alias }} / {{ a.maskedNumber }}
                        </option>
                    </select></label
                >
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
                            <input
                                v-model="activeAccount.alias"
                                required
                                maxlength="100" /></label
                        ><button :disabled="busy">별칭 저장</button>
                    </form>
                    <h3>계좌별 공유 권한</h3>
                    <p>
                        가족 관리자에게 자동 공유되지 않습니다. 편집자는
                        업로드할 수 있습니다.
                    </p>
                    <ul>
                        <li
                            v-for="(role, uid) in activeAccount.permissions"
                            :key="uid">
                            {{
                                profiles.find((p) => p.uid === uid)?.name ||
                                uid
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
                            <select v-model="shareUid" required>
                                <option value="">선택</option>
                                <option
                                    v-for="p in otherAdults"
                                    :key="p.id"
                                    :value="p.uid">
                                    {{ p.name }}
                                </option>
                            </select></label
                        ><label
                            >권한
                            <select v-model="shareRole">
                                <option value="viewer">조회</option>
                                <option value="editor">조회·업로드</option>
                                <option value="none">공유 취소</option>
                            </select></label
                        ><button :disabled="busy">권한 저장</button>
                    </form>
                    <details>
                        <summary>이전 단일 계좌 데이터 보존 이전</summary>
                        <p>
                            본인 portfolios 원장을 별도 보관 복사합니다. 기존
                            데이터는 유지하며, 기준일 불명 잔고는 합산하지
                            않습니다. 다른 이전 저장소는 자동 합치지 않습니다.
                        </p>
                        <label
                            ><input
                                v-model="singleAccountConfirmed"
                                type="checkbox" />
                            원본이 선택한 본인 계좌 한 개의 자료임을
                            확인했습니다</label
                        ><button
                            :disabled="busy || !singleAccountConfirmed"
                            @click="
                                mutate('migrateLegacy', {
                                    accountId: selectedAccount,
                                    confirmedSingleAccount:
                                        singleAccountConfirmed,
                                })
                            ">
                            자료 없는 계좌로 보존 이전
                        </button>
                    </details>
                </template>
                <p v-if="activeAccount.legacyMigration">
                    이전 자료:
                    {{ activeAccount.legacyMigration.transactions }}건 · 잔고
                    기준일 확인 필요
                </p>
                <h3>거래 원장</h3>
                <label
                    ><input v-model="legacy" type="checkbox" /> 보존 이전
                    원장</label
                ><button :disabled="busy" @click="loadEntries(false)">
                    조회
                </button>
                <button
                    v-if="nextCursor"
                    :disabled="busy"
                    @click="loadEntries(true)">
                    다음 200건 조회
                </button>
                <div class="scroll">
                    <table v-if="entries.length">
                        <thead>
                            <tr>
                                <th>기준일·출처</th>
                                <th>거래 내용</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="entry in entries" :key="entry.id">
                                <td>
                                    {{ entry.asOf || '미확인' }} ·
                                    {{ entry.source || 'legacy' }}
                                </td>
                                <td>
                                    <pre>{{ entry.row || entry }}</pre>
                                    <button
                                        v-if="
                                            !legacy && entry.row?.type === 'buy'
                                        "
                                        type="button"
                                        @click="openFunding(entry)">
                                        자금 구성 확인
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
            <dialog
                ref="fundingDialog"
                aria-label="계좌 매수 자금 상세"
                class="funding-dialog">
                <template v-if="fundingEntry && activeAccount">
                    <div class="funding-title">
                        <h2>
                            {{ activeAccount.alias }} ·
                            {{ fundingEntry.symbol }} · {{ fundingEntry.date }}
                        </h2>
                        <button type="button" @click="fundingDialog.close()">
                            상세 창 닫기
                        </button>
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
                        @close="fundingDialog.close()" />
                </template>
            </dialog>
            <section
                v-if="
                    activeAccount &&
                    editableAccounts.some((a) => a.id === selectedAccount)
                ">
                <h2>파일 업로드·저장 전 검토</h2>
                <p>
                    표준 UTF-8 CSV와 토스 거래내역 PDF를 지원합니다. 2MB·200행
                    이하. 잔고 CSV는 기준일의 전체 보유 종목을 넣으세요. 새
                    잔고는 해당 계좌의 이전 잔고를 대체합니다.
                </p>
                <details>
                    <summary>CSV 양식과 거래 유형</summary>
                    <p>
                        잔고 amount는 기준일 평가액이며 모르면 비워둡니다. 거래
                        amount는 거래 금액입니다. 현금 종목은 CASH를 사용하세요.
                        거래 고유번호 externalId는 같은 계좌에서
                        재업로드·조회기간 변경에도 같아야 합니다. 매수 자금
                        배분에는 수수료 포함 정산액이 필요합니다. CSV에
                        nativeSettlementAmount(USD) 또는 settlementAmount(KRW)를
                        추가할 수 있습니다. 현금 CASH 행의 cashKind가
                        exchange이면 계좌 내 환전 후보로 분류합니다.
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
                </details>
                <form @submit.prevent="preview">
                    <label
                        >자료 종류
                        <select v-model="kind">
                            <option value="transactions">거래내역</option>
                            <option value="holdings">잔고내역</option>
                        </select></label
                    ><label
                        >파일 형식
                        <select v-model="format">
                            <option value="standard-csv">표준 CSV</option>
                            <option value="toss-pdf">토스 거래내역 PDF</option>
                        </select></label
                    ><label
                        >자료 기준일
                        <input v-model="asOf" type="date" required /></label
                    ><label
                        >파일
                        <input
                            ref="fileInput"
                            type="file"
                            :accept="format === 'toss-pdf' ? '.pdf' : '.csv'"
                            required /></label
                    ><label v-if="format === 'toss-pdf'"
                        >PDF 비밀번호
                        <input
                            v-model="password"
                            type="password"
                            autocomplete="off" /></label
                    ><label
                        ><input v-model="confirmed" type="checkbox" required />
                        {{ ownerName(activeAccount.ownerId) }} ·
                        {{ activeAccount.institution }} ·
                        {{ activeAccount.alias }} ·
                        {{ activeAccount.maskedNumber }}의 자료임을
                        확인했습니다. 파일에서 확실히 확인할 수 없으면 저장하지
                        않습니다.</label
                    ><button :disabled="busy">추출·미리보기</button>
                </form>
                <template v-if="review"
                    ><h3>검토 · {{ review.source }}</h3>
                    <p>
                        표의 오류를 수정한 뒤 전체 행을 저장합니다. 오류가
                        남으면 저장되지 않습니다. 검토는 1시간 유효합니다.
                    </p>
                    <ul class="error">
                        <li v-for="(e, i) in review.errors" :key="i">
                            행 {{ e.row }}: {{ e.error }}
                        </li>
                    </ul>
                    <div class="scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>행</th>
                                    <th
                                        v-for="col in [
                                            'date',
                                            'symbol',
                                            'quantity',
                                            'amount',
                                            'currency',
                                            'type',
                                            'externalId',
                                        ]"
                                        :key="col">
                                        {{ col }}
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="(row, i) in review.rows" :key="i">
                                    <td>{{ i + 1 }}</td>
                                    <td
                                        v-for="col in [
                                            'date',
                                            'symbol',
                                            'quantity',
                                            'amount',
                                            'currency',
                                            'type',
                                            'externalId',
                                        ]"
                                        :key="col">
                                        <input
                                            v-model="row[col]"
                                            :aria-label="`${i + 1}행 ${col}`" />
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <button :disabled="busy" @click="commit">
                        수정 내용 검증·저장</button
                    ><button :disabled="busy" @click="review = null">
                        취소
                    </button></template
                >
            </section>
            <section v-if="summary">
                <h2>가족 합산 · 접근 가능한 {{ accounts.length }}개 계좌</h2>
                <p>{{ summary.notice }}</p>
                <p>
                    자료 기준일: {{ summary.oldestAsOf || '미확인' }} ~
                    {{ summary.newestAsOf || '미확인' }}
                </p>
                <p v-if="summary.mixedDates" class="warning">
                    계좌별 자료 기준일이 다릅니다. 일부 계좌만 갱신되었습니다.
                </p>
                <p
                    v-if="summary.missingSnapshotAccounts.length"
                    class="warning">
                    잔고 미확인 계좌
                    {{ summary.missingSnapshotAccounts.length }}개는 합계에서
                    제외했습니다. 거래만으로 기초 보유량을 추정하지 않습니다.
                </p>
                <p v-if="!summary.valueComplete" class="warning">
                    미확인 평가액이 있어 합계는 확인된 금액만 포함합니다.
                </p>
                <p
                    v-for="(amount, currency) in summary.knownValueByCurrency"
                    :key="currency">
                    확인된 자료 평가액: {{ num(amount) }} {{ currency }}
                </p>
                <label
                    >명의자
                    <select v-model="ownerFilter">
                        <option value="">전체</option>
                        <option v-for="p in profiles" :key="p.id" :value="p.id">
                            {{ p.name }}
                        </option>
                    </select></label
                ><label
                    >계좌
                    <select v-model="accountFilter">
                        <option value="">전체</option>
                        <option v-for="a in accounts" :key="a.id" :value="a.id">
                            {{ a.alias }}
                        </option>
                    </select></label
                ><label>종목 검색 <input v-model="symbolFilter" /></label>
                <div class="scroll">
                    <table>
                        <caption>
                            명의자·계좌별 원본 잔고
                        </caption>
                        <thead>
                            <tr>
                                <th>명의자</th>
                                <th>계좌</th>
                                <th>종목</th>
                                <th>수량</th>
                                <th>자료 평가액</th>
                                <th>기준일·출처</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="p in positions"
                                :key="`${p.accountId}:${p.symbol}:${p.currency}`">
                                <td>{{ ownerName(p.ownerId) }}</td>
                                <td>{{ label(p.accountId) }}</td>
                                <td>{{ p.symbol }}</td>
                                <td>{{ num(p.quantity) }}</td>
                                <td>{{ num(p.amount) }} {{ p.currency }}</td>
                                <td>{{ p.asOf }} · {{ p.source }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div class="scroll">
                    <table>
                        <caption>
                            선택 범위의 종목별 합산 (자료 기준일이 다를 수 있음)
                        </caption>
                        <thead>
                            <tr>
                                <th>종목·통화</th>
                                <th>합산 수량</th>
                                <th>확인된 평가액</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="s in symbols"
                                :key="`${s.symbol}:${s.currency}`">
                                <td>{{ s.symbol }} · {{ s.currency }}</td>
                                <td>{{ num(s.quantity) }}</td>
                                <td>
                                    {{ num(s.amount) }}
                                    {{ s.complete ? '' : '(일부 미확인)' }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        </template>
    </div>
</template>

<style scoped>
    .funding-dialog {
        width: min(850px, calc(100vw - 24px));
        max-height: 90dvh;
        overflow-y: auto;
        border: 1px solid var(--app-border, #ddd);
        border-radius: 14px;
        padding: 16px;
        color: var(--app-text);
        background: var(--app-surface, #fff);
    }
    .funding-dialog::backdrop {
        background: rgba(0, 0, 0, 0.45);
    }
    .funding-title {
        display: flex;
        gap: 12px;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
    }
    .family-page {
        max-width: 1200px;
        margin: auto;
        padding: 24px 16px 64px;
        color: var(--app-text);
        line-height: 1.6;
    }
    .family-page,
    .family-page * {
        box-sizing: border-box;
    }
    section {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 20px;
        margin-top: 20px;
        background: var(--app-surface);
    }
    form {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 12px;
        margin: 16px 0;
    }
    label {
        max-width: calc(100% - 12px);
        min-width: 0;
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 6px;
    }
    input,
    select,
    button {
        max-width: 100%;
        font: inherit;
        border: 1px solid var(--app-border);
        border-radius: 6px;
        padding: 8px;
        color: var(--app-text);
        background: var(--app-surface);
    }
    button {
        cursor: pointer;
        margin: 4px;
    }
    button:disabled {
        opacity: 0.5;
        cursor: wait;
    }
    a {
        color: var(--app-accent);
    }
    .error {
        color: #db4545;
    }
    .warning {
        color: var(--app-muted);
    }
    .scroll {
        max-width: 100%;
        overflow: auto;
        margin: 16px 0;
    }
    table {
        border-collapse: collapse;
        width: 100%;
    }
    th,
    td {
        padding: 8px;
        border-bottom: 1px solid var(--app-border);
        text-align: left;
    }
    td input {
        min-width: 100px;
        width: 140px;
    }
    pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-width: 700px;
    }
    code {
        overflow-wrap: anywhere;
    }
    :focus-visible {
        outline: 2px solid var(--app-accent);
        outline-offset: 2px;
    }
    @media (max-width: 600px) {
        section {
            padding: 12px;
        }
        form {
            align-items: stretch;
            flex-direction: column;
        }
    }
</style>
