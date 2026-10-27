import {
    buildSourceTimeItems,
    validSourceTimeItems,
} from './sheet-source-times.js';
import { buildPanelSourceTimeItems } from './sheet-panel-times.js';

// Portable projection for a local archive export or the existing private R2
// operator. Does not fetch, publish, approve, or change any source object.
export async function projectVerifiedTimeArchives({
    accountId,
    orders,
    transactions,
    archiveKeys,
    runId,
    panels = [],
    frozenSourceLedgerKeys = [],
}) {
    const archives = {};
    for (const [kind, archive] of Object.entries({ orders, transactions })) {
        if (archive.accountId !== accountId || !Array.isArray(archive.files))
            throw Error('Archive account mismatch');
        const files = [];
        for (const f of archive.files) {
            if (
                !(kind === 'orders'
                    ? f.file.startsWith('orders-all-') ||
                      f.file.startsWith('order-details/')
                    : f.file.startsWith('transaction-details/'))
            )
                continue;
            const bytes = Uint8Array.from(atob(f.content), (c) =>
                c.charCodeAt(0)
            );
            const digest = [
                ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            ]
                .map((x) => x.toString(16).padStart(2, '0'))
                .join('');
            if (digest !== f.sha256 || bytes.length !== f.bytes)
                throw Error('Archive hash or byte-size mismatch');
            files.push({
                file: f.file,
                sha256: f.sha256,
                data: JSON.parse(new TextDecoder().decode(bytes)),
            });
        }
        archives[kind] = files;
    }
    const symbols = Object.create(null);
    for (const f of archives.orders.filter((f) =>
        f.file.startsWith('orders-all-')
    ))
        for (const row of f.data.data?.result?.body ||
            f.data.data?.body ||
            []) {
            if (!row.stockCode || !row.symbol) continue;
            symbols[row.stockCode] ||= [];
            if (!symbols[row.stockCode].includes(row.symbol))
                symbols[row.stockCode].push(row.symbol);
        }
    const items = ['orders', 'transactions'].flatMap((kind) =>
        buildSourceTimeItems({
            accountId,
            files: archives[kind],
            symbols,
            archiveKey: archiveKeys[kind],
            kind,
        })
    );
    if (panels.length && !frozenSourceLedgerKeys.length)
        throw Error('Frozen baseline required for panel projection');
    const frozen = new Set(frozenSourceLedgerKeys);
    let projectedPanelRecords = 0;
    for (const panel of panels) {
        if (
            panel.data.accountRole !== accountId ||
            (!Array.isArray(panel.data.records) &&
                !Array.isArray(panel.data.found))
        )
            throw Error('Panel account mismatch');
        const bytes = new TextEncoder().encode(JSON.stringify(panel.data));
        const hash = [
            ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        ]
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        if (hash !== panel.sha256) throw Error('Panel response hash mismatch');
        const recordsPath = Array.isArray(panel.data.found)
            ? 'found'
            : 'records';
        const records = panel.data[recordsPath].map((r) =>
            frozen.has(r.sourceLedgerKey || r.ledgerKey)
                ? r
                : { ...r, status: 'outside-frozen-baseline' }
        );
        const projected = buildPanelSourceTimeItems({
            records,
            accountId,
            archiveKey: panel.key,
            sha256: hash,
            recordsPath,
        });
        items.push(...projected);
        projectedPanelRecords += projected.length;
    }
    if (!validSourceTimeItems(items, accountId))
        throw Error('Invalid time projection');
    return {
        schemaVersion: 1,
        section: 'times',
        runId,
        accountId,
        basis: 'Stored order list/detail, classified dividend cash posting details, and optional baseline-scoped panel texts. Source candidates, not approved links. No inferred timezone or missing time precision.',
        coverage: {
            verifiedOrderFiles: archives.orders.length,
            verifiedTransactionFiles: archives.transactions.length,
            projectedSourceRecords: items.length,
            projectedPanelRecords,
            verifiedPanelObjects: panels.length,
            completeFinancialEventCount: false,
        },
        items,
    };
}
