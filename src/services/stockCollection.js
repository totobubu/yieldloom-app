import { apiUrl } from './apiUrl.js';
export async function stockCollectionRequest(
    user,
    symbol,
    { requestId, signal } = {}
) {
    const url = requestId
        ? `/api/stock-collection?symbol=${encodeURIComponent(symbol)}&requestId=${encodeURIComponent(requestId)}`
        : '/api/stock-collection';
    const response = await fetch(apiUrl(url), {
        method: requestId ? 'GET' : 'POST',
        signal,
        headers: {
            Authorization: `Bearer ${await user.getIdToken()}`,
            ...(!requestId ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(!requestId ? { body: JSON.stringify({ symbol }) } : {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
        throw new Error(body.error || '데이터 수집을 요청하지 못했습니다.');
    return body;
}
