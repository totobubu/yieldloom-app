// Deliberately stores column positions, never file headers, sheet names or account data.
export const BROKER_PRESET_KEY = 'yieldloom.broker-layouts.v1';
const brokers = [
    'toss',
    'kiwoom',
    'korea-investment',
    'miraeasset',
    'samsung',
    'other',
];
const fields = new Set([
    'symbol',
    'quantity',
    'amount',
    'currency',
    'date',
    'type',
    'externalId',
    'settlementAmount',
    'nativeSettlementAmount',
    'nativeAmount',
    'nativeCommission',
    'nativeTax',
    'exchangeRate',
    'cashKind',
]);
export async function brokerHeaderSignature(headers) {
    const bytes = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(headers))
    );
    return [...new Uint8Array(bytes)]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
}
const keyFor = (broker, kind) => {
    if (
        !brokers.includes(broker) ||
        !['holdings', 'transactions'].includes(kind)
    )
        throw new Error('증권사와 자료 종류를 확인하세요.');
    return `${broker}:${kind}`;
};
function read(storage) {
    const value = JSON.parse(storage.getItem(BROKER_PRESET_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function clean(value) {
    if (
        !value ||
        !['utf-8-sig', 'cp949'].includes(value.encoding) ||
        !Number.isInteger(value.headerRow) ||
        value.headerRow < 1 ||
        value.headerRow > 20 ||
        !['', 'USD', 'KRW'].includes(value.defaultCurrency) ||
        !Number.isInteger(value.columnCount) ||
        value.columnCount < 1 ||
        value.columnCount > 50 ||
        !Number.isInteger(value.sheetIndex ?? 0) ||
        (value.sheetIndex ?? 0) < 0 ||
        (value.sheetIndex ?? 0) >= 20 ||
        !/^[a-f0-9]{64}$/.test(value.headerSignature || '') ||
        !value.mapping ||
        typeof value.mapping !== 'object' ||
        Array.isArray(value.mapping)
    )
        throw new Error('저장된 열 연결 설정을 확인하세요.');
    const mapping = Object.fromEntries(
        Object.entries(value.mapping).filter(
            ([key, index]) =>
                fields.has(key) &&
                Number.isInteger(index) &&
                index >= 0 &&
                index < value.columnCount
        )
    );
    return {
        encoding: value.encoding,
        headerRow: value.headerRow,
        defaultCurrency: value.defaultCurrency,
        columnCount: value.columnCount,
        sheetIndex: value.sheetIndex ?? 0,
        headerSignature: value.headerSignature,
        mapping,
    };
}
export function saveBrokerPreset(storage, broker, kind, value) {
    const presets = read(storage);
    presets[keyFor(broker, kind)] = clean(value);
    // Bound the persisted object to known broker/kind slots, including on malformed input.
    const bounded = Object.fromEntries(
        brokers
            .flatMap((b) =>
                ['holdings', 'transactions'].map((k) => `${b}:${k}`)
            )
            .filter((key) => Object.hasOwn(presets, key))
            .flatMap((key) => {
                try {
                    return [[key, clean(presets[key])]];
                } catch {
                    return [];
                }
            })
    );
    storage.setItem(BROKER_PRESET_KEY, JSON.stringify(bounded));
}
export function loadBrokerPreset(storage, broker, kind) {
    const value = read(storage)[keyFor(broker, kind)];
    return value ? clean(value) : null;
}
export function deleteBrokerPreset(storage, broker, kind) {
    const key = keyFor(broker, kind);
    let presets;
    try {
        presets = read(storage);
    } catch {
        storage.setItem(BROKER_PRESET_KEY, '{}');
        return;
    }
    delete presets[key];
    storage.setItem(BROKER_PRESET_KEY, JSON.stringify(presets));
}
