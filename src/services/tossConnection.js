export async function getTossConnectionStatus(user, fetcher = fetch) {
    if (!user) throw new Error('로그인이 필요합니다.');
    const response = await fetcher('/api/toss-connection', {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '토스 연결 상태를 확인하지 못했습니다.');
    return payload;
}
