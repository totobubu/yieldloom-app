import {
    normalizeCardPresentation,
    shareCardKinds,
} from './thumbnail/cardPresentation.js';

// Retain the v1 storage key so existing local presets migrate in place.
const storageKey = 'yieldloom.thumbnail-presets.v1';
const readLocal = () => {
    try {
        const value = JSON.parse(localStorage.getItem(storageKey) || '[]');
        return Array.isArray(value) ? value : [];
    } catch {
        return [];
    }
};
const writeLocal = (items) =>
    localStorage.setItem(storageKey, JSON.stringify(items));
const normalize = (item) => {
    if (!item || typeof item !== 'object') return null;
    const ticker = String(item.ticker || '').toUpperCase();
    if (!/^[A-Z0-9.^:_-]{1,40}$/.test(ticker) || !item.id) return null;
    const kinds = Array.isArray(item.cardKinds)
        ? [...new Set(item.cardKinds)].filter((kind) =>
              shareCardKinds.includes(kind)
          )
        : ['summary'];
    return {
        schemaVersion: 2,
        id: item.id,
        name: String(item.name || ticker).slice(0, 40),
        ticker,
        rivals: [
            ...new Set(Array.isArray(item.rivals) ? item.rivals : []),
        ].slice(0, 3),
        tone: ['informative', 'concise', 'friendly'].includes(item.tone)
            ? item.tone
            : 'informative',
        presentation: normalizeCardPresentation(item.presentation),
        cardKinds: kinds.length ? kinds : ['summary'],
        updatedAt: item.updatedAt ?? new Date().toISOString(),
    };
};

export function loadLocalPresets() {
    return readLocal().map(normalize).filter(Boolean);
}
export function saveLocalPreset(preset) {
    const item = normalize(preset);
    if (!item) throw new Error('프리셋 종목과 이름을 확인해 주세요.');
    writeLocal([...readLocal().filter((entry) => entry?.id !== item.id), item]);
    return item;
}
export function removeLocalPreset(id) {
    writeLocal(readLocal().filter((item) => item?.id !== id));
}
