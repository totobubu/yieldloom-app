#!/usr/bin/env node
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import {
    incrementHash as hash,
    incrementMarker,
    verifyIncrement,
    publishIncrement,
} from '../../lib/toss-ledger-increments.js';

export async function preserve(path, bytes) {
    try {
        await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (!Buffer.from(await readFile(path)).equals(Buffer.from(bytes)))
            throw Error('local_content_conflict');
    }
}
export async function prepareManualPublication({
    root,
    accountSeq,
    accountSuffix,
    scopes,
    browserFile,
    checkedAt,
    existingFiles,
}) {
    if (
        !/^\d{4}$/.test(accountSuffix) ||
        !['OPEN', 'CLOSED'].some((k) => scopes[k]?.status === 'complete')
    )
        throw Error('invalid_publication_scope');
    const files = existingFiles
        ? existingFiles.map((file) => ({ ...file }))
        : [];
    const add = (name, b) =>
        files.push({
            name,
            bytes: b.length,
            sha256: hash(b),
            dataBase64: b.toString('base64'),
        });
    for (const status of existingFiles ? [] : ['OPEN', 'CLOSED']) {
        const scope = scopes[status];
        if (scope?.status === 'not_requested') continue;
        if (scope?.status !== 'complete') throw Error('incomplete_api_scope');
        const dir = join(root, hash(String(accountSeq)), scope.run);
        for (const name of (await readdir(dir)).sort())
            if (
                /^(manifest|checkpoint|orders-index)\.json$|^page-\d{8}\.json$/.test(
                    name
                )
            )
                add(`api/${status}/${name}`, await readFile(join(dir, name)));
    }
    if (browserFile) {
        const bytes = await readFile(browserFile),
            ui = JSON.parse(bytes);
        const identity = {
            provider: 'TOSS_PERSONAL_ACCOUNT_UI',
            account: 'wife',
            document: ui.detail?.url,
            observedAt: ui.checkedAt,
            sourceSha256: hash(bytes),
        };
        const sourceFile = 'browser/observation.json';
        add(sourceFile, bytes);
        const observation = {
            kind: 'TOSS_TRANSACTION',
            accountId: 'wife',
            sourceIdentity: identity,
            observationId: hash(JSON.stringify(identity)),
            originalTransactionId: null,
            type: 'DIVIDEND',
            symbol: ui.symbol,
            currency: ui.currency,
            displayedPaidAt: ui.depositAtDisplayed,
            timePrecision: 'minute',
            timeZone: 'Asia/Seoul',
            gross: ui.gross,
            tax: ui.tax,
            net: ui.net,
            paymentStatus: 'PAID',
            canonicalAdoption: false,
            sourceFile,
            coverage: ui.coverage,
        };
        add(
            'dividend-observation.json',
            Buffer.from(JSON.stringify(observation))
        );
    }
    const sourceFiles = files.map(({ name, bytes, sha256 }) => ({
            name,
            bytes,
            sha256,
        })),
        sourceSetHash = hash(JSON.stringify(sourceFiles));
    const prefix = `brokerage/toss/wife-${accountSuffix}/${sourceSetHash}/`;
    const archive = Buffer.from(
        JSON.stringify({
            format: 'yieldloom-private-toss-raw-bundle-v1',
            files,
        })
    );
    const gz = gzipSync(archive),
        encoded = gz.toString('base64');
    const objects = new Map(),
        parts = [];
    for (let offset = 0; offset < encoded.length; offset += 24000) {
        const body = Buffer.from(encoded.slice(offset, offset + 24000));
        const key =
            prefix +
            `collection.bundle.json.gz.base64.part-${String(parts.length + 1).padStart(5, '0')}`;
        parts.push({ key, bytes: body.length, sha256: hash(body) });
        objects.set(key, body);
    }
    const sourceTimes = files
        .flatMap((file) => {
            const value = JSON.parse(Buffer.from(file.dataBase64, 'base64'));
            return [
                value.updatedAt,
                value.observedAt,
                value.fetchedAt,
                value.checkedAt,
            ].filter(
                (time) =>
                    typeof time === 'string' &&
                    Number.isFinite(Date.parse(time))
            );
        })
        .sort((a, b) => Date.parse(a) - Date.parse(b));
    const apiCoverage = Object.fromEntries(
        ['OPEN', 'CLOSED'].map((status) => {
            const file = files.find(
                (item) => item.name === `api/${status}/checkpoint.json`
            );
            if (!file) return [status, { status: 'not_requested' }];
            const checkpoint = JSON.parse(
                Buffer.from(file.dataBase64, 'base64')
            );
            return [
                status,
                {
                    status: checkpoint.status,
                    coverage: checkpoint.coverage,
                    pages: checkpoint.pages,
                    uniqueOrders: checkpoint.uniqueOrders,
                },
            ];
        })
    );
    const manifest = {
        format: 'yieldloom-private-toss-r2-transfer-v1',
        bucket: 'yieldloom-data-private',
        prefix,
        sourceFiles,
        sourceFileCount: files.length,
        sourceSetHash,
        archiveBytes: archive.length,
        archiveSha256: hash(archive),
        gzipBytes: gz.length,
        gzipSha256: hash(gz),
        partCount: parts.length,
        parts,
        coverage: {
            api: apiCoverage,
            canonicalUnchanged: true,
        },
    };
    const mb = Buffer.from(JSON.stringify(manifest)),
        manifestDescriptor = {
            key: prefix + 'collection.manifest.json',
            bytes: mb.length,
            sha256: hash(mb),
        };
    objects.set(manifestDescriptor.key, mb);
    const receipt = {
        status: 'incremental_observations_verified',
        bucket: manifest.bucket,
        prefix,
        verifiedAt: sourceTimes.at(-1) ?? checkedAt,
        sourceFilesVerified: files.length,
        allRawPartsGetVerified: true,
        manifest: manifestDescriptor,
        gzipSha256: manifest.gzipSha256,
        archiveSha256: manifest.archiveSha256,
        canonicalUnchanged: true,
    };
    const rb = Buffer.from(JSON.stringify(receipt)),
        receiptDescriptor = {
            key: prefix + 'r2-upload-receipt.json',
            bytes: rb.length,
            sha256: hash(rb),
        };
    objects.set(receiptDescriptor.key, rb);
    const marker = incrementMarker({
        prefix,
        manifest: manifestDescriptor,
        receipt: receiptDescriptor,
    });
    await verifyIncrement(async (key) => objects.get(key), marker.value);
    const dir = join(root, 'publication-' + sourceSetHash);
    await mkdir(dir, { recursive: true });
    for (const [key, bytes] of objects)
        await preserve(join(dir, basename(key)), bytes);
    await preserve(join(dir, 'index-marker.json'), marker.bytes);
    const plan = {
        schemaVersion: 1,
        prefix,
        marker: marker.value,
        indexKey: marker.key,
        localDirectory: dir,
        status: 'prepared_not_uploaded',
    };
    await preserve(
        join(dir, 'publication-plan.json'),
        Buffer.from(JSON.stringify(plan))
    );
    return plan;
}

export async function loadPublication(directory) {
    const dir = resolve(directory),
        mb = await readFile(join(dir, 'collection.manifest.json')),
        rb = await readFile(join(dir, 'r2-upload-receipt.json'));
    const m = JSON.parse(mb);
    const marker = incrementMarker({
        prefix: m.prefix,
        manifest: {
            key: m.prefix + 'collection.manifest.json',
            bytes: mb.length,
            sha256: hash(mb),
        },
        receipt: {
            key: m.prefix + 'r2-upload-receipt.json',
            bytes: rb.length,
            sha256: hash(rb),
        },
    });
    const objects = new Map([
        [marker.value.manifest.key, mb],
        [marker.value.receipt.key, rb],
    ]);
    for (const p of m.parts) {
        if (p.key !== m.prefix + basename(p.key))
            throw Error('invalid_part_path');
        objects.set(p.key, await readFile(join(dir, basename(p.key))));
    }
    await verifyIncrement(async (key) => objects.get(key), marker.value);
    return { dir, marker, objects };
}
export async function attachBrowserObservation(directory, browserFile) {
    const p = await loadPublication(directory);
    const manifest = JSON.parse(p.objects.get(p.marker.value.manifest.key));
    const encoded = manifest.parts
        .map((part) => p.objects.get(part.key).toString('ascii'))
        .join('');
    const bundle = JSON.parse(
        gunzipSync(Buffer.from(encoded, 'base64'), {
            maxOutputLength: 5_000_000,
        })
    );
    if (
        bundle.files.some(
            (file) =>
                file.name.startsWith('browser/') ||
                file.name === 'dividend-observation.json'
        )
    )
        throw Error('browser_evidence_already_attached');
    const ui = JSON.parse(await readFile(browserFile));
    return prepareManualPublication({
        root: resolve(p.dir, '..'),
        accountSuffix: manifest.prefix.match(
            /^brokerage\/toss\/wife-(\d{4})\//
        )?.[1],
        scopes: manifest.coverage.api,
        browserFile,
        checkedAt: ui.checkedAt,
        existingFiles: bundle.files,
    });
}
export async function publishExisting({ directory, readBytes, putIfAbsent }) {
    const { dir, marker, objects } = await loadPublication(directory);
    const receiptKey = marker.value.receipt.key;
    for (const [key, bytes] of objects) {
        if (key === receiptKey) continue;
        try {
            await putIfAbsent(key, bytes);
        } catch (e) {
            if (![409, 412].includes(e.status ?? e.$metadata?.httpStatusCode))
                throw e;
        }
        if (!Buffer.from(await readBytes(key, 5_000_000)).equals(bytes))
            throw Error('remote_readback_mismatch');
    }
    // Verify remote parts/members before publishing the completion receipt or marker.
    await verifyIncrement(
        async (key, max) =>
            key === receiptKey ? objects.get(key) : readBytes(key, max),
        marker.value
    );
    try {
        await putIfAbsent(receiptKey, objects.get(receiptKey));
    } catch (e) {
        if (![409, 412].includes(e.status ?? e.$metadata?.httpStatusCode))
            throw e;
    }
    const result = await publishIncrement({
        readBytes,
        putIfAbsent,
        marker: marker.value,
    });
    await preserve(
        join(dir, 'linked-receipt.json'),
        Buffer.from(JSON.stringify(result))
    );
    return result;
}
export async function createExistingR2Transport(environment = process.env) {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } =
        environment;
    if (
        !/^[a-f0-9]{32}$/.test(R2_ACCOUNT_ID ?? '') ||
        !R2_ACCESS_KEY_ID ||
        !R2_SECRET_ACCESS_KEY
    )
        throw Error('existing_r2_configuration_required');
    const { S3Client, GetObjectCommand, PutObjectCommand } = await import(
        '@aws-sdk/client-s3'
    );
    const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
        maxAttempts: 1,
    });
    const Bucket = 'yieldloom-data-private';
    return {
        readBytes: async (Key, max) => {
            const r = await s3.send(new GetObjectCommand({ Bucket, Key }));
            if (r.ContentLength > max) throw Error('size_limit');
            const chunks = [];
            let total = 0;
            for await (const b of r.Body) {
                total += b.length;
                if (total > max) {
                    r.Body.destroy?.();
                    throw Error('size_limit');
                }
                chunks.push(Buffer.from(b));
            }
            return Buffer.concat(chunks);
        },
        putIfAbsent: (Key, Body) =>
            s3.send(
                new PutObjectCommand({
                    Bucket,
                    Key,
                    Body,
                    IfNoneMatch: '*',
                    ContentType: 'text/plain; charset=utf-8',
                })
            ),
    };
}
export async function main(args = process.argv.slice(2)) {
    try {
        const { values } = parseArgs({
            args,
            options: {
                help: { type: 'boolean' },
                directory: { type: 'string' },
                publish: { type: 'boolean' },
                'attach-browser': { type: 'string' },
            },
        });
        if (values.help) {
            console.log(
                'node scripts/toss/publish-account-observations.mjs --directory EXISTING_VERIFIED_PUBLICATION [--attach-browser EXISTING_EGO_JSON] [--publish]\nWithout --publish: offline verification/preparation only. --attach-browser combines one actual ego observation with existing API evidence without recollecting. With --publish: existing R2 environment credentials, private immutable writes, GET/member verification, append-only index commit. No new credentials, baseline writes or financial API calls.'
            );
            return 0;
        }
        if (!values.directory) throw Error('directory_required');
        const prepared = values['attach-browser']
            ? await attachBrowserObservation(
                  values.directory,
                  values['attach-browser']
              )
            : null;
        const p = await loadPublication(
            prepared?.localDirectory ?? values.directory
        );
        if (!values.publish) {
            console.log(
                JSON.stringify({
                    status: 'offline_verified_not_linked',
                    indexKey: p.marker.key,
                    marker: p.marker.value,
                    directory: p.dir,
                })
            );
            return 0;
        }
        console.log(
            JSON.stringify(
                await publishExisting({
                    directory: p.dir,
                    ...(await createExistingR2Transport()),
                })
            )
        );
        return 0;
    } catch {
        console.error(
            JSON.stringify({
                status: 'not_linked',
                reason: 'publication_failed_check_existing_configuration_and_private_receipt',
            })
        );
        return 2;
    }
}
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    process.exitCode = await main();
