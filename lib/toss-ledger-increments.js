// Server/local-only. Commit markers are immutable and content addressed, never a shared pointer.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
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
            )
        );
        noCredentials(child);
    }
}
const check = (ok) => {
    if (!ok)
        throw Object.assign(
            new Error('증분 자료 무결성을 확인하지 못했습니다.'),
            { status: 409, code: 'INCREMENT_INTEGRITY_FAILED' }
        );
};
const decode = (s) => {
    check(
        typeof s === 'string' &&
            s.length <= 8_000_000 &&
            /^[A-Za-z0-9+/=]*$/.test(s)
    );
    return Buffer.from(s, 'base64');
};
const rawPrefix = (p) =>
    typeof p === 'string' &&
    /^brokerage\/toss\/wife-[0-9]{4}\/[A-Za-z0-9-]+\/$/.test(p);
export function incrementMarker({ prefix, manifest, receipt }) {
    check(rawPrefix(prefix));
    for (const [d, name] of [
        [manifest, 'collection.manifest.json'],
        [receipt, 'r2-upload-receipt.json'],
    ])
        check(
            d?.key === prefix + name &&
                hex(d.sha256) &&
                Number.isInteger(d.bytes) &&
                d.bytes > 0 &&
                d.bytes <= 128_000
        );
    const value = {
        schemaVersion: 1,
        accountId: 'wife',
        prefix,
        manifest,
        receipt,
    };
    const bytes = Buffer.from(JSON.stringify(value));
    return {
        key: incrementIndexPrefix + incrementHash(bytes) + '.json',
        bytes,
        value,
    };
}

export async function verifyIncrement(readBytes, marker) {
    const canonical = incrementMarker(marker);
    const checkedRead = async (d, max) => {
        check(d.bytes <= max);
        const b = Buffer.from(await readBytes(d.key, max));
        check(b.length === d.bytes && incrementHash(b) === d.sha256);
        return b;
    };
    const mb = await checkedRead(marker.manifest, 128_000);
    const rb = await checkedRead(marker.receipt, 128_000);
    const manifest = JSON.parse(mb),
        receipt = JSON.parse(rb);
    check(
        manifest.format === 'yieldloom-private-toss-r2-transfer-v1' &&
            manifest.prefix === marker.prefix &&
            manifest.bucket === 'yieldloom-data-private'
    );
    check(
        receipt.prefix === marker.prefix &&
            receipt.bucket === manifest.bucket &&
            receipt.allRawPartsGetVerified === true &&
            receipt.sourceFilesVerified === manifest.sourceFileCount &&
            receipt.manifest?.key === marker.manifest.key &&
            receipt.manifest?.sha256 === marker.manifest.sha256 &&
            receipt.manifest?.bytes === marker.manifest.bytes
    );
    check(
        [
            'incremental_observations_verified_not_adopted',
            'incremental_observations_verified',
        ].includes(receipt.status)
    );
    check(
        Array.isArray(manifest.parts) &&
            manifest.parts.length === manifest.partCount &&
            manifest.partCount > 0 &&
            manifest.partCount <= 32 &&
            manifest.gzipBytes <= 2_000_000 &&
            manifest.archiveBytes <= 5_000_000
    );
    check(
        Array.isArray(manifest.sourceFiles) &&
            manifest.sourceFiles.length === manifest.sourceFileCount &&
            manifest.sourceFileCount <= 200
    );
    check(
        hex(manifest.sourceSetHash) &&
            incrementHash(JSON.stringify(manifest.sourceFiles)) ===
                manifest.sourceSetHash
    );
    const pieces = [];
    for (const [i, part] of manifest.parts.entries()) {
        check(
            part.key ===
                marker.prefix +
                    `collection.bundle.json.gz.base64.part-${String(i + 1).padStart(5, '0')}` &&
                part.bytes <= 24_000 &&
                hex(part.sha256)
        );
        pieces.push((await checkedRead(part, 24_000)).toString('ascii'));
    }
    const gzip = decode(pieces.join(''));
    check(
        gzip.length === manifest.gzipBytes &&
            incrementHash(gzip) === manifest.gzipSha256 &&
            receipt.gzipSha256 === manifest.gzipSha256
    );
    const archive = gunzipSync(gzip, { maxOutputLength: 5_000_000 });
    check(
        archive.length === manifest.archiveBytes &&
            incrementHash(archive) === manifest.archiveSha256 &&
            receipt.archiveSha256 === manifest.archiveSha256
    );
    const bundle = JSON.parse(archive);
    check(
        bundle.format === 'yieldloom-private-toss-raw-bundle-v1' &&
            Array.isArray(bundle.files) &&
            bundle.files.length === manifest.sourceFileCount
    );
    const members = new Map();
    for (const file of bundle.files) {
        check(
            typeof file.name === 'string' &&
                !file.name.includes('..') &&
                !members.has(file.name)
        );
        const descriptor = manifest.sourceFiles.find(
            (d) => d.name === file.name
        );
        const bytes = decode(file.dataBase64);
        check(
            descriptor &&
                bytes.length === descriptor.bytes &&
                incrementHash(bytes) === descriptor.sha256 &&
                file.sha256 === descriptor.sha256 &&
                file.bytes === descriptor.bytes
        );
        members.set(file.name, { bytes, sha256: descriptor.sha256 });
        if (file.name.endsWith('.json')) noCredentials(JSON.parse(bytes));
    }
    const observations = [],
        apiOrders = [];
    for (const [name, file] of members) {
        if (/^api\/(OPEN|CLOSED)\/page-\d{8}\.json$/.test(name)) {
            const page = JSON.parse(file.bytes),
                raw = decode(page.bodyBase64);
            check(incrementHash(raw) === page.sha256);
            const data = JSON.parse(raw);
            noCredentials(data);
            check(Array.isArray(data.result?.orders) && !data.error);
            for (const order of data.result.orders) {
                check(
                    typeof order.orderId === 'string' &&
                        order.orderId &&
                        ['BUY', 'SELL'].includes(order.side) &&
                        ['USD', 'KRW'].includes(order.currency) &&
                        typeof order.symbol === 'string' &&
                        typeof order.status === 'string' &&
                        decimal(order.execution?.filledQuantity)
                );
                check(
                    typeof order.orderedAt === 'string' &&
                        Number.isFinite(Date.parse(order.orderedAt))
                );
                for (const key of [
                    'averageFilledPrice',
                    'filledAmount',
                    'commission',
                    'tax',
                ])
                    check(
                        order.execution[key] === null ||
                            decimal(order.execution[key])
                    );
                check(
                    Number.isFinite(
                        Date.parse(
                            page.fetchedAt ??
                                page.observedAt ??
                                receipt.verifiedAt
                        )
                    )
                );
                apiOrders.push({
                    order,
                    observedAt:
                        page.fetchedAt ?? page.observedAt ?? receipt.verifiedAt,
                    sourceHash: file.sha256,
                });
            }
        }
        if (name !== 'dividend-observation.json') continue;
        const d = JSON.parse(file.bytes);
        check(
            d.kind === 'TOSS_TRANSACTION' &&
                d.accountId === 'wife' &&
                d.type === 'DIVIDEND' &&
                ['USD', 'KRW'].includes(d.currency) &&
                typeof d.symbol === 'string' &&
                /^[A-Z0-9.-]{1,32}$/.test(d.symbol)
        );
        check(
            d.sourceIdentity?.provider === 'TOSS_PERSONAL_ACCOUNT_UI' &&
                d.sourceIdentity?.account === 'wife' &&
                hex(d.sourceIdentity.sourceSha256)
        );
        const source = members.get(d.sourceFile);
        check(source && source.sha256 === d.sourceIdentity.sourceSha256);
        const ui = JSON.parse(source.bytes);
        check(
            ui.accountVerified === true &&
                ui.currency === d.currency &&
                ui.symbol === d.symbol &&
                ui.gross === d.gross &&
                ui.tax === d.tax &&
                ui.net === d.net &&
                ui.depositAtDisplayed === d.displayedPaidAt &&
                ui.checkedAt === d.sourceIdentity.observedAt
        );
        check(
            /^https:\/\/www\.tossinvest\.com\/account\/transactions\//.test(
                d.sourceIdentity.document
            ) && d.sourceIdentity.document === ui.detail?.url
        );
        check(
            d.observationId ===
                incrementHash(JSON.stringify(d.sourceIdentity)) &&
                d.originalTransactionId === null &&
                d.canonicalAdoption === false &&
                d.paymentStatus === 'PAID' &&
                d.timeZone === 'Asia/Seoul' &&
                d.timePrecision === 'minute'
        );
        check(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(d.displayedPaidAt) &&
                Number.isFinite(
                    Date.parse(
                        d.displayedPaidAt.replace(' ', 'T') + ':00+09:00'
                    )
                )
        );
        check(decimal(d.gross) && decimal(d.tax) && decimal(d.net));
        const expectedFields = [
            `거래유형\n${d.currency === 'USD' ? '외화배당금입금' : '배당금입금'}`,
            `입금일시\n${Number(d.displayedPaidAt.slice(0, 4))}년 ${Number(d.displayedPaidAt.slice(5, 7))}월 ${Number(d.displayedPaidAt.slice(8, 10))}일 ${d.displayedPaidAt.slice(11)}`,
        ];
        check(
            expectedFields.every((field) =>
                ui.detail.detailFields?.includes(field)
            )
        );
        for (const [label, expected] of [
            ['총 금액', d.gross],
            ['제세금', d.tax],
            ['입금 금액', d.net],
        ]) {
            const matches = ui.detail.detailFields.filter((field) =>
                field.startsWith(label + '\n')
            );
            check(matches.length === 1);
            const displayed = matches[0].slice(label.length + 1).trim();
            check(
                d.currency === 'USD'
                    ? displayed.startsWith('$')
                    : displayed.endsWith('원')
            );
            check(displayed.replace(/[$,원\s]/g, '') === expected);
        }
        observations.push(d);
    }
    return {
        marker: canonical.value,
        observations,
        apiOrders,
        sourceSetHash: manifest.sourceSetHash,
        verifiedAt: receipt.verifiedAt,
        apiCoverage: manifest.coverage?.api ?? null,
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
    check(readback.equals(entry.bytes));
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
export async function readIncrements({ listEntries, readBytes }) {
    const listed = await listEntries(incrementIndexPrefix);
    check(
        Array.isArray(listed.keys) &&
            !listed.truncated &&
            listed.keys.length <= 128
    );
    const unique = [...new Set(listed.keys)].sort();
    const verified = [],
        seen = new Set();
    for (const key of unique) {
        check(
            key.startsWith(incrementIndexPrefix) &&
                /^[a-f0-9]{64}\.json$/.test(
                    key.slice(incrementIndexPrefix.length)
                )
        );
        const bytes = Buffer.from(await readBytes(key, 16_000));
        check(key === incrementIndexPrefix + incrementHash(bytes) + '.json');
        const marker = JSON.parse(bytes);
        check(marker.schemaVersion === 1 && marker.accountId === 'wife');
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
    const rows = baseline.rows.map((r) => ({ ...r })),
        details = new Map(baseline.details);
    const seen = new Set(rows.map((r) => r.id));
    const web = new Map(),
        versions = new Map();
    for (const batch of increments.verified) {
        for (const d of batch.observations) {
            if (seen.has(d.observationId)) continue;
            seen.add(d.observationId);
            const row = {
                id: d.observationId,
                accountId: 'wife',
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
                accountAssignment: '아내',
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
            const key = incrementHash('wife:' + v.order.orderId);
            const prior = versions.get(key);
            if (
                !prior ||
                Date.parse(v.observedAt) > Date.parse(prior.observedAt)
            )
                versions.set(key, v);
            else if (
                Date.parse(v.observedAt) === Date.parse(prior.observedAt) &&
                JSON.stringify(v.order) !== JSON.stringify(prior.order)
            )
                check(false);
        }
    }
    for (const [key, v] of versions) {
        if (Date.parse(v.observedAt) <= Date.parse(baseline.snapshotAt))
            continue;
        const oldId = baseline.orderReferences?.get(key),
            oldIndex = rows.findIndex((r) => r.id === oldId);
        const o = v.order,
            e = o.execution,
            active = !/^0+(?:\.0+)?$/.test(e.filledQuantity);
        const id = incrementHash('wife:' + o.orderId + ':' + v.sourceHash);
        const row = {
            id,
            accountId: 'wife',
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
            countInTotals: true,
            state: o.status,
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
            accountAssignment: '아내',
            fields: [
                { field: 'orderStatus', value: o.status },
                { field: 'filledQuantity', value: e.filledQuantity },
                { field: 'executionAmount', value: e.filledAmount },
                { field: 'commission', value: e.commission },
                { field: 'tax', value: e.tax },
            ],
            missing: ['individualFillId', 'actualFxRate'],
            previousObservationId: oldId ?? null,
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
