import { apiUrl } from './apiUrl.js';

export async function portfolioCapitalRequest(user, input, accountId) {
    if (!user) throw new Error('로그인이 필요합니다.');
    const response = await fetch(
        apiUrl('/api/portfolio-capital') +
            (accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''),
        {
            method: input ? 'POST' : 'GET',
            cache: 'no-store',
            headers: {
                Authorization: `Bearer ${await user.getIdToken()}`,
                ...(input ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(input
                ? {
                      body: JSON.stringify({
                          ...input,
                          ...(accountId ? { accountId } : {}),
                      }),
                  }
                : {}),
        }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(payload.error || '원금 내역을 조회하지 못했습니다.');
    return payload;
}
