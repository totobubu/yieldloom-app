import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEntryIncomeEfficiency } from '../src/services/thumbnail/entryIncomeEfficiency.js';

const monthlyRows = () => {
    const rows = [];
    for (let month = 1; month <= 36; month += 1) {
        const date = new Date(Date.UTC(2023, month - 1, 2)).toISOString().slice(0, 10);
        rows.push({ date, close: 100 + month, amount: month <= 24 ? 1 : 10 });
    }
    return rows;
};

test('entry efficiency only uses distributions known before each entry date', () => {
    const rows = monthlyRows();
    rows.push({ date: '2026-02-02', close: 140, amount: 999, forecasted: true });
    const result = calculateEntryIncomeEfficiency(
        { symbol: 'TEST', backtestData: rows },
        { asOfDate: '2025-12-31' }
    );

    assert.equal(result.available, true);
    assert.equal(result.samples.length, 24);
    const january2025 = result.samples.find((sample) => sample.date === '2025-01-02');
    assert.equal(january2025.preTaxAnnualDividend, 12);
    assert.equal(january2025.afterTaxAnnualDividend, 10.2);
    assert.ok(Math.abs(january2025.afterTaxYield - (10.2 / 125) * 100) < 1e-12);
});

test('entry efficiency prioritizes fixed amounts and selects the first valid monthly close', () => {
    const rows = monthlyRows();
    rows.unshift({ date: '2023-01-01', close: 0, amount: 1 });
    const fixed = rows.find((row) => row.date === '2025-11-02');
    fixed.amountFixed = 20;
    const result = calculateEntryIncomeEfficiency(
        { symbol: 'TEST', backtestData: rows },
        { asOfDate: '2025-12-31' }
    );

    assert.equal(result.available, true);
    assert.equal(result.samples.at(-1).date, '2025-12-02');
    assert.equal(result.samples.at(-1).preTaxAnnualDividend, 121);
});

test('entry efficiency reports unavailable when fewer than six qualified entry months exist', () => {
    const rows = monthlyRows().slice(0, 16);
    const result = calculateEntryIncomeEfficiency(
        { symbol: 'SHORT', backtestData: rows },
        { asOfDate: '2024-04-30' }
    );

    assert.equal(result.available, false);
    assert.match(result.reason, /부족/);
});
