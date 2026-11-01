// Synthetic memory-only mutations. Never reads configuration or external storage.
import assert from 'node:assert/strict';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
    incrementHash as hash,
    incrementMarker,
} from '../../lib/toss-ledger-increments.js';
const bytes = (value) => Buffer.from(JSON.stringify(value));
const describe = (key, data) => ({
    key,
    bytes: data.length,
    sha256: hash(data),
});
export function rewriteIncrementFixture(source, edit = {}) {
    const objects = new Map(source.objects);
    const original = source.marker.value;
    const manifest = JSON.parse(objects.get(original.manifest.key));
    const receipt = JSON.parse(objects.get(original.receipt.key));
    let gzip = Buffer.from(
        manifest.parts
            .map((p) => objects.get(p.key).toString('ascii'))
            .join(''),
        'base64'
    );
    let archive = gunzipSync(gzip);
    const bundle = JSON.parse(archive);
    if (edit.member || edit.bundle) {
        if (edit.member)
            for (const file of bundle.files) {
                const value = JSON.parse(
                    Buffer.from(file.dataBase64, 'base64')
                );
                edit.member(file.name, value);
                const data = bytes(value);
                Object.assign(file, {
                    bytes: data.length,
                    sha256: hash(data),
                    dataBase64: data.toString('base64'),
                });
            }
        edit.bundle?.(bundle);
        manifest.sourceFiles = bundle.files.map(({ name, bytes, sha256 }) => ({
            name,
            bytes,
            sha256,
        }));
        manifest.sourceFileCount = bundle.files.length;
        manifest.sourceSetHash = hash(JSON.stringify(manifest.sourceFiles));
        archive = bytes(bundle);
        gzip = gzipSync(archive);
    }
    if (edit.archive) {
        archive = edit.archive(archive);
        gzip = gzipSync(archive);
    }
    if (edit.gzip) gzip = edit.gzip(gzip);
    const encoded = gzip.toString('base64');
    const pieces = encoded.match(/.{1,24000}/g);
    assert(pieces.length > 0);
    manifest.parts = pieces.map((text, i) => {
        const key =
            original.prefix +
            `collection.bundle.json.gz.base64.part-${String(i + 1).padStart(5, '0')}`;
        const data = Buffer.from(text);
        objects.set(key, data);
        return describe(key, data);
    });
    Object.assign(manifest, {
        partCount: pieces.length,
        gzipBytes: gzip.length,
        gzipSha256: hash(gzip),
        archiveBytes: archive.length,
        archiveSha256: hash(archive),
    });
    edit.manifest?.(manifest);
    const mb = bytes(manifest);
    const md = describe(original.manifest.key, mb);
    Object.assign(receipt, {
        sourceFilesVerified: manifest.sourceFileCount,
        manifest: md,
        gzipSha256: manifest.gzipSha256,
        archiveSha256: manifest.archiveSha256,
    });
    edit.receipt?.(receipt);
    const rb = bytes(receipt);
    objects.set(md.key, mb);
    objects.set(original.receipt.key, rb);
    const marker = incrementMarker({
        ...original,
        manifest: md,
        receipt: describe(original.receipt.key, rb),
    });
    objects.delete(source.marker.key);
    objects.set(marker.key, marker.bytes);
    return { objects, marker };
}
