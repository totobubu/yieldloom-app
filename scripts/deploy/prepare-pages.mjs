import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function preparePages(directory = 'dist') {
    const root = resolve(directory);
    // Pages serves existing HTML files at their extensionless paths.
    // Keep /compare and its query unchanged; preserve the general SPA fallback.
    await copyFile(resolve(root, 'index.html'), resolve(root, 'compare.html'));
    await copyFile(resolve(root, 'index.html'), resolve(root, '404.html'));
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
    await preparePages(process.argv[2]);
}
