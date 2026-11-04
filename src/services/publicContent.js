import {
    createPublicContentReader,
    publicContentRoot,
} from '../../lib/public-content.js';
import { readPublicJson } from './publicJson.js';
import { getAssetUrl } from '../utils/dataUrl.js';

const root = publicContentRoot(
    import.meta.env?.VITE_PUBLIC_CONTENT_BASE_URL || '',
    import.meta.env?.VITE_PUBLIC_CONTENT_CHANNEL
);
export const isPublicContentConfigured = () => Boolean(root);
const reader = createPublicContentReader({
    root,
    sha256: async (text) =>
        Array.from(
            new Uint8Array(
                await crypto.subtle.digest(
                    'SHA-256',
                    new TextEncoder().encode(text)
                )
            ),
            (byte) => byte.toString(16).padStart(2, '0')
        ).join(''),
    read: (url, options) =>
        readPublicJson(url, {
            signal: options.signal,
            force: !options.immutable && options.force,
            ttlMs: options.immutable ? 86_400_000 : 60_000,
            cachePolicy: options.immutable ? 'immutable' : 'memory',
            validate: options.text
                ? async (text) => {
                      const hash = Array.from(
                          new Uint8Array(
                              await crypto.subtle.digest(
                                  'SHA-256',
                                  new TextEncoder().encode(text)
                              )
                          ),
                          (byte) => byte.toString(16).padStart(2, '0')
                      ).join('');
                      return url.endsWith(`/${hash}.json`);
                  }
                : () => true,
            responseType: options.text ? 'text' : 'json',
        }),
});
export async function readContentJson(path, options = {}) {
    if (!root)
        return readPublicJson(getAssetUrl(path.replace(/^\//, '')), options);
    const url = new URL(path, 'https://public.invalid');
    const name = url.pathname.replace(/^\/?content-studio\//, '');
    const { value, releaseId } = await reader(name, {
        ...options,
        releaseId: url.searchParams.get('snapshot') || undefined,
    });
    if (options.validate && !options.validate(value))
        throw Error('Invalid public projection');
    if (name.endsWith('-index.json') && Array.isArray(value.tickers))
        return {
            ...value,
            tickers: value.tickers.map((row) => ({
                ...row,
                historyUrl: `${row.historyUrl}?snapshot=${releaseId}`,
            })),
        };
    return value;
}
