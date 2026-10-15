import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFirebaseCredential } from '../lib/firebase-credential.js';
const fixture = {
    type: 'service_account',
    project_id: 'fixture',
    client_email: 'fixture@example.invalid',
    private_key: 'placeholder',
};
test('credential configuration accepts complete JSON, quoted JSON and field-only legacy values', () => {
    const raw = JSON.stringify(fixture, null, 2);
    for (const value of [raw, JSON.stringify(raw), raw.slice(1, -1)])
        assert.deepEqual(parseFirebaseCredential(value), fixture);
});
test('invalid credential configuration never echoes its contents', () => {
    assert.throws(
        () => parseFirebaseCredential('private-secret-placeholder'),
        (error) => !error.message.includes('private-secret-placeholder')
    );
    assert.throws(() => parseFirebaseCredential('{}'));
});
