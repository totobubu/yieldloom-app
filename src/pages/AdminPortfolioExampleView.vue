<script setup>
    import { computed } from 'vue';
    import { useHead } from '@vueuse/head';
    import Button from 'primevue/button';
    import Card from 'primevue/card';
    import Message from 'primevue/message';
    import ProgressBar from 'primevue/progressbar';
    import Tag from 'primevue/tag';
    import {
        dividendRecoveryRate,
        sheetPortfolioExample,
    } from '@/services/adminPortfolioExample.js';

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
            detail: '내 은행에서 투자계좌로 보낸 KRW만 포함합니다. 계좌 내 환전과 재투자는 제외합니다.',
            needed: '원화 입금 내역에 ‘외부 입금’ 표시 필요',
        },
        {
            number: '02',
            title: '순수 달러 실납입',
            value: '미분류',
            severity: 'warn',
            detail: '외부에서 USD로 직접 입금한 돈만 포함합니다. 원화를 환전한 달러는 중복 계산하지 않습니다.',
            needed: '달러 입금과 계좌 내 환전을 별도 구분',
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
            formula: '(누적 인출 + 세후 청산가치) ÷ 외부 실납입',
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
    .source-grid {
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
