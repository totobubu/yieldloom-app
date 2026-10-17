<script setup>
    import { computed, ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import Button from 'primevue/button';
    import InputNumber from 'primevue/inputnumber';
    import Select from 'primevue/select';
    import SelectButton from 'primevue/selectbutton';
    import Message from 'primevue/message';
    import Tag from 'primevue/tag';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import SimulationScenarioForm from '@/components/portfolio/SimulationScenarioForm.vue';
    import {
        simulateDividends,
        normalizeSimulationSetup,
    } from '@/services/dividendSimulation';
    useHead({ title: '배당 시뮬레이터 · 가정 비교' });
    const defaults = () => ({
        version: 1,
        common: { months: 12, currency: 'USD', annualPriceChange: 0 },
        comparison: 'strategy',
        a: {
            initial: 10000,
            contribution: 100,
            price: 10,
            annualDividend: 1.2,
            taxRate: 15,
            fee: 0,
            frequency: 'monthly',
            reinvest: false,
            fractional: true,
        },
        b: {
            initial: 10000,
            contribution: 100,
            price: 10,
            annualDividend: 1.2,
            taxRate: 15,
            fee: 0,
            frequency: 'monthly',
            reinvest: true,
            fractional: true,
        },
    });
    const setup = ref(defaults()),
        notice = ref(''),
        storageError = ref('');
    const comparisons = [
        { label: '투자·재투자 A/B', value: 'strategy' },
        { label: '원천징수율만 비교', value: 'tax' },
    ];
    const currencies = [
        { label: 'USD · 달러', value: 'USD' },
        { label: 'KRW · 원화', value: 'KRW' },
    ];
    const taxOnly = computed(() => setup.value.comparison === 'tax');
    const scenarioB = computed(() =>
        taxOnly.value
            ? { ...setup.value.a, taxRate: setup.value.b.taxRate }
            : setup.value.b
    );
    const result = computed(() => {
        try {
            return {
                a: simulateDividends({
                    ...setup.value.a,
                    ...setup.value.common,
                }),
                b: simulateDividends({
                    ...scenarioB.value,
                    ...setup.value.common,
                }),
                error: '',
            };
        } catch (error) {
            return { a: null, b: null, error: error.message };
        }
    });
    const money = (value) =>
        `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 })} ${setup.value.common.currency}`;
    const monthlyRows = computed(
        () =>
            result.value.a?.rows.map((a, i) => ({
                month: a.month,
                a,
                b: result.value.b.rows[i],
            })) || []
    );
    const chart = computed(() => {
        if (!result.value.a) return { lines: [], ticks: [], maxMonth: 0 };
        const series = [result.value.a, result.value.b].map((r) => [
            r.start,
            ...r.rows,
        ]);
        const max = Math.max(1, ...series.flat().map((r) => r.wealth));
        const months = Math.max(1, setup.value.common.months);
        return {
            lines: series.map((rows) =>
                rows
                    .map(
                        (r) =>
                            `${76 + (r.month / months) * 620},${220 - (r.wealth / max) * 180}`
                    )
                    .join(' ')
            ),
            ticks: [0, 0.5, 1].map((f) => ({
                y: 220 - f * 180,
                label: (max * f).toLocaleString('ko-KR', {
                    maximumFractionDigits: 0,
                    notation: 'compact',
                }),
            })),
            maxMonth: setup.value.common.months,
        };
    });
    const summaries = computed(() =>
        result.value.a
            ? [
                  { name: 'A', ...result.value.a.summary },
                  { name: 'B', ...result.value.b.summary },
              ]
            : []
    );
    function save() {
        try {
            localStorage.setItem(
                'yieldloom.dividend-simulation.v1',
                JSON.stringify(normalizeSimulationSetup(setup.value))
            );
            storageError.value = '';
            notice.value = '입력한 가정을 이 브라우저에 저장했습니다.';
        } catch (error) {
            storageError.value =
                error.message || '브라우저 저장 공간을 확인해 주세요.';
            notice.value = '';
        }
    }
    function restore() {
        try {
            const raw = localStorage.getItem(
                'yieldloom.dividend-simulation.v1'
            );
            if (!raw)
                throw new Error('이 브라우저에 저장된 시나리오가 없습니다.');
            setup.value = normalizeSimulationSetup(JSON.parse(raw));
            storageError.value = '';
            notice.value = '저장된 가정을 불러왔습니다.';
        } catch {
            storageError.value =
                '저장된 가정을 불러오지 못했습니다. 저장 여부와 입력 값을 확인해 주세요.';
            notice.value = '';
        }
    }
    function reset() {
        setup.value = defaults();
        notice.value =
            '예시 입력으로 되돌렸습니다. 저장된 시나리오는 유지됩니다.';
        storageError.value = '';
    }
</script>
<template>
    <section class="simulator-page">
        <header class="simulator-heading">
            <div>
                <span class="studio-eyebrow">DIVIDEND LAB</span>
                <h1>배당 시뮬레이터</h1>
                <p>
                    납입·배당·재투자 가정을 바꾸며 두 시나리오를 비교해 보세요.
                </p>
            </div>
            <Tag value="가정 시뮬레이션" severity="info" />
        </header>
        <Message severity="info" :closable="false"
            >입력한 주가·배당금·원천징수율이 유지된다는 <b>사용자 가정</b>으로
            계산합니다. 실제 계좌·시장 데이터와 연결되지 않으며 미래 수익이나
            세금 신고액을 예측·확정하지 않습니다. 예시 15%는 적용 세율을 판정한
            값이 아닙니다.</Message
        >
        <div class="simulation-actions">
            <SelectButton
                v-model="setup.comparison"
                :options="comparisons"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                aria-label="시뮬레이션 비교 방식" />
            <div>
                <Button
                    label="가정 저장"
                    icon="pi pi-bookmark"
                    severity="secondary"
                    outlined
                    :disabled="!!result.error"
                    @click="save" /><Button
                    label="저장된 가정 불러오기"
                    severity="secondary"
                    text
                    @click="restore" /><Button
                    label="예시로 초기화"
                    severity="secondary"
                    text
                    @click="reset" />
            </div>
        </div>
        <Message
            v-if="notice"
            severity="success"
            :closable="false"
            role="status"
            >{{ notice }}</Message
        ><Message v-if="storageError" severity="error" :closable="false">{{
            storageError
        }}</Message>
        <section class="simulation-common" aria-label="공통 계산 가정">
            <div class="studio-field">
                <label for="sim-currency" id="sim-currency-label"
                    >계산 통화</label
                ><Select
                    v-model="setup.common.currency"
                    input-id="sim-currency"
                    aria-labelledby="sim-currency-label"
                    :options="currencies"
                    option-label="label"
                    option-value="value" />
            </div>
            <div class="studio-field">
                <label for="sim-months">투자 기간 (개월 · 0~360)</label
                ><InputNumber
                    v-model="setup.common.months"
                    input-id="sim-months"
                    :min="0"
                    :max="360"
                    :max-fraction-digits="0"
                    fluid />
            </div>
            <div class="studio-field">
                <label for="sim-growth">연간 주가 변화율 (%)</label
                ><InputNumber
                    v-model="setup.common.annualPriceChange"
                    input-id="sim-growth"
                    :min="-95"
                    :max="100"
                    :max-fraction-digits="4"
                    fluid />
            </div>
        </section>
        <p class="currency-note">
            통화를 바꾸면 입력 숫자의 단위만 바뀌며 환산하지 않습니다. 모든
            입력은 선택한 통화 기준입니다.
        </p>
        <div class="scenario-pair">
            <SimulationScenarioForm
                v-model="setup.a"
                name="A"
                :currency="setup.common.currency" /><SimulationScenarioForm
                :model-value="scenarioB"
                name="B"
                :tax-only="taxOnly"
                :currency="setup.common.currency"
                @update:model-value="setup.b = $event" />
        </div>
        <Message
            v-if="result.error"
            severity="error"
            :closable="false"
            role="alert"
            >{{ result.error }}</Message
        >
        <template v-if="result.a"
            ><div class="simulation-results">
                <article
                    v-for="summary in summaries"
                    :key="summary.name"
                    class="scenario-result"
                    :aria-label="`시나리오 ${summary.name} 결과`">
                    <span
                        >시나리오 {{ summary.name }} ·
                        {{ setup.common.months }}개월 후</span
                    >
                    <h2>{{ money(summary.wealth) }}</h2>
                    <p>
                        가정 자산 = 주식 평가액 + 남은 투자 현금 + 보관한 배당금
                    </p>
                    <dl>
                        <dt>외부 납입 합계</dt>
                        <dd>{{ money(summary.contributed) }}</dd>
                        <dt>누적 세전 배당</dt>
                        <dd>{{ money(summary.grossTotal) }}</dd>
                        <dt>원천징수 가정액</dt>
                        <dd>{{ money(summary.taxTotal) }}</dd>
                        <dt>누적 세후 배당</dt>
                        <dd>{{ money(summary.netTotal) }}</dd>
                        <dt>누적 매수 수수료</dt>
                        <dd>{{ money(summary.fees) }}</dd>
                        <dt>가정 자산 − 외부 납입</dt>
                        <dd :class="{ loss: summary.gain < 0 }">
                            {{ money(summary.gain) }}
                        </dd>
                        <dt>최종 보유 수량</dt>
                        <dd>
                            {{
                                summary.shares.toLocaleString('ko-KR', {
                                    maximumFractionDigits: 6,
                                })
                            }}주
                        </dd>
                    </dl>
                </article>
            </div>
            <p class="simulation-difference">
                동일 통화·기간 기준 B − A 최종 자산 차이
                <b>{{
                    money(result.b.summary.wealth - result.a.summary.wealth)
                }}</b
                ><small
                    >{{
                        taxOnly
                            ? '원천징수율 차이에 따른 재투자·누적 자산 변화도 포함합니다.'
                            : '시나리오의 납입액과 배당 가정이 다르면 차이를 함께 확인하세요.'
                    }}
                    절세 확정액이나 실제 수익률이 아닙니다.</small
                >
            </p>
            <section class="simulation-chart" aria-label="가정 자산 추이">
                <h2>가정 자산 추이</h2>
                <div class="chart-legend">
                    <span class="a">● 시나리오 A</span
                    ><span class="b">● 시나리오 B</span
                    ><span>{{ setup.common.currency }} · 명목 금액</span>
                </div>
                <svg
                    viewBox="0 0 740 260"
                    role="img"
                    :aria-label="`${setup.common.months}개월 가정 자산 비교, A ${money(result.a.summary.wealth)}, B ${money(result.b.summary.wealth)}`">
                    <g v-for="tick in chart.ticks" :key="tick.y">
                        <line
                            x1="76"
                            x2="696"
                            :y1="tick.y"
                            :y2="tick.y"
                            class="chart-grid" />
                        <text x="66" :y="tick.y + 4" text-anchor="end">
                            {{ tick.label }}
                        </text>
                    </g>
                    <polyline
                        :points="chart.lines[0]"
                        fill="none"
                        stroke="#2563eb"
                        stroke-width="3" />
                    <polyline
                        :points="chart.lines[1]"
                        fill="none"
                        stroke="#d97706"
                        stroke-dasharray="7 4"
                        stroke-width="3" />
                    <text x="76" y="248">시작</text>
                    <text x="696" y="248" text-anchor="end">
                        {{ chart.maxMonth }}개월
                    </text>
                </svg>
            </section>
            <section class="simulation-table">
                <h2>월별 계산 내역</h2>
                <p>
                    배당은 해당 월의 지급액입니다. 재투자한 배당을 최종 자산에
                    다시 더하지 않습니다.
                </p>
                <DataTable
                    :value="monthlyRows"
                    paginator
                    :rows="12"
                    :rows-per-page-options="[12, 24, 60]"
                    scrollable
                    :table-style="{ minWidth: '52rem' }"
                    :table-props="{ 'aria-label': '월별 배당 가정 비교' }"
                    ><Column field="month" header="개월" /><Column
                        header="A 가정 자산"
                        ><template #body="{ data }">{{
                            money(data.a.wealth)
                        }}</template></Column
                    ><Column header="B 가정 자산"
                        ><template #body="{ data }">{{
                            money(data.b.wealth)
                        }}</template></Column
                    ><Column header="A 세후 배당"
                        ><template #body="{ data }">{{
                            money(data.a.net)
                        }}</template></Column
                    ><Column header="B 세후 배당"
                        ><template #body="{ data }">{{
                            money(data.b.net)
                        }}</template></Column
                    ><Column header="A 원천징수"
                        ><template #body="{ data }">{{
                            money(data.a.tax)
                        }}</template></Column
                    ><Column header="B 원천징수"
                        ><template #body="{ data }">{{
                            money(data.b.tax)
                        }}</template></Column
                    ><template #empty
                        >기간이 0개월이면 시작 시점의 매수·현금만
                        표시합니다.</template
                    ></DataTable
                >
            </section>
        </template>
        <details class="simulation-assumptions" open>
            <summary>계산 순서와 제외 항목</summary>
            <ol>
                <li>
                    시작 시점에 최초 투자액으로 매수합니다. 매월 초 추가
                    납입액과 남은 투자 현금으로 매수하며, 매수 건마다 입력한
                    고정 수수료를 차감합니다.
                </li>
                <li>
                    주가는 입력한 연간 변화율을 월 복리로 적용합니다. 연간 주당
                    배당금은 고정하고, 월·분기·반기·연간 주기에 따라 기간 시작
                    후 첫 지급월부터 균등 분배합니다. 매주는 연 52회 균등
                    간격으로 지급하며 연간 주당 배당금을 52로 나눕니다. 월별
                    결과에는 그달의 4~5회 지급액을 합산합니다.
                </li>
                <li>
                    배당 지급마다 원천징수 가정액을 차감합니다. 재투자하면 지급
                    시점의 주가로 매수하며 새 수량은 다음 지급부터 배당을
                    받습니다. 재투자하지 않은 배당은 현금으로 보관하고 이후
                    매수에 사용하지 않습니다. 매주는 월 복리 경로상의 지급 시점
                    주가를 사용하고, 나머지 주기는 월말에 지급합니다.
                </li>
                <li>
                    소수주 미허용이면 정수 수량만 매수하고 잔돈은 보관합니다.
                    반올림하지 않은 내부 계산값을 사용하며 화면 금액은 소수
                    4자리까지 표시합니다.
                </li>
                <li>
                    배당락에 따른 가격 조정, 배당 삭감·성장, 주식 분할, ROC
                    확정·정정, 환율·환전 비용, 매도 수수료·양도세, 물가 변화,
                    증권사별 지급·재투자 시차는 반영하지 않습니다.
                </li>
                <li>
                    국가·거주자·조세조약·계좌 유형·연도별 세법을 판정하지
                    않습니다. 종합과세·공제·외국납부세액·ISA·연금 혜택·신고액
                    계산은 제공하지 않습니다.
                </li>
            </ol>
        </details>
        <router-link to="/mypage?tab=calendar" class="calendar-link"
            >내 계좌 배당 캘린더 보기
            <i class="pi pi-arrow-right" aria-hidden="true"
        /></router-link>
    </section>
</template>
<style scoped>
    .simulator-page {
        display: grid;
        gap: 24px;
        min-width: 0;
    }
    .simulator-heading,
    .simulation-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
    }
    .simulator-heading h1 {
        font-size: 32px;
        margin: 8px 0;
    }
    .simulator-heading p {
        margin: 0;
        color: var(--app-muted);
        line-height: 1.8;
    }
    .simulation-actions > div {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .simulation-common {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 20px;
        padding: 24px;
        border: 1px solid var(--app-border);
        border-radius: 16px;
        background: var(--app-surface-muted);
    }
    .scenario-pair,
    .simulation-results {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 22px;
    }
    .scenario-result {
        border: 1px solid var(--app-border);
        border-top: 3px solid #2563eb;
        border-radius: 16px;
        padding: 24px;
        background: var(--app-surface);
        min-width: 0;
        overflow-wrap: anywhere;
    }
    .scenario-result:nth-child(2) {
        border-top-color: #d97706;
    }
    .scenario-result > span {
        color: var(--app-muted);
        font-size: 14px;
    }
    .scenario-result h2 {
        margin: 16px 0 10px;
        font-size: 30px;
        color: var(--app-accent);
    }
    .scenario-result p {
        font-size: 12px;
        color: var(--app-muted);
        line-height: 1.8;
    }
    .scenario-result dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 12px;
        font-size: 13px;
    }
    .scenario-result dt {
        color: var(--app-muted);
    }
    .scenario-result dd {
        margin: 0;
        font-weight: 650;
        text-align: right;
    }
    .scenario-result .loss {
        color: var(--p-red-600);
    }
    .simulation-difference {
        margin: 0;
        background: var(--app-surface-muted);
        padding: 20px;
        border-radius: 12px;
        line-height: 1.9;
    }
    .simulation-difference > b {
        display: block;
        font-size: 23px;
    }
    .simulation-difference small {
        display: block;
        color: var(--app-muted);
    }
    .simulation-chart,
    .simulation-table,
    .simulation-assumptions {
        border: 1px solid var(--app-border);
        border-radius: 16px;
        padding: 24px;
        background: var(--app-surface);
        min-width: 0;
    }
    .simulation-chart h2,
    .simulation-table h2 {
        margin: 0 0 16px;
        font-size: 21px;
    }
    .chart-legend {
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--app-muted);
    }
    .chart-legend .a {
        color: #2563eb;
    }
    .chart-legend .b {
        color: #d97706;
    }
    .simulation-chart svg {
        width: 100%;
        max-height: 360px;
        display: block;
        margin-top: 20px;
    }
    .chart-grid {
        stroke: var(--app-border);
        stroke-dasharray: 4 4;
    }
    .simulation-chart text {
        font-size: 13px;
        fill: var(--app-muted);
    }
    .simulation-table p {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.8;
    }
    .simulation-assumptions summary {
        cursor: pointer;
        font-weight: 650;
    }
    .simulation-assumptions li {
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.9;
        margin: 10px 0;
    }
    .simulation-assumptions ol {
        padding-left: 20px;
    }
    .currency-note {
        margin: -8px 0 0;
        color: var(--app-muted);
        font-size: 13px;
        line-height: 1.8;
    }
    .calendar-link {
        color: var(--app-accent);
        display: flex;
        gap: 12px;
        align-items: center;
    }
    @media (max-width: 800px) {
        .scenario-pair,
        .simulation-results {
            grid-template-columns: 1fr;
        }
        .simulation-common {
            grid-template-columns: 1fr;
        }
    }
    @media (max-width: 600px) {
        .simulator-heading h1 {
            font-size: 27px;
        }
        .simulation-chart,
        .simulation-table,
        .simulation-assumptions,
        .simulation-common,
        .scenario-result {
            padding: 18px;
        }
        .scenario-result h2 {
            font-size: 25px;
        }
        .scenario-result dl {
            grid-template-columns: 1fr;
        }
        .scenario-result dd {
            text-align: left;
            margin-bottom: 6px;
        }
        .simulation-chart text {
            font-size: 16px;
        }
    }
</style>
