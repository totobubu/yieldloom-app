import { pathToFileURL } from 'node:url';
import { releaseIdentity } from '../../lib/release-identity.js';
export function assertRelease(actual, expected) {
    if (
        actual?.schemaVersion !== 1 ||
        !/^[a-f0-9]{40}$/.test(actual.commit || '') ||
        actual.commit !== expected.commit ||
        !/^[a-f0-9]{64}$/.test(actual.metadataSha256 || '') ||
        actual.metadataSha256 !== expected.metadataSha256
    )
        throw new Error('배포 커밋 또는 데이터 버전이 일치하지 않습니다.');
}
export async function waitForReleases(
    bases,
    expected,
    {
        fetcher = fetch,
        attempts = 32,
        intervalMs = 15_000,
        pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        report = console.log,
    } = {}
) {
    const pending = new Set(bases);
    for (let attempt = 0; attempt < attempts && pending.size; attempt++) {
        await Promise.all(
            [...pending].map(async (base) => {
                try {
                    const url = new URL(
                        'app-release.json',
                        base.endsWith('/') ? base : `${base}/`
                    );
                    url.searchParams.set('release', expected.commit);
                    url.searchParams.set('check', String(attempt));
                    const response = await fetcher(url, {
                        cache: 'no-store',
                        headers: { 'Cache-Control': 'no-cache' },
                        signal: AbortSignal.timeout(20_000),
                    });
                    if (!response.ok) throw Error(`HTTP ${response.status}`);
                    assertRelease(await response.json(), expected);
                    pending.delete(base);
                    report(`${base}: commit and metadata verified`);
                } catch {
                    report(
                        `${base}: waiting for expected release (${attempt + 1}/${attempts})`
                    );
                }
            })
        );
        if (pending.size && attempt + 1 < attempts) await pause(intervalMs);
    }
    if (pending.size)
        throw Error(`배포 동기화 미완료: ${[...pending].join(', ')}`);
}
if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    const expected = await releaseIdentity(process.cwd());
    const index = process.argv.indexOf('--sha');
    if (index >= 0) expected.commit = process.argv[index + 1];
    if (!/^[a-f0-9]{40}$/.test(expected.commit || ''))
        throw Error('검증할 커밋 SHA가 필요합니다.');
    await waitForReleases(
        [
            'https://totobubu.github.io/yieldloom-app/',
            'https://yieldloom-app.vercel.app/',
        ],
        expected
    );
}
