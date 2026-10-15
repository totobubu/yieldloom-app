import { apiUrl } from './apiUrl.js';

export async function portfolioMappingRequest(user, body) {
    if (!user) throw new Error('로그인이 필요합니다.');
    const response = await fetch(apiUrl('/api/portfolio-mappings'), {
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
            payload.error || '종목 연결 정보를 처리하지 못했습니다.'
        );
    return payload;
}
