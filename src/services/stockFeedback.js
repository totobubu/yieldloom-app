import { apiUrl } from './apiUrl.js';

async function parse(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
        throw Object.assign(
            new Error(payload.error || '종목 의견을 처리하지 못했습니다.'),
            { status: response.status }
        );
    return payload;
}

export async function submitStockFeedback(body) {
    return parse(
        await fetch(apiUrl('/api/stock-feedback'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
    );
}

export async function loadStockFeedback(user) {
    return parse(
        await fetch(apiUrl('/api/stock-feedback'), {
            headers: { Authorization: `Bearer ${await user.getIdToken()}` },
        })
    );
}

export async function updateStockFeedback(user, body) {
    return parse(
        await fetch(apiUrl('/api/stock-feedback'), {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${await user.getIdToken()}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        })
    );
}
