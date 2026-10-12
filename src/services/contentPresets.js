import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { db } from './firebaseClient';

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

export async function syncPresets(uid) {
    if (!db || !uid) return loadLocalPresets();
    const remote = (await getDocs(collection(db, 'contentPresets', uid, 'items'))).docs.map((entry) => normalize({ id: entry.id, ...entry.data() }));
    const merged = new Map(remote.map((item) => [item.id, item]));
    for (const item of loadLocalPresets()) {
        const existing = merged.get(item.id);
        if (!existing || item.updatedAt > existing.updatedAt) {
            await setDoc(doc(db, 'contentPresets', uid, 'items', item.id), item);
            merged.set(item.id, item);
        }
    }
    localStorage.removeItem(storageKey);
    return [...merged.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function savePreset(uid, preset) {
    const item = saveLocalPreset(preset);
    if (db && uid) await setDoc(doc(db, 'contentPresets', uid, 'items', item));
    return item;
}

export async function removePreset(uid, id) {
    writeLocal(readLocal().filter((item) => item.id !== id));
    if (db && uid) await deleteDoc(doc(db, 'contentPresets', uid, 'items', id));
}
