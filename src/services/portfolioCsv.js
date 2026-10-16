// Keep these columns compatible with the existing CSV review parser (20 max).
// Account numbers, internal ids, permissions and password material are excluded.
const coreColumns = ['date', 'symbol', 'quantity', 'amount', 'currency'];
const transactionColumns = [
    'type',
    'externalId',
    'settlementAmount',
    'nativeAmount',
    'nativeSettlementAmount',
    'exchangeRate',
    'nativeCommission',
    'nativeTax',
    'rawType',
    'cashKind',
    'originalCode',
    'securityName',
];
export const MAX_EXPORT_ROWS = 10000;

function needsCsvEscape(value) {
    return (
        typeof value === 'string' &&
        // oxlint-disable-next-line no-control-regex -- Control-prefixed spreadsheet formulas must be neutralized.
        (/^[\s\u0000-\u001f]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value))
    );
}

export function csvCell(value) {
    if (value === null || value === undefined) return '""';
    if (typeof value === 'number' && !Number.isFinite(value))
        throw new Error('내보낼 자료의 숫자 형식을 확인해 주세요.');
    if (!['number', 'string'].includes(typeof value))
        throw new Error('내보낼 자료의 열 형식을 확인해 주세요.');
    let text = String(value);
    // Quoting alone does not prevent spreadsheet formula execution. Only text
    // cells are neutralized; numeric values (including zero) stay numeric.
    if (needsCsvEscape(value)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
}

export function buildPortfolioCsv(kind, rows) {
    if (!['holdings', 'transactions'].includes(kind))
        throw new Error('내보낼 자료 종류를 선택하세요.');
    if (!rows.length) throw new Error('내보낼 저장 자료가 없습니다.');
    if (rows.length > MAX_EXPORT_ROWS)
        throw new Error('한 번에 10,000행까지 내보낼 수 있습니다.');
    const columns = [
        ...coreColumns,
        ...(kind === 'transactions' ? transactionColumns : []),
        'asOf',
        'source',
    ];
    return (
        '\uFEFF' +
        [
            [...columns, 'csvEscaped'].join(','),
            ...rows.map((row) => {
                // Record exactly which cells received a protective quote so
                // reimport preserves original externalId and deduplication.
                const escaped = columns.filter((key) =>
                    needsCsvEscape(row[key])
                );
                return [
                    ...columns.map((key) => csvCell(row[key])),
                    csvCell(escaped.length ? `v1:${escaped.join('|')}` : ''),
                ].join(',');
            }),
        ].join('\r\n') +
        '\r\n'
    );
}

function checkActive(signal, isCurrent) {
    if (signal?.aborted || !isCurrent())
        throw new DOMException('내보내기를 취소했습니다.', 'AbortError');
}

// Each page uses the authenticated read API, so revoked permissions abort the
// entire export. Never download a partial first page or an old account's data.
export async function loadPortfolioCsv({
    request,
    familyId,
    accountId,
    kind,
    signal,
    isCurrent = () => true,
    onProgress = () => {},
}) {
    checkActive(signal, isCurrent);
    if (!familyId || !accountId || !['holdings', 'transactions'].includes(kind))
        throw new Error('계좌와 자료 종류를 선택하세요.');
    const overview = await request('', undefined, { familyId }, { signal });
    checkActive(signal, isCurrent);
    const account = overview.accounts?.find((item) => item.id === accountId);
    if (!account)
        throw new Error(
            '이 계좌의 조회 권한을 확인할 수 없습니다. 계좌 목록을 새로고침해 주세요.'
        );
    let rows = [];
    if (kind === 'holdings') {
        if (!account.snapshot)
            throw new Error(
                '이 계좌에 저장된 잔고 자료가 없습니다. 잔고내역을 먼저 등록해 주세요.'
            );
        rows = account.snapshot.rows.map((row) => ({
            ...row,
            asOf: account.snapshot.asOf,
            source: account.snapshot.source,
        }));
        onProgress(rows.length);
    } else {
        const cursors = new Set();
        const ids = new Set();
        let cursor;
        do {
            checkActive(signal, isCurrent);
            const page = await request(
                '',
                undefined,
                { accountId, legacy: 'false', ...(cursor ? { cursor } : {}) },
                { signal }
            );
            checkActive(signal, isCurrent);
            for (const entry of page.entries) {
                if (!entry.id || ids.has(entry.id))
                    throw new Error(
                        '조회 중 거래 목록이 변경되었습니다. 다시 내보내 주세요.'
                    );
                ids.add(entry.id);
                rows.push({
                    ...entry.row,
                    asOf: entry.asOf,
                    source: entry.source,
                });
            }
            if (rows.length > MAX_EXPORT_ROWS)
                throw new Error('한 번에 10,000행까지 내보낼 수 있습니다.');
            onProgress(rows.length);
            cursor = page.nextCursor;
            if (cursor && cursors.has(cursor))
                throw new Error(
                    '다음 거래를 조회하지 못했습니다. 다시 시도해 주세요.'
                );
            if (cursor) cursors.add(cursor);
        } while (cursor);
        // Recheck permission after the final page before making a local file.
        checkActive(signal, isCurrent);
        const latest = await request('', undefined, { familyId }, { signal });
        checkActive(signal, isCurrent);
        const latestAccount = latest.accounts?.find(
            (item) => item.id === accountId
        );
        if (!latestAccount)
            throw new Error(
                '이 계좌의 조회 권한이 변경되어 내보내기를 중단했습니다.'
            );
        if (
            (latestAccount.entriesRevision ?? 0) !==
            (account.entriesRevision ?? 0)
        )
            throw new Error(
                '조회 중 거래 목록이 변경되었습니다. 다시 내보내 주세요.'
            );
    }
    checkActive(signal, isCurrent);
    return {
        csv: buildPortfolioCsv(kind, rows),
        count: rows.length,
    };
}
