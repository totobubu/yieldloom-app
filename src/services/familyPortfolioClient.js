import { apiUrl } from './apiUrl.js';
import {
    cancelledRequest,
    createSharedRequest,
    joinSharedRequest,
} from './sharedRequest.js';

export function retryDeadline(header, now, fallbackSeconds = 60) {
    const raw = String(header ?? '').trim();
    if (/^\d+$/.test(raw)) {
        const deadline = now + Number(raw) * 1000;
        return Number.isFinite(deadline) && deadline <= 8.64e15
            ? deadline
            : now + fallbackSeconds * 1000;
    }
    const date = raw ? Date.parse(raw) : NaN;
    return Number.isFinite(date)
        ? Math.max(now, date)
        : now + fallbackSeconds * 1000;
}

// Session-only requests and counters. GET responses are never cached here:
// permission checks must reach the server even when ledger pages are reused.
export function createFamilyPortfolioClient({
    getUser,
    fetcher = fetch,
    now = Date.now,
}) {
    const limitedUsers = new WeakMap();
    let session;
    const listeners = new Set();
    const invalidate = (reason = 'reset') => {
        const user = session?.user;
        if (session) {
            session.generation++;
            for (const task of session.pending.values())
                task.controller.abort();
            session.pending.clear();
        }
        for (const listener of listeners) listener(user, reason);
    };
    const clear = () => {
        invalidate('session');
        session = undefined;
    };
    function currentSession(user) {
        if (session?.user !== user) {
            if (session) clear();
            session = {
                user,
                generation: 0,
                pending: new Map(),
                metrics: {
                    apiRequests: 0,
                    sharedRequests: 0,
                    firestoreDocumentsRead: 0,
                    firestoreReadOperations: 0,
                    measuredResponses: 0,
                },
            };
        }
        return session;
    }
    async function familyRequest(
        action = '',
        body,
        query = {},
        { signal } = {}
    ) {
        const user = getUser();
        if (!user) {
            clear();
            throw new Error('로그인이 필요합니다.');
        }
        const scope = currentSession(user);
        if (signal?.aborted)
            throw new DOMException('요청이 취소되었습니다.', 'AbortError');
        const limited = limitedUsers.get(user);
        if (limited?.retryAt > now()) throw limited;
        const params = new URLSearchParams({
            ...query,
            ...(action ? { action } : {}),
        });
        params.sort();
        const mutation = body !== undefined;
        // Inspection, preferences and private reports do not change the account ledger.
        const invalidatesLedger =
            mutation &&
            ![
                'inspectSpreadsheet',
                'inspectAccountDocument',
                'saveMonthlyStatement',
                'deleteMonthlyStatement',
                'savePreferences',
            ].includes(action);
        if (invalidatesLedger) invalidate('write');
        const generation = scope.generation;
        const active = () => session === scope && getUser() === user;
        const work = async (transportSignal) => {
            const token = await user.getIdToken();
            if (!active() || transportSignal?.aborted) throw cancelledRequest();
            scope.metrics.apiRequests++;
            const response = await fetcher(
                apiUrl(`/api/family-portfolio?${params}`),
                {
                    method: body === undefined ? 'GET' : 'POST',
                    cache: 'no-store',
                    signal: transportSignal,
                    headers: {
                        Authorization: `Bearer ${token}`,
                        ...(body instanceof FormData || body === undefined
                            ? {}
                            : { 'Content-Type': 'application/json' }),
                    },
                    body:
                        body === undefined
                            ? undefined
                            : body instanceof FormData
                              ? body
                              : JSON.stringify(body),
                }
            );
            if (!active()) throw cancelledRequest();
            const documents = response.headers.get(
                'X-Portfolio-Document-Reads'
            );
            const operations = response.headers.get(
                'X-Portfolio-Read-Operations'
            );
            if (
                /^\d+$/.test(documents ?? '') &&
                /^\d+$/.test(operations ?? '')
            ) {
                scope.metrics.firestoreDocumentsRead += Number(documents);
                scope.metrics.firestoreReadOperations += Number(operations);
                scope.metrics.measuredResponses++;
            }
            const payload = await response.json().catch(() => ({}));
            if (!active()) throw cancelledRequest();
            if (!response.ok) {
                const error = Object.assign(
                    new Error(payload.error || '요청을 처리하지 못했습니다.'),
                    { code: payload.code, status: response.status }
                );
                if (response.status === 429) {
                    error.retryAt = retryDeadline(
                        response.headers.get('Retry-After'),
                        now()
                    );
                    // This is the earliest recommended retry, never a promise of recovery.
                    error.retryTiming = payload.retryTiming || 'recommended';
                    error.limitType = payload.limitType || 'unknown';
                    limitedUsers.set(user, error);
                }
                if ([401, 403, 404].includes(response.status))
                    invalidate('access');
                throw error;
            }
            if (!mutation && generation !== scope.generation)
                throw cancelledRequest();
            // Another in-flight response must not erase a newer 429 cooldown.
            if (!(limitedUsers.get(user)?.retryAt > now()))
                limitedUsers.delete(user);
            return payload;
        };
        if (mutation) {
            try {
                return await work(signal);
            } finally {
                if (active() && invalidatesLedger) invalidate('write');
            }
        }
        const key = params.toString();
        let task = scope.pending.get(key);
        if (task && !task.controller.signal.aborted)
            scope.metrics.sharedRequests++;
        else {
            task = createSharedRequest(work);
            scope.pending.set(key, task);
            const remove = () => {
                if (scope.pending.get(key) === task) scope.pending.delete(key);
            };
            task.promise.then(remove, remove);
        }
        const payload = await joinSharedRequest(task, signal);
        if (!active() || generation !== scope.generation)
            throw cancelledRequest();
        return structuredClone(payload);
    }
    familyRequest.clear = clear;
    familyRequest.onInvalidate = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    };
    familyRequest.metrics = () =>
        getUser() && session?.user === getUser()
            ? { ...session.metrics }
            : null;
    return familyRequest;
}
