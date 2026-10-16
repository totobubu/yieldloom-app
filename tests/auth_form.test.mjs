import test from 'node:test';
import assert from 'node:assert/strict';
import { authDestination, maskedEmail } from '../src/services/authForm.js';

test('authentication redirects remain on this app including backslash and control-character inputs', () => {
    const origin = 'https://yieldloom-app.vercel.app';
    for (const value of [
        'https://evil.example',
        '//evil.example',
        '/\\evil.example',
        '/\n/evil.example',
        '/login?redirect=/mypage',
        undefined,
        ['//evil.example'],
    ])
        assert.equal(authDestination(value, origin), '/mypage', String(value));
    assert.equal(
        authDestination('/stock/TSLY?tab=share', origin),
        '/stock/TSLY?tab=share'
    );
    assert.equal(authDestination('/legal', origin), '/legal');
});

test('reset status displays a masked email without claiming that an account exists', () => {
    assert.equal(maskedEmail('member@example.test'), 'me***@example.test');
    assert.equal(maskedEmail('a@example.test'), 'a***@example.test');
    assert.equal(maskedEmail(''), '입력한 이메일');
});
