import { apiUrl } from './apiUrl.js';

export function createSheetReportClient({
    fetchImpl = fetch,
    now = Date.now,
} = {}) {
    const cache = new Map(),
        pending = new Map();
    let owner = null,
        generation = 0;
    function clear() {
        generation++;
        owner = null;
        cache.clear();
        pending.clear();
    }
    function select(user) {
        if (owner !== user) {
            clear();
            owner = user;
        }
    }
    async function load(
        user,
        accountId,
        section = 'summary',
        { refresh = false } = {}
    ) {
        select(user);
        if (
            !user ||
            !['wife', 'husband'].includes(accountId) ||
            !['summary', 'details'].includes(section)
        )
            throw new Error('로그인과 계좌를 확인해 주세요.');
        const key = `${accountId}:${section}`;
        if (pending.has(key)) return pending.get(key);
        if (!refresh && cache.get(key)?.expires > now())
            return cache.get(key).value;
        const current = generation;
        const task = (async () => {
            const query = new URLSearchParams({
                view: 'sheet-reports',
                accountId,
                section,
            });
            const response = await fetchImpl(
                apiUrl(`/api/portfolio-capital?${query}`),
                {
                    headers: {
                        Authorization: `Bearer ${await user.getIdToken()}`,
                    },
                    signal: AbortSignal.timeout(30_000),
                    cache: 'no-store',
                }
            );
            const value = await response.json();
            if (!response.ok) {
                if (
                    [401, 403].includes(response.status) &&
                    current === generation
                )
                    clear();
                throw new Error(
                    value.error || '비공개 대조 보고서 조회에 실패했습니다.'
                );
            }
            if (current !== generation || owner !== user)
                throw new Error(
                    '로그인 상태가 변경되어 보고서를 폐기했습니다.'
                );
            if (
                value.accountId !== accountId ||
                value.section !== section ||
                value.readOnly !== true
            )
                throw new Error('보고서 계좌 또는 형식을 확인해 주세요.');
            cache.set(key, { value, expires: now() + 30_000 });
            return value;
        })().finally(() => {
            if (pending.get(key) === task) pending.delete(key);
        });
        pending.set(key, task);
        return task;
    }
    return { load, clear };
}
