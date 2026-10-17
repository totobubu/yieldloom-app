import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
export async function releaseIdentity(root) {
    const paths = [
        'data-v2/catalog-seed.json',
        'data-v2/security-underlyings.json',
        'data-v2/collection-health.json',
    ];
    const data = await Promise.all(
        paths.map(async (filename) =>
            JSON.parse(await fs.readFile(path.join(root, filename), 'utf8'))
        )
    );
    let commit;
    try {
        commit = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        commit =
            process.env.VERCEL_GIT_COMMIT_SHA ||
            process.env.GITHUB_SHA ||
            'local';
    }
    return {
        schemaVersion: 1,
        commit,
        metadataSha256: createHash('sha256')
            .update(JSON.stringify(data))
            .digest('hex'),
    };
}
