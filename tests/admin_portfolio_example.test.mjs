import test from 'node:test';
import assert from 'node:assert/strict';
import {
    dividendRecoveryRate,
    recoveryModel,
    sheetPortfolioExample,
    temporaryProjectionHoldings,
} from '../src/services/adminPortfolioExample.js';
import { simulateHeldPortfolio } from '../src/services/holdingSimulation.js';

test('기존 시트 수치는 현금 회수율이 아닌 배당 누적률로 계산한다', () => {
    assert.equal(
        dividendRecoveryRate(
            sheetPortfolioExample.displayedPrincipalUsd,
            sheetPortfolioExample.cumulativeDividendUsd
        ),
        96.23
    );
});

test('달러만 납입한 경우 재투자는 외부 원금 분모에 포함하지 않는다', () => {
    const result = recoveryModel({
        usdContribution: 10000,
        reinvestedUsd: 3000,
        cashWithdrawnUsd: 2500,
        afterTaxLiquidationValueUsd: 12000,
        currentValueUsd: 15000,
    });
    assert.equal(result.principalUsd, 10000);
    assert.equal(result.cashRecoveryRate, 25);
    assert.equal(result.unrecoveredUsd, 7500);
    assert.equal(result.economicRecoveryRate, 145);
    assert.equal(result.reinvestedUsd, 3000);
    assert.equal(result.currentRiskUsd, 15000);
    assert.equal(result.status, 'ready');
});

test('원화만 납입한 경우 명시된 환율로 USD 기준 원금을 계산한다', () => {
    const result = recoveryModel({
        krwContribution: 14000000,
        convertedKrw: 12000000,
        krwPerUsd: 1400,
        cashWithdrawnUsd: 2000,
        afterTaxLiquidationValueUsd: 10000,
    });
    assert.equal(result.krwContribution, 14000000);
    assert.equal(result.convertedKrw, 12000000);
    assert.equal(result.principalUsd, 10000);
    assert.equal(result.cashRecoveryRate, 20);
    assert.equal(result.unrecoveredUsd, 8000);
    assert.equal(result.economicRecoveryRate, 120);
    assert.equal(result.status, 'ready');
});

test('원화와 달러 혼합 납입은 환전한 원화를 한 번만 계산한다', () => {
    const result = recoveryModel({
        krwContribution: 14000000,
        convertedKrw: 12000000,
        usdContribution: 2000,
        krwPerUsd: 1400,
        cashWithdrawnUsd: 3000,
        afterTaxLiquidationValueUsd: 7000,
    });
    assert.equal(result.principalUsd, 12000);
    assert.equal(result.cashRecoveryRate, 25);
    assert.equal(result.economicRecoveryRate, 83.33);
});

test('환율이 없으면 원화 납입의 회수율을 계산 불가로 표시한다', () => {
    const result = recoveryModel({
        krwContribution: 14000000,
        usdContribution: 2000,
        cashWithdrawnUsd: 1000,
        afterTaxLiquidationValueUsd: 10000,
    });
    assert.equal(result.principalUsd, null);
    assert.equal(result.cashRecoveryRate, null);
    assert.equal(result.economicRecoveryRate, null);
    assert.equal(result.unrecoveredUsd, null);
    assert.equal(result.status, 'incomplete');
    assert.ok(result.issues.includes('missing_krw_per_usd_rate'));
    assert.ok(!result.issues.includes('missing_contribution'));
});

test('환전 원화가 외부 원화 납입을 초과하면 입력 오류로 처리한다', () => {
    const result = recoveryModel({
        krwContribution: 1000000,
        convertedKrw: 1200000,
        krwPerUsd: 1400,
    });
    assert.equal(result.principalUsd, null);
    assert.equal(result.status, 'invalid_input');
    assert.ok(result.issues.includes('invalid_input'));
});

test('세전 또는 불명확한 청산가치로는 청산 기준 회수율을 계산하지 않는다', () => {
    const result = recoveryModel({
        usdContribution: 10000,
        cashWithdrawnUsd: 1000,
        preTaxLiquidationValueUsd: 9000,
        liquidationValueUsd: 9000,
    });
    assert.equal(result.cashRecoveryRate, 10);
    assert.equal(result.economicRecoveryRate, null);
    assert.equal(result.status, 'incomplete');
    assert.ok(result.issues.includes('missing_after_tax_liquidation_value'));
});

test('명시적으로 입력한 세후 청산가치만 청산 회수율에 반영한다', () => {
    const result = recoveryModel({
        usdContribution: 10000,
        cashWithdrawnUsd: 1000,
        afterTaxLiquidationValueUsd: 7000,
    });
    assert.equal(result.economicRecoveryRate, 80);
    assert.equal(result.status, 'ready');
});

test('세후 청산가치가 미입력(null)이면 세전 금액으로 대체하지 않는다', () => {
    const result = recoveryModel({
        usdContribution: 10000,
        cashWithdrawnUsd: 1000,
        afterTaxLiquidationValueUsd: null,
        liquidationValueUsd: 9000,
    });
    assert.equal(result.economicRecoveryRate, null);
    assert.ok(result.issues.includes('missing_after_tax_liquidation_value'));
});

test('세후 청산가치가 음수면 세율을 추정하지 않고 입력 오류로 처리한다', () => {
    const result = recoveryModel({
        usdContribution: 10000,
        afterTaxLiquidationValueUsd: -2000,
    });
    assert.equal(result.economicRecoveryRate, null);
    assert.equal(result.status, 'invalid_input');
});

test('임시 보유 종목은 배당 재투자 효과와 분배금 감소 위험을 비교한다', () => {
    const result = simulateHeldPortfolio(temporaryProjectionHoldings, {
        currency: 'USD',
        contribution: 500,
        reduction: 20,
        months: 60,
        taxRate: 15,
        fee: 0,
        annualPriceChange: -5,
    });
    const [cash, reinvest, reduced] = result.scenarios;
    assert.equal(result.initial > 30000, true);
    assert.equal(reinvest.summary.netTotal > cash.summary.netTotal, true);
    assert.equal(reinvest.rows.at(-1).net > cash.rows.at(-1).net, true);
    assert.equal(reduced.rows.at(-1).net < reinvest.rows.at(-1).net, true);
});

test('빈 금액·불리언·배열은 0이나 1로 추정하지 않는다', () => {
    for (const value of ['', '  ', true, false, [], {}]) {
        const result = recoveryModel({ usdContribution: value });
        assert.equal(result.principalUsd, null);
        assert.equal(result.status, 'invalid_input');
    }
});
test('명시적으로 미입력된 환율도 없는 환율로 구분한다', () => {
    for (const value of [undefined, null, '', '  ']) {
        const result = recoveryModel({
            krwContribution: 1000,
            krwPerUsd: value,
        });
        assert.equal(result.status, 'incomplete');
        assert(result.issues.includes('missing_krw_per_usd_rate'));
        assert(!result.issues.includes('invalid_input'));
    }
});
test('센트 미만 원금·잔액·평가액은 회수율 계산 전에 반올림하지 않는다', () => {
    const r = recoveryModel({
        usdContribution: 0.003,
        cashWithdrawnUsd: 0.0015,
        afterTaxLiquidationValueUsd: 0.0015,
        currentValueUsd: 0.003,
    });
    assert.equal(r.principalUsd, 0.003);
    assert.equal(r.cashRecoveryRate, 50);
    assert.equal(r.economicRecoveryRate, 100);
    assert.equal(r.unrecoveredUsd, 0.0015);
    assert.equal(r.currentRiskUsd, 0.003);
});
