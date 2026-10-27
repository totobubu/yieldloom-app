<script setup>
    import { computed, reactive } from 'vue';
    import { useHead } from '@vueuse/head';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import Message from 'primevue/message';
    import InputNumber from 'primevue/inputnumber';
    import DataTable from 'primevue/datatable';
    import Column from 'primevue/column';
    import ProgressBar from 'primevue/progressbar';
    import Tag from 'primevue/tag';
    import {
        dividendRecoveryRate,
        sheetPortfolioExample,
        temporaryProjectionHoldings,
    } from '@/services/adminPortfolioExample.js';
    import { simulateHeldPortfolio } from '@/services/holdingSimulation.js';

    useHead({ title: '포트폴리오 원금 기준안' });

    const usd = new Intl.NumberFormat('ko-KR', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
    });
    const legacyRate = computed(() =>
        dividendRecoveryRate(
            sheetPortfolioExample.displayedPrincipalUsd,
            sheetPortfolioExample.cumulativeDividendUsd
        )
    );
    const sourceCards = [
        {
            number: '01',
            title: '순수 원화 실납입',
            value: '미분류',
            severity: 'warn',
            detail: '내 은행에서 투자계좌로 보낸 원화 전체를 포함합니다. 환전한 원화도 이 금액의 일부로 기록하고 별도 원금으로 더하지 않습니다.',
            needed: 'USD 환산에는 명시한 기준 환율 필요',
        },
        {
            number: '02',
            title: '순수 달러 실납입',
            value: '미분류',
            severity: 'warn',
            detail: '외부에서 USD로 직접 입금한 돈만 포함합니다. 원화 납입액은 기준 환율로 USD 환산해 더합니다.',
            needed: '계좌 내 환전으로 생긴 USD는 USD 실납입에서 제외',
        },
        {
            number: '03',
            title: '재투자 포함 현재 원가',
            value: '미분류',
            severity: 'warn',
            detail: '배당과 매도대금으로 다시 매수한 금액은 최초 원금이 아니라 ‘현재 위험노출’로 따로 보여줍니다.',
            needed: '매수별 자금 출처(원금·배당·매도대금) 확정 필요',
        },
    ];
    const standards = [
        {
            name: '현금 원금 회수율',
            formula: '계좌 밖 원금 인출 ÷ 외부 실납입',
            use: '대표 지표',
            description: '실제로 내 주머니로 돌아온 원금만 인정합니다.',
        },
        {
            name: '미회수 원금',
            formula: 'max(외부 실납입 - 원금 인출, 0)',
            use: '잔액',
            description: '아직 현금으로 못 건진 최초 자금을 보여줍니다.',
        },
        {
            name: '청산 기준 회수율',
            formula:
                '(누적 인출 + 명시적으로 입력한 세후 청산가치) ÷ 외부 실납입',
            use: '보조 지표',
            description: '지금 모두 팔았을 때의 전체 결과를 보여줍니다.',
        },
        {
            name: '현재 위험노출액',
            formula: '현재 보유자산의 취득원가·평가액',
            use: '위험 지표',
            description:
                '재투자금도 내 돈이므로 시장 위험에서 제외하지 않습니다.',
        },
        {
            name: '시간 반영 수익률',
            formula: '모든 입·출금 날짜를 사용한 XIRR',
            use: '성과 지표',
            description: '돈을 언제 넣고 뺈지까지 반영해 연환산 성과를 봅니다.',
        },
    ];
    const projectionSetup = reactive({
        contribution: 500,
        reduction: 20,
        months: 60,
        taxRate: 15,
        fee: 0,
        annualPriceChange: -5,
    });
    const projection = computed(() =>
        simulateHeldPortfolio(temporaryProjectionHoldings, {
            ...projectionSetup,
            currency: 'USD',
        })
    );
    const projectionCards = computed(() =>
        projection.value.scenarios.map((scenario) => ({
            ...scenario,
            monthlyDividend: scenario.rows.at(-1)?.net || 0,
        }))
    );
    const projectionTable = computed(() => {
        const indexes = [12, 24, 36, 60]
            .filter((month) => month <= projectionSetup.months)
            .map((month) => month - 1);
        if (
            projectionSetup.months > 0 &&
            !indexes.includes(projectionSetup.months - 1)
        )
            indexes.push(projectionSetup.months - 1);
        return indexes.map((index) => ({
            month: index + 1,
            cash: projection.value.scenarios[0].rows[index].net,
            reinvest: projection.value.scenarios[1].rows[index].net,
            reduced: projection.value.scenarios[2].rows[index].net,
        }));
    });
    const projectionFields = [
        {
            key: 'contribution',
            label: '월 추가 투자금',
            min: 0,
            max: 100000,
            suffix: ' USD',
        },
        {
            key: 'months',
            label: '예측 기간',
            min: 12,
            max: 360,
            suffix: '개월',
        },
        {
            key: 'reduction',
            label: '분배금 감소',
            min: 0,
            max: 100,
            suffix: '%',
        },
        {
            key: 'annualPriceChange',
            label: '연 주가 변화',
            min: -95,
            max: 100,
            suffix: '%',
        },
    ];
</script>

<template>
    <main class="portfolio-example">
        <header class="hero">
            <div>
                <span class="eyebrow">ADMIN · PORTFOLIO LAB</span>
                <h1>원금을 하나의 숫자로<br />부르지 않기</h1>
                <p>
                    실납입, 재투자, 현금 회수를 분리한 관리자용 포트폴리오
                    기준안입니다.
                </p>
            </div>
            <div class="hero-actions">
                <Button
                    as="router-link"
                    to="/mypage?view=capital"
                    label="현재 원금 화면"
                    icon="pi pi-wallet" />
                <Button
                    as="router-link"
                    to="/admin/portfolio-mappings"
                    label="관리자 메뉴"
                    severity="secondary"
                    outlined />
            </div>
        </header>

        <Message severity="warn" :closable="false">
            <strong>현재 시트의 96.23%는 현금 회수율이 아닙니다.</strong>
            누적 배당
            {{ usd.format(sheetPortfolioExample.cumulativeDividendUsd) }}을 표시
            원금
            {{ usd.format(sheetPortfolioExample.displayedPrincipalUsd) }}으로
            나눈 ‘배당 누적률’이며, 재투자한 배당도 계속 올라갑니다.
        </Message>

        <section class="snapshot" aria-labelledby="snapshot-title">
            <div class="section-heading">
                <div>
                    <span class="eyebrow">SHEET SNAPSHOT</span>
                    <h2 id="snapshot-title">시트에서 확인된 숫자</h2>
                </div>
                <Tag
                    :value="`${sheetPortfolioExample.asOf} 기준`"
                    severity="secondary" />
            </div>
            <div class="snapshot-grid">
                <Card>
                    <template #title>표시 원금</template>
                    <template #content>
                        <strong class="metric-value">{{
                            usd.format(
                                sheetPortfolioExample.displayedPrincipalUsd
                            )
                        }}</strong>
                        <p>부부 합산 시트 표시값</p>
                    </template>
                </Card>
                <Card>
                    <template #title>누적 세후 배당</template>
                    <template #content>
                        <strong class="metric-value">{{
                            usd.format(
                                sheetPortfolioExample.cumulativeDividendUsd
                            )
                        }}</strong>
                        <p>인출과 재투자가 섞인 누적값</p>
                    </template>
                </Card>
                <Card class="legacy-card">
                    <template #title>기존 시트 배당 누적률</template>
                    <template #content>
                        <strong class="metric-value">{{ legacyRate }}%</strong>
                        <ProgressBar :value="legacyRate" :show-value="false" />
                        <p>원금 회수와 분리해 표시할 지표</p>
                    </template>
                </Card>
            </div>
        </section>

        <section class="projection" aria-labelledby="projection-title">
            <div class="section-heading">
                <div>
                    <span class="eyebrow">TEMPORARY PROJECTION</span>
                    <h2 id="projection-title">배당 재투자 테스트</h2>
                </div>
                <Tag value="임시 데이터 · 저장 안 됨" severity="warn" />
            </div>
            <Message severity="info" :closable="false">
                시트의 최근 수량과 분배금을 옮긴 테스트입니다. YMAX 가격 등 일부
                값은 임시 가정이며, 입력값은 서버나 Google Sheets에 저장하지
                않습니다.
            </Message>
            <div class="projection-layout">
                <form class="projection-form" @submit.prevent>
                    <h3>계산 가정</h3>
                    <label
                        v-for="field in projectionFields"
                        :key="field.key"
                        :for="`projection-${field.key}`">
                        {{ field.label }}
                        <InputNumber
                            v-model="projectionSetup[field.key]"
                            :input-id="`projection-${field.key}`"
                            :min="field.min"
                            :max="field.max"
                            :suffix="field.suffix"
                            :max-fraction-digits="0" />
                    </label>
                    <div class="assumption-note">
                        <strong>고정 가정</strong>
                        <span>세율 15% · 소수주 매수 · 월초 추가 투자</span>
                    </div>
                </form>
                <div class="projection-results" aria-live="polite">
                    <article
                        v-for="scenario in projectionCards"
                        :key="scenario.key">
                        <span>{{ scenario.label }}</span>
                        <strong>{{
                            usd.format(scenario.monthlyDividend)
                        }}</strong>
                        <small>기간 말 월 세후 배당</small>
                        <dl>
                            <div>
                                <dt>누적 세후 배당</dt>
                                <dd>
                                    {{ usd.format(scenario.summary.netTotal) }}
                                </dd>
                            </div>
                            <div>
                                <dt>기간 말 자산</dt>
                                <dd>
                                    {{ usd.format(scenario.summary.wealth) }}
                                </dd>
                            </div>
                        </dl>
                    </article>
                </div>
            </div>
            <DataTable :value="projectionTable" class="projection-table">
                <Column field="month" header="경과 개월">
                    <template #body="{ data }">{{ data.month }}개월</template>
                </Column>
                <Column header="현금 보관 월배당">
                    <template #body="{ data }">{{
                        usd.format(data.cash)
                    }}</template>
                </Column>
                <Column header="전액 재투자 월배당">
                    <template #body="{ data }">{{
                        usd.format(data.reinvest)
                    }}</template>
                </Column>
                <Column :header="`분배금 ${projectionSetup.reduction}% 감소`">
                    <template #body="{ data }">{{
                        usd.format(data.reduced)
                    }}</template>
                </Column>
            </DataTable>
            <p class="projection-disclaimer">
                이 결과는 투자 예측이 아니라 계산식 검증용입니다. 주가 변화와
                분배금 변동을 단순화했으며 액면병합, 환율, 매매세금은 반영하지
                않습니다.
            </p>
        </section>

        <section class="classification" aria-labelledby="classification-title">
            <div class="section-heading">
                <div>
                    <span class="eyebrow">CAPITAL SOURCES</span>
                    <h2 id="classification-title">
                        먼저 세 개의 바구니로 나눍니다
                    </h2>
                </div>
                <Tag value="중복 계산 방지" severity="info" />
            </div>
            <div class="source-grid">
                <article v-for="item in sourceCards" :key="item.number">
                    <div class="source-number">{{ item.number }}</div>
                    <div class="source-title">
                        <h3>{{ item.title }}</h3>
                        <Tag :value="item.value" :severity="item.severity" />
                    </div>
                    <p>{{ item.detail }}</p>
                    <small
                        ><i class="pi pi-info-circle" />
                        {{ item.needed }}</small
                    >
                </article>
            </div>
        </section>

        <section class="standards" aria-labelledby="standards-title">
            <div class="section-heading">
                <div>
                    <span class="eyebrow">FIVE STANDARDS</span>
                    <h2 id="standards-title">회수율을 판단하는 5가지 기준</h2>
                </div>
                <Tag value="1번을 대표 지표로" severity="success" />
            </div>
            <ol>
                <li v-for="(item, index) in standards" :key="item.name">
                    <span class="standard-index">0{{ index + 1 }}</span>
                    <div>
                        <div class="standard-title">
                            <h3>{{ item.name }}</h3>
                            <Tag :value="item.use" severity="secondary" />
                        </div>
                        <code>{{ item.formula }}</code>
                        <p>{{ item.description }}</p>
                    </div>
                </li>
            </ol>
        </section>

        <Message severity="info" :closable="false">
            계산 시 원화 실납입액 전체를 입력한 기준 환율로 USD 환산하고, 그중
            환전한 원화는 별도로 더하지 않습니다. 원화 납입이 있는데 환율이
            없으면 회수율은 계산 불가입니다. 세후 청산가치가 없으면 청산 기준
            회수율만 계산하지 않습니다. 세율을 추정하지 않으며, 사용자가 확인한
            세후 청산가치를 입력해야 합니다.
        </Message>

        <section class="decision">
            <div>
                <span class="eyebrow">DECISION</span>
                <h2>이 포트폴리오의 권장 표시법</h2>
            </div>
            <div class="decision-rule">
                <span>대표 원금 회수율</span>
                <strong>계좌 밖으로 인출한 원금 ÷ 외부 실납입</strong>
            </div>
            <p>
                배당이 발생했다고 회수로 잡지 않고, 재투자금은 최초 원금이 아닌
                현재 위험노출액으로 따로 표시합니다.
            </p>
        </section>
    </main>
</template>

<style scoped>
    .portfolio-example {
        width: min(1180px, calc(100% - 32px));
        margin: 0 auto;
        padding: 46px 0 80px;
        color: var(--p-text-color);
    }
    .hero,
    .section-heading,
    .source-title,
    .standard-title,
    .decision {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 24px;
    }
    .hero {
        align-items: flex-end;
        margin-bottom: 28px;
    }
    .hero h1 {
        margin: 10px 0 14px;
        max-width: 720px;
        font-size: clamp(2.25rem, 6vw, 4.75rem);
        line-height: 0.98;
        letter-spacing: -0.055em;
    }
    .hero p,
    .snapshot p,
    .source-grid p,
    .standards p,
    .decision p {
        color: var(--p-text-muted-color);
        line-height: 1.65;
    }
    .hero-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }
    .eyebrow {
        color: var(--p-primary-color);
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.16em;
    }
    section {
        margin-top: 56px;
    }
    .section-heading {
        margin-bottom: 20px;
    }
    .section-heading h2,
    .decision h2 {
        margin: 7px 0 0;
        font-size: clamp(1.5rem, 3vw, 2.15rem);
        letter-spacing: -0.035em;
    }
    .snapshot-grid,
    .source-grid,
    .projection-results {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
    }
    .metric-value {
        display: block;
        margin: 8px 0 18px;
        font-size: clamp(1.85rem, 4vw, 2.75rem);
        letter-spacing: -0.04em;
    }
    .legacy-card {
        border: 1px solid
            color-mix(in srgb, var(--p-orange-500), transparent 45%);
    }
    .legacy-card :deep(.p-progressbar) {
        height: 8px;
        margin-bottom: 16px;
    }
    .source-grid article,
    .projection-form,
    .projection-results article,
    .standards li,
    .decision {
        border: 1px solid var(--p-content-border-color);
        border-radius: 18px;
        background: var(--p-content-background);
    }
    .source-grid article {
        min-height: 250px;
        padding: 24px;
    }
    .projection-layout {
        display: grid;
        grid-template-columns: minmax(240px, 0.72fr) minmax(0, 2fr);
        gap: 16px;
        margin-top: 18px;
    }
    .projection-form,
    .projection-results article {
        padding: 22px;
    }
    .projection-form h3 {
        margin: 0 0 16px;
    }
    .projection-form label {
        display: grid;
        gap: 7px;
        margin-top: 14px;
        font-size: 0.88rem;
        font-weight: 700;
    }
    .projection-form :deep(.p-inputnumber),
    .projection-form :deep(.p-inputtext) {
        width: 100%;
    }
    .assumption-note {
        display: grid;
        gap: 4px;
        margin-top: 20px;
        color: var(--p-text-muted-color);
        font-size: 0.82rem;
    }
    .projection-results article {
        min-width: 0;
        border: 1px solid var(--p-content-border-color);
        border-radius: 18px;
        background: var(--p-content-background);
    }
    .projection-results article:nth-child(2) {
        border-color: var(--p-primary-color);
        background: color-mix(in srgb, var(--p-primary-color), transparent 95%);
    }
    .projection-results article > span,
    .projection-results small {
        display: block;
        color: var(--p-text-muted-color);
    }
    .projection-results article > strong {
        display: block;
        margin: 14px 0 3px;
        font-size: clamp(1.6rem, 3vw, 2.35rem);
        letter-spacing: -0.04em;
    }
    .projection-results dl {
        display: grid;
        gap: 8px;
        margin: 22px 0 0;
    }
    .projection-results dl div {
        display: flex;
        justify-content: space-between;
        gap: 12px;
    }
    .projection-results dt,
    .projection-results dd {
        margin: 0;
        font-size: 0.82rem;
    }
    .projection-results dt {
        color: var(--p-text-muted-color);
    }
    .projection-table {
        margin-top: 16px;
    }
    .projection-disclaimer {
        margin: 14px 0 0;
        color: var(--p-text-muted-color);
        font-size: 0.84rem;
        line-height: 1.6;
    }
    .source-number,
    .standard-index {
        color: var(--p-primary-color);
        font-weight: 800;
        letter-spacing: 0.08em;
    }
    .source-title {
        align-items: flex-start;
        margin: 28px 0 12px;
    }
    .source-title h3,
    .standard-title h3 {
        margin: 0;
        font-size: 1.15rem;
    }
    .source-grid small {
        display: block;
        margin-top: 20px;
        color: var(--p-primary-color);
        line-height: 1.5;
    }
    .standards ol {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 0;
        padding: 0;
        list-style: none;
    }
    .standards li {
        display: grid;
        grid-template-columns: 42px 1fr;
        gap: 12px;
        padding: 22px;
    }
    .standards li:first-child {
        grid-column: 1 / -1;
        border-color: var(--p-primary-color);
        background: color-mix(in srgb, var(--p-primary-color), transparent 94%);
    }
    .standard-title {
        align-items: flex-start;
    }
    code {
        display: inline-block;
        margin-top: 12px;
        padding: 6px 9px;
        border-radius: 7px;
        background: var(--p-content-hover-background);
        color: var(--p-text-color);
        white-space: normal;
    }
    .decision {
        align-items: flex-start;
        flex-wrap: wrap;
        padding: clamp(24px, 5vw, 44px);
        background: var(--p-surface-950);
        color: var(--p-surface-0);
    }
    .decision .eyebrow,
    .decision p {
        color: var(--p-surface-300);
    }
    .decision-rule {
        display: grid;
        gap: 8px;
        min-width: min(100%, 380px);
    }
    .decision-rule span {
        color: var(--p-surface-400);
        font-size: 0.8rem;
    }
    .decision-rule strong {
        font-size: 1.2rem;
        line-height: 1.45;
    }
    .decision p {
        width: 100%;
        margin-bottom: 0;
    }
    @media (max-width: 820px) {
        .hero,
        .section-heading {
            align-items: flex-start;
            flex-direction: column;
        }
        .hero-actions {
            justify-content: flex-start;
        }
        .snapshot-grid,
        .source-grid,
        .projection-results,
        .projection-layout,
        .standards ol {
            grid-template-columns: 1fr;
        }
        .standards li:first-child {
            grid-column: auto;
        }
    }
    @media (max-width: 520px) {
        .portfolio-example {
            width: min(100% - 24px, 1180px);
            padding-top: 28px;
        }
        .hero-actions :deep(.p-button) {
            width: 100%;
        }
        .source-title,
        .standard-title {
            gap: 10px;
        }
    }
</style>
