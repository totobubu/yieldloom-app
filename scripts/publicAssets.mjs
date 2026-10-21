import { applySecurityStatuses, isSearchableSecurity } from '../lib/security-status.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeDiscoveredStocks } from '../lib/discovered-stocks.js';
import { verifiedUnderlying } from '../lib/security-underlyings.js';
import { releaseIdentity } from '../lib/release-identity.js';
import { inferSecurityType, matchesProductType, productTypeOptions } from '../lib/security-filters.js';

export const excludedPublicDirectories = new Set([
    'logos', 'calendar', 'sidebar', 'popularity', 'brokerage', 'flags', 'holidays',
    // Source metadata is retained locally for the legacy data generators.
    'nav',
]);
const indexFields = ['symbol', 'koName', 'longName', 'company', 'underlying', 'market', 'currency', 'dividendEtfs', 'dividendEvidence', 'noDividends', 'ipoDate', 'frequency', 'active', 'listingStatus'];

export function createTickerIndex(payload, relationships = {}, discovered = {}) {
    const underlyingByTicker = new Map(Object.entries(relationships).flatMap(([underlying, tickers]) =>
        (tickers ?? []).map(ticker => [ticker, underlying])));
    return { nav: applySecurityStatuses(mergeDiscoveredStocks(payload.instruments, discovered)).filter(row => row.symbol && isSearchableSecurity(row, true)).map(row => ({
        ...Object.fromEntries(indexFields.filter(key => row[key] != null).map(key => [key, row[key]])),
        company: row.officialProvider ?? row.company,
        underlying: verifiedUnderlying(row.symbol)?.underlying ?? underlyingByTicker.get(row.symbol) ?? row.underlying,
        securityType: inferSecurityType(row),
        productTypes: productTypeOptions.filter(option => option.value && !['stock', 'etf'].includes(option.value) && matchesProductType(row, option.value)).map(option => option.value),
    })) };
}

export function publicAssetsPlugin() {
    let publicRoot;
    let configRoot;
    let base;
    const readIndex = async () => {
        const [seed, catalog, discovered, nav] = await Promise.all([
            fs.readFile(path.join(configRoot, 'data-v2', 'catalog-seed.json'), 'utf8'),
            fs.readFile(path.join(publicRoot, 'thumbnail-catalog.json'), 'utf8'),
            fs.readFile(path.join(publicRoot, 'us-dividend-stocks.json'), 'utf8'),
            fs.readFile(path.join(publicRoot, 'nav.json'), 'utf8'),
        ]);
        const metadata = new Map(JSON.parse(nav).nav.map(row => [row.symbol, row]));
        const payload = JSON.parse(seed);
        payload.instruments = payload.instruments.map(row => ({ ...metadata.get(row.symbol), ...row }));
        return JSON.stringify(createTickerIndex(payload, JSON.parse(catalog).relationships, JSON.parse(discovered)));
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
                if (req.url?.split('?')[0] === `${base}app-release.json`) {
                    try {
                        res.setHeader(
                            'Content-Type',
                            'application/json; charset=utf-8'
                        );
                        res.setHeader('Cache-Control', 'no-store');
                        return res.end(
                            JSON.stringify(await releaseIdentity(configRoot))
                        );
                    } catch (error) {
                        return next(error);
                    }
                }
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
            this.emitFile({
                type: 'asset',
                fileName: 'app-release.json',
                source: JSON.stringify(await releaseIdentity(configRoot)),
            });
        },
    };
}
