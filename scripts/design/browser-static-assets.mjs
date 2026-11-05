import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export const staticAssetHosts = new Set([
    'cdn.tailwindcss.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'lh3.googleusercontent.com',
]);
// Public immutable asset cache shared across viewport contexts in one capture run.
const cache = new Map();
export async function installStaticAssets(context) {
    const failures = [];
    await context.route('https://**/*', async (route) => {
        const url = route.request().url(),
            host = new URL(url).hostname;
        if (!staticAssetHosts.has(host)) return route.abort();
        try {
            // The unversioned Tailwind endpoint returned HTTP200 with an empty
            // body in this environment. Pin its public v3 runtime for reference
            // rendering; keep the immutable source HTML unchanged.
            const fetchUrl =
                host === 'cdn.tailwindcss.com' && new URL(url).pathname === '/'
                    ? 'https://cdn.tailwindcss.com/3.4.17' + new URL(url).search
                    : url;
            let body = cache.get(fetchUrl);
            if (!body) {
                ({ stdout: body } = await exec(
                    'curl',
                    [
                        '--fail',
                        '--location',
                        '--silent',
                        '--show-error',
                        '--max-time',
                        '20',
                        fetchUrl,
                    ],
                    { encoding: 'buffer', maxBuffer: 12000000 }
                ));
                if (!body.length)
                    throw new Error('Empty static asset response');
                cache.set(fetchUrl, body);
            }
            const contentType =
                host === 'cdn.tailwindcss.com'
                    ? 'application/javascript'
                    : host === 'fonts.googleapis.com' || url.includes('.css')
                      ? 'text/css'
                      : host === 'fonts.gstatic.com' ||
                          /\.(?:woff2?|ttf)/.test(url)
                        ? 'font/woff2'
                        : 'image/png';
            return route.fulfill({ body, contentType });
        } catch {
            failures.push({ host, status: 'asset-fetch-failed' });
            return route.abort();
        }
    });
    return failures;
}
