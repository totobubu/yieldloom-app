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
        if (error.code === 'auth/popup-blocked')
            throw new Error(
                'Google 연결 창이 차단되었습니다. 이 사이트의 팝업을 허용하고 다시 분석해 주세요.'
            );
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
export function createSheetLedgerClient({
    fetchImpl = fetch,
    timeoutMs = 45000,
} = {}) {
    let pending = null,
        owner = null;
    async function request(user, method = 'GET', body, query = '') {
        let response;
        try {
            response = await fetchImpl(apiUrl(`/api/sheet-ledger${query}`), {
                method,
                headers: {
                    Authorization: `Bearer ${await user.getIdToken()}`,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError')
                throw new Error(
                    '시트 응답 시간이 초과되었습니다. 잠시 후 다시 분석해 주세요.'
                );
            throw new Error(
                '서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.'
            );
        }
        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload !== 'object')
            throw new Error(
                '서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'
            );
        if (!response.ok)
            throw Object.assign(
                new Error(payload.error || '시험 장부를 읽지 못했습니다.'),
                { status: response.status, code: payload.code }
            );
        if (!Array.isArray(payload.rows) || !Number.isInteger(payload.version))
            throw new Error(
                '거래 목록 응답 형식이 올바르지 않습니다. 새로고침 후 다시 시도해 주세요.'
            );
        if (
            body?.action === 'preview' &&
            (!Array.isArray(payload.excluded) ||
                !Array.isArray(payload.warnings) ||
                typeof payload.fingerprint !== 'string' ||
                typeof payload.cutoff !== 'string')
        )
            throw new Error(
                '분석 결과를 읽지 못했습니다. 잠시 후 다시 분석해 주세요.'
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
        archive(user, id) {
            return request(
                user,
                'GET',
                undefined,
                `?sourceArchive=${encodeURIComponent(id)}`
            );
        },
        clear() {
            pending = null;
            owner = null;
        },
    };
}
