// Cache only imported, immutable ledger rows. Callers must authorize first and
// pass the account's entriesRevision: imports update that document in the same
// transaction as entries. Classifications/allocations are always read fresh.

export function createAccountLedgerCache({
    now = Date.now,
    ttlMs = 300000,
    maxRows = 30000,
} = {}) {
    const cache = new Map();
    const pending = new Map();
    return async (root, version, load) => {
        // Without a reliable revision, never risk serving an old import.
        if (!version) return { rows: await load(), cache: 'bypass' };
        const key = `${root}|${version}`;
        const saved = cache.get(key);
        if (saved && saved.expires > now())
            return { rows: saved.rows, cache: 'hit' };
        cache.delete(key);
        if (pending.has(key))
            return { rows: await pending.get(key), cache: 'shared' };
        const promise = (async () => {
            const rows = await load();
            for (const [key, value] of cache) {
                if (value.root === root || value.expires <= now())
                    cache.delete(key);
            }
            if (rows.length <= maxRows) {
                let count = [...cache.values()].reduce(
                    (sum, entry) => sum + entry.rows.length,
                    0
                );
                while (
                    cache.size &&
                    (count + rows.length > maxRows || cache.size >= 8)
                ) {
                    const oldest = cache.keys().next().value;
                    count -= cache.get(oldest).rows.length;
                    cache.delete(oldest);
                }
                cache.set(key, { root, rows, expires: now() + ttlMs });
            }
            return rows;
        })();
        pending.set(key, promise);
        try {
            return { rows: await promise, cache: 'miss' };
        } finally {
            pending.delete(key);
        }
    };
}
