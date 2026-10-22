import { readPublicJson } from './publicJson.js';
import { releaseCacheOptions } from './releaseCache.js';

const configuredBase = (
    import.meta.env?.VITE_DATA_PLATFORM_BASE_URL || ''
).replace(/\/+$/, '');
export const isOfficialFundConfigured = () => Boolean(configuredBase);

export function createOfficialFundClient({
    baseUrl = configuredBase,
    read = readPublicJson,
} = {}) {
    const base = baseUrl.replace(/\/+$/, '');
    return async function load(
        symbol,
        dataset = 'fund-observations',
        options = {}
    ) {
        if (!base) return null;
        if (
            !/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(symbol) ||
            !['fund-observations', 'holdings'].includes(dataset)
        )
            throw new Error('공식 데이터 조회 대상이 잘못되었습니다.');
        const prefix = `datasets/${dataset}`;
        const pointer = await read(`${base}/${prefix}/current.json`, {
            ...releaseCacheOptions(`${base}/${prefix}/current.json`, options),
            validate: (p) =>
                p?.schemaVersion === 1 &&
                p.dataset === dataset &&
                /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p.releaseId || '') &&
                p.manifestKey ===
                    `${prefix}/releases/${p.releaseId}/manifest.json`,
        });
        const manifest = await read(`${base}/${pointer.manifestKey}`, {
            ...releaseCacheOptions(`${base}/${pointer.manifestKey}`, options),
            validate: (m) =>
                m?.schemaVersion === 1 &&
                m.dataset === dataset &&
                m.releaseId === pointer.releaseId &&
                m.entities &&
                m.symbols &&
                m.policies,
        });
        const entity = manifest.symbols[symbol];
        if (!entity) return null;
        const entry = manifest.entities[entity];
        if (!/^entities\/[a-f0-9]{64}\.json$/.test(entry?.path || ''))
            throw new Error('공식 데이터 파일 경로가 잘못되었습니다.');
        const directory = pointer.manifestKey.replace(/manifest\.json$/, '');
        const data = await read(`${base}/${directory}${entry.path}`, {
            ...releaseCacheOptions(
                `${base}/${directory}${entry.path}`,
                options
            ),
            validate: (v) =>
                v?.schemaVersion === 1 &&
                v.dataset === dataset &&
                v.entityId === entity &&
                v.releaseId === pointer.releaseId &&
                Array.isArray(v.observations) &&
                v.observations.every(
                    (r) =>
                        r.entityId === entity &&
                        r.dataset === dataset &&
                        r.field &&
                        r.sourceUrl &&
                        r.asOfDate
                ),
        });
        return {
            ...data,
            policies: Object.values(manifest.policies),
            inputVersions: manifest.inputVersions || {},
        };
    };
}

export const loadOfficialFund = createOfficialFundClient();
