import { apiUrl } from './apiUrl';
import { firebaseUser } from './firebaseClient';

const limitedUsers = new WeakMap();

export async function familyRequest(
    action = '',
    body,
    query = {},
    { signal } = {}
) {
    const user = firebaseUser.value;
    if (!user) throw new Error('로그인이 필요합니다.');
    const limited = limitedUsers.get(user);
    if (limited?.until > Date.now()) throw limited.error;
    const params = new URLSearchParams({
        ...query,
        ...(action ? { action } : {}),
    });
    const response = await fetch(apiUrl(`/api/family-portfolio?${params}`), {
        method: body === undefined ? 'GET' : 'POST',
        cache: 'no-store',
        signal,
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
    if (!response.ok) {
        const error = Object.assign(
            new Error(payload.error || '요청을 처리하지 못했습니다.'),
            { code: payload.code, status: response.status }
        );
        if (response.status === 429)
            limitedUsers.set(user, {
                error,
                until:
                    Date.now() +
                    Math.max(
                        30,
                        Number(response.headers.get('Retry-After')) || 60
                    ) *
                        1000,
            });
        throw error;
    }
    limitedUsers.delete(user);
    return payload;
}
