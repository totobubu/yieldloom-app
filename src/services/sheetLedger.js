import { GoogleAuthProvider, reauthenticateWithPopup } from 'firebase/auth';
import { apiUrl } from './apiUrl.js';

// Token exists only for the preview/commit flow in this component's lifetime.
export async function connectGoogleSheet(user) {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
    provider.addScope('https://www.googleapis.com/auth/drive.readonly');
    provider.setCustomParameters({ login_hint: user.email });
    try {
        const result = await reauthenticateWithPopup(user, provider);
        const token =
            GoogleAuthProvider.credentialFromResult(result)?.accessToken;
        if (!token) throw new Error('Google 읽기 권한을 확인하지 못했습니다.');
        return token;
    } catch (error) {
        if (
            [
                'auth/popup-closed-by-user',
                'auth/cancelled-popup-request',
            ].includes(error.code)
        )
            throw new Error(
                'Google 연결이 취소되었습니다. 다시 연결할 수 있습니다.'
            );
        if (error.code === 'auth/user-mismatch')
            throw new Error('현재 관리자와 같은 Google 계정을 선택해 주세요.');
        throw error;
    }
}
export function createSheetLedgerClient({ fetchImpl = fetch } = {}) {
    let pending = null,
        owner = null;
    async function request(user, method = 'GET', body) {
        const response = await fetchImpl(apiUrl('/api/sheet-ledger'), {
            method,
            headers: {
                Authorization: `Bearer ${await user.getIdToken()}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const payload = await response.json();
        if (!response.ok)
            throw Object.assign(
                new Error(payload.error || '시험 장부를 읽지 못했습니다.'),
                { status: response.status }
            );
        return payload;
    }
    return {
        load(user) {
            if (owner === user && pending) return pending;
            owner = user;
            const active = request(user).finally(() => {
                if (pending === active) pending = null;
            });
            pending = active;
            return active;
        },
        mutate(user, method, body) {
            pending = null;
            return request(user, method, body);
        },
        clear() {
            pending = null;
            owner = null;
        },
    };
}
