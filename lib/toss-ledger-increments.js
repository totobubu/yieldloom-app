import {
    reportDiagnosticError,
    withReportDiagnostic,
} from './report-diagnostics.js';
// Server/local-only. Commit markers are immutable and content addressed, never a shared pointer.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import {
    validProfileBinding,
    bindingIndexPrefix,
    profileIndexPrefix,
} from './toss-account-profiles.js';
export const incrementIndexPrefix = 'reconciliation/increments/v1/wife/index/';
export const incrementHash = (b) =>
    createHash('sha256').update(b).digest('hex');
const hex = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const decimal = (v) => typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v);
function noCredentials(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        check(
            !/^(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|app[_-]?secret)$/i.test(
                key
            ),
            'INC_CREDENTIAL_FIELD'
        );
        noCredentials(child);
    }
}
const check = (ok, code) => {
    if (!ok) throw reportDiagnosticError(code);
};
const json = (bytes, code) =>
    withReportDiagnostic(code, () => JSON.parse(bytes));
const decode = (s, diagnosticCode = 'INC_BASE64_FORMAT') => {
    check(
        typeof s === 'string' &&
            s.length <= 8_000_000 &&
            /^[A-Za-z0-9+/=]*$/.test(s),
        diagnosticCode
    );
    return Buffer.from(s, 'base64');
};
const rawPrefix = (p) =>
    typeof p === 'string' &&
    /^brokerage\/toss\/wife-[0-9]{4}\/[A-Za-z0-9-]+\/$/.test(p);
// JSON object property order is not identity. Retain every field, type and value.
const sameBinding = (left, right) =>
    validProfileBinding(left) &&
    validProfileBinding(right) &&
    isDeepStrictEqual(left, right);
export function incrementMarker({ prefix, manifest, receipt, binding }) {
    const modern = binding !== undefined;
    check(
        modern
            ? validProfileBinding(binding) &&
                  prefix.startsWith(
                      `brokerage/toss/${binding.ownerId}-${binding.suffix}/accounts/${binding.accountNoSha256}/`
                  ) &&
                  /^brokerage\/toss\/(wife|husband)-[0-9]{4}\/accounts\/[a-f0-9]{64}\/[a-f0-9]{64}\/$/.test(
                      prefix
                  )
            : rawPrefix(prefix),
        'INC_MARKER_PREFIX_BINDING'
    );
    for (const [d, name] of [
        [manifest, 'collection.manifest.json'],
        [receipt, 'r2-upload-receipt.json'],
    ])
        check(
            d?.key === prefix + name &&
                hex(d.sha256) &&
                Number.isInteger(d.bytes) &&
                d.bytes > 0 &&
                d.bytes <= 128_000,
            'INC_MARKER_DESCRIPTOR'
        );
    const value = {
        schemaVersion: modern ? 2 : 1,
        accountId: modern ? binding.ownerId : 'wife',
        ...(modern ? { binding } : {}),
        prefix,
        manifest,
        receipt,
    };
    const bytes = Buffer.from(JSON.stringify(value));
    return {
        key:
            (modern ? bindingIndexPrefix(binding) : incrementIndexPrefix) +
            incrementHash(bytes) +
            '.json',
        bytes,
        value,
    };
}

// Hashes prove the included bytes, not that a complete API run was included.
// Replay the collector's page receipts before accepting its derived coverage.
function verifyApiCompleteness(members, coverage, binding) {
    let accountHash;
    let scopeCount = 0;
    for (const status of ['OPEN', 'CLOSED']) {
        const prefix = `api/${status}/`;
        const names = [...members.keys()].filter((name) =>
            name.startsWith(prefix)
        );
        const declared = coverage?.[status];
        if (!names.length) {
            check(
                !declared || declared.status === 'not_requested',
                'INC_COLLECTOR_SCOPE_DECLARATION'
            );
            continue;
        }
        scopeCount++;
        const memberJson = (name) => {
            check(members.has(prefix + name), 'INC_COLLECTOR_MEMBER_MISSING');
            return json(members.get(prefix + name).bytes, 'INC_COLLECTOR_JSON');
        };
        const identity = memberJson('manifest.json').identity;
        const checkpoint = memberJson('checkpoint.json');
        const index = memberJson('orders-index.json');
        check(
            identity?.format === 1 &&
                hex(identity.accountHash) &&
                identity.query?.status === status,
            'INC_COLLECTOR_IDENTITY'
        );
        if (accountHash !== undefined)
            check(
                accountHash === identity.accountHash,
                'INC_COLLECTOR_ACCOUNT_CONFLICT'
            );
        accountHash = identity.accountHash;
        if (binding)
            check(
                accountHash === binding.accountSeqSha256,
                'INC_COLLECTOR_BINDING'
            );
        check(
            checkpoint.format === 1 &&
                checkpoint.status === 'complete' &&
                checkpoint.nextCursor === null,
            'INC_CHECKPOINT_FORMAT'
        );
        check(
            Number.isInteger(checkpoint.pages) &&
                checkpoint.pages > 0 &&
                checkpoint.pages <= 200,
            'INC_CHECKPOINT_PAGE_LIMIT'
        );
        check(
            index.format === 1 &&
                index.status === 'complete' &&
                Array.isArray(index.orders),
            'INC_ORDER_INDEX_FORMAT'
        );
        check(
            index.pages === checkpoint.pages &&
                index.uniqueOrders === checkpoint.uniqueOrders,
            'INC_ORDER_INDEX_COUNTS'
        );
        check(
            declared &&
                declared.pages === checkpoint.pages &&
                declared.uniqueOrders === checkpoint.uniqueOrders,
            'INC_COVERAGE_COUNTS'
        );
        check(
            declared.status === undefined || declared.status === 'complete',
            'INC_COVERAGE_STATUS'
        );
        const pages = names
            .filter((name) =>
                /^page-\d{8}\.json$/.test(name.slice(prefix.length))
            )
            .sort();
        check(
            names.length === pages.length + 3 &&
                pages.length === checkpoint.pages,
            'INC_PAGE_SET'
        );
        if (status === 'OPEN') check(pages.length === 1, 'INC_OPEN_PAGE_COUNT');
        let cursor = null;
        const cursors = new Set(),
            orders = new Map();
        for (const [i, name] of pages.entries()) {
            check(
                name === prefix + `page-${String(i + 1).padStart(8, '0')}.json`,
                'INC_PAGE_SEQUENCE'
            );
            const page = json(members.get(name).bytes, 'INC_PAGE_JSON');
            check(
                page.format === 1 &&
                    page.accountHash === accountHash &&
                    page.cursor === cursor,
                'INC_PAGE_ACCOUNT_CURSOR'
            );
            check(
                typeof page.receivedAt === 'string' &&
                    Number.isFinite(Date.parse(page.receivedAt)),
                'INC_PAGE_TIME'
            );
            const raw = decode(page.bodyBase64, 'INC_PAGE_ENCODING');
            check(incrementHash(raw) === page.sha256, 'INC_PAGE_DIGEST');
            const payload = json(raw, 'INC_PAGE_JSON'),
                result = payload.result;
            check(
                !payload.error &&
                    Array.isArray(result?.orders) &&
                    typeof result.hasNext === 'boolean',
                'INC_PAGE_PAYLOAD'
            );
            check(
                result.hasNext === i < pages.length - 1,
                'INC_PAGE_CONTINUATION'
            );
            if (result.hasNext) {
                check(
                    typeof result.nextCursor === 'string' &&
                        result.nextCursor &&
                        !cursors.has(result.nextCursor),
                    'INC_PAGE_CURSOR_CHAIN'
                );
                cursors.add(result.nextCursor);
            } else check(result.nextCursor === null, 'INC_PAGE_TERMINATION');
            cursor = result.nextCursor;
            for (const [position, order] of result.orders.entries()) {
                check(
                    typeof order.orderId === 'string' && order.orderId,
                    'INC_ORDER_ID'
                );
                const refs = orders.get(order.orderId) ?? [];
                const sha256 = incrementHash(JSON.stringify(order));
                if (!refs.some((ref) => ref.sha256 === sha256))
                    refs.push({
                        page: name.slice(prefix.length),
                        position,
                        sha256,
                    });
                orders.set(order.orderId, refs);
            }
        }
        check(
            orders.size === checkpoint.uniqueOrders &&
                index.orders.length === orders.size,
            'INC_INDEX_COUNTS'
        );
        const indexed = new Set();
        for (const order of index.orders) {
            check(!indexed.has(order.orderId), 'INC_INDEX_DUPLICATE');
            indexed.add(order.orderId);
            const refs = orders.get(order.orderId);
            check(
                refs &&
                    Array.isArray(order.observations) &&
                    refs.length === order.observations.length,
                'INC_INDEX_REFERENCE_COUNT'
            );
            check(
                refs.every((ref, i) =>
                    ['page', 'position', 'sha256'].every(
                        (key) => ref[key] === order.observations[i][key]
                    )
                ),
                'INC_INDEX_REFERENCE_VALUES'
            );
        }
    }
    check(scopeCount > 0, 'INC_COLLECTOR_SCOPE_MISSING');
    return accountHash;
}

export async function verifyIncrement(readBytes, marker) {
    return withReportDiagnostic('INC_BUNDLE_FORMAT', () =>
        verifyIncrementImpl(readBytes, marker)
    );
}
async function verifyIncrementImpl(readBytes, marker) {
    const canonical = incrementMarker(marker);
    check(
        marker.schemaVersion === canonical.value.schemaVersion &&
            marker.accountId === canonical.value.accountId,
        'INC_MARKER_SCOPE'
    );
    const accountId = canonical.value.accountId;
    const checkedRead = async (d, max, digestCode, readCode) => {
        check(d.bytes <= max, digestCode);
        const b = await withReportDiagnostic(readCode, async () =>
            Buffer.from(await readBytes(d.key, max))
        );
        check(
            b.length === d.bytes && incrementHash(b) === d.sha256,
            digestCode
        );
        return b;
    };
    const mb = await checkedRead(
        marker.manifest,
        128_000,
        'INC_MANIFEST_DIGEST',
        'INC_MANIFEST_READ'
    );
    const rb = await checkedRead(
        marker.receipt,
        128_000,
        'INC_RECEIPT_DIGEST',
        'INC_RECEIPT_READ'
    );
    const manifest = json(mb, 'INC_MANIFEST_JSON'),
        receipt = json(rb, 'INC_RECEIPT_JSON');
    check(
        manifest.format === 'yieldloom-private-toss-r2-transfer-v1' &&
            manifest.prefix === marker.prefix &&
            manifest.bucket === 'yieldloom-data-private',
        'INC_MANIFEST_FORMAT'
    );
    check(
        receipt.prefix === marker.prefix &&
            receipt.bucket === manifest.bucket &&
            receipt.allRawPartsGetVerified === true &&
            receipt.sourceFilesVerified === manifest.sourceFileCount &&
            receipt.manifest?.key === marker.manifest.key &&
            receipt.manifest?.sha256 === marker.manifest.sha256 &&
            receipt.manifest?.bytes === marker.manifest.bytes,
        'INC_RECEIPT_FORMAT'
    );
    check(
        [
            'incremental_observations_verified_not_adopted',
            'incremental_observations_verified',
        ].includes(receipt.status),
        'INC_RECEIPT_STATUS'
    );
    check(
        Array.isArray(manifest.parts) &&
            manifest.parts.length === manifest.partCount &&
            manifest.partCount > 0 &&
            manifest.partCount <= 32 &&
            manifest.gzipBytes <= 2_000_000 &&
            manifest.archiveBytes <= 5_000_000,
        'INC_BUNDLE_LIMITS'
    );
    check(
        Array.isArray(manifest.sourceFiles) &&
            manifest.sourceFiles.length === manifest.sourceFileCount &&
            manifest.sourceFileCount <= 200,
        'INC_SOURCE_FILE_LIST'
    );
    check(
        hex(manifest.sourceSetHash) &&
            incrementHash(JSON.stringify(manifest.sourceFiles)) ===
                manifest.sourceSetHash,
        'INC_SOURCE_SET_DIGEST'
    );
    const pieces = [];
    for (const [i, part] of manifest.parts.entries()) {
        check(
            part.key ===
                marker.prefix +
                    `collection.bundle.json.gz.base64.part-${String(i + 1).padStart(5, '0')}` &&
                part.bytes <= 24_000 &&
                hex(part.sha256),
            'INC_PART_DESCRIPTOR'
        );
        pieces.push(
            (
                await checkedRead(
                    part,
                    24_000,
                    'INC_PART_DIGEST',
                    'INC_PART_READ'
                )
            ).toString('ascii')
        );
    }
    const gzip = decode(pieces.join(''), 'INC_GZIP_FORMAT');
    check(
        gzip.length === manifest.gzipBytes &&
            incrementHash(gzip) === manifest.gzipSha256 &&
            receipt.gzipSha256 === manifest.gzipSha256,
        'INC_GZIP_DIGEST'
    );
    const archive = withReportDiagnostic('INC_GZIP_FORMAT', () =>
        gunzipSync(gzip, { maxOutputLength: 5_000_000 })
    );
    check(
        archive.length === manifest.archiveBytes &&
            incrementHash(archive) === manifest.archiveSha256 &&
            receipt.archiveSha256 === manifest.archiveSha256,
        'INC_ARCHIVE_DIGEST'
    );
    const bundle = json(archive, 'INC_ARCHIVE_FORMAT');
    check(
        bundle.format === 'yieldloom-private-toss-raw-bundle-v1' &&
            Array.isArray(bundle.files) &&
            bundle.files.length === manifest.sourceFileCount,
        'INC_BUNDLE_FORMAT'
    );
    const members = new Map();
    for (const file of bundle.files) {
        check(
            typeof file.name === 'string' &&
                !file.name.includes('..') &&
                !members.has(file.name),
            'INC_MEMBER_NAME'
        );
        const descriptor = manifest.sourceFiles.find(
            (d) => d.name === file.name
        );
        const bytes = decode(file.dataBase64, 'INC_MEMBER_ENCODING');
        check(
            descriptor &&
                bytes.length === descriptor.bytes &&
                incrementHash(bytes) === descriptor.sha256 &&
                file.sha256 === descriptor.sha256 &&
                file.bytes === descriptor.bytes,
            'INC_MEMBER_DIGEST'
        );
        members.set(file.name, { bytes, sha256: descriptor.sha256 });
        if (file.name.endsWith('.json'))
            noCredentials(json(bytes, 'INC_MEMBER_JSON'));
    }
    if (marker.binding)
        check(
            sameBinding(manifest.binding, marker.binding),
            'INC_BUNDLE_BINDING'
        );
    const apiAccountHash = verifyApiCompleteness(
        members,
        manifest.coverage?.api,
        marker.binding
    );
    const observations = [],
        apiOrders = [];
    let legacyPaidDetailCount = 0;
    for (const [name, file] of members) {
        if (/^api\/(OPEN|CLOSED)\/page-\d{8}\.json$/.test(name)) {
            const page = json(file.bytes, 'INC_API_PAGE_JSON'),
                raw = decode(page.bodyBase64, 'INC_API_PAGE_ENCODING');
            check(incrementHash(raw) === page.sha256, 'INC_API_PAGE_DIGEST');
            const data = json(raw, 'INC_API_PAGE_JSON');
            noCredentials(data);
            check(
                Array.isArray(data.result?.orders) && !data.error,
                'INC_API_PAGE_PAYLOAD'
            );
            // Collector receipts fix the API observation time. A later browser
            // attachment/publication must never make an older API page newer.
            check(
                typeof page.receivedAt === 'string' &&
                    Number.isFinite(Date.parse(page.receivedAt)),
                'INC_API_PAGE_TIME'
            );
            for (const order of data.result.orders) {
                check(
                    typeof order.orderId === 'string' &&
                        order.orderId &&
                        ['BUY', 'SELL'].includes(order.side) &&
                        ['USD', 'KRW'].includes(order.currency) &&
                        typeof order.symbol === 'string' &&
                        typeof order.status === 'string' &&
                        decimal(order.execution?.filledQuantity),
                    'INC_API_ORDER_FORMAT'
                );
                check(
                    typeof order.orderedAt === 'string' &&
                        Number.isFinite(Date.parse(order.orderedAt)),
                    'INC_API_ORDER_TIME'
                );
                for (const key of [
                    'averageFilledPrice',
                    'filledAmount',
                    'commission',
                    'tax',
                ])
                    check(
                        order.execution[key] === null ||
                            decimal(order.execution[key]),
                        'INC_API_ORDER_NUMERIC'
                    );
                apiOrders.push({
                    order,
                    observedAt: page.receivedAt,
                    sourceHash: file.sha256,
                });
            }
        }
        if (name !== 'dividend-observation.json') continue;
        const d = json(file.bytes, 'INC_DIVIDEND_JSON');
        check(
            d.kind === 'TOSS_TRANSACTION' &&
                d.accountId === accountId &&
                d.type === 'DIVIDEND' &&
                ['USD', 'KRW'].includes(d.currency) &&
                typeof d.symbol === 'string' &&
                /^[A-Z0-9.-]{1,32}$/.test(d.symbol),
            'INC_DIVIDEND_FORMAT'
        );
        check(
            d.sourceIdentity?.provider === 'TOSS_PERSONAL_ACCOUNT_UI' &&
                d.sourceIdentity?.account === accountId &&
                hex(d.sourceIdentity.sourceSha256),
            'INC_DIVIDEND_SOURCE_IDENTITY'
        );
        const source = members.get(d.sourceFile);
        check(
            source && source.sha256 === d.sourceIdentity.sourceSha256,
            'INC_DIVIDEND_SOURCE_REFERENCE'
        );
        const ui = json(source.bytes, 'INC_DIVIDEND_JSON');
        if (marker.binding)
            check(
                (ui.accountId === undefined || ui.accountId === accountId) &&
                    ui.profileId === marker.binding.profileId &&
                    ui.accountNoSha256 === marker.binding.accountNoSha256 &&
                    ui.accountSuffix === marker.binding.suffix,
                'INC_BROWSER_BINDING'
            );
        // Wife UI captures observed before the Nov 1 status requirement can
        // lack both status fields. Their paid-deposit detail card, document,
        // time and amounts are all checked below; declared non-PAID, newer or
        // partially missing status fails. Immutable evidence is not rewritten.
        const explicitPaid =
            ui.paymentStatus === 'PAID' &&
            ui.detail?.paymentStatus === 'PAID';
        const legacyStatusless =
            accountId === 'wife' &&
            Date.parse(d.sourceIdentity.observedAt) <
                Date.parse('2026-11-01T00:00:00+09:00') &&
            !Object.hasOwn(ui, 'paymentStatus') &&
            !Object.hasOwn(ui.detail ?? {}, 'paymentStatus');
        check(
            ui.accountVerified === true &&
                (explicitPaid || legacyStatusless) &&
                ui.currency === d.currency &&
                ui.symbol === d.symbol &&
                ui.gross === d.gross &&
                ui.tax === d.tax &&
                ui.net === d.net &&
                ui.depositAtDisplayed === d.displayedPaidAt &&
                ui.checkedAt === d.sourceIdentity.observedAt,
            'INC_PAID_EVIDENCE'
        );
        check(
            /^https:\/\/www\.tossinvest\.com\/account\/transactions\//.test(
                d.sourceIdentity.document
            ) && d.sourceIdentity.document === ui.detail?.url,
            'INC_DIVIDEND_DOCUMENT'
        );
        check(
            d.observationId ===
                incrementHash(JSON.stringify(d.sourceIdentity)) &&
                d.originalTransactionId === null &&
                d.canonicalAdoption === false &&
                d.paymentStatus === 'PAID' &&
                d.timeZone === 'Asia/Seoul' &&
                d.timePrecision === 'minute',
            'INC_DIVIDEND_OBSERVATION'
        );
        check(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d.displayedPaidAt) &&
                Number.isFinite(
                    Date.parse(
                        d.displayedPaidAt.replace(' ', 'T') + ':00+09:00'
                    )
                ),
            'INC_DIVIDEND_TIME'
        );
        check(
            decimal(d.gross) && decimal(d.tax) && decimal(d.net),
            'INC_DIVIDEND_NUMERIC'
        );
        const expectedFields = [
            `거래유형\n${d.currency === 'USD' ? '외화배당금입금' : '배당금입금'}`,
            `입금일시\n${Number(d.displayedPaidAt.slice(0, 4))}년 ${Number(d.displayedPaidAt.slice(5, 7))}월 ${Number(d.displayedPaidAt.slice(8, 10))}일 ${d.displayedPaidAt.slice(11)}`,
        ];
        check(
            expectedFields.every((field) =>
                ui.detail.detailFields?.includes(field)
            ),
            'INC_DIVIDEND_DETAIL_FIELDS'
        );
        for (const [label, expected] of [
            ['총 금액', d.gross],
            ['제세금', d.tax],
            ['입금 금액', d.net],
        ]) {
            const matches = ui.detail.detailFields.filter((field) =>
                field.startsWith(label + '\n')
            );
            check(matches.length === 1, 'INC_DIVIDEND_DETAIL_CARDINALITY');
            const displayed = matches[0].slice(label.length + 1).trim();
            check(
                d.currency === 'USD'
                    ? displayed.startsWith('$')
                    : displayed.endsWith('원'),
                'INC_DIVIDEND_CURRENCY_MARKER'
            );
            check(
                displayed.replace(/[$,원\s]/g, '') === expected,
                'INC_DIVIDEND_DETAIL_AMOUNT'
            );
        }
        if (legacyStatusless) legacyPaidDetailCount++;
        observations.push(d);
    }
    return {
        marker: canonical.value,
        apiAccountHash,
        observations,
        apiOrders,
        sourceSetHash: manifest.sourceSetHash,
        verifiedAt: receipt.verifiedAt,
        apiCoverage: manifest.coverage?.api ?? null,
        paidEvidence: {
            contract: 'toss-paid-detail-v1',
            legacyStatuslessCount: legacyPaidDetailCount,
        },
    };
}

// A content-addressed append-only index is the commit log. Different writers add different keys;
// no shared read/modify/write pointer exists, so concurrent appends cannot lose each other.
export async function publishIncrement({ readBytes, putIfAbsent, marker }) {
    const verified = await verifyIncrement(readBytes, marker);
    const entry = incrementMarker(marker);
    try {
        await putIfAbsent(entry.key, entry.bytes);
    } catch (e) {
        if (![409, 412].includes(e.$metadata?.httpStatusCode ?? e.status))
            throw e;
    }
    const readback = Buffer.from(await readBytes(entry.key, 16_000));
    check(readback.equals(entry.bytes), 'INC_PUBLICATION_READBACK');
    return {
        status: 'linked',
        key: entry.key,
        sha256: incrementHash(entry.bytes),
        bytes: entry.bytes.length,
        sourceSetHash: verified.sourceSetHash,
        observationCount: verified.observations.length,
        canonicalUnchanged: true,
    };
}
export async function readIncrements(options) {
    return withReportDiagnostic('INC_INDEX_FORMAT', () =>
        readIncrementsImpl(options)
    );
}
async function readIncrementsImpl({
    listEntries,
    readBytes,
    binding,
    profile,
    expectedLegacySuffix,
}) {
    const indexPrefix = withReportDiagnostic('INC_PROFILE_CONFIGURATION', () =>
        profile
            ? profileIndexPrefix(profile)
            : binding
              ? bindingIndexPrefix(binding)
              : incrementIndexPrefix
    );
    const listed = await withReportDiagnostic('INC_INDEX_READ', () =>
        listEntries(indexPrefix)
    );
    check(
        Array.isArray(listed.keys) &&
            !listed.truncated &&
            listed.keys.length <= 128,
        'INC_INDEX_LIST'
    );
    const unique = [...new Set(listed.keys)].sort();
    const verified = [],
        seen = new Set();
    for (const key of unique) {
        check(
            key.startsWith(indexPrefix) &&
                /^[a-f0-9]{64}\.json$/.test(key.slice(indexPrefix.length)),
            'INC_INDEX_KEY'
        );
        const bytes = await withReportDiagnostic('INC_INDEX_READ', async () =>
            Buffer.from(await readBytes(key, 16_000))
        );
        check(
            key === indexPrefix + incrementHash(bytes) + '.json',
            'INC_INDEX_DIGEST'
        );
        const marker = json(bytes, 'INC_INDEX_JSON');
        check(
            profile
                ? marker.schemaVersion === 2 &&
                      marker.binding?.profileId === profile.id &&
                      marker.binding?.accountNoSha256 ===
                          profile.accountNoSha256 &&
                      marker.binding?.suffix === profile.suffix &&
                      marker.accountId === profile.ownerId
                : binding
                  ? marker.schemaVersion === 2 &&
                    sameBinding(marker.binding, binding)
                  : marker.schemaVersion === 1 && marker.accountId === 'wife',
            'INC_INDEX_SCOPE'
        );
        if (!profile && !binding && expectedLegacySuffix)
            check(
                marker.prefix.startsWith(
                    `brokerage/toss/wife-${expectedLegacySuffix}/`
                ),
                'INC_LEGACY_BINDING'
            );
        const result = await verifyIncrement(readBytes, marker);
        if (!seen.has(result.sourceSetHash)) {
            seen.add(result.sourceSetHash);
            verified.push(result);
        }
    }
    return {
        verified,
        revision: incrementHash(unique.join('\n')),
        entryCount: unique.length,
    };
}

export function overlayIncrements(baseline, increments) {
    return withReportDiagnostic('INC_INTEGRATION_FORMAT', () =>
        overlayIncrementsImpl(baseline, increments)
    );
}
function overlayIncrementsImpl(baseline, increments) {
    const rows = baseline.rows.map((r) => ({ ...r })),
        details = new Map(baseline.details);
    const seen = new Set(rows.map((r) => r.id));
    const web = new Map(),
        versions = new Map(),
        bindings = new Map(),
        accountSequences = new Map();
    for (const batch of increments.verified) {
        const binding = batch.marker?.binding;
        if (batch.marker) {
            const owner = batch.marker.accountId;
            check(hex(batch.apiAccountHash), 'INC_INTEGRATION_ACCOUNT_FORMAT');
            const previousSequence = accountSequences.get(owner);
            check(
                !previousSequence || previousSequence === batch.apiAccountHash,
                'INC_INTEGRATION_SEQUENCE_CONFLICT'
            );
            accountSequences.set(owner, batch.apiAccountHash);
            if (binding)
                check(
                    binding.accountSeqSha256 === batch.apiAccountHash,
                    'INC_INTEGRATION_COLLECTOR_BINDING'
                );
        }
        if (!binding) continue;
        const previous = bindings.get(binding.ownerId);
        check(
            !previous || previous.accountNoSha256 === binding.accountNoSha256,
            'INC_INTEGRATION_OWNER_CONFLICT'
        );
        bindings.set(binding.ownerId, binding);
    }
    for (const batch of increments.verified) {
        const accountId = batch.marker?.accountId ?? 'wife';
        const binding = bindings.get(accountId);
        if (!batch.marker?.binding && binding && batch.marker?.prefix)
            check(
                batch.marker.prefix.startsWith(
                    `brokerage/toss/${accountId}-${binding.suffix}/`
                ),
                'INC_INTEGRATION_LEGACY_BINDING'
            );
        const namespace = binding
            ? `${binding.profileId}:${binding.accountNoSha256}`
            : accountId;
        for (const d of batch.observations) {
            if (seen.has(d.observationId)) continue;
            seen.add(d.observationId);
            const row = {
                id: d.observationId,
                accountId,
                ledgerAccountKey: namespace,
                type: 'DIVIDEND',
                currency: d.currency,
                symbol: d.symbol,
                date: d.displayedPaidAt.slice(0, 10),
                timestamp: d.displayedPaidAt,
                dateRole: '실제 입금 · 분 단위 KST',
                quantity: null,
                unitPrice: null,
                amount: d.net,
                amountMeaning: '실제 입금액',
                commission: null,
                tax: d.tax,
                gross: d.gross,
                taxDerived: false,
                isTransaction: true,
                countInTotals: true,
                state: '실제 입금 관측 · 거래 ID 미확인',
                sourceLabel: '토스 웹 입금',
                increment: true,
            };
            rows.push(row);
            web.set(row.id, row);
            details.set(row.id, {
                id: row.id,
                sourceLabel: row.sourceLabel,
                sourceFamily: 'toss_personal_ui',
                sourceHashReference: d.sourceIdentity.sourceSha256,
                accountAssignment: accountId === 'wife' ? '아내' : '남편',
                fields: [
                    {
                        field: 'grossDividendUsd',
                        value: d.gross,
                        unit: d.currency,
                    },
                    { field: 'tax', value: d.tax, unit: d.currency },
                    { field: 'netDividendUsd', value: d.net, unit: d.currency },
                    {
                        field: 'paidAt',
                        value: d.displayedPaidAt,
                        unit: 'KST · minute',
                    },
                    {
                        field: 'originalTransactionId',
                        value: '미확인',
                        unit: null,
                    },
                ],
                missing: [
                    'originalTransactionId',
                    'actualFxRate',
                    'commission',
                ],
                coverage: d.coverage,
                adopted: false,
            });
        }
        for (const v of batch.apiOrders) {
            const key = incrementHash(namespace + ':' + v.order.orderId);
            const prior = versions.get(key);
            if (
                !prior ||
                Date.parse(v.observedAt) > Date.parse(prior.observedAt)
            )
                versions.set(key, {
                    ...v,
                    accountId,
                    namespace,
                    profileBound: Boolean(binding),
                });
            else if (
                Date.parse(v.observedAt) === Date.parse(prior.observedAt) &&
                JSON.stringify(v.order) !== JSON.stringify(prior.order)
            )
                check(false, 'INC_INTEGRATION_ORDER_CONFLICT');
        }
    }
    for (const [key, v] of versions) {
        const accountId = v.accountId;
        if (
            accountId === 'wife' &&
            !v.profileBound &&
            Date.parse(v.observedAt) <= Date.parse(baseline.snapshotAt)
        )
            continue;
        const legacyId = baseline.orderReferences?.get(
            incrementHash(accountId + ':' + v.order.orderId)
        );
        const directId = baseline.orderReferences?.get(key);
        // The adopted legacy snapshot has owner-scoped IDs but no verified account
        // binding. A v2 profile cannot use those IDs as proof of the same account.
        const unboundCandidateId =
            v.profileBound && !directId ? legacyId : undefined;
        const oldId = directId ?? (v.profileBound ? undefined : legacyId);
        const oldIndex = rows.findIndex((r) => r.id === oldId);
        const o = v.order,
            e = o.execution,
            active = !/^0+(?:\.0+)?$/.test(e.filledQuantity);
        const id = incrementHash(
            v.namespace + ':' + o.orderId + ':' + v.sourceHash
        );
        const row = {
            id,
            accountId,
            ledgerAccountKey: v.namespace,
            type: o.side,
            currency: o.currency,
            symbol: o.symbol,
            date: (e.filledAt || o.orderedAt).slice(0, 10),
            timestamp: e.filledAt || o.orderedAt,
            dateRole: e.filledAt ? '최종 체결' : '주문',
            quantity: e.filledQuantity,
            unitPrice: e.averageFilledPrice,
            amount: active ? e.filledAmount : null,
            amountMeaning: '총 체결 금액',
            commission: e.commission,
            tax: e.tax,
            taxDerived: false,
            isTransaction: active,
            countInTotals: !unboundCandidateId,
            state: unboundCandidateId
                ? '기준 계좌 연결 미확인 · 합계 제외'
                : o.status,
            sourceLabel: '토스 주문 · 신규 관측',
            increment: true,
        };
        if (oldIndex >= 0) {
            rows[oldIndex] = row;
            row.previousObservationId = oldId;
        } else rows.push(row);
        details.set(id, {
            id,
            sourceLabel: row.sourceLabel,
            sourceFamily: 'toss_api',
            sourceHashReference: v.sourceHash,
            accountAssignment: accountId === 'wife' ? '아내' : '남편',
            fields: [
                { field: 'orderStatus', value: o.status },
                { field: 'filledQuantity', value: e.filledQuantity },
                { field: 'executionAmount', value: e.filledAmount },
                { field: 'commission', value: e.commission },
                { field: 'tax', value: e.tax },
            ],
            missing: ['individualFillId', 'actualFxRate'],
            previousObservationId: oldId ?? null,
            ...(unboundCandidateId
                ? {
                      possiblePreviousObservationId: unboundCandidateId,
                      duplicateStatus: 'baseline_account_binding_unverified',
                  }
                : {}),
            adopted: false,
        });
    }
    for (const row of web.values()) {
        const candidates = rows.filter(
            (r) =>
                r.id !== row.id &&
                r.type === 'DIVIDEND' &&
                r.accountId === row.accountId &&
                r.currency === row.currency &&
                r.date === row.date &&
                r.symbol === row.symbol
        );
        if (candidates.length) {
            row.countInTotals = false;
            row.state = '중복 여부 미확정 · 합계 제외';
            details.get(row.id).duplicateStatus =
                'independent_observations_not_merged';
        }
    }
    return {
        ...baseline,
        rows,
        details,
        baselineRowCount: baseline.rows.length,
        incrementRevision: increments.revision,
        incrementEntryCount: increments.entryCount,
        incrementRowCount: rows.filter((r) => r.increment).length,
        canonicalUnchanged: true,
    };
}
