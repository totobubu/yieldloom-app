import test from 'node:test';
import assert from 'node:assert/strict';
import {
    dividendRecoveryRate,
    recoveryModel,
    sheetPortfolioExample,
} from '../src/services/adminPortfolioExample.js';

test('기존 시트 수치는 현금 회수율이 아닌 배당 누적률로 계산한다', () => {
    assert.equal(
        dividendRecoveryRate(
            sheetPortfolioExample.displayedPrincipalUsd,
            sheetPortfolioExample.cumulativeDividendUsd
        ),
        96.23
    );
});

test('재투자는 외부 실납입과 현금 회수율의 분모에 중복 포함하지 않는다', () => {
    const result = recoveryModel({
        usdContribution: 10000,
        reinvestedUsd: 3000,
        cashWithdrawnUsd: 2500,
        liquidationValueUsd: 12000,
    });
    assert.equal(result.cashRecoveryRate, 25);
    assert.equal(result.unrecoveredUsd, 7500);
    assert.equal(result.economicRecoveryRate, 145);
    assert.equal(result.reinvestedUsd, 3000);
});

test('원화 실납입과 환전 사용액을 별도로 보존한다', () => {
    const result = recoveryModel({
        krwContribution: 14000000,
        convertedKrw: 12000000,
    });
    assert.equal(result.krwContribution, 14000000);
    assert.equal(result.convertedKrw, 12000000);
    assert.equal(result.cashRecoveryRate, null);
});
