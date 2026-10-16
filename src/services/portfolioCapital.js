import { apiUrl } from './apiUrl.js';

// Private memory only: each signed-in user object owns a bounded account cache.
export function createPortfolioCapitalClient({
    fetcher = fetch,
    now = Date.now,
} = {}) {
    const users = new WeakMap();
    return async function request(
        user,
        input,
        accountId,
        { force = false } = {}
    ) {
        if (!user) throw new Error('로그인이 필요합니다.');
        let accounts = users.get(user);
        if (!accounts) users.set(user, (accounts = new Map()));
        const key = `${user.uid}:${accountId || ''}`;
        let cached = accounts.get(key);
        if (cached?.mutation) {
            await cached.mutation;
            return request(user, input, accountId, { force: true });
        }
        if (!input && cached?.pending) {
            const result = await cached.pending;
            if (accounts.get(key) !== cached)
                return request(user, undefined, accountId, { force: true });
            return structuredClone(result);
        }
        if (cached?.retryAt > now()) throw cached.error;
        if (!input && !force && cached?.expiresAt > now())
            return structuredClone(cached.data);
        if (input && cached) {
            // Preserve the immutable ledger through annotation writes, but detach any old GET.
            cached = { data: cached.data };
            accounts.set(key, cached);
        }
        if (!cached) {
            cached = {};
            if (accounts.size >= 30)
                accounts.delete(accounts.keys().next().value);
            accounts.set(key, cached);
        }
        const work = async () => {
            const params = new URLSearchParams();
            if (accountId) params.set('accountId', accountId);
            if (!input && cached?.data?.version)
                params.set('version', cached.data.version);
            if (!input && cached?.data?.ledgerVersion)
                params.set('ledgerVersion', cached.data.ledgerVersion);
            const response = await fetcher(
                apiUrl('/api/portfolio-capital') +
                    (params.size ? `?${params}` : ''),
                {
                    method: input ? 'POST' : 'GET',
                    cache: 'no-store',
                    headers: {
                        Authorization: `Bearer ${await user.getIdToken()}`,
                        ...(input
                            ? { 'Content-Type': 'application/json' }
                            : {}),
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
            if (!response.ok) {
                const error = Object.assign(
                    new Error(
                        payload.error || '원금 내역을 조회하지 못했습니다.'
                    ),
                    { code: payload.code, status: response.status }
                );
                if (cached) {
                    delete cached.data;
                    delete cached.expiresAt;
                    if (response.status === 429) {
                        cached.error = error;
                        cached.retryAt =
                            now() +
                            Math.max(
                                30,
                                Number(response.headers?.get('Retry-After')) ||
                                    60
                            ) *
                                1000;
                    }
                }
                throw error;
            }
            if (input) {
                // An uncertain write response must never make old data look fresh.
                if (cached) delete cached.expiresAt;
                return payload;
            }
            const data =
                payload.unchanged && cached.data ? cached.data : payload;
            if (payload.ledgerUnchanged && cached.data) {
                data.trades = cached.data.trades;
                data.importedCash = cached.data.importedCash || [];
                data.entries = [...payload.entries, ...data.importedCash];
            }
            if (payload.unchanged && !cached.data)
                throw new Error('계좌 내역을 다시 조회해 주세요.');
            cached.data = data;
            cached.expiresAt = now() + 5000;
            return data;
        };
        if (input) {
            cached.mutation = work();
            try {
                return await cached.mutation;
            } finally {
                delete cached.mutation;
            }
        }
        cached.pending = work();
        try {
            const result = await cached.pending;
            if (accounts.get(key) !== cached)
                return request(user, undefined, accountId, { force: true });
            return structuredClone(result);
        } finally {
            delete cached.pending;
        }
    };
}
export const portfolioCapitalRequest = createPortfolioCapitalClient();
