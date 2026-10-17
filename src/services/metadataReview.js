import { apiUrl } from './apiUrl.js';
const sessions = new WeakMap();
export async function metadataReviewRequest(
    user,
    body,
    { refresh = false } = {}
) {
    if (!user) throw new Error('로그인이 필요합니다.');
    let session = sessions.get(user);
    if (!session) {
        session = {};
        sessions.set(user, session);
    }
    if (!body && !refresh && session.value && Date.now() < session.expires)
        return session.value;
    if (!body && session.pending) return session.pending;
    const request = async () => {
        const response = await fetch(apiUrl('/api/security-metadata'), {
            method: body ? 'POST' : 'GET',
            headers: {
                Authorization: `Bearer ${await user.getIdToken()}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error(
                payload.error || '검토 자료를 불러오지 못했습니다.'
            );
        if (!body) {
            session.value = payload;
            session.expires = Date.now() + 30_000;
        } else {
            session.value = null;
            session.expires = 0;
        }
        return payload;
    };
    if (body) return request();
    session.pending = request().finally(() => {
        session.pending = null;
    });
    return session.pending;
}
