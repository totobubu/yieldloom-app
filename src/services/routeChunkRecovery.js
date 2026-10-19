const RECOVERY_PREFIX = 'yieldloom:route-chunk-recovery:';
const DYNAMIC_IMPORT_ERRORS = [
    'Failed to fetch dynamically imported module',
    'Importing a module script failed',
    'error loading dynamically imported module',
];

export function isDynamicImportError(error) {
    const message =
        error instanceof Error ? error.message : String(error || '');
    return DYNAMIC_IMPORT_ERRORS.some((text) => message.includes(text));
}

function recoveryKey(path) {
    return `${RECOVERY_PREFIX}${path || '/'}`;
}

export function recoverRouteChunk(
    error,
    path,
    {
        storage = globalThis.sessionStorage,
        reload = () => globalThis.location.reload(),
    } = {}
) {
    if (!isDynamicImportError(error)) return false;
    const key = recoveryKey(path);
    try {
        if (storage.getItem(key)) return false;
        storage.setItem(key, '1');
    } catch {
        return false;
    }
    reload();
    return true;
}

export function clearRouteChunkRecovery(
    path,
    storage = globalThis.sessionStorage
) {
    try {
        storage.removeItem(recoveryKey(path));
    } catch {
        // Storage can be unavailable in restricted browser modes.
    }
}
