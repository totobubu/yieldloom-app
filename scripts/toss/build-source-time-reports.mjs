// Local private materialization only. No credentials, HTTP, Firebase or R2 writes.
// Input: { index, accounts: { wife: { orders: {key,path}, transactions:{key,path} }, ... } }
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportDigest } from '../../lib/private-report-store.js';
import { projectVerifiedTimeArchives } from '../../lib/sheet-source-time-archive.js';

export async function buildReports(inputPath, outputPath) {
    const checkout = fileURLToPath(new URL('../../', import.meta.url));
    const target = path.resolve(outputPath);
    if (target === path.resolve(checkout) || target.startsWith(checkout))
        throw Error(
            'Private reports must be materialized outside the checkout'
        );
    const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
    if (
        !input.index?.runId ||
        !/^[a-f0-9]{64}$/.test(
            input.index.sourceBinding?.spreadsheetIdSha256 || ''
        )
    )
        throw Error('Existing private dashboard index binding required');
    await fs.mkdir(outputPath, { recursive: true, mode: 0o700 });
    const descriptors = {};
    for (const accountId of ['wife', 'husband']) {
        const sources = input.accounts[accountId];
        const loaded = {};
        for (const kind of ['orders', 'transactions']) {
            if (
                !sources[kind].key.startsWith(`snapshots/`) ||
                !sources[kind].key.includes(`/${accountId}/`)
            )
                throw Error('Archive source/account mismatch');
            loaded[kind] = JSON.parse(
                await fs.readFile(
                    path.resolve(path.dirname(inputPath), sources[kind].path),
                    'utf8'
                )
            );
        }
        const report = await projectVerifiedTimeArchives({
            accountId,
            ...loaded,
            panels: await Promise.all(
                (sources.panels || []).map(async (p) => ({
                    key: p.key,
                    sha256: p.sha256,
                    data: JSON.parse(
                        await fs.readFile(
                            path.resolve(path.dirname(inputPath), p.path),
                            'utf8'
                        )
                    ),
                }))
            ),
            frozenSourceLedgerKeys: sources.frozenSourceLedgerKeys || [],
            archiveKeys: Object.fromEntries(
                ['orders', 'transactions'].map((k) => [k, sources[k].key])
            ),
            runId: input.index.runId,
        });
        const body = JSON.stringify(report);
        if (Buffer.byteLength(body) > 4_300_000)
            throw Error(
                'Report exceeds authenticated API limit; partition before publishing'
            );
        const output = path.join(outputPath, `${accountId}.times.json`);
        await fs.writeFile(output, body, { mode: 0o600, flag: 'wx' });
        descriptors[accountId] = {
            file: path.basename(output),
            sha256: reportDigest(body),
            bytes: Buffer.byteLength(body),
            ...report.coverage,
        };
    }
    const manifest = {
        schemaVersion: 1,
        readOnly: true,
        runId: input.index.runId,
        sourceBinding: input.index.sourceBinding,
        descriptors,
        activated: false,
    };
    await fs.writeFile(
        path.join(outputPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        { mode: 0o600, flag: 'wx' }
    );
    return manifest;
}
if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const [input, out] = process.argv.slice(2);
    if (!input || !out)
        throw Error(
            'Usage: node scripts/toss/build-source-time-reports.mjs <private-input.json> <new-private-output-directory>'
        );
    const result = await buildReports(path.resolve(input), path.resolve(out));
    console.log(
        JSON.stringify({
            activated: false,
            accounts: Object.keys(result.descriptors),
        })
    );
}
