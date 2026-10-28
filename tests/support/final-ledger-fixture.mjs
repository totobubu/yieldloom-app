import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const hash = (b) => createHash('sha256').update(b).digest('hex');
export const fixtureId = (n) => hash(`synthetic-observation-${n}`);
export function finalObservation(
    n,
    {
        family = 'toss_api',
        scope = 'wife',
        type = 'BUY',
        symbol = 'TEST',
        amount = '6.2501',
        quantity = '1',
        currency = 'USD',
        active = true,
        partial = false,
    } = {}
) {
    const fields = {};
    const set = (key, value) => {
        fields[key] = {
            value,
            status: 'captured',
            sourceField: key,
            unit: null,
        };
    };
    for (const [key, value] of Object.entries({
        symbol,
        eventType: type,
        providerOrderId: `synthetic-order-${n}`,
        currency,
        orderedAt: '2025-02-03T11:12:13.123+09:00',
        finalFilledAt: active ? '2025-02-04T01:02:03+09:00' : null,
        recordedDate: '2025-02-04',
        filledQuantity: quantity,
        recordedQuantity: quantity,
        averageFilledPrice: null,
        executionAmount: amount,
        netDividendUsd: amount,
        statementNativeTransactionAmount: amount,
        commission: null,
        tax: '0',
    }))
        set(key, value);
    return {
        observationId: fixtureId(n),
        sourceFamily: family,
        accountScope: scope,
        executionPresence: active
            ? 'observed_order_aggregate'
            : 'no_execution_observed',
        partialFillThenCanceled: partial,
        fields,
        sourceReference: { source: 'synthetic-source' },
    };
}
export function finalLedgerFixture(extra = []) {
    const observations = [
        finalObservation(1, { symbol: 'QDTE' }),
        finalObservation(2, {
            symbol: 'QDTE',
            amount: '0.9999',
            quantity: '0.029498',
        }),
        finalObservation(3, { active: false, amount: '0', quantity: '0' }),
        finalObservation(4, {
            partial: true,
            amount: '1.1250',
            quantity: '0.5',
        }),
        finalObservation(5, { family: 'google_sheet_reference', type: 'BUY' }),
        finalObservation(6, {
            family: 'google_sheet_reference',
            type: 'DIVIDEND',
            amount: '2.0000',
        }),
        finalObservation(7, {
            family: 'toss_pdf_saved_parse',
            scope: 'unbound_pdf',
            type: 'TAX_REFUND',
            amount: '0.2500',
        }),
        finalObservation(8, { type: 'SELL', amount: '1000', currency: 'KRW' }),
        ...extra,
    ];
    const raw = Buffer.from(
        JSON.stringify({
            schemaVersion: 1,
            rowCount: observations.length,
            rows: observations,
        })
    );
    const member = {
        name: 'observations.json',
        bytes: raw.length,
        sha256: hash(raw),
    };
    const archive = Buffer.from(
        JSON.stringify({
            format: 'yieldloom-private-review-bundle-v2',
            members: [
                {
                    ...member,
                    encoding: 'gzip+base64',
                    dataBase64: gzipSync(raw).toString('base64'),
                },
            ],
        })
    );
    const gzip = gzipSync(archive),
        base64 = gzip.toString('base64');
    const prefix = 'reconciliation/final-review/synthetic/';
    const partName = 'final-review.bundle.json.gz.base64.part-00001';
    const part = {
        name: partName,
        key: prefix + partName,
        bytes: base64.length,
        sha256: hash(base64),
    };
    const manifest = {
        prefix,
        publicationStatus: 'remote_readback_verified',
        gzipSha256: hash(gzip),
        gzipBytes: gzip.length,
        archiveSha256: hash(archive),
        archiveBytes: archive.length,
        observationRows: observations.length,
        createdAt: '2025-02-05T00:00:00Z',
        partCount: 1,
        parts: [part],
        members: [member],
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const receiptBytes = Buffer.from(
        JSON.stringify({
            manifest: { sha256: hash(manifestBytes) },
            remoteReconstruction: { membersVerified: 1 },
        })
    );
    const checkpoint = {
        prefix,
        manifestSha256: hash(manifestBytes),
        receiptSha256: hash(receiptBytes),
        gzipSha256: hash(gzip),
        workbookSha256: hash('synthetic-workbook'),
        observations: observations.length,
    };
    const objects = new Map([
        [prefix + 'manifest.json', manifestBytes],
        [prefix + 'verification-receipt.json', receiptBytes],
        [part.key, Buffer.from(base64)],
    ]);
    return { observations, checkpoint, manifest, objects, raw };
}
