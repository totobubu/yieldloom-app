<script setup>
    import { computed } from 'vue';
    import { tracePortfolioFunding } from '@/services/portfolioFundingTrace.js';
    import OpeningFundingEditor from './OpeningFundingEditor.vue';
    const props = defineProps({
        entries: { type: Array, default: () => [] },
        classifications: { type: Array, default: () => [] },
        trades: { type: Array, default: () => [] },
        allocations: { type: Array, default: () => [] },
        openingLots: { type: Array, default: () => [] },
        openingRevision: { type: Number, default: 0 },
        canEditOpening: Boolean,
        savingOpening: Boolean,
        accounts: { type: Array, default: () => [] },
    });
    const emit = defineEmits(['save-opening']);
    const accountId = defineModel('accountId', { type: String, default: '' });
    const activeAccount = computed(() =>
        props.accounts.some((a) => a.id === accountId.value)
            ? accountId.value
            : ''
    );
    const scopeLabel = computed(() =>
        activeAccount.value
            ? props.accounts.find((a) => a.id === activeAccount.value)?.alias ||
              activeAccount.value
            : '전체 계좌'
    );
    const activeOpeningLots = computed(() =>
        props.openingLots.filter(
            (row) =>
                !activeAccount.value || row.accountId === activeAccount.value
        )
    );
    const currency = defineModel('currency', { type: String, default: 'USD' });
    const result = computed(() =>
        tracePortfolioFunding(
            Object.fromEntries(
                [
                    'entries',
                    'classifications',
                    'trades',
                    'allocations',
                    'openingLots',
                ].map((key) => [
                    key,
                    props[key].filter(
                        (r) =>
                            !activeAccount.value ||
                            r.accountId === activeAccount.value
                    ),
                ])
            )
        )
    );
    const points = computed(() => result.value.timelines[currency.value]);
    const rows = computed(() =>
        result.value.stocks.filter((s) => s.currency === currency.value)
    );
    const metric = computed(() =>
        result.value.currencies.find((s) => s.currency === currency.value)
    );
    const last = computed(() => points.value.at(-1));
    const money = (v) =>
        new Intl.NumberFormat('ko-KR', {
            style: 'currency',
            currency: currency.value,
            maximumFractionDigits: currency.value === 'KRW' ? 0 : 2,
        }).format(v);
    const percent = (v) =>
        v == null
            ? '확인 필요'
            : `${v.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%`;
    const account = (id) =>
        props.accounts.find((a) => a.id === id)?.alias || id;
    const series = [
        { key: 'deposits', label: '누적 투자 원금', color: '#2563eb' },
        {
            key: 'trackedAssetsAtCost',
            label: '추적 자산 (취득원가 + 현금)',
            color: '#16a34a',
        },
        {
            key: 'principalRecovered',
            label: '누적 원금 회수',
            color: '#c05621',
        },
    ];
    const range = computed(() => {
        const values = points.value.flatMap((p) => series.map((s) => p[s.key]));
        return { min: Math.min(0, ...values), max: Math.max(1, ...values) };
    });
    const x = (index) =>
        40 + (index / Math.max(1, points.value.length - 1)) * 720;
    const y = (value) =>
        185 -
        ((value - range.value.min) / (range.value.max - range.value.min)) * 160;
    const path = (key) =>
        points.value
            .map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[key])}`)
            .join(' ');
    const date = (value) => value?.replace(/(\d{4})(\d{2})(\d{2})/, '$1.$2.$3');
</script>

<template>
    <section class="funding-trace" aria-label="내 돈과 재투자 추적">
        <h2>내 돈 · 재투자 · 현금 회수</h2>
        <p>
            새로 넣은 돈과 투자에서 생긴 돈을 구분합니다. 재투자와 종목 이동은
            새 원금이나 현금 회수로 더하지 않습니다.
        </p>
        <label v-if="accounts.length"
            >조회 범위
            <select v-model="accountId" aria-label="자금 추적 계좌">
                <option value="">전체 계좌</option>
                <option v-for="a in accounts" :key="a.id" :value="a.id">
                    {{ a.alias || a.id }}
                </option>
            </select></label
        >
        <p>현재 범위: {{ scopeLabel }}</p>
        <OpeningFundingEditor
            v-if="canEditOpening && (activeAccount || !accounts.length)"
            :lots="activeOpeningLots"
            :revision="openingRevision"
            :disabled="savingOpening"
            @save="emit('save-opening', $event)" />
        <label
            >추적 통화
            <select v-model="currency" aria-label="자금 추적 통화">
                <option value="USD">USD · 달러</option>
                <option value="KRW">KRW · 원화</option>
            </select></label
        >
        <p v-if="!points.length" role="status">
            {{
                result.unavailable
                    ? '정정 내역 확인 후 자금 추적을 다시 계산할 수 있습니다.'
                    : '이 통화의 입출금·종목 거래가 필요합니다.'
            }}
        </p>
        <template v-else>
            <p v-if="result.warnings.length" role="status">
                자료 확인이 필요한 부분 추적입니다. 아래 자동 배분 규칙과 확인할
                내역 {{ result.warnings.length }}개 항목을 확인하세요.
            </p>
            <div class="trace-metrics">
                <article>
                    <small>누적 투자 원금</small
                    ><strong>{{ money(metric.deposits) }}</strong>
                </article>
                <article>
                    <small>원금 회수</small
                    ><strong>{{ money(metric.principalRecovered) }}</strong>
                    <span v-if="metric.estimatedPrincipalRecovered">
                        추정
                        {{ money(metric.estimatedPrincipalRecovered) }} 별도
                    </span>
                </article>
                <article>
                    <small>원금 회수율</small
                    ><strong>{{ percent(metric.principalRate) }}</strong>
                </article>
                <article>
                    <small>미회수 원금</small
                    ><strong>{{ money(metric.remainingPrincipal) }}</strong>
                </article>
                <article>
                    <small>현재 원금 기반 자산</small
                    ><strong>{{ money(last.principalAssets) }}</strong>
                </article>
                <article>
                    <small>배당·수익 회수</small
                    ><strong>{{
                        money(metric.dividendRecovered + metric.profitRecovered)
                    }}</strong>
                </article>
            </div>
            <p>
                원금 회수율 = 원금으로 귀속된 외부 출금 ÷ 누적 투자 원금.
                배당·수익의 출금은 총 현금 회수에는 포함하지만 원금 회수에는
                포함하지 않습니다. 손실은 현재 원금 기반 자산을 줄여도 누적 투자
                원금을 줄이지 않습니다.
            </p>
            <p>
                총 현금 회수 {{ money(metric.recovered) }} · 출처 미확인
                {{ money(metric.unknownRecovered) }} · 실현손익
                {{ money(metric.realizedPnl) }}
            </p>
            <figure>
                <figcaption>
                    자금 흐름 추이 · {{ currency }} ·
                    {{
                        result.warnings.length
                            ? '자료 확인 필요 · 부분 추적'
                            : '자동 배분 규칙 기준'
                    }}
                </figcaption>
                <svg
                    viewBox="0 0 800 225"
                    role="img"
                    aria-label="누적 투자 원금, 취득원가 기준 추적 자산, 누적 원금 회수 추이">
                    <title>
                        평가액이 아닌 취득원가 기준 자금 흐름입니다. 아래 표에서
                        일자별 금액을 확인할 수 있습니다.
                    </title>
                    <line
                        x1="40"
                        x2="760"
                        :y1="y(0)"
                        :y2="y(0)"
                        stroke="currentColor"
                        opacity="0.25" />
                    <path
                        v-for="(s, index) in series"
                        :key="s.key"
                        :d="path(s.key)"
                        fill="none"
                        :stroke="s.color"
                        stroke-width="3"
                        :stroke-dasharray="
                            index === 0
                                ? '8 4'
                                : index === 2
                                  ? '3 3'
                                  : undefined
                        " />
                    <circle
                        v-for="s in series"
                        :key="s.key"
                        :cx="x(points.length - 1)"
                        :cy="y(last[s.key])"
                        r="4"
                        :fill="s.color" />
                    <text x="40" y="215" fill="currentColor" font-size="13">
                        {{ date(points[0].date) }}
                    </text>
                    <text
                        x="760"
                        y="215"
                        text-anchor="end"
                        fill="currentColor"
                        font-size="13">
                        {{ date(last.date) }}
                    </text>
                    <text x="40" y="16" fill="currentColor" font-size="13">
                        {{ money(range.max) }}
                    </text>
                </svg>
                <ul class="legend">
                    <li v-for="s in series" :key="s.key">
                        <span :style="{ background: s.color }"></span
                        >{{ s.label }} · {{ money(last[s.key]) }}
                    </li>
                </ul>
            </figure>
            <p>
                취득원가 기준 추적으로 현재 평가액·수익률을 나타내지 않습니다.
                재투자 매수 자체는 자산을 증가시키지 않습니다. 현재 평가액은
                잔고 화면에서 확인하세요.
            </p>
            <details>
                <summary>일자별 차트 데이터</summary>
                <div class="scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>일자</th>
                                <th v-for="s in series" :key="s.key">
                                    {{ s.label }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="p in points" :key="p.date">
                                <th>{{ date(p.date) }}</th>
                                <td v-for="s in series" :key="s.key">
                                    {{ money(p[s.key]) }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </details>
            <h3>종목별 원금 회수율 · 자금 출처와 이동</h3>
            <div class="scroll">
                <table aria-label="종목별 원금과 재투자">
                    <thead>
                        <tr>
                            <th>계좌 · 종목</th>
                            <th>최초 배정된 내 돈</th>
                            <th>원장 추적 수량</th>
                            <th>보유분 원금 출처</th>
                            <th>보유분 배당·수익 출처</th>
                            <th>누적 배당·수익 재투자</th>
                            <th>재투자분 실현손익</th>
                            <th>출처 미확인</th>
                            <th>출처 종목 귀속 원금 회수</th>
                            <th>회수율</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="s in rows" :key="s.key">
                            <th scope="row">
                                {{ account(s.accountId) }} · {{ s.symbol
                                }}<small
                                    v-for="source in s.sources"
                                    :key="source"
                                    >{{ source }}</small
                                >
                            </th>
                            <td>{{ money(s.direct) }}</td>
                            <td>
                                {{
                                    s.quantity.toLocaleString('ko-KR', {
                                        maximumFractionDigits: 6,
                                    })
                                }}
                                <small
                                    >재투자분
                                    {{
                                        s.reinvestedQuantity.toLocaleString(
                                            'ko-KR',
                                            { maximumFractionDigits: 6 }
                                        )
                                    }}주</small
                                >
                            </td>
                            <td>{{ money(s.principalHeld) }}</td>
                            <td>{{ money(s.reinvestedHeld) }}</td>
                            <td>{{ money(s.reinvested) }}</td>
                            <td>{{ money(s.reinvestmentRealizedPnl) }}</td>
                            <td>{{ money(s.unknownHeld) }}</td>
                            <td>{{ money(s.recovered) }}</td>
                            <td>{{ percent(s.rate) }}</td>
                        </tr>
                        <tr v-if="!rows.length">
                            <td colspan="10">저장된 종목 거래가 없습니다.</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p>
                외부에서 납입한 원금만 원금으로 계산합니다. 배당으로 B를
                매수해도 원금은 늘지 않습니다. 원금은 처음 매수한 종목에 한 번
                배정하며 매도 후 다른 종목으로 이동해도 출처를 유지합니다.
                원금·재투자 보유분은 취득원가이며 손익이 아닙니다. 인출액은 현금
                잔액의 출처별 비율로 배분합니다. 다른 종목의 배당·수익에서만
                투자한 종목은 회수율을 계산하지 않습니다.
            </p>
            <p>
                누적 재투자는 반복 투자한 금액을 포함한 거래 누계입니다.
                재투자분 실현손익은 비례 매도 규칙으로 배분한 정산손익이며, 보유
                중 평가손익이나 비재투자 대비 추가 성과는 포함하지 않습니다.
                추적 수량은 저장된 원장 기준으로 잔고 자료와 다를 수 있습니다.
            </p>
        </template>
        <details>
            <summary>
                자동 배분 규칙과 확인할 내역 ({{ result.warnings.length }})
            </summary>
            <p>
                매수는 배당 → 기타 수익 → 원금 순으로 사용합니다. 저장한 자금
                구성이 있으면 우선 적용합니다. 매도는 가장 오래된 보유 로트부터
                차감하며, 손실은 해당 로트에서 차감하고 초과 매도수익은 별도
                추적합니다. 자동 배분은 자금 출처를 해석하기 위한 규칙입니다.
            </p>
            <p>
                수량 증가만으로 복리 수익을 확정하지 않습니다. 재투자분의 현재
                손익과 비재투자 대비 성과는 시세·기준일·비교 시나리오가
                확인되어야 계산할 수 있습니다.
            </p>
            <ul v-if="result.warnings.length" role="status">
                <li v-for="warning in result.warnings" :key="warning">
                    {{ warning }}
                </li>
            </ul>
        </details>
    </section>
</template>

<style scoped>
    .funding-trace {
        min-width: 0;
        padding: 20px;
        margin: 20px 0;
        border: 1px solid var(--app-border);
        border-radius: 14px;
        background: var(--app-surface);
        color: var(--app-text);
    }
    h2 {
        margin: 0;
        font-size: 1.2rem;
    }
    p,
    small {
        color: var(--app-muted);
        font-size: 0.88rem;
    }
    .trace-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 16px;
    }
    article {
        padding: 14px;
        background: var(--app-surface-muted);
        border-radius: 10px;
        min-width: 0;
    }
    strong,
    small {
        display: block;
        overflow-wrap: anywhere;
    }
    strong {
        font-size: 1.3rem;
    }
    figure {
        margin: 20px 0;
    }
    svg {
        display: block;
        width: 100%;
    }
    .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 0;
        list-style: none;
        font-size: 0.85rem;
    }
    .legend span {
        display: inline-block;
        width: 10px;
        height: 10px;
        margin-right: 6px;
    }
    .scroll {
        overflow-x: auto;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.88rem;
    }
    th,
    td {
        padding: 10px;
        text-align: left;
        min-width: 110px;
        border-bottom: 1px solid var(--app-border);
    }
    summary {
        cursor: pointer;
        margin: 12px 0;
    }
    @media (max-width: 640px) {
        .trace-metrics {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .funding-trace {
            padding: 14px;
        }
        strong {
            font-size: 1.05rem;
        }
    }
</style>
