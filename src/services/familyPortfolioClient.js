import { apiUrl } from './apiUrl.js';

export function retryDeadline(header, now, fallbackSeconds = 60) {
    const raw = String(header ?? '').trim();
    if (/^\d+$/.test(raw)) {
        const deadline = now + Number(raw) * 1000;
        return Number.isFinite(deadline) && deadline <= 8.64e15
            ? deadline
            : now + fallbackSeconds * 1000;
    }
    const date = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(date)
        ? Math.max(now, date)
        : now + fallbackSeconds * 1000;
}

// Session-only rate limiting: no account data or auth state is persisted.
export function createFamilyPortfolioClient({
    getUser,
    fetcher = fetch,
    now = Date.now,
}) {
    const limitedUsers = new WeakMap();
    return async function familyRequest(
        action = '',
        body,
        query = {},
        { signal } = {}
    ) {
        const user = getUser();
        if (!user) throw new Error('로그인이 필요합니다.');
        if (signal?.aborted)
            throw new DOMException('요청이 취소되었습니다.', 'AbortError');
        const limited = limitedUsers.get(user);
        if (limited?.retryAt > now()) throw limited;
        const params = new URLSearchParams({
            ...query,
            ...(action ? { action } : {}),
        });
        const response = await fetcher(
            apiUrl(`/api/family-portfolio?${params}`),
            {
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
            }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = Object.assign(
                new Error(payload.error || '요청을 처리하지 못했습니다.'),
                { code: payload.code, status: response.status }
            );
            if (response.status === 429) {
                error.retryAt = retryDeadline(
                    response.headers.get('Retry-After'),
                    now()
                );
                // This is the earliest recommended retry, never a promise of recovery.
                error.retryTiming = payload.retryTiming || 'recommended';
                error.limitType = payload.limitType || 'unknown';
                limitedUsers.set(user, error);
            }
            throw error;
        }
        limitedUsers.delete(user);
        return payload;
    };
}
