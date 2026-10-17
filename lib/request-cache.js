// Bounded public-data cache with one loader per active key. Failures are never retained.
export function createRequestCache({
    ttlMs = 60_000,
    maxEntries = 128,
    maxChars = 8_000_000,
    now = Date.now,
} = {}) {
    const entries = new Map();
    let chars = 0;
    const remove = (key, entry) => {
        if (entries.get(key) !== entry) return;
        chars -= entry.chars || 0;
        entries.delete(key);
    };
    const read = async (key, loader) => {
        let entry = entries.get(key);
        if (entry?.expires > now()) return structuredClone(entry.value);
        if (!entry?.pending) {
            if (entry) remove(key, entry);
            entry = {};
            entries.set(key, entry);
            const current = entry;
            current.pending = Promise.resolve()
                .then(loader)
                .then((value) => {
                    if (entries.get(key) === current) {
                        const size = JSON.stringify(value).length;
                        if (size <= maxChars) {
                            current.value = structuredClone(value);
                            current.chars = size;
                            current.expires = now() + ttlMs;
                            chars += size;
                        } else remove(key, current);
                        while (entries.size > maxEntries || chars > maxChars) {
                            const oldest = entries.keys().next().value;
                            remove(oldest, entries.get(oldest));
                        }
                    }
                    return value;
                });
            current.pending.then(
                () => {
                    delete current.pending;
                },
                () => remove(key, current)
            );
            while (entries.size > maxEntries) {
                const oldest = entries.keys().next().value;
                remove(oldest, entries.get(oldest));
            }
        }
        return structuredClone(await entry.pending);
    };
    read.clear = () => {
        entries.clear();
        chars = 0;
    };
    return read;
}

export function createTransportCache(options) {
    const transports = new WeakMap();
    return (fetcher = fetch) => {
        if (!transports.has(fetcher))
            transports.set(fetcher, createRequestCache(options));
        return transports.get(fetcher);
    };
}
