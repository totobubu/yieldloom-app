import { readFile, writeFile } from 'node:fs/promises';
import { verifiedUnderlying } from '../../lib/security-underlyings.js';

const root = new URL('../../', import.meta.url);
const seed = JSON.parse(
    await readFile(new URL('data-v2/catalog-seed.json', root))
);
const catalog = JSON.parse(
    await readFile(new URL('public/thumbnail-catalog.json', root))
);
const links = new Map();
for (const [underlying, symbols] of Object.entries(catalog.relationships)) {
    for (const symbol of [underlying, ...symbols]) {
        const groups = links.get(symbol) || new Set();
        groups.add(underlying);
        links.set(symbol, groups);
    }
}
const instruments = new Map(seed.instruments.map((row) => [row.symbol, row]));
const securities = {};
for (const symbol of [
    ...new Set([...instruments.keys(), ...links.keys()]),
].sort()) {
    const provider = instruments.get(symbol)?.officialProvider || null;
    const groups = links.get(symbol);
    const underlying =
        verifiedUnderlying(symbol)?.underlying ??
        (groups?.size === 1 ? [...groups][0] : null);
    if (provider || underlying) securities[symbol] = { provider, underlying };
}
await writeFile(
    new URL('public/portfolio-classifications.json', root),
    JSON.stringify(
        {
            schemaVersion: 1,
            source: 'catalog-seed + thumbnail-catalog + security-underlyings',
            securities,
        },
        null,
        2
    ) + '\n'
);
console.log(
    `Exported ${Object.keys(securities).length} portfolio classifications`
);
