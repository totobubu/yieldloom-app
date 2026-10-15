import { apiUrl } from './apiUrl.js';

export async function portfolioCapitalRequest(user, input) {
    if (!user) throw new Error('로그인이 필요합니다.');
    const response = await fetch(apiUrl('/api/portfolio-capital'), {
        method: input ? 'POST' : 'GET',
        headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            ...(input ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(payload.error || '원금 내역을 조회하지 못했습니다.');
    return payload;
}
