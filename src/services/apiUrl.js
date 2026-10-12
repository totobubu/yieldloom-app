const apiBase = String(import.meta.env?.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export function apiUrl(path) {
    if (!String(path).startsWith('/api/')) throw new Error('API path must begin with /api/');
    return `${apiBase}${path}`;
}

export const apiOrigin = apiBase;
