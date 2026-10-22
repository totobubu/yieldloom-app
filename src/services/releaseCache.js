// Public versioned releases only. Mutable URLs retain the existing short memory cache.
export function releaseCacheOptions(url, options = {}) {
    let immutable = false;
    try {
        const parsed = new URL(url, 'https://public.invalid');
        immutable =
            !parsed.search &&
            !parsed.hash &&
            /\/(?:core|datasets\/[a-z][a-z0-9-]*)\/releases\/[A-Za-z0-9][A-Za-z0-9._-]*\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.json$/.test(
                parsed.pathname
            );
    } catch {
        // Invalid URLs fail in the transport; never grant them long-lived caching.
    }
    return {
        ...options,
        ttlMs: immutable ? 86_400_000 : 60_000,
        cachePolicy: immutable ? 'immutable' : 'memory',
        // A refresh checks the pointer. A different version gets a different URL.
        force: immutable ? false : Boolean(options.force),
    };
}
