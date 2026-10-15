import { apiUrl } from './apiUrl';
import { firebaseUser } from './firebaseClient';

export async function familyRequest(action = '', body, query = {}) {
    const user = firebaseUser.value;
    if (!user) throw new Error('로그인이 필요합니다.');
    const params = new URLSearchParams({
        ...query,
        ...(action ? { action } : {}),
    });
    const response = await fetch(apiUrl(`/api/family-portfolio?${params}`), {
        method: body === undefined ? 'GET' : 'POST',
        cache: 'no-store',
        headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            ...(body instanceof FormData || body === undefined
                ? {}
                : { 'Content-Type': 'application/json' }),
        },
        body:
            body === undefined
                ? undefined
                : body instanceof FormData
                  ? body
                  : JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok)
        throw new Error(payload.error || '요청을 처리하지 못했습니다.');
    return payload;
}
