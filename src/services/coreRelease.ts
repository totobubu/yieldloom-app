import { getDataUrl } from '@/utils/dataUrl';

export interface CoreInstrument {
    symbol: string;
    isin?: string | null;
    market: string;
    currency: string;
    koName?: string | null;
    longName?: string | null;
    active: boolean;
    officialProvider?: string | null;
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

const configuredBase = (import.meta.env.VITE_DATA_RELEASE_BASE_URL || '').replace(/\/+$/, '');
let pointerPromise: Promise<{ pointer: CorePointer; manifest: CoreManifest }> | null = null;
let directoryPromise: Promise<CoreInstrument[]> | null = null;

const urlForKey = (key: string) =>
    configuredBase ? `${configuredBase}/${key.replace(/^\//, '')}` : getDataUrl(key);

async function currentRelease() {
    if (!pointerPromise) {
        pointerPromise = (async () => {
            const pointerResponse = await fetch(urlForKey('core/current.json'));
            if (!pointerResponse.ok) throw new Error(`Core release pointer unavailable (${pointerResponse.status})`);
            const pointer = await pointerResponse.json() as CorePointer;
            if (!pointer.releaseId || !pointer.manifestKey?.startsWith('core/releases/')) {
                throw new Error('Core release pointer is invalid');
            }
            const manifestResponse = await fetch(urlForKey(pointer.manifestKey));
            if (!manifestResponse.ok) throw new Error(`Core manifest unavailable (${manifestResponse.status})`);
            const manifest = await manifestResponse.json() as CoreManifest;
            if (manifest.releaseId !== pointer.releaseId || !manifest.catalogSearchIndexPath) {
                throw new Error('Core manifest is invalid');
            }
            return { pointer, manifest };
        })().catch((error) => {
            pointerPromise = null;
            throw error;
        });
    }
    return pointerPromise;
}

export async function loadCoreDirectory(): Promise<CoreInstrument[]> {
    if (!directoryPromise) {
        directoryPromise = (async () => {
            const { pointer, manifest } = await currentRelease();
            const releaseRoot = pointer.manifestKey.slice(0, -'manifest.json'.length);
            const response = await fetch(urlForKey(`${releaseRoot}${manifest.catalogSearchIndexPath}`));
            if (!response.ok) throw new Error(`Core catalog unavailable (${response.status})`);
            const payload = await response.json();
            if (!Array.isArray(payload?.instruments)) throw new Error('Core catalog is invalid');
            return payload.instruments as CoreInstrument[];
        })().catch((error) => {
            directoryPromise = null;
            throw error;
        });
    }
    return directoryPromise;
}

export async function loadCoreInstrument(entry: CoreInstrument): Promise<CoreInstrument> {
    if (!entry.instrumentPath) return entry;
    const { pointer } = await currentRelease();
    const releaseRoot = pointer.manifestKey.slice(0, -'manifest.json'.length);
    const response = await fetch(urlForKey(`${releaseRoot}${entry.instrumentPath}`));
    if (!response.ok) throw new Error(`Core instrument unavailable (${response.status})`);
    return { ...entry, ...(await response.json() as CoreInstrument) };
}

export async function loadCoreDividendEvents(entry: CoreInstrument): Promise<any[]> {
    const instrument = await loadCoreInstrument(entry);
    if (!instrument.dividendHistoryPath) return [];
    const { pointer } = await currentRelease();
    const releaseRoot = pointer.manifestKey.slice(0, -'manifest.json'.length);
    const response = await fetch(urlForKey(`${releaseRoot}${instrument.dividendHistoryPath}`));
    if (!response.ok) throw new Error(`Core dividend history unavailable (${response.status})`);
    const payload = await response.json();
    return Array.isArray(payload?.events) ? payload.events : [];
}
