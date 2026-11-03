<script setup>
    import {
        computed,
        onBeforeUnmount,
        reactive,
        ref,
        shallowRef,
        watch,
    } from 'vue';
    import Select from 'primevue/select';
    import InputText from 'primevue/inputtext';
    import Button from 'primevue/button';
    import Message from 'primevue/message';
    import FifoReviewCalendar from './FifoReviewCalendar.vue';
    import { firebaseUser } from '@/services/firebaseClient.js';
    import { createSheetReportClient } from '@/services/sheetReports.js';
    import {
        calculateFifoAssets,
        validateFifoCorrection,
        applyFifoCorrections,
    } from '../../../lib/fifo-asset-report.js';
    import { loadValuationQuotes } from '@/services/portfolioValuation.js';
    import {
        normalizeReportDiagnostic,
        reportDiagnosticText,
    } from '../../../lib/report-diagnostics.js';
    const client = createSheetReportClient();
    const payload = shallowRef(null),
        busy = ref(false),
        saving = ref(false),
        error = ref(''),
        diagnostic = shallowRef(null),
        copyNotice = ref(''),
        notice = ref(''),
        quotes = shallowRef({}),
        quoteBusy = ref(false),
        scope = ref('family');
    const pendingMutation = shallowRef(null);
    let generation = 0,
        quoteGeneration = 0,
        mutationGeneration = 0;
    const kinds = [
        { value: 'OPENING_LOT', label: '과거 보유 lot · 원가 입력' },
        { value: 'BASIS', label: '기존 매수·입고 원가 보정' },
        { value: 'FX_COST', label: '실제 원화 환전 원가·수취액' },
        { value: 'EXECUTION_TIME', label: '실제 단일 체결 시각 확인' },
        { value: 'CASH_MOVEMENT', label: '외부 입출금·미분류 현금' },
        { value: 'CASH_COVERAGE', label: '외부 입출금 전체 범위 확인' },
        { value: 'CONFIRM_INTERNAL_TRANSFER', label: '가족 현금 이동 확인' },
        { value: 'SECURITY_TRANSFER', label: '같은 명의 계좌의 주식 이전' },
        { value: 'SPLIT', label: '확인된 분할·병합' },
        { value: 'CASH_IN_LIEU', label: '단주 실제 현금 처분' },
    ];
    const kindsById = Object.fromEntries(kinds.map((k) => [k.value, k.label]));
    const emptyForm = () => ({
        kind: 'OPENING_LOT',
        accountId: '',
        targetId: '',
        peerId: '',
        toAccountId: '',
        symbol: '',
        currency: 'USD',
        at: '',
        quantity: '',
        cost: '',
        amount: '',
        numerator: '',
        denominator: '',
        from: '',
        to: '',
        direction: 'deposit',
        funding: 'unknown',
        singleExecutionConfirmed: false,
        note: '',
    });
    const form = reactive(emptyForm());
    const state = computed(() => payload.value?.adjustments);
    const accounts = computed(() => payload.value?.input.accounts || []);
    const applied = computed(() => {
        if (!payload.value) return { events: [] };
        try {
            return applyFifoCorrections(
                payload.value.input.events,
                state.value.active,
                accounts.value
            );
        } catch {
            return { events: [] };
        }
    });
    const targets = computed(() =>
        applied.value.events
            .filter((e) => e.accountId === form.accountId && !e.excluded)
            .map((e) => ({
                ...e,
                label: `${e.at} · ${e.symbol || '현금'} · ${e.type} · ${e.quantity || e.amount || '미상'}`,
            }))
    );
    const peers = computed(() =>
        applied.value.events
            .filter(
                (e) =>
                    e.type === 'EXTERNAL_DEPOSIT' &&
                    e.accountId !== form.accountId
            )
            .map((e) => ({
                ...e,
                label: `${name(e.accountId)} · ${e.at} · ${e.amount} ${e.currency}`,
            }))
    );
    const targetKind = computed(() =>
        [
            'BASIS',
            'FX_COST',
            'EXECUTION_TIME',
            'CONFIRM_INTERNAL_TRANSFER',
        ].includes(form.kind)
    );
    const stockKind = computed(() =>
        ['OPENING_LOT', 'SECURITY_TRANSFER', 'SPLIT', 'CASH_IN_LIEU'].includes(
            form.kind
        )
    );
    const timingKind = computed(
        () =>
            ![
                'BASIS',
                'FX_COST',
                'CASH_COVERAGE',
                'CONFIRM_INTERNAL_TRANSFER',
            ].includes(form.kind)
    );
    const scopes = [
        { id: 'family', label: '가족 전체' },
        { id: 'wife', label: '아내' },
        { id: 'husband', label: '남편' },
    ];
    const fields = [
        ['remainingCost', '입력 범위 잔여 FIFO 취득원가'],
        ['cumulativeBuys', '기록된 누적 매수금액(비용 포함)'],
        ['realizedPnl', '입력 범위 실현손익'],
        ['unrealizedPnl', '입력 범위 평가손익'],
        ['marketValue', '입력 범위 주식 평가액'],
        ['netDividends', '누적 세후 배당'],
        ['externalDeposits', '누적 외부 투입금'],
        ['externalWithdrawals', '외부 인출'],
        ['netExternal', '외부 순투입금'],
        ['reinvestedBuys', '확인된 배당 재투자 매수'],
    ];
    const positionMetrics = new Set([
        'remainingCost',
        'cumulativeBuys',
        'realizedPnl',
        'unrealizedPnl',
        'marketValue',
        'reinvestedBuys',
    ]);
    const evidenceLabels = {
        order: '순서·시각',
        coverage: '기초·주식 이력',
        movement: '기업행사·이전',
        cost: '원통화 원가',
        fx: '원화 환산',
        conflict: '기록 충돌',
    };
    const report = computed(() => {
        if (!payload.value || payload.value.calculationError) return null;
        try {
            return calculateFifoAssets({
                ...payload.value.input,
                corrections: state.value.active,
                scope: scope.value,
                quotes: quotes.value,
                today: payload.value.today,
            });
        } catch {
            return null;
        }
    });
    const portfolioEvents = computed(() =>
        applied.value.events
            .filter((event) => {
                const account = accounts.value.find(
                    (a) => a.id === event.accountId
                );
                return (
                    !event.excluded &&
                    (scope.value === 'family' ||
                        account?.ownerId === scope.value) &&
                    ['BUY', 'SELL', 'DIVIDEND', 'TAX_REFUND'].includes(
                        event.type
                    )
                );
            })
            .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    );
    const eventLabel = (type) =>
        ({
            BUY: '매수',
            SELL: '매도',
            DIVIDEND: '배당',
            TAX_REFUND: '세금 환급',
        })[type] || type;
    const number = (v) => {
        if (v == null) return '미상';
        const [whole, fraction] = String(v).split('.');
        return (
            whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
            (fraction === undefined ? '' : '.' + fraction)
        );
    };
    function metricNumber(currency, key) {
        return number(
            positionMetrics.has(key) &&
                !report.value.rows.some((r) => r.currency === currency.currency)
                ? null
                : currency[key]
        );
    }
    function name(id) {
        return (
            accounts.value.find((a) => a.id === id)?.label || '계좌 확인 필요'
        );
    }
    async function load(refresh = false) {
        const current = ++generation,
            user = firebaseUser.value;
        payload.value = null;
        quotes.value = {};
        error.value = '';
        diagnostic.value = null;
        copyNotice.value = '';
        busy.value = Boolean(user);
        quoteGeneration++;
        quoteBusy.value = false;
        if (!user) return;
        try {
            const result = await client.load(user, 'family', 'assets', {
                refresh,
            });
            if (current === generation && user === firebaseUser.value) {
                payload.value = result;
                if (
                    pendingMutation.value &&
                    result.adjustments.history.some(
                        (h) => h.id === pendingMutation.value.requestId
                    )
                ) {
                    pendingMutation.value = null;
                    Object.assign(form, emptyForm());
                    notice.value =
                        '이전 저장이 확인되었습니다. 중복으로 저장하지 않았습니다.';
                }
                if (!result.input.accounts.some((a) => a.id === form.accountId))
                    form.accountId = result.input.accounts[0]?.id || '';
            }
        } catch (e) {
            if (current === generation && user === firebaseUser.value) {
                error.value = e.message;
                diagnostic.value = normalizeReportDiagnostic(e.diagnostic);
                if ([401, 403].includes(e.status)) {
                    pendingMutation.value = null;
                    Object.assign(form, emptyForm());
                }
            }
        } finally {
            if (current === generation) busy.value = false;
        }
    }
    async function copyDiagnostic() {
        const selected = diagnostic.value,
            current = generation,
            user = firebaseUser.value,
            text = reportDiagnosticText(selected);
        if (!text || !user) return;
        try {
            await navigator.clipboard.writeText(text);
            if (
                current === generation &&
                user === firebaseUser.value &&
                selected === diagnostic.value
            )
                copyNotice.value = '진단 정보를 복사했습니다.';
        } catch {
            if (
                current === generation &&
                user === firebaseUser.value &&
                selected === diagnostic.value
            )
                copyNotice.value =
                    '복사하지 못했습니다. 표시된 코드·단계·요청 ID를 전달해 주세요.';
        }
    }
    async function prices() {
        if (!report.value) return;
        const current = ++quoteGeneration,
            user = firebaseUser.value;
        quoteBusy.value = true;
        try {
            const result = await loadValuationQuotes(
                report.value.rows.map((r) => r.symbol),
                { force: true }
            );
            if (current === quoteGeneration && user === firebaseUser.value)
                quotes.value = result.quotes;
        } catch (e) {
            if (current === quoteGeneration) {
                error.value = e.message;
                diagnostic.value = null;
                copyNotice.value = '';
            }
        } finally {
            if (current === quoteGeneration) quoteBusy.value = false;
        }
    }
    function correction() {
        const c = {
            kind: form.kind,
            accountId: form.accountId,
            note: form.note,
        };
        if (targetKind.value) c.targetId = form.targetId;
        else if (form.kind === 'CASH_COVERAGE')
            Object.assign(c, {
                currency: form.currency,
                from: form.from,
                to: form.to,
            });
        else Object.assign(c, { currency: form.currency, at: form.at });
        if (stockKind.value) c.symbol = form.symbol.trim().toUpperCase();
        if (
            ['OPENING_LOT', 'SECURITY_TRANSFER', 'CASH_IN_LIEU'].includes(
                form.kind
            )
        )
            c.quantity = form.quantity;
        if (form.kind === 'OPENING_LOT') c.cost = form.cost || null;
        if (form.kind === 'BASIS')
            Object.assign(c, { cost: form.cost, funding: form.funding });
        if (['FX_COST', 'CASH_MOVEMENT', 'CASH_IN_LIEU'].includes(form.kind))
            c.amount = form.amount;
        if (form.kind === 'CASH_MOVEMENT') c.direction = form.direction;
        if (form.kind === 'CONFIRM_INTERNAL_TRANSFER') c.peerId = form.peerId;
        if (form.kind === 'SECURITY_TRANSFER') c.toAccountId = form.toAccountId;
        if (form.kind === 'SPLIT')
            Object.assign(c, {
                numerator: form.numerator,
                denominator: form.denominator,
            });
        if (form.kind === 'EXECUTION_TIME')
            Object.assign(c, {
                at: form.at,
                singleExecutionConfirmed: form.singleExecutionConfirmed,
            });
        return validateFifoCorrection(c, {
            accounts: accounts.value,
            events: applied.value.events,
        });
    }
    async function save(targetId = null) {
        if (saving.value || !payload.value) return;
        error.value = '';
        diagnostic.value = null;
        copyNotice.value = '';
        notice.value = '';
        let c;
        try {
            if (!targetId) c = correction();
        } catch (e) {
            error.value = e.message;
            diagnostic.value = normalizeReportDiagnostic(e.diagnostic);
            return;
        }
        const user = firebaseUser.value,
            current = mutationGeneration;
        let body = {
            action: targetId ? 'revert' : 'add',
            requestId: crypto.randomUUID(),
            expectedRevision: state.value.revision,
            ledgerRevision: payload.value.input.ledgerRevision,
            ...(targetId ? { targetId } : { correction: c }),
        };
        if (pendingMutation.value) {
            if (
                JSON.stringify(pendingMutation.value.correction) !==
                    JSON.stringify(body.correction) ||
                pendingMutation.value.targetId !== body.targetId
            ) {
                error.value =
                    '이전 저장 결과를 먼저 새로고침으로 확인해 주세요.';
                return;
            }
            body = pendingMutation.value;
        } else pendingMutation.value = body;
        saving.value = true;
        try {
            await client.saveFifoCorrection(user, body);
            if (current !== mutationGeneration || user !== firebaseUser.value)
                return;
            pendingMutation.value = null;
            Object.assign(form, emptyForm());
            if (user === firebaseUser.value) {
                await load(true);
                notice.value = targetId
                    ? '보정을 되돌렸습니다. 원문과 이력은 보존됩니다.'
                    : '보정 이력을 저장하고 다시 계산했습니다.';
            }
        } catch (e) {
            if (current !== mutationGeneration || user !== firebaseUser.value)
                return;
            error.value = e.message;
            diagnostic.value = normalizeReportDiagnostic(e.diagnostic);
            if (
                e.status >= 400 &&
                e.status < 500 &&
                ![408, 429].includes(e.status)
            )
                pendingMutation.value = null;
            else
                error.value +=
                    ' 저장 결과가 미확정입니다. 새로고침으로 확인하거나 같은 입력으로 재시도해 주세요.';
            if ([401, 403].includes(e.status)) {
                payload.value = null;
                diagnostic.value = null;
                Object.assign(form, emptyForm());
                client.clear();
            }
        } finally {
            if (current === mutationGeneration) saving.value = false;
        }
    }
    const activeIds = computed(
        () => new Set(state.value?.active.map((c) => c.id) || [])
    );
    watch(
        () => [
            firebaseUser.value,
            firebaseUser.value?.uid,
            firebaseUser.value?.email,
            firebaseUser.value?.emailVerified,
        ],
        () => {
            client.clear();
            mutationGeneration++;
            saving.value = false;
            Object.assign(form, emptyForm());
            scope.value = 'family';
            notice.value = '';
            pendingMutation.value = null;
            load();
        },
        { immediate: true }
    );
    watch(
        () => form.kind,
        () => {
            form.targetId = '';
            form.singleExecutionConfirmed = false;
        }
    );
    onBeforeUnmount(() => {
        mutationGeneration++;
        generation++;
        quoteGeneration++;
        client.clear();
    });
</script>
<template>
    <main class="fifo-report">
        <header>
            <div>
                <h1>주식 포트폴리오</h1>
                <p>
                    채택한 장부와 수기 보정에 기록된 범위로 계좌별 원가와 손익을
                    계산합니다. 누락 이력을 전체 이력으로 추정하지 않습니다.
                </p>
            </div>
            <Button
                label="리포트 새로고침"
                :loading="busy"
                :disabled="saving"
                @click="load(true)" />
        </header>
        <Message v-if="error" severity="error" :closable="false">{{
            error
        }}</Message>
        <section
            v-if="diagnostic"
            class="diagnostic"
            aria-label="안전한 보고서 진단">
            <p>코드: {{ diagnostic.code }} · 단계: {{ diagnostic.stage }}</p>
            <p>요청 ID: {{ diagnostic.requestId }}</p>
            <Button label="진단 정보 복사" @click="copyDiagnostic" />
            <p v-if="copyNotice" role="status">{{ copyNotice }}</p>
        </section>
        <Message v-if="notice" severity="success" :closable="false">{{
            notice
        }}</Message>
        <p v-if="busy" role="status">
            채택 장부와 보정 이력을 확인하고 있습니다.
        </p>
        <p v-else-if="!firebaseUser">관리자 로그인 후 조회할 수 있습니다.</p>
        <template v-if="payload">
            <p>
                금액은 원 거래 통화로 표시합니다. 확인되지 않은 원가·입출금은
                미상으로 표시합니다. 외화 현금 자체의 환차손익·가족 간 주식 증여
                원가는 미지원입니다.
            </p>
            <ul aria-label="자료 범위와 제한">
                <li v-for="limit in payload.input.limitations" :key="limit">
                    {{ limit }}
                </li>
                <li v-if="payload.input.unassignedCount">
                    계좌 미지정 {{ payload.input.unassignedCount }}건은 계산에
                    포함하지 않았습니다.
                </li>
            </ul>
            <Message
                v-if="payload.calculationError"
                severity="warn"
                :closable="false"
                >{{ payload.calculationError }}</Message
            >
            <div class="toolbar">
                <label
                    >조회 범위<Select
                        v-model="scope"
                        :options="scopes"
                        option-label="label"
                        option-value="id"
                        aria-label="조회 범위" /></label
                ><Button
                    label="평가 시세 조회"
                    :loading="quoteBusy"
                    :disabled="!report || saving"
                    @click="prices" />
            </div>
            <template v-if="report">
                <Message severity="warn" :closable="false">
                    현재 보유 수량과 보유 종목 수는 확인되지 않았습니다. 장부
                    순매수는 기록된 매수 체결 수량에서 매도 체결 수량을 뺀
                    참고값이며, 초기 보유·누락 거래·주식 이전을 반영한 현재
                    잔고가 아닙니다. 원가와 손익은 입력 범위의 계산이며 주식
                    이력 전체의 완전성을 뜻하지 않습니다.
                </Message>
                <section
                    v-for="c in report.currencies"
                    v-show="report.rows.length || portfolioEvents.length"
                    :key="c.currency"
                    :aria-label="`${c.currency} 자산 요약`">
                    <h2>{{ c.currency }}</h2>
                    <div class="metrics">
                        <article v-for="[key, label] in fields" :key="key">
                            <span>{{ label }}</span
                            ><strong>{{ metricNumber(c, key) }}</strong>
                        </article>
                        <article>
                            <span>누적 배당 회수율</span
                            ><strong
                                >{{ number(c.dividendRecoveryRate)
                                }}{{
                                    c.dividendRecoveryRate === null ? '' : '%'
                                }}</strong
                            ><small>{{
                                c.recoveryReason ||
                                '누적 세후 배당 ÷ 누적 외부 투입금'
                            }}</small>
                        </article>
                    </div>
                </section>
                <p>
                    매도손익과 현금 인출은 별개입니다. 수기 기초 원가·DRIP는
                    외부 입금에 더하지 않습니다. 현금 잔고 평가는 포함하지
                    않습니다. 미분류 현금은 가족 내부이체로 추정하지 않습니다.
                </p>
                <section aria-label="계좌별 FIFO lot">
                    <h2>계좌별 기록 항목 · 계산 상태</h2>
                    <p aria-label="검토 항목 안내">
                        검토 항목 {{ report.rows.length }}개. 연결된 자료 범위의
                        항목 수이며 현재 보유 종목 수나 가족 전체 자료의
                        완전성을 확인한 수가 아닙니다.
                    </p>
                    <p v-if="!report.rows.length" role="status">
                        해당 범위에 계산할 매매·기초 lot 기록이 없습니다. 실제
                        보유가 0이라는 뜻은 아닙니다.
                    </p>
                    <div class="table-scroll">
                        <table>
                            <thead>
                                <tr>
                                    <th>계좌 · 종목</th>
                                    <th>장부 순매수 수량 · 참고</th>
                                    <th>현재 보유 수량</th>
                                    <th>잔여 FIFO 원가 · 입력 범위</th>
                                    <th>실현손익 · 입력 범위</th>
                                    <th>평가손익 · 입력 범위</th>
                                    <th>원화 환산 기준</th>
                                    <th>확인 상태</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="r in report.rows"
                                    :key="`${r.accountId}:${r.symbol}:${r.currency}`">
                                    <th>
                                        {{ name(r.accountId) }} · {{ r.symbol
                                        }}<small>{{ r.currency }}</small>
                                    </th>
                                    <td>
                                        <span
                                            aria-label="장부 순매수 참고 수량"
                                            >{{
                                                number(
                                                    r.recordedTradeQuantity.net
                                                )
                                            }}</span
                                        >
                                        <small
                                            >매수
                                            {{
                                                number(
                                                    r.recordedTradeQuantity.buys
                                                )
                                            }}
                                            · 매도
                                            {{
                                                number(
                                                    r.recordedTradeQuantity
                                                        .sells
                                                )
                                            }}</small
                                        >
                                        <small
                                            >기록 당시 수량 기준 ·
                                            기업행사·입출고 조정 없음</small
                                        >
                                        <small
                                            v-if="r.recordedTradeQuantity.from"
                                            >기록일
                                            {{ r.recordedTradeQuantity.from }} ~
                                            {{ r.recordedTradeQuantity.to }} ·
                                            전체 기간 확인 아님</small
                                        >
                                        <p
                                            v-for="reason in r
                                                .recordedTradeQuantity.reasons"
                                            :key="reason.code">
                                            {{ reason.message }}
                                        </p>
                                    </td>
                                    <td>
                                        <span aria-label="현재 보유 수량">{{
                                            r.currentHoldingQuantity === null
                                                ? '미확인'
                                                : number(
                                                      r.currentHoldingQuantity
                                                  )
                                        }}</span>
                                    </td>
                                    <td>{{ number(r.remainingCost) }}</td>
                                    <td>{{ number(r.realizedPnl) }}</td>
                                    <td>{{ number(r.unrealizedPnl) }}</td>
                                    <td>
                                        잔여
                                        {{ number(r.remainingKrwCost) }}
                                        KRW<br />실현
                                        {{ number(r.realizedKrwPnl) }}
                                        KRW<small>{{
                                            r.fxBasis.join(' · ') || '미확인'
                                        }}</small>
                                    </td>
                                    <td>
                                        <ul aria-label="근거별 확인 상태">
                                            <li
                                                v-for="status in r.evidenceStatus"
                                                :key="status.category">
                                                {{
                                                    evidenceLabels[
                                                        status.category
                                                    ]
                                                }}: {{ status.message }}
                                            </li>
                                        </ul>
                                        <details>
                                            <summary>
                                                입력 범위 계산 근거
                                            </summary>
                                            <p>
                                                입력 범위 FIFO 수량:
                                                {{ number(r.quantity) }} · 현재
                                                보유 수량과 구분합니다.
                                            </p>
                                            <p>
                                                {{
                                                    r.issues.join(' · ') ||
                                                    '입력 범위 계산 완료 · 전체 이력 확인 아님'
                                                }}
                                            </p>
                                            <p
                                                v-for="(lot, i) in r.lots"
                                                :key="i">
                                                {{
                                                    lot.acquiredAt ||
                                                    '취득일 미상'
                                                }}
                                                · {{ lot.quantity }}주 ·
                                                {{
                                                    lot.cost === null
                                                        ? '원가 미상'
                                                        : lot.cost +
                                                          ' ' +
                                                          r.currency
                                                }}
                                            </p>
                                        </details>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>
                <p>
                    미체결·취소·중복 미확정 제외 {{ report.excluded }}건. 주문
                    누적 체결은 실제 단일 체결 근거를 확인하기 전까지 순서를
                    확정하지 않습니다.
                </p>
                <FifoReviewCalendar
                    :key="firebaseUser?.uid"
                    :events="portfolioEvents">
                    <template #default="{ events: reviewEvents }">
                        <section aria-label="주식 거래 내역">
                            <h2>거래 내역</h2>
                            <p v-if="!reviewEvents.length">
                                확인된 거래가 없습니다.
                            </p>
                            <div v-else class="table-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>일시</th>
                                            <th>계좌</th>
                                            <th>종목</th>
                                            <th>구분</th>
                                            <th>수량</th>
                                            <th>금액</th>
                                            <th>상태</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr
                                            v-for="event in reviewEvents"
                                            :key="`${event.accountId}:${event.id}`">
                                            <td>
                                                {{ event.at || '날짜 미상' }}
                                            </td>
                                            <td>{{ name(event.accountId) }}</td>
                                            <td>{{ event.symbol || '—' }}</td>
                                            <td>
                                                {{ eventLabel(event.type) }}
                                            </td>
                                            <td>
                                                {{ number(event.quantity) }}
                                            </td>
                                            <td>
                                                {{ number(event.amount) }}
                                                {{ event.currency }}
                                            </td>
                                            <td>
                                                {{
                                                    event.timing ===
                                                    'order_aggregate'
                                                        ? '주문 누적 · 체결 시각 미확정'
                                                        : '채택 장부'
                                                }}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </section>
                        <section aria-label="배당 내역">
                            <h2>배당 내역</h2>
                            <p
                                v-if="
                                    !reviewEvents.some(
                                        (event) => event.type === 'DIVIDEND'
                                    )
                                ">
                                확인된 배당이 없습니다.
                            </p>
                            <div v-else class="table-scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>일시</th>
                                            <th>계좌</th>
                                            <th>종목</th>
                                            <th>기록 금액</th>
                                            <th>세후 입금</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr
                                            v-for="event in reviewEvents.filter(
                                                (event) =>
                                                    event.type === 'DIVIDEND'
                                            )"
                                            :key="`${event.accountId}:${event.id}`">
                                            <td>
                                                {{ event.at || '날짜 미상' }}
                                            </td>
                                            <td>{{ name(event.accountId) }}</td>
                                            <td>{{ event.symbol || '—' }}</td>
                                            <td>
                                                {{ number(event.amount) }}
                                                {{ event.currency }}
                                            </td>
                                            <td>
                                                {{ number(event.net) }}
                                                {{ event.currency }}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    </template>
                </FifoReviewCalendar>
            </template>
            <section aria-labelledby="fifo-correction-title">
                <h2 id="fifo-correction-title">수기 보정</h2>
                <p>
                    원문을 덮어쓰지 않습니다. 실제 근거가 있는 값만 입력하고,
                    원가 미상은 비워 두세요.
                </p>
                <form @submit.prevent="save()">
                    <div class="form-grid">
                        <label
                            >보정 종류<Select
                                v-model="form.kind"
                                :options="kinds"
                                option-label="label"
                                option-value="value"
                                aria-label="보정 종류"
                        /></label>
                        <label
                            >대상 계좌<Select
                                v-model="form.accountId"
                                :options="accounts"
                                option-label="label"
                                option-value="id"
                                aria-label="대상 계좌"
                        /></label>
                        <label v-if="targetKind"
                            >대상 거래<Select
                                v-model="form.targetId"
                                :options="targets"
                                option-label="label"
                                option-value="id"
                                filter
                                :virtual-scroller-options="{ itemSize: 38 }"
                                aria-label="대상 거래"
                        /></label>
                        <label v-if="form.kind === 'CONFIRM_INTERNAL_TRANSFER'"
                            >대응 입금<Select
                                v-model="form.peerId"
                                :options="peers"
                                option-label="label"
                                option-value="id"
                                filter
                                aria-label="대응 입금"
                        /></label>
                        <label v-if="form.kind === 'SECURITY_TRANSFER'"
                            >이전 도착 계좌<Select
                                v-model="form.toAccountId"
                                :options="accounts"
                                option-label="label"
                                option-value="id"
                                aria-label="이전 도착 계좌"
                        /></label>
                        <label v-if="stockKind"
                            >종목<InputText
                                v-model="form.symbol"
                                aria-label="종목"
                        /></label>
                        <label v-if="!targetKind"
                            >통화<Select
                                v-model="form.currency"
                                :options="['USD', 'KRW']"
                                aria-label="보정 통화"
                        /></label>
                        <label v-if="timingKind"
                            >원 취득일·실제 사건 시각<InputText
                                v-model="form.at"
                                placeholder="2026-01-02 또는 2026-01-02T10:30:00+09:00"
                                aria-label="원 취득일·실제 사건 시각"
                        /></label>
                        <label
                            v-if="
                                [
                                    'OPENING_LOT',
                                    'SECURITY_TRANSFER',
                                    'CASH_IN_LIEU',
                                ].includes(form.kind)
                            "
                            >수량<InputText
                                v-model="form.quantity"
                                inputmode="decimal"
                                aria-label="보정 수량"
                        /></label>
                        <label
                            v-if="['OPENING_LOT', 'BASIS'].includes(form.kind)"
                            >수수료 포함 취득원가<InputText
                                v-model="form.cost"
                                inputmode="decimal"
                                aria-label="수수료 포함 취득원가"
                        /></label>
                        <label v-if="form.kind === 'BASIS'"
                            >확인한 매수 재원<Select
                                v-model="form.funding"
                                :options="[
                                    { label: '미확인', value: 'unknown' },
                                    { label: '외부 원금', value: 'external' },
                                    { label: '배당 재투자', value: 'dividend' },
                                ]"
                                option-label="label"
                                option-value="value"
                                aria-label="확인한 매수 재원"
                        /></label>
                        <label
                            v-if="
                                [
                                    'FX_COST',
                                    'CASH_MOVEMENT',
                                    'CASH_IN_LIEU',
                                ].includes(form.kind)
                            "
                            >{{
                                form.kind === 'FX_COST'
                                    ? '실제 원화 금액(KRW)'
                                    : '실제 금액'
                            }}<InputText
                                v-model="form.amount"
                                inputmode="decimal"
                                aria-label="실제 금액"
                        /></label>
                        <label v-if="form.kind === 'CASH_MOVEMENT'"
                            >현금 구분<Select
                                v-model="form.direction"
                                :options="[
                                    { label: '외부 입금', value: 'deposit' },
                                    { label: '외부 인출', value: 'withdrawal' },
                                    { label: '미분류', value: 'unknown' },
                                ]"
                                option-label="label"
                                option-value="value"
                                aria-label="현금 구분"
                        /></label>
                        <template v-if="form.kind === 'SPLIT'"
                            ><label
                                >변경 후 수량 비율 분자<InputText
                                    v-model="form.numerator"
                                    inputmode="decimal"
                                    aria-label="비율 분자" /></label
                            ><label
                                >변경 전 수량 비율 분모<InputText
                                    v-model="form.denominator"
                                    inputmode="decimal"
                                    aria-label="비율 분모" /></label
                        ></template>
                        <template v-if="form.kind === 'CASH_COVERAGE'"
                            ><label
                                >전체 이력 확인 시작<input
                                    v-model="form.from"
                                    type="date"
                                    aria-label="이력 확인 시작" /></label
                            ><label
                                >전체 이력 확인 종료<input
                                    v-model="form.to"
                                    type="date"
                                    aria-label="이력 확인 종료" /></label
                        ></template>
                        <label v-if="form.kind === 'EXECUTION_TIME'"
                            ><input
                                v-model="form.singleExecutionConfirmed"
                                type="checkbox" />실제 단일 체결 근거를
                            확인했습니다</label
                        >
                        <label class="note"
                            >확인 근거·보정 이유<InputText
                                v-model="form.note"
                                aria-label="확인 근거·보정 이유"
                                maxlength="500"
                        /></label>
                    </div>
                    <Button
                        type="submit"
                        label="보정 저장 후 재계산"
                        :loading="saving"
                        :disabled="busy || !accounts.length" />
                </form>
            </section>
            <section aria-label="보정 변경 이력">
                <h2>보정 이력 · 버전 {{ state.revision }}</h2>
                <p v-if="!state.history.length">아직 보정 이력이 없습니다.</p>
                <ol>
                    <li v-for="h in [...state.history].reverse()" :key="h.id">
                        {{ h.at }} ·
                        {{
                            h.action === 'revert'
                                ? '보정 되돌림'
                                : kindsById[h.correction.kind]
                        }}
                        <p v-if="h.correction">{{ h.correction.note }}</p>
                        <Button
                            v-if="activeIds.has(h.id)"
                            label="이 보정 되돌리기"
                            severity="secondary"
                            :disabled="saving || busy"
                            @click="save(h.id)" />
                    </li>
                </ol>
            </section>
        </template>
    </main>
</template>
<style scoped>
    .fifo-report {
        max-width: 1500px;
        margin: auto;
        padding: 1.5rem;
        color: var(--app-text);
    }
    header,
    .toolbar {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
    }
    header > div {
        flex: 1 1 24rem;
        min-width: 0;
    }
    p,
    small {
        line-height: 1.6;
        color: var(--app-text-muted);
    }
    small {
        display: block;
    }
    section {
        margin-top: 2rem;
    }
    .metrics,
    .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
    }
    .metrics article {
        padding: 1rem;
        border: 1px solid var(--app-border);
        border-radius: 0.7rem;
        background: var(--app-surface);
    }
    strong {
        display: block;
        font-size: 1.3rem;
        margin-top: 0.6rem;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
    }
    label {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        min-width: 0;
    }
    .note {
        grid-column: 1/-1;
    }
    .form-grid {
        margin-bottom: 1rem;
    }
    .table-scroll {
        overflow-x: auto;
    }
    table {
        border-collapse: collapse;
        width: 100%;
        font-size: 0.85rem;
    }
    th,
    td {
        padding: 0.8rem;
        text-align: left;
        vertical-align: top;
        border-bottom: 1px solid var(--app-border);
        min-width: 100px;
    }
    input[type='date'] {
        padding: 0.7rem;
        background: var(--app-surface);
        color: var(--app-text);
        border: 1px solid var(--app-border);
        border-radius: 6px;
    }
    li {
        margin: 1rem 0;
    }
    details p,
    .diagnostic p {
        overflow-wrap: anywhere;
    }
    @media (max-width: 600px) {
        .fifo-report {
            padding: 1rem;
        }
        .metrics,
        .form-grid {
            grid-template-columns: minmax(0, 1fr);
        }
        header h1 {
            font-size: 1.5rem;
        }
    }
</style>
