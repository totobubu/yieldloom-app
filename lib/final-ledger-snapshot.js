// Server-only allowlist. No client-supplied object keys or credentials.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { projectFinalLedger } from './final-ledger-view.js';
export const finalLedgerCheckpoint = Object.freeze({
    prefix: 'reconciliation/final-review/2026-10-28/b42699d3-913a-4268-a100-10a6c232fa3b/d8dbb50889d2bf832e21a35b4e201e3c84fb54e84a81fab4497a4019fe4684e1/',
    manifestSha256:
        '11f6f8bf03d4d55fbae0612770a70d4e618795012047547c73b6a70a31c43b67',
    receiptSha256:
        '30fdd7ee100a504c2b8e2e108a7f5aff100ae7ce73f2b892651629d57d05282c',
    gzipSha256:
        'd8dbb50889d2bf832e21a35b4e201e3c84fb54e84a81fab4497a4019fe4684e1',
    workbookSha256:
        '7b244450902ff8f39af54c7c2a573539164b70c978e95531dfe5239eb26bca96',
    observations: 5287,
});
const hash = (b) => createHash('sha256').update(b).digest('hex');
const check = (ok) => {
    if (!ok)
        throw Object.assign(
            new Error('최종 데이터 무결성을 확인하지 못했습니다.'),
            { status: 409, code: 'FINAL_INTEGRITY_FAILED' }
        );
};
export async function readFinalLedger(
    readBytes,
    checkpoint = finalLedgerCheckpoint
) {
    const manifestBytes = await readBytes(
        checkpoint.prefix + 'manifest.json',
        48_000
    );
    const receiptBytes = await readBytes(
        checkpoint.prefix + 'verification-receipt.json',
        64_000
    );
    check(
        hash(manifestBytes) === checkpoint.manifestSha256 &&
            hash(receiptBytes) === checkpoint.receiptSha256
    );
    const manifest = JSON.parse(manifestBytes),
        receipt = JSON.parse(receiptBytes);
    check(
        manifest.prefix === checkpoint.prefix &&
            manifest.publicationStatus === 'remote_readback_verified' &&
            manifest.gzipSha256 === checkpoint.gzipSha256 &&
            manifest.observationRows === checkpoint.observations
    );
    check(
        receipt.manifest?.sha256 === checkpoint.manifestSha256 &&
            receipt.remoteReconstruction?.membersVerified ===
                manifest.members?.length
    );
    check(
        Array.isArray(manifest.parts) &&
            manifest.parts.length === manifest.partCount &&
            manifest.parts.length <= 100 &&
            manifest.gzipBytes <= 2_000_000 &&
            manifest.archiveBytes <= 3_000_000
    );
    const pieces = [];
    for (let start = 0; start < manifest.parts.length; start += 4) {
        const group = await Promise.all(
            manifest.parts.slice(start, start + 4).map(async (p, offset) => {
                check(
                    p.name ===
                        `final-review.bundle.json.gz.base64.part-${String(start + offset + 1).padStart(5, '0')}` &&
                        p.key === checkpoint.prefix + p.name &&
                        p.bytes > 0 &&
                        p.bytes <= 24_000
                );
                const bytes = await readBytes(p.key, 24_000);
                check(
                    bytes.length === p.bytes &&
                        hash(bytes) === p.sha256 &&
                        /^[A-Za-z0-9+/=]+$/.test(bytes.toString('ascii'))
                );
                return bytes.toString('ascii');
            })
        );
        pieces.push(...group);
    }
    const gzip = Buffer.from(pieces.join(''), 'base64');
    check(
        gzip.length === manifest.gzipBytes &&
            hash(gzip) === checkpoint.gzipSha256
    );
    const archive = gunzipSync(gzip, { maxOutputLength: 3_000_000 });
    check(
        archive.length === manifest.archiveBytes &&
            hash(archive) === manifest.archiveSha256
    );
    const bundle = JSON.parse(archive);
    check(
        bundle.format === 'yieldloom-private-review-bundle-v2' &&
            Array.isArray(bundle.members) &&
            bundle.members.length === manifest.members.length
    );
    const descriptor = manifest.members.find(
        (m) => m.name === 'observations.json'
    );
    const member = bundle.members.filter((m) => m.name === 'observations.json');
    check(
        descriptor &&
            member.length === 1 &&
            member[0].encoding === 'gzip+base64' &&
            member[0].sha256 === descriptor.sha256 &&
            member[0].bytes === descriptor.bytes &&
            descriptor.bytes <= 64_000_000
    );
    const raw = gunzipSync(Buffer.from(member[0].dataBase64, 'base64'), {
        maxOutputLength: 64_000_000,
    });
    check(raw.length === descriptor.bytes && hash(raw) === descriptor.sha256);
    const input = JSON.parse(raw);
    check(
        input.schemaVersion === 1 &&
            input.rowCount === checkpoint.observations &&
            Array.isArray(input.rows) &&
            input.rows.length === checkpoint.observations
    );
    const projected = projectFinalLedger(input.rows);
    // Opaque provider IDs remain server-only; clients receive only observation IDs.
    projected.orderReferences = new Map(
        [...projected.orderReferences].map(([id, row]) => [
            hash('wife:' + id),
            row,
        ])
    );
    return {
        ...projected,
        releaseId: checkpoint.gzipSha256,
        snapshotAt: manifest.createdAt,
    };
}
