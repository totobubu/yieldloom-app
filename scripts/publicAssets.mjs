import fs from 'node:fs/promises';
import path from 'node:path';

export const excludedPublicDirectories = new Set([
    'logos', 'calendar', 'sidebar', 'popularity', 'brokerage', 'flags', 'holidays',
    // Source metadata is retained locally for the legacy data generators.
    'nav',
]);
const indexFields = ['symbol', 'koName', 'company', 'underlying', 'market', 'currency'];

export function createTickerIndex(payload, relationships = {}) {
    const underlyingByTicker = new Map(Object.entries(relationships).flatMap(([underlying, tickers]) =>
        (tickers ?? []).map(ticker => [ticker, underlying])));
    return { nav: (payload.instruments ?? []).filter(row => row.symbol && row.active !== false).map(row => ({
        ...Object.fromEntries(indexFields.filter(key => row[key] != null).map(key => [key, row[key]])),
        company: row.officialProvider ?? row.company,
        underlying: underlyingByTicker.get(row.symbol) ?? row.underlying,
        securityType: row.market === 'KR' ? 'stock' : 'etf',
    })) };
}

export function publicAssetsPlugin() {
    let publicRoot;
    let configRoot;
    let base;
    const readIndex = async () => {
        const [seed, catalog] = await Promise.all([
            fs.readFile(path.join(configRoot, 'data-v2', 'catalog-seed.json'), 'utf8'),
            fs.readFile(path.join(publicRoot, 'thumbnail-catalog.json'), 'utf8'),
        ]);
        return JSON.stringify(createTickerIndex(JSON.parse(seed), JSON.parse(catalog).relationships));
    };
    return {
        name: 'thumbnail-public-assets',
        configResolved(config) {
            publicRoot = path.join(config.root, 'public');
            configRoot = config.root;
            base = config.base;
        },
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                if (req.url?.split('?')[0] !== `${base}ticker-index.json`) return next();
                try {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-store');
                    res.end(await readIndex());
                } catch (error) { next(error); }
            });
        },
        async generateBundle() {
            const emitDirectory = async (directory, prefix = '') => {
                for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
                    if (!prefix && (excludedPublicDirectories.has(entry.name) || ['nav.json', 'ticker-index.json'].includes(entry.name))) continue;
                    const name = `${prefix}${entry.name}`;
                    const location = path.join(directory, entry.name);
                    if (entry.isDirectory()) await emitDirectory(location, `${name}/`);
                    else this.emitFile({ type: 'asset', fileName: name, source: await fs.readFile(location) });
                }
            };
            await emitDirectory(publicRoot);
            this.emitFile({ type: 'asset', fileName: 'ticker-index.json', source: await readIndex() });
        },
    };
}
