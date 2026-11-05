<script setup>
    import { computed, ref } from 'vue';
    import { useHead } from '@vueuse/head';
    import Button from 'primevue/button';
    import InputNumber from 'primevue/inputnumber';
    import Select from 'primevue/select';
    import SelectButton from 'primevue/selectbutton';
    import Message from 'primevue/message';
    import Popover from 'primevue/popover';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import SimulationScenarioForm from '@/components/portfolio/SimulationScenarioForm.vue';
    import {
        simulateDividends,
        normalizeSimulationSetup,
    } from '@/services/dividendSimulation';
    useHead({ title: '배당 시뮬레이터 · 가정 비교' });
    const storageMenu = ref();
    const mobileLimit = ref(12);
    const frequencies = {
        weekly: '매주',
        monthly: '매월',
        quarterly: '분기',
        semiannual: '반기',
        annual: '매년',
    };
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

    const assetDifference = computed(() =>
        result.value.a
            ? (result.value.b.summary.wealth - result.value.a.summary.wealth) *
              (taxOnly.value ? -1 : 1)
            : 0
    );
    const breakdown = computed(() =>
        result.value.a
            ? [
                  ['외부 납입 합계', 'contributed'],
                  ['누적 세전 배당', 'grossTotal'],
                  ['적용 원천징수율 (가정)', 'rate'],
                  ['원천징수 가정액', 'taxTotal'],
                  ['누적 세후 배당', 'netTotal'],
                  ['누적 매수 수수료', 'fees'],
                  ['최종 주식 평가액', 'stockValue'],
                  ['최종 보유 현금', 'cash'],
                  ['가정 자산 − 외부 납입', 'gain'],
                  ['최종 총자산', 'wealth'],
              ].map(([label, key]) => ({
                  label,
                  kind: key === 'rate' ? 'rate' : 'money',
                  a:
                      key === 'rate'
                          ? Number(setup.value.a.taxRate)
                          : result.value.a.summary[key],
                  b:
                      key === 'rate'
                          ? Number(scenarioB.value.taxRate)
                          : result.value.b.summary[key],
              }))
            : []
    );
    const breakdownValue = (value, row, difference = false) =>
        row.kind === 'rate'
            ? `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 4 })}${difference ? '%p' : '%'}`
            : money(value);
    const mobileRows = computed(() =>
        monthlyRows.value.slice(0, mobileLimit.value)
    );
    const barWidth = (summary) =>
        `${Math.max(0, Math.min(100, summary.wealth > 0 ? (summary.stockValue / summary.wealth) * 100 : 0))}%`;
    const shares = (value) =>
        Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 6 });
</script>
<template>
    <section class="simulator-page" :class="{ 'tax-mode': taxOnly }">
        <header class="simulator-heading">
            <div class="simulator-badges">
                <span>가상 시뮬레이션 환경</span><span>사용자 가정</span
                ><span>단일 통화 명목 모델</span>
            </div>
            <div class="heading-row">
                <h1>
                    {{
                        taxOnly
                            ? '배당소득 원천징수율 비교 시뮬레이션'
                            : '배당 시뮬레이터'
                    }}
                </h1>
                <div class="storage-actions">
                    <Button
                        label="가정치 저장/불러오기"
                        icon="pi pi-bookmark"
                        severity="secondary"
                        outlined
                        aria-haspopup="dialog"
                        @click="storageMenu.toggle($event)" />
                    <Popover
                        ref="storageMenu"
                        aria-label="가정 저장 및 불러오기"
                        ><div class="storage-menu">
                            <Button
                                label="가정 저장"
                                icon="pi pi-bookmark"
                                :disabled="!!result.error"
                                @click="
                                    save();
                                    storageMenu.hide();
                                " />
                            <Button
                                label="저장된 가정 불러오기"
                                severity="secondary"
                                outlined
                                @click="
                                    restore();
                                    storageMenu.hide();
                                " /></div
                    ></Popover>
                    <Button
                        label="예시로 초기화"
                        icon="pi pi-refresh"
                        severity="secondary"
                        outlined
                        @click="reset" />
                </div>
            </div>
            <p>
                {{
                    taxOnly
                        ? '동일한 투자·배당 조건에서 원천징수율 가정에 따른 세후 배당과 기말 자산을 대조합니다.'
                        : '납입·배당·재투자 가정을 바꾸며 두 시나리오의 자산과 보유 수량을 비교해 보세요.'
                }}
            </p>
        </header>
        <div class="comparison-mode">
            <span>대조 모드 선택</span
            ><SelectButton
                v-model="setup.comparison"
                :options="comparisons"
                option-label="label"
                option-value="value"
                :allow-empty="false"
                aria-label="시뮬레이션 비교 방식" />
        </div>
        <aside class="simulation-notice">
            <i class="pi pi-info-circle" aria-hidden="true" />
            <div>
                <h2>시뮬레이션 전제조건 및 산출 안내</h2>
                <p>
                    입력한 주가·배당금·원천징수율이 유지된다는
                    <b>사용자 가정</b>으로 계산합니다. 실제 계좌·시장 데이터와
                    연결되지 않으며 미래 수익이나 세금 신고액을 예측·확정하지
                    않습니다. 예시 15%는 적용 세율을 판정한 값이 아닙니다.
                </p>
            </div>
        </aside>
        <Message
            v-if="notice"
            severity="success"
            :closable="false"
            role="status"
            >{{ notice }}</Message
        >
        <Message v-if="storageError" severity="error" :closable="false">{{
            storageError
        }}</Message>
        <div class="simulation-workspace">
            <section
                class="simulation-settings"
                aria-labelledby="simulation-settings-title">
                <header class="panel-heading">
                    <h2 id="simulation-settings-title">
                        <span class="section-number">01</span> 시뮬레이션 가정
                        설정
                    </h2>
                    <span class="currency-badge"
                        >{{ setup.common.currency }} 독립 산출</span
                    >
                </header>
                <section class="simulation-common" aria-label="공통 계산 가정">
                    <h3>공통 기본 가정</h3>
                    <div class="studio-field">
                        <label id="sim-currency-label" for="sim-currency"
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
                    통화를 바꾸면 입력 숫자의 단위만 바뀌며 환산하지 않습니다.
                    모든 입력은 선택한 통화 기준입니다.
                </p>
                <div class="scenario-pair">
                    <SimulationScenarioForm
                        v-model="setup.a"
                        name="A"
                        :currency="
                            setup.common.currency
                        " /><SimulationScenarioForm
                        v-if="!taxOnly"
                        :model-value="scenarioB"
                        name="B"
                        :tax-only="taxOnly"
                        :currency="setup.common.currency"
                        @update:model-value="setup.b = $event" />

                    <section
                        v-else
                        class="tax-inheritance"
                        aria-label="시나리오 B 입력">
                        <h2>시나리오 B · 세율 차이 비교</h2>
                        <div class="studio-field">
                            <label for="sim-B-taxRate"
                                >B 원천징수 가정 (%)</label
                            >
                            <InputNumber
                                v-model="setup.b.taxRate"
                                input-id="sim-B-taxRate"
                                :min="0"
                                :max="100"
                                :max-fraction-digits="6"
                                fluid />
                        </div>
                        <p class="tax-gap">
                            A 대비 원천징수율 차이:
                            {{
                                Number(setup.b.taxRate) -
                                Number(setup.a.taxRate)
                            }}%p
                        </p>
                        <div class="inherited-summary">
                            <h3>
                                <i class="pi pi-link" aria-hidden="true" />
                                시나리오 A 설정값 상속
                            </h3>
                            <dl>
                                <dt>최초 투자액</dt>
                                <dd>{{ money(setup.a.initial) }}</dd>
                                <dt>월 추가 납입</dt>
                                <dd>{{ money(setup.a.contribution) }}</dd>
                                <dt>시작 주가</dt>
                                <dd>{{ money(setup.a.price) }}</dd>
                                <dt>연간 주당 배당금</dt>
                                <dd>{{ money(setup.a.annualDividend) }}</dd>
                                <dt>매수 건당 수수료</dt>
                                <dd>{{ money(setup.a.fee) }}</dd>
                                <dt>배당 지급 주기</dt>
                                <dd>{{ frequencies[setup.a.frequency] }}</dd>
                                <dt>세후 배당 재투자</dt>
                                <dd>{{ setup.a.reinvest ? 'ON' : 'OFF' }}</dd>
                                <dt>소수주 매수 허용</dt>
                                <dd>{{ setup.a.fractional ? 'ON' : 'OFF' }}</dd>
                            </dl>
                            <p>
                                원천징수율 외 모든 가정은 A와 동일하게
                                연동됩니다.
                            </p>
                        </div>
                    </section>
                </div>

                <p class="live-calculation">
                    <i class="pi pi-check-circle" aria-hidden="true" /> 입력한
                    가정을 즉시 계산에 반영합니다.
                </p>
            </section>
            <div class="simulation-output" aria-label="시뮬레이션 결과">
                <Message
                    v-if="result.error"
                    severity="error"
                    :closable="false"
                    role="alert"
                    >{{ result.error }}</Message
                >
                <template v-if="result.a">
                    <div
                        class="simulation-kpis"
                        :class="{ 'tax-kpis': taxOnly }">
                        <article>
                            <span>초기 투자 원금 · A</span
                            ><strong>{{ money(setup.a.initial) }}</strong
                            ><small>{{ setup.common.currency }} 기준</small>
                        </article>
                        <article
                            v-for="summary in summaries"
                            :key="summary.name"
                            :class="`kpi-${summary.name}`">
                            <span
                                >시나리오 {{ summary.name }}
                                {{ taxOnly ? '세후 배당' : '가정 자산' }}</span
                            ><strong>{{
                                money(
                                    taxOnly ? summary.netTotal : summary.wealth
                                )
                            }}</strong
                            ><small
                                >{{ shares(summary.shares) }}주 · 원천징수
                                {{ money(summary.taxTotal) }}</small
                            >
                        </article>
                        <article v-if="taxOnly">
                            <span>누적 세후 배당 격차 · A − B</span
                            ><strong>{{
                                money(
                                    result.a.summary.netTotal -
                                        result.b.summary.netTotal
                                )
                            }}</strong
                            ><small>{{ setup.common.months }}개월 가정</small>
                        </article>
                    </div>
                    <section class="wealth-comparison">
                        <header class="panel-heading">
                            <div>
                                <h2>
                                    {{ setup.common.months }}개월 후 가정 자산
                                    및 주식 수 대조
                                </h2>
                                <p>
                                    가정 자산 = 주식 평가액 + 남은 투자 현금 +
                                    보관한 배당금
                                </p>
                            </div>
                        </header>
                        <div class="simulation-results">
                            <article
                                v-for="summary in summaries"
                                :key="summary.name"
                                class="scenario-result"
                                :aria-label="`시나리오 ${summary.name} 결과`">
                                <span
                                    >시나리오 {{ summary.name }} ·
                                    {{
                                        (summary.name === 'A'
                                            ? setup.a
                                            : scenarioB
                                        ).reinvest
                                            ? '세후 배당 재투자'
                                            : '배당 현금 보유'
                                    }}</span
                                >
                                <h2>{{ money(summary.wealth) }}</h2>
                                <div
                                    class="wealth-bar"
                                    :aria-label="`주식 평가액 ${money(summary.stockValue)}, 현금 ${money(summary.cash)}`"
                                    role="img">
                                    <span
                                        :style="{ width: barWidth(summary) }" />
                                </div>
                                <dl>
                                    <dt>최종 보유 수량</dt>
                                    <dd>{{ shares(summary.shares) }}주</dd>
                                    <dt>주식 평가액</dt>
                                    <dd>{{ money(summary.stockValue) }}</dd>
                                    <dt>보유 현금</dt>
                                    <dd>{{ money(summary.cash) }}</dd>
                                </dl>
                            </article>
                        </div>
                        <p class="simulation-difference">
                            동일 통화·기간 기준
                            {{ taxOnly ? 'A − B' : 'B − A' }} 최종 자산 차이
                            <b>{{ money(assetDifference) }}</b
                            ><small
                                >{{
                                    taxOnly
                                        ? '원천징수율 차이에 따른 재투자·누적 자산 변화도 포함합니다.'
                                        : '납입액과 배당 가정이 다르면 차이를 함께 확인하세요.'
                                }}
                                절세 확정액이나 실제 수익률이 아닙니다.</small
                            >
                        </p>
                    </section>
                    <section
                        class="comparison-breakdown"
                        aria-labelledby="comparison-breakdown-title">
                        <header class="panel-heading">
                            <h2 id="comparison-breakdown-title">
                                세부 항목별 산출 대조 명세
                            </h2>
                            <span>{{ setup.common.currency }} 기준</span>
                        </header>
                        <table v-if="taxOnly" class="tax-breakdown-table">
                            <caption>
                                원천징수율 가정에 따른 상세 대조 ·
                                {{
                                    setup.common.currency
                                }}
                            </caption>
                            <thead>
                                <tr>
                                    <th scope="col">비교 항목</th>
                                    <th scope="col">시나리오 A</th>
                                    <th scope="col">시나리오 B</th>
                                    <th scope="col">격차 (A − B)</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr v-for="row in breakdown" :key="row.label">
                                    <th scope="row">{{ row.label }}</th>
                                    <td>{{ breakdownValue(row.a, row) }}</td>
                                    <td>{{ breakdownValue(row.b, row) }}</td>
                                    <td>
                                        {{
                                            breakdownValue(
                                                row.a - row.b,
                                                row,
                                                true
                                            )
                                        }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                        <div
                            class="breakdown-grid"
                            :class="{ 'tax-breakdown-cards': taxOnly }">
                            <article v-for="row in breakdown" :key="row.label">
                                <h3>{{ row.label }}</h3>
                                <dl>
                                    <dt>시나리오 A</dt>
                                    <dd>{{ breakdownValue(row.a, row) }}</dd>
                                    <dt>시나리오 B</dt>
                                    <dd>{{ breakdownValue(row.b, row) }}</dd>
                                </dl>
                                <p>
                                    {{ taxOnly ? 'A − B' : 'B − A' }}
                                    <b>{{
                                        breakdownValue(
                                            (row.b - row.a) *
                                                (taxOnly ? -1 : 1),
                                            row,
                                            true
                                        )
                                    }}</b>
                                </p>
                            </article>
                        </div>
                    </section>
                    <section
                        class="simulation-chart"
                        aria-label="가정 자산 추이">
                        <h2>가정 자산 추이</h2>
                        <div class="chart-legend">
                            <span class="a">● 시나리오 A</span
                            ><span class="b">● 시나리오 B</span
                            ><span
                                >{{ setup.common.currency }} · 명목 금액</span
                            >
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
                                stroke="var(--sim-a)"
                                stroke-width="3" />
                            <polyline
                                :points="chart.lines[1]"
                                fill="none"
                                stroke="var(--sim-b)"
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
                            배당은 해당 월의 지급액입니다. 재투자한 배당을 최종
                            자산에 다시 더하지 않습니다.
                        </p>
                        <DataTable
                            class="monthly-desktop"
                            :value="monthlyRows"
                            paginator
                            :rows="12"
                            :rows-per-page-options="[12, 24, 60]"
                            scrollable
                            :table-style="{ minWidth: '52rem' }"
                            :table-props="{
                                'aria-label': '월별 배당 가정 비교',
                            }"
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

                        <div
                            class="monthly-mobile"
                            aria-label="월별 배당 가정 비교">
                            <p v-if="!monthlyRows.length">
                                기간이 0개월이면 시작 시점의 매수·현금만
                                표시합니다.
                            </p>
                            <article
                                v-for="row in mobileRows"
                                :key="row.month"
                                class="month-card">
                                <header>
                                    <h3>{{ row.month }}개월차</h3>
                                    <span>월별 계산 내역</span>
                                </header>
                                <div class="month-scenarios">
                                    <dl
                                        v-for="name in ['a', 'b']"
                                        :key="name"
                                        :aria-label="`${row.month}개월 시나리오 ${name.toUpperCase()}`">
                                        <dt>
                                            시나리오 {{ name.toUpperCase() }} ·
                                            가정 자산
                                        </dt>
                                        <dd>{{ money(row[name].wealth) }}</dd>
                                        <dt>세후 배당</dt>
                                        <dd>{{ money(row[name].net) }}</dd>
                                        <dt>원천징수 가정액</dt>
                                        <dd>{{ money(row[name].tax) }}</dd>
                                        <dt>보유 수량</dt>
                                        <dd>
                                            {{ shares(row[name].shares) }}주
                                        </dd>
                                    </dl>
                                </div>
                            </article>
                            <Button
                                v-if="mobileRows.length < monthlyRows.length"
                                label="다음 12개월 더 보기"
                                severity="secondary"
                                outlined
                                @click="mobileLimit += 12" />
                        </div>
                    </section>
                </template>
            </div>
        </div>
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
    /* Source: Stitch 17382728461495959991; per-device IDs and unresolved
       source differences are recorded in docs/design/SIMULATOR_REVIEW.md. */
    :global(.shell-body:has(> .studio-main > .simulator-page)) {
        max-width: 1440px;
    }
    :global(.studio-main:has(> .simulator-page)) {
        max-width: 1440px;
        padding: 40px;
    }
    :global(.studio-main:has(> .simulator-page.tax-mode)) {
        padding: 32px;
    }
    .simulator-page {
        --sim-a: var(--app-accent);
        --sim-b: #b77900;
        --sim-b-bg: #fffbeb;
        --sim-b-border: #fde68a;
        display: grid;
        gap: 24px;
        min-width: 0;
        font-variant-numeric: tabular-nums;
        color: var(--app-text);
    }
    :global(.p-dark) .simulator-page {
        --sim-b: #f7be1d;
        --sim-b-bg: #30270e;
        --sim-b-border: #896700;
    }
    .simulator-heading {
        display: grid;
        gap: 8px;
    }
    .simulator-badges,
    .heading-row,
    .storage-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
    }
    .heading-row {
        justify-content: space-between;
        gap: 16px;
    }
    .simulator-badges > span {
        padding: 3px 8px;
        border: 1px solid var(--app-border);
        border-radius: 999px;
        background: var(--app-surface-muted);
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
    }
    .simulator-badges > span:first-child {
        color: var(--sim-a);
        border-color: var(--p-primary-200);
        background: var(--p-highlight-background);
        font-weight: 600;
    }
    .simulator-heading h1 {
        font-size: 32px;
        line-height: 1.25;
        margin: 0;
        letter-spacing: -0.025em;
    }
    .simulator-heading p {
        margin: 0;
        font-size: 14px;
        line-height: 1.625;
        color: var(--app-muted);
    }
    .storage-actions :deep(.p-button) {
        font-size: 12px;
        min-height: 38px;
        padding: 8px 12px;
    }
    .storage-menu {
        display: grid;
        gap: 8px;
    }
    .comparison-mode {
        display: grid;
        gap: 6px;
        justify-items: start;
    }
    .comparison-mode > span {
        font-size: 11px;
        font-weight: 600;
        color: var(--app-muted);
    }
    .comparison-mode :deep(.p-togglebutton) {
        min-height: 38px;
        font-size: 12px;
    }
    .simulation-notice {
        display: flex;
        gap: 12px;
        padding: 18px;
        border: 1px solid var(--sim-b-border);
        border-radius: 12px;
        background: var(--sim-b-bg);
    }
    .simulation-notice > i {
        color: var(--sim-b);
        margin-top: 3px;
        flex-shrink: 0;
    }
    .simulation-notice h2 {
        margin: 0 0 6px;
        font-size: 13px;
        line-height: 20px;
    }
    .simulation-notice p {
        margin: 0;
        font-size: 12px;
        line-height: 1.625;
        color: var(--app-muted);
    }
    .simulation-workspace {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 24px;
        align-items: start;
    }
    .simulation-settings,
    .wealth-comparison,
    .comparison-breakdown,
    .simulation-chart,
    .simulation-table,
    .simulation-assumptions {
        min-width: 0;
        background: var(--app-surface);
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 1px 2px rgb(15 23 42 / 0.05);
    }
    .simulation-settings {
        grid-column: span 4;
        display: grid;
        gap: 16px;
    }
    .panel-heading {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding-bottom: 16px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--app-border);
    }
    .simulation-settings > .panel-heading {
        margin-bottom: 0;
    }
    .panel-heading h2 {
        margin: 0;
        font-size: 20px;
        line-height: 28px;
    }
    .panel-heading > span,
    .panel-heading p {
        margin: 4px 0 0;
        color: var(--app-muted);
        font-size: 11px;
        line-height: 1.5;
    }
    .section-number {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        margin-right: 4px;
        border-radius: 6px;
        font-size: 12px;
        color: var(--sim-a);
        background: var(--p-highlight-background);
    }
    .panel-heading .currency-badge {
        margin: 0;
        color: var(--sim-a);
        background: var(--p-highlight-background);
        border: 1px solid var(--p-primary-200);
        border-radius: 4px;
        padding: 2px 6px;
        white-space: nowrap;
        font-weight: 600;
        font-size: 10px;
    }
    .simulation-common {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface-muted);
        min-width: 0;
    }
    .simulation-common h3 {
        grid-column: 1 / -1;
        margin: 0 0 2px;
        font-size: 12px;
        line-height: 18px;
    }
    .simulation-common > .studio-field:last-child {
        grid-column: 1 / -1;
    }
    .studio-field {
        display: grid;
        gap: 4px;
        min-width: 0;
    }
    .simulator-page :deep(.studio-field label) {
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .simulator-page :deep(.p-inputnumber),
    .simulator-page :deep(.p-select) {
        width: 100%;
        min-width: 0;
    }
    .simulator-page :deep(.p-inputnumber-input) {
        min-width: 0;
        width: 100%;
        height: 44px;
        padding: 8px 10px;
        border-radius: 8px;
        text-align: right;
        font-size: 12px;
        font-weight: 600;
    }
    .simulator-page :deep(.p-select-label) {
        padding: 12px 10px;
        font-size: 12px;
    }
    .currency-note {
        margin: 0;
        color: var(--app-muted);
        font-size: 10px;
        line-height: 1.5;
    }
    .scenario-pair {
        display: grid;
        gap: 12px;
        min-width: 0;
    }
    .scenario-pair :deep(.scenario-form),
    .tax-inheritance {
        border: 1px solid var(--p-primary-200);
        background: var(--app-surface);
        border-radius: 8px;
        padding: 12px;
    }
    .scenario-pair :deep(.scenario-form:nth-child(2)),
    .tax-inheritance {
        border-color: var(--sim-b-border);
    }
    .scenario-pair :deep(.scenario-form header) {
        gap: 6px;
        border-bottom: 1px solid var(--app-border);
        padding-bottom: 8px;
        margin-bottom: 10px;
    }
    .scenario-pair :deep(.scenario-form h2),
    .tax-inheritance h2 {
        margin: 0;
        font-size: 12px;
        line-height: 18px;
        color: var(--sim-a);
    }
    .scenario-pair :deep(.scenario-form:nth-child(2) h2),
    .tax-inheritance h2 {
        color: var(--sim-b);
    }
    .scenario-pair :deep(.scenario-badge) {
        padding: 2px 5px;
        border-radius: 4px;
        font-size: 10px;
    }
    .scenario-pair :deep(.scenario-fields) {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
    }
    .scenario-pair :deep(.scenario-fields > .studio-field:last-child) {
        grid-column: 1 / -1;
    }
    .scenario-pair :deep(.scenario-fields small) {
        font-size: 10px;
    }
    .scenario-pair :deep(.scenario-switches) {
        display: grid;
        gap: 10px;
        margin-top: 12px;
    }
    .scenario-pair :deep(.scenario-switches label) {
        font-size: 11px;
        line-height: 16px;
        min-height: 28px;
        gap: 8px;
    }
    .tax-inheritance > .studio-field {
        margin-top: 12px;
    }
    .tax-gap {
        color: var(--sim-b);
        font-size: 11px;
        line-height: 16px;
    }
    .inherited-summary {
        border: 1px solid var(--app-border);
        background: var(--app-surface-muted);
        border-radius: 8px;
        padding: 12px;
    }
    .inherited-summary h3 {
        font-size: 11px;
        margin: 0 0 8px;
        color: var(--app-muted);
    }
    .inherited-summary dl {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 6px 8px;
        margin: 0;
        font-size: 11px;
        line-height: 16px;
    }
    .inherited-summary dd {
        text-align: right;
        margin: 0;
        overflow-wrap: anywhere;
    }
    .inherited-summary dt {
        color: var(--app-muted);
    }
    .inherited-summary p {
        margin: 8px 0 0;
        padding-top: 8px;
        border-top: 1px solid var(--app-border);
        font-size: 10px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .live-calculation {
        margin: 0;
        padding: 12px;
        border-radius: 8px;
        background: var(--p-highlight-background);
        color: var(--sim-a);
        text-align: center;
        font-size: 12px;
        line-height: 20px;
        font-weight: 600;
    }
    .live-calculation i {
        margin-right: 4px;
    }
    .simulation-output {
        grid-column: span 8;
        display: grid;
        gap: 24px;
        min-width: 0;
    }
    .simulation-kpis {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
    }
    .simulation-kpis.tax-kpis {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .simulation-kpis article {
        border: 1px solid var(--app-border);
        border-radius: 12px;
        padding: 16px;
        background: var(--app-surface);
        min-width: 0;
    }
    .simulation-kpis article > span,
    .simulation-kpis article > small {
        display: block;
        color: var(--app-muted);
        font-size: 11px;
        line-height: 16px;
    }
    .simulation-kpis strong {
        display: block;
        font-size: 22px;
        line-height: 28px;
        margin: 6px 0;
        overflow-wrap: anywhere;
    }
    .simulation-kpis .kpi-A {
        border-left: 4px solid var(--sim-a);
    }
    .simulation-kpis .kpi-A strong {
        color: var(--sim-a);
    }
    .simulation-kpis .kpi-B {
        border-left: 4px solid var(--sim-b);
    }
    .simulation-kpis .kpi-B strong {
        color: var(--sim-b);
    }
    .simulation-results {
        display: grid;
        gap: 16px;
    }
    .scenario-result {
        padding: 16px;
        border: 1px solid var(--p-primary-200);
        border-radius: 8px;
        min-width: 0;
    }
    .scenario-result:nth-child(2) {
        border-color: var(--sim-b-border);
    }
    .scenario-result > span {
        font-size: 12px;
        font-weight: 600;
        color: var(--sim-a);
    }
    .scenario-result:nth-child(2) > span {
        color: var(--sim-b);
    }
    .scenario-result h2 {
        margin: 8px 0;
        font-size: 28px;
        line-height: 36px;
        overflow-wrap: anywhere;
        color: var(--sim-a);
    }
    .scenario-result:nth-child(2) h2 {
        color: var(--sim-b);
    }
    .wealth-bar {
        display: flex;
        height: 8px;
        background: var(--app-border);
        border-radius: 999px;
        overflow: hidden;
    }
    .wealth-bar > span {
        background: var(--sim-a);
    }
    .scenario-result:nth-child(2) .wealth-bar > span {
        background: var(--sim-b);
    }
    .scenario-result dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
        margin: 12px 0 0;
        font-size: 11px;
        line-height: 16px;
    }
    .scenario-result dt {
        color: var(--app-muted);
    }
    .scenario-result dd {
        margin: 0;
        text-align: right;
        overflow-wrap: anywhere;
    }
    .simulation-difference {
        margin: 16px 0 0;
        padding: 12px;
        border: 1px solid var(--app-border);
        border-radius: 8px;
        background: var(--app-surface-muted);
        font-size: 12px;
        line-height: 20px;
    }
    .simulation-difference b {
        display: block;
        color: var(--sim-a);
        font-size: 22px;
        line-height: 28px;
        margin: 4px 0;
        overflow-wrap: anywhere;
    }
    .simulation-difference small {
        color: var(--app-muted);
        display: block;
        font-size: 11px;
        line-height: 16px;
    }
    .breakdown-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
    }
    .breakdown-grid article {
        padding: 12px;
        border-radius: 8px;
        border: 1px solid var(--app-border);
        background: var(--app-surface-muted);
        min-width: 0;
    }
    .breakdown-grid h3 {
        margin: 0 0 8px;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .breakdown-grid dl {
        margin: 0;
        display: grid;
        gap: 4px;
        font-size: 11px;
        line-height: 16px;
    }
    .breakdown-grid dd {
        margin: 0 0 4px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }
    .breakdown-grid dt {
        color: var(--sim-a);
    }
    .breakdown-grid dt:nth-of-type(2) {
        color: var(--sim-b);
    }
    .breakdown-grid p {
        margin: 6px 0 0;
        border-top: 1px solid var(--app-border);
        padding-top: 6px;
        font-size: 10px;
        line-height: 16px;
        color: var(--app-muted);
        overflow-wrap: anywhere;
    }
    .simulation-chart h2,
    .simulation-table h2 {
        margin: 0 0 12px;
        font-size: 20px;
        line-height: 28px;
    }
    .chart-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 11px;
        line-height: 16px;
        color: var(--app-muted);
    }
    .chart-legend .a {
        color: var(--sim-a);
    }
    .chart-legend .b {
        color: var(--sim-b);
    }
    .simulation-chart svg {
        width: 100%;
        display: block;
        margin-top: 16px;
    }
    .chart-grid {
        stroke: var(--app-border);
        stroke-dasharray: 4 4;
    }
    .simulation-chart text {
        fill: var(--app-muted);
        font-size: 13px;
    }
    .simulation-table > p,
    .simulation-assumptions li {
        color: var(--app-muted);
        font-size: 12px;
        line-height: 1.625;
    }
    .simulation-table :deep(.p-datatable) {
        font-size: 11px;
    }
    .monthly-mobile {
        display: none;
    }
    .simulation-assumptions summary {
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        line-height: 20px;
    }
    .simulation-assumptions ol {
        padding-left: 20px;
        margin-bottom: 0;
    }
    .simulation-assumptions li {
        margin: 8px 0;
    }
    .calendar-link {
        color: var(--sim-a);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
    }
    @media (min-width: 768px) and (max-width: 1023px) {
        :global(.studio-main:has(> .simulator-page)),
        :global(.studio-main:has(> .simulator-page.tax-mode)) {
            max-width: 834px;
            padding: 24px;
        }
        .simulator-page {
            gap: 20px;
        }
        .simulator-heading h1 {
            font-size: 24px;
            line-height: 32px;
        }
        .simulator-heading p {
            font-size: 12px;
            line-height: 1.625;
        }
        .simulation-workspace {
            grid-template-columns: repeat(12, minmax(0, 1fr));
            gap: 20px;
        }
        .simulation-output {
            gap: 16px;
        }
        .simulation-settings,
        .wealth-comparison,
        .comparison-breakdown,
        .simulation-chart,
        .simulation-table,
        .simulation-assumptions {
            padding: 16px;
        }
        .panel-heading {
            padding-bottom: 12px;
            margin-bottom: 14px;
        }
        .panel-heading h2,
        .simulation-chart h2,
        .simulation-table h2 {
            font-size: 14px;
            line-height: 20px;
        }
        .simulation-settings > .panel-heading {
            flex-wrap: wrap;
        }
        .simulation-settings {
            gap: 14px;
        }
        .simulation-common,
        .scenario-pair :deep(.scenario-form),
        .tax-inheritance {
            padding: 10px;
        }
        .simulation-kpis {
            gap: 8px;
        }
        .simulation-kpis article {
            padding: 12px;
        }
        .simulation-kpis strong {
            font-size: 16px;
            line-height: 24px;
        }
        .simulation-kpis.tax-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .simulation-kpis article > span,
        .simulation-kpis article > small {
            font-size: 10px;
            line-height: 14px;
        }
        .scenario-result h2 {
            font-size: 22px;
            line-height: 28px;
        }
        .breakdown-grid {
            gap: 8px;
        }
    }
    @media (max-width: 767px) {
        :global(.studio-main:has(> .simulator-page)) {
            max-width: 414px;
            padding: 16px 12px;
        }
        :global(.studio-main:has(> .simulator-page.tax-mode)) {
            max-width: 390px;
            padding: 24px 16px;
        }
        .simulator-page {
            gap: 16px;
        }
        .tax-mode {
            gap: 20px;
        }
        .heading-row {
            gap: 8px;
        }
        .simulator-heading h1 {
            font-size: 20px;
            line-height: 28px;
        }
        .simulator-heading p {
            font-size: 12px;
            line-height: 1.625;
        }
        .storage-actions {
            gap: 6px;
        }
        .storage-actions :deep(.p-button) {
            min-height: 36px;
            padding: 8px 10px;
            font-size: 11px;
        }
        .comparison-mode {
            justify-items: stretch;
        }
        .comparison-mode :deep(.p-selectbutton) {
            display: flex;
        }
        .comparison-mode :deep(.p-togglebutton) {
            flex: 1;
            min-width: 0;
            font-size: 11px;
            padding: 4px;
        }
        .comparison-mode :deep(.p-togglebutton-label) {
            white-space: normal;
        }
        .simulation-notice {
            padding: 14px;
            gap: 10px;
        }
        .simulation-notice h2 {
            font-size: 12px;
            line-height: 18px;
        }
        .simulation-workspace {
            grid-template-columns: 1fr;
            gap: 16px;
        }
        .simulation-output {
            gap: 16px;
        }
        .simulation-settings,
        .wealth-comparison,
        .comparison-breakdown,
        .simulation-chart,
        .simulation-table,
        .simulation-assumptions {
            padding: 14px;
        }
        .panel-heading {
            padding-bottom: 8px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }
        .panel-heading h2,
        .simulation-chart h2,
        .simulation-table h2 {
            font-size: 14px;
            line-height: 20px;
        }
        .simulation-settings {
            gap: 14px;
        }
        .simulation-common {
            padding: 10px;
        }
        .simulation-kpis {
            gap: 8px;
        }
        .simulation-kpis article {
            padding: 10px;
        }
        .simulation-kpis strong {
            font-size: 14px;
            line-height: 20px;
        }
        .simulation-kpis article > span,
        .simulation-kpis article > small {
            font-size: 10px;
            line-height: 14px;
        }
        .simulation-kpis.tax-kpis {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }
        .scenario-result {
            padding: 10px;
        }
        .scenario-result h2 {
            font-size: 22px;
            line-height: 28px;
        }
        .scenario-result dl {
            font-size: 11px;
        }
        .breakdown-grid {
            gap: 8px;
        }
        .breakdown-grid article {
            padding: 10px;
        }
        .monthly-desktop {
            display: none;
        }
        .monthly-mobile {
            display: grid;
            gap: 10px;
        }
        .month-card {
            padding: 10px;
            border: 1px solid var(--app-border);
            border-radius: 8px;
        }
        .month-card header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding-bottom: 8px;
            border-bottom: 1px dashed var(--app-border);
        }
        .month-card h3 {
            margin: 0;
            font-size: 12px;
            line-height: 18px;
        }
        .month-card header > span {
            font-size: 10px;
            color: var(--app-muted);
        }
        .month-scenarios {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }
        .month-scenarios dl {
            display: grid;
            gap: 4px;
            margin: 8px 0 0;
            font-size: 10px;
            line-height: 16px;
        }
        .month-scenarios dt {
            color: var(--app-muted);
        }
        .month-scenarios dd {
            margin: 0 0 4px;
            font-weight: 600;
            overflow-wrap: anywhere;
        }
        .month-scenarios dl:first-child dd {
            color: var(--sim-a);
        }
        .month-scenarios dl:nth-child(2) dd {
            color: var(--sim-b);
        }
    }

    .tax-breakdown-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
        line-height: 18px;
        table-layout: fixed;
    }
    .tax-breakdown-table caption {
        text-align: left;
        color: var(--app-muted);
        font-size: 11px;
        padding-bottom: 12px;
    }
    .tax-breakdown-table th,
    .tax-breakdown-table td {
        border-bottom: 1px solid var(--app-border);
        padding: 12px 8px;
        text-align: right;
        overflow-wrap: anywhere;
    }
    .tax-breakdown-table th:first-child {
        text-align: left;
    }
    .tax-breakdown-table thead {
        background: var(--app-surface-muted);
    }
    .tax-breakdown-cards {
        display: none;
    }
    @media (min-width: 1024px) {
        .tax-mode .simulator-heading h1 {
            font-size: 30px;
            line-height: 38px;
            min-height: 38px;
        }
        .tax-mode :deep(.p-inputnumber-input) {
            height: 40px;
            min-height: 40px;
        }
    }
    @media (min-width: 768px) and (max-width: 1023px) {
        .simulation-settings {
            grid-column: span 5;
        }
        .simulation-output {
            grid-column: span 7;
        }
        .tax-mode {
            gap: 24px;
        }
        .tax-mode .simulation-workspace,
        .tax-mode .simulation-output {
            gap: 24px;
        }
        .tax-mode .simulation-settings {
            padding: 24px;
            gap: 20px;
        }
        .tax-mode .simulator-heading h1 {
            font-size: 30px;
            line-height: 38px;
            min-height: 38px;
        }
        .tax-mode :deep(.p-inputnumber-input) {
            height: 38px;
            min-height: 38px;
        }
        .tax-mode .tax-inheritance :deep(.p-inputnumber-input) {
            height: 44px;
            min-height: 44px;
        }
    }
    @media (max-width: 767px) {
        .simulation-settings,
        .simulation-output {
            grid-column: auto;
        }
        .tax-mode .simulation-settings,
        .tax-mode .wealth-comparison,
        .tax-mode .comparison-breakdown {
            padding: 16px;
        }
        .tax-mode .simulation-settings {
            gap: 16px;
        }
        .tax-mode .panel-heading h2 {
            font-size: 17px;
            line-height: 23px;
        }
        .tax-breakdown-table {
            display: none;
        }
        .tax-breakdown-cards {
            display: grid;
        }
    }
</style>
