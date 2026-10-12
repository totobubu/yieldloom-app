const storageKey = 'yieldloom.thumbnail-presets.v1';
const readLocal = () => { try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; } };
const writeLocal = (items) => localStorage.setItem(storageKey, JSON.stringify(items));
const normalize = (item) => ({ id: item.id, name: String(item.name).slice(0, 40), ticker: String(item.ticker).toUpperCase(), rivals: [...new Set(item.rivals ?? [])].slice(0, 3), tone: item.tone, updatedAt: item.updatedAt ?? new Date().toISOString() });

export function loadLocalPresets() { return readLocal().map(normalize); }
export function saveLocalPreset(preset) {
    const item = normalize(preset);
    const next = [...readLocal().filter((entry) => entry.id !== item.id), item];
    writeLocal(next);
    return item;
}

export function removeLocalPreset(id) {
    writeLocal(readLocal().filter((item) => item.id !== id));
}
