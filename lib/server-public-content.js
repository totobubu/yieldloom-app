import { createHash } from 'node:crypto';
import { createTransportCache } from './request-cache.js';
import {
    createPublicContentReader,
    publicContentRoot,
} from './public-content.js';

const pointerCache = createTransportCache({ ttlMs: 60_000, maxEntries: 16 });
const objectCache = createTransportCache({
    ttlMs: 86_400_000,
    maxEntries: 256,
});
export function serverContentRoot() {
    const channel = process.env.PUBLIC_CONTENT_CHANNEL;
    if (process.env.VERCEL_ENV === 'preview' && channel === 'production')
        throw Error('Preview cannot read production public content');
    return publicContentRoot(
        process.env.PUBLIC_CONTENT_BASE_URL || '',
        channel
    );
}
export async function readServerContent(name, fetcher = fetch, options = {}) {
    const root = serverContentRoot();
    if (!root) return null;
    return createPublicContentReader({
        root,
        sha256: (text) => createHash('sha256').update(text).digest('hex'),
        read: (url, opts) =>
            (opts.immutable ? objectCache : pointerCache)(fetcher)(
                url,
                async () => {
                    const response = await fetcher(url, {
                        signal: AbortSignal.timeout(5000),
                        credentials: 'omit',
                        cache: opts.immutable ? 'default' : 'no-store',
                    });
                    if (!response.ok)
                        throw Error(`Public content HTTP ${response.status}`);
                    if (!opts.text) return response.json();
                    const text = await response.text();
                    const hash = createHash('sha256')
                        .update(text)
                        .digest('hex');
                    if (!url.endsWith(`/${hash}.json`))
                        throw Error('Public projection hash mismatch');
                    return text;
                }
            ),
    })(name, options);
}
