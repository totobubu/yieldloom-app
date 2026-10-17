import { loadCalendarLedger } from './portfolioLedger.js';
import { cancelledRequest } from './sharedRequest.js';

// Shared by calendar and insights, bounded to 10,000 private rows / 100 pages.
// Only complete, permission- and revision-checked loads may populate the cache.
export function createPortfolioLedgerClient({ getUser, request }) {
    let session;
    const clear = () => {
        session = undefined;
    };
    request.onInvalidate?.((user) => {
        if (!user || session?.user === user) clear();
    });
    function scopeFor(user) {
        if (session?.user !== user)
            session = { user, pages: new Map(), rows: 0, cacheHits: 0 };
        return session;
    }
    async function load({ force = false, isCurrent = () => true, ...options }) {
        const user = getUser();
        if (!user) {
            clear();
            throw new Error('로그인이 필요합니다.');
        }
        const scope = scopeFor(user);
        const active = () =>
            session === scope && getUser() === user && isCurrent();
        const check = () => {
            if (!active() || options.signal?.aborted) throw cancelledRequest();
        };
        const staged = new Map();
        let accounts, checkedAccess;
        const access = (account) =>
            JSON.stringify(
                account && [
                    account.id,
                    account.permissions?.[user.uid],
                    account.authorityUid,
                    account.ownerId,
                ]
            );
        const stamp = (account) => {
            // Missing legacy revisions can still be read, but cannot justify reuse.
            if (
                !Number.isSafeInteger(account?.entriesRevision) ||
                account.entriesRevision < 0
            )
                return null;
            return JSON.stringify([
                options.familyId,
                account.id,
                account.entriesRevision,
                account.permissions?.[user.uid],
                account.authorityUid,
                account.ownerId,
            ]);
        };
        const adapter = async (action, body, query, requestOptions) => {
            check();
            if (!query.accountId) {
                const result = await request(
                    action,
                    body,
                    { ...query, view: 'ledger' },
                    requestOptions
                );
                check();
                const latest = new Map(
                    result.accounts.map((account) => [account.id, account])
                );
                if (checkedAccess) {
                    if (
                        options.accounts.some(
                            (account) =>
                                checkedAccess.get(account.id) !==
                                access(latest.get(account.id))
                        )
                    )
                        throw new Error(
                            '조회 중 계좌 권한 또는 거래 목록이 변경되었습니다. 다시 조회해 주세요.'
                        );
                } else
                    checkedAccess = new Map(
                        options.accounts.map((account) => [
                            account.id,
                            access(latest.get(account.id)),
                        ])
                    );
                for (const [key, page] of scope.pages) {
                    if (
                        page.familyId === options.familyId &&
                        page.stamp !== stamp(latest.get(page.accountId))
                    ) {
                        scope.pages.delete(key);
                        scope.rows -= page.payload.entries.length;
                    }
                }
                accounts = latest;
                return result;
            }
            const version = stamp(accounts.get(query.accountId));
            const key = JSON.stringify([
                options.familyId,
                query.accountId,
                query.cursor || '',
            ]);
            const cached = scope.pages.get(key);
            if (!force && version !== null && cached?.stamp === version) {
                scope.cacheHits++;
                return structuredClone(cached.payload);
            }
            const payload = await request(action, body, query, requestOptions);
            check();
            if (version !== null)
                staged.set(key, {
                    familyId: options.familyId,
                    accountId: query.accountId,
                    stamp: version,
                    payload: structuredClone(payload),
                });
            return payload;
        };
        try {
            const entries = await loadCalendarLedger({
                ...options,
                request: adapter,
                isCurrent: active,
            });
            check();
            for (const [key, page] of staged) {
                if (page.stamp !== stamp(accounts.get(page.accountId)))
                    throw cancelledRequest();
                const previous = scope.pages.get(key);
                if (previous) scope.rows -= previous.payload.entries.length;
                scope.pages.delete(key);
                scope.pages.set(key, page);
                scope.rows += page.payload.entries.length;
                while (scope.rows > 10000 || scope.pages.size > 100) {
                    const oldest = scope.pages.keys().next().value;
                    scope.rows -=
                        scope.pages.get(oldest).payload.entries.length;
                    scope.pages.delete(oldest);
                }
            }
            return entries;
        } catch (error) {
            // Never reuse pages after a failed validation or an uncertain response.
            if (session === scope && error.name !== 'AbortError') clear();
            throw error;
        }
    }
    load.clear = clear;
    load.metrics = () =>
        session && session.user === getUser()
            ? {
                  cacheHits: session.cacheHits,
                  cachedPages: session.pages.size,
                  cachedRows: session.rows,
              }
            : null;
    return load;
}
