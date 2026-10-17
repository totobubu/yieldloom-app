import registry from '../data-v2/security-underlyings.json' with { type: 'json' };

const officialHosts = {
    direxion: 'direxion.com',
    kurv: 'kurvinvest.com',
    graniteshares: 'graniteshares.com',
    roundhill: 'roundhillinvestments.com',
    yieldmax: 'yieldmaxetfs.com',
    defiance: 'defianceetfs.com',
    rex: 'rexshares.com',
    proshares: 'proshares.com',
};

const symbolKey = (symbol) =>
    String(symbol ?? '')
        .trim()
        .toUpperCase();

/** Verified economic reference asset; this does not imply direct stock holdings. */
export function verifiedUnderlying(symbol, catalog = registry) {
    if (catalog?.schemaVersion !== 1) return null;
    const key = symbolKey(symbol);
    const row = catalog.instruments?.[key];
    let source;
    try {
        source = new URL(row?.evidence?.url);
    } catch {
        return null;
    }
    if (
        row?.symbol !== key ||
        row.verificationStatus !== 'official' ||
        !/^[A-Z][A-Z0-9.-]{0,11}$/.test(row.underlying ?? '') ||
        row.underlying === key ||
        source.protocol !== 'https:' ||
        source.hostname.replace(/^www\./, '') !== officialHosts[row.provider] ||
        !/^[a-f0-9]{64}$/.test(row.evidence?.contentSha256 ?? '')
    )
        return null;
    return row;
}

/** Overlay every directory source, including older remote core/DivGrow releases. */
export function applyVerifiedUnderlyings(rows, catalog = registry) {
    return rows.map((row) => {
        const link = verifiedUnderlying(row.symbol, catalog);
        return link ? { ...row, underlying: link.underlying } : row;
    });
}
