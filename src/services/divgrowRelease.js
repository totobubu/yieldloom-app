const configuredBase = (import.meta.env.VITE_DIVGROW_RELEASE_BASE_URL || '').replace(/\/+$/, '');

const fetchJson = async (url) => {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`DivGrow release request failed (${response.status})`);
    return response.json();
};

const keyUrl = (key) => `${configuredBase}/${String(key).replace(/^\//, '')}`;

export const isDivgrowReleaseConfigured = () => Boolean(configuredBase);

export async function loadDivgrowTickerIndex() {
    if (!configuredBase) throw new Error('DivGrow release URL is not configured');
    const pointer = await fetchJson(keyUrl('releases/v1/current.json'));
    if (pointer.schemaVersion !== 1 || !pointer.releaseId || !/^releases\/v1\/releases\/[A-Za-z0-9._-]+\/manifest\.json$/.test(pointer.manifestKey || '')) {
        throw new Error('DivGrow release pointer is invalid');
    }
    const manifest = await fetchJson(keyUrl(pointer.manifestKey));
    if (manifest.schemaVersion !== 1 || manifest.releaseId !== pointer.releaseId || manifest.dataRoot !== 'data/' || typeof manifest.catalogPath !== 'string') {
        throw new Error('DivGrow release manifest is invalid');
    }
    const releaseRoot = pointer.manifestKey.slice(0, -'manifest.json'.length);
    const catalog = await fetchJson(keyUrl(`${releaseRoot}${manifest.catalogPath}`));
    if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.instruments)) throw new Error('DivGrow release catalog is invalid');
    return {
        releaseId: pointer.releaseId,
        nav: catalog.instruments
            .filter((row) => typeof row?.symbol === 'string' && typeof row?.dataPath === 'string' && row.dataPath.startsWith('data/'))
            .map((row) => ({ ...row, dataPaths: [row.dataPath] })),
    };
}
