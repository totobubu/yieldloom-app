import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitalAccountLabel } from '../src/services/accountDisplay.js';
test('capital account labels use only authorized masked numbers and explicit missing labels', () => {
    assert.equal(
        capitalAccountLabel(
            {
                institution: '합성증권',
                maskedNumber: '****4321',
                accountNumber: 'NEVER_READ',
            },
            '합성 예금주'
        ),
        '합성 예금주 / 합성증권 / ****4321'
    );
    assert.equal(
        capitalAccountLabel(
            { institution: '합성증권', maskedNumber: '1234567890' },
            '합성 예금주'
        ),
        '합성 예금주 / 합성증권 / 계좌번호 미등록'
    );
    assert.equal(
        capitalAccountLabel({}, ''),
        '예금주 미등록 / 증권사 미등록 / 계좌번호 미등록'
    );
});
