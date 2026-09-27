// Yahoo's ratio is NEW shares / OLD shares. Never infer from a price jump.
export function normalizeSplit(event) {
    const [newShares, oldShares] = String(event.ratio || '').split(':').map(Number);
    if (!(newShares > 0) || !(oldShares > 0) || !Number.isFinite(newShares / oldShares)) return event;
    return { ...event, type: newShares < oldShares ? 'reverse-split' : 'split' };
}

export function mergeSplits(existing, incoming) {
    const events = new Map();
    for (const event of [...existing, ...incoming]) {
        const normalized = normalizeSplit(event);
        events.set(`${normalized.date}|${normalized.ratio}`, normalized);
    }
    return [...events.values()].sort((a, b) => a.date.localeCompare(b.date));
}
