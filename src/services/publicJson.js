import { createSharedRequest, joinSharedRequest } from './sharedRequest.js';

export function publicRequestCredentials(url, origin = '') {
    const value = String(url);
    if (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return 'same-origin';
    if (!origin) return 'omit';
    try {
        return new URL(value, origin).origin === new URL(origin).origin
            ? 'same-origin'
            : 'omit';
    } catch {
        return 'omit';
    }
}

// Opt-in public GETs only. Never use this cache for accounts or authenticated data.
export function createPublicJsonClient({
    fetcher = fetch,
    now = Date.now,
    maxEntries = 96,
    maxChars = 8_000_000,
    origin = typeof window === 'undefined' ? '' : window.location.origin,
} = {}) {
    const entries = new Map();
    const counters = { networkRequests: 0, cacheHits: 0, sharedRequests: 0 };
    let chars = 0;
    const checked = (value, validate, key, entry) => {
        try {
            if (!validate(value))
                throw new Error('공개 데이터 형식이 잘못되었습니다.');
            return value;
        } catch (error) {
            remove(key, entry);
            throw error;
        }
    };
    const remove = (key, entry) => {
        if (entries.get(key) !== entry) return;
        chars -= entry.chars || 0;
        entries.delete(key);
    };
    async function read(
        url,
        {
            signal,
            force = false,
            ttlMs = 60_000,
            timeoutMs = 15_000,
            validate = () => true,
        } = {}
    ) {
        if (signal?.aborted) throw signal.reason;
        const key = String(url);
        let entry = entries.get(key);
        if (!force && entry?.expires > now()) {
            counters.cacheHits++;
            const value = structuredClone(entry.value);
            return checked(value, validate, key, entry);
        }
        if (
            entry?.task &&
            !entry.task.controller.signal.aborted &&
            (!force || entry.forced)
        ) {
            counters.sharedRequests++;
        } else {
            if (entry) remove(key, entry);
            entry = { forced: force };
            entries.set(key, entry);
            const current = entry;
            current.task = createSharedRequest(async (transportSignal) => {
                counters.networkRequests++;
                const response = await fetcher(key, {
                    credentials: publicRequestCredentials(key, origin),
                    referrerPolicy: 'no-referrer',
                    cache: force ? 'reload' : 'no-store',
                    signal: transportSignal,
                });
                if (!response.ok) {
                    const value = await response.json().catch(() => ({}));
                    throw Object.assign(
                        new Error(
                            value?.error ||
                                `공개 데이터 조회 실패 (${response.status})`
                        ),
                        { status: response.status }
                    );
                }
                const value = await response.json();
                if (!validate(value))
                    throw new Error('공개 데이터 형식이 잘못되었습니다.');
                if (transportSignal.aborted) throw transportSignal.reason;
                if (entries.get(key) === current) {
                    const size = JSON.stringify(value).length;
                    if (size <= maxChars && ttlMs > 0) {
                        current.value = structuredClone(value);
                        current.chars = size;
                        chars += size;
                        current.expires = now() + ttlMs;
                    }
                    while (entries.size > maxEntries || chars > maxChars) {
                        const oldest = entries.keys().next().value;
                        remove(oldest, entries.get(oldest));
                    }
                }
                return value;
            });
            current.task.promise.then(
                () => {
                    delete current.task;
                    if (!current.expires) remove(key, current);
                },
                () => remove(key, current)
            );
            // Bound pending keys too; existing consumers keep their detached task.
            while (entries.size > maxEntries) {
                const oldest = entries.keys().next().value;
                remove(oldest, entries.get(oldest));
            }
        }
        const current = entry;
        const subscriberSignal = signal
            ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs);
        const value = structuredClone(
            await joinSharedRequest(current.task, subscriberSignal)
        );
        if (signal?.aborted) throw signal.reason;
        return checked(value, validate, key, current);
    }
    read.clear = () => {
        entries.clear();
        chars = 0;
    };
    read.metrics = () => ({ ...counters, entries: entries.size, chars });
    return read;
}

// Isolate injected transports used by tests, and share the browser's normal transport.
const clients = new WeakMap();
export function publicJsonFor(fetcher = fetch) {
    if (!clients.has(fetcher))
        clients.set(fetcher, createPublicJsonClient({ fetcher }));
    return clients.get(fetcher);
}
export const readPublicJson = (url, options) => publicJsonFor()(url, options);
