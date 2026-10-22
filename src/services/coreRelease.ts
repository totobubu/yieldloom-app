import { getDataUrl } from '@/utils/dataUrl';
import { readPublicJson } from './publicJson.js';
import { releaseCacheOptions } from './releaseCache.js';

export interface CoreInstrument {
    symbol: string;
    isin?: string | null;
    market: string;
    currency: string;
    koName?: string | null;
    longName?: string | null;
    active: boolean;
    listingStatus?: {
        status: 'delisted';
        delistedOn: string | null;
        lastTradingOn: string | null;
        reason: string;
        source: {
            type: 'official' | 'user_report';
            reference: string;
            url: string | null;
        };
        officialVerified: boolean;
        checkedOn: string;
    };
    ipoDate?: string;
    frequency?: string;
    noDividends?: boolean;
    officialProvider?: string | null;
    underlying?: string | null;
    instrumentPath?: string;
    dividendHistoryPath?: string;
}

interface CorePointer {
    releaseId: string;
    manifestKey: string;
}

interface CoreManifest {
    releaseId: string;
    catalogSearchIndexPath: string;
}

const configuredBase = (
    import.meta.env.VITE_DATA_RELEASE_BASE_URL || ''
).replace(/\/+$/, '');
const urlForKey = (key: string) =>
    configuredBase
        ? `${configuredBase}/${key.replace(/^\//, '')}`
        : getDataUrl(key);

async function currentRelease(): Promise<{
    pointer: CorePointer;
    manifest: CoreManifest;
}> {
    const pointer = await readPublicJson(urlForKey('core/current.json'), {
        ...releaseCacheOptions(urlForKey('core/current.json')),
        validate: (value: CorePointer) =>
            Boolean(
                value.releaseId &&
                    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.releaseId) &&
                    value.manifestKey ===
                        `core/releases/${value.releaseId}/manifest.json`
            ),
    });
    const manifest = await readPublicJson(urlForKey(pointer.manifestKey), {
        ...releaseCacheOptions(urlForKey(pointer.manifestKey)),
        validate: (value: CoreManifest) =>
            value.releaseId === pointer.releaseId &&
            value.catalogSearchIndexPath === 'catalog/search-index.json',
    });
    return { pointer, manifest };
}

export async function loadCoreDirectory(): Promise<CoreInstrument[]> {
    const { pointer, manifest } = await currentRelease();
    const releaseRoot = pointer.manifestKey.slice(0, -'manifest.json'.length);
    const payload = await readPublicJson(
        urlForKey(`${releaseRoot}${manifest.catalogSearchIndexPath}`),
        {
            ...releaseCacheOptions(
                urlForKey(`${releaseRoot}${manifest.catalogSearchIndexPath}`)
            ),
            validate: (value: { instruments: unknown }) =>
                Array.isArray(value?.instruments),
        }
    );
    return payload.instruments;
}

async function instrumentFromRelease(
    entry: CoreInstrument,
    pointer: CorePointer
): Promise<CoreInstrument> {
    if (!entry.instrumentPath) return entry;
    const releaseRoot = pointer.manifestKey.slice(0, -'manifest.json'.length);
    return {
        ...entry,
        ...(await readPublicJson(
            urlForKey(`${releaseRoot}${entry.instrumentPath}`),
            releaseCacheOptions(
                urlForKey(`${releaseRoot}${entry.instrumentPath}`)
            )
        )),
    };
}

export async function loadCoreInstrument(
    entry: CoreInstrument
): Promise<CoreInstrument> {
    const { pointer } = await currentRelease();
    return instrumentFromRelease(entry, pointer);
}

export async function loadCoreDividendEvents(
    entry: CoreInstrument
): Promise<unknown[]> {
    const { pointer } = await currentRelease();
    const instrument = await instrumentFromRelease(entry, pointer);
    if (!instrument.dividendHistoryPath) return [];
    const releaseRoot = pointer.manifestKey.slice(0, -'manifest.json'.length);
    const payload = await readPublicJson(
        urlForKey(`${releaseRoot}${instrument.dividendHistoryPath}`),
        releaseCacheOptions(
            urlForKey(`${releaseRoot}${instrument.dividendHistoryPath}`)
        )
    );
    return Array.isArray(payload?.events) ? payload.events : [];
}
