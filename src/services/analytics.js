import { apiUrl } from './apiUrl.js';

const events = new Set(['search', 'card_open', 'png_download', 'share_copy']);
const kinds = new Set(['summary', 'comparison', 'rival', 'calendar', 'holding-dividend', 'entry-efficiency', 'home']);

// No uid, identifier, page URL, search text, or portfolio data is ever sent.
export function trackAggregate(event, cardKind = 'home') {
    if (!events.has(event) || !kinds.has(cardKind)) return;
    fetch(apiUrl('/api/analytics'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, cardKind }), keepalive: true }).catch(() => {});
}
