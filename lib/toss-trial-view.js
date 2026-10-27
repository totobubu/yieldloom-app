// A read-only projection. Evidence IDs are internal references, never broker fill IDs.
const brokerKinds = new Set([
    'TOSS_ORDER',
    'TOSS_TRANSACTION',
    'TOSS_EXPECTED_DIVIDEND',
    'PDF',
]);
const decimal = (value) => {
    if (value == null || !/^-?\d+(?:\.\d+)?$/.test(String(value))) return null;
    const [integer, fraction = ''] = String(value).split('.');
    return { units: BigInt(integer + fraction), scale: fraction.length };
};
export function decimalDifference(a, b) {
    const x = decimal(a),
        y = decimal(b);
    if (!x || !y) return null;
    const scale = Math.max(x.scale, y.scale);
    const n =
        x.units * 10n ** BigInt(scale - x.scale) -
        y.units * 10n ** BigInt(scale - y.scale);
    const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
    return `${n < 0n ? '-' : ''}${scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits}`;
}
const equalDecimal = (a, b) => {
    const difference = decimalDifference(a, b);
    return difference !== null && /^-?0(?:\.0+)?$/.test(difference);
};
const amount = (r) => r.purchaseUsd ?? r.netDividendUsd ?? r.cashUsd ?? null;
const scopeKey = (account, type, symbol, date) =>
    JSON.stringify([account, type, symbol, date]);
const comparable = (o) =>
    JSON.stringify([
        o.kind,
        o.accountId,
        o.type,
        o.symbol,
        o.sourceId,
        Object.entries(o.values || {}).sort(([a], [b]) => a.localeCompare(b)),
        o.location,
        o.digest,
    ]);
export function buildTossTrialRows(observations = [], sheetRows = []) {
    const evidence = new Map(),
        sheetIndex = new Map();
    for (const r of sheetRows) {
        const key = scopeKey(r.accountId, r.type, r.symbol, r.date);
        if (!sheetIndex.has(key)) sheetIndex.set(key, []);
        sheetIndex.get(key).push(r);
    }
    for (const o of observations) {
        if (!brokerKinds.has(o.kind) || !o.id || !o.accountId) continue;
        // Collapse exact replays only. Conflicting revisions stay visible; no last-write-wins.
        const key = JSON.stringify([o.accountId, o.kind, o.id]);
        const group = evidence.get(key) || [];
        if (!group.some((previous) => comparable(previous) === comparable(o)))
            group.push(o);
        evidence.set(key, group);
    }
    return [...evidence.entries()].flatMap(([key, variants]) =>
        variants.map((o, index) => {
            const values = { ...(o.values || {}) };
            const references = (
                sheetIndex.get(
                    scopeKey(o.accountId, o.type, o.symbol, values.date)
                ) || []
            ).map((r) => ({
                id: r.id,
                quantity: r.quantity ?? null,
                amountUsd: amount(r),
                quantityDifference: decimalDifference(
                    values.quantity,
                    r.quantity
                ),
                amountDifference: decimalDifference(amount(values), amount(r)),
                jointMatch:
                    equalDecimal(values.quantity, r.quantity) &&
                    equalDecimal(amount(values), amount(r)),
                approval: r.fieldResolutions || null,
            }));
            return {
                id: `${key}:${index}`,
                evidenceId: o.id,
                accountId: o.accountId,
                kind: o.kind,
                type: o.type,
                symbol: o.symbol,
                date: values.date || '',
                values,
                quantity: values.quantity ?? null,
                amountUsd: amount(values),
                location: o.location,
                original: o.original ?? null,
                rawText: o.rawText ?? '',
                hasOriginal: Boolean(o.hasOriginal || o.original || o.rawText),
                observation: o,
                normalizationStatus: '관측값 투영 · 금융사건 검증 대기',
                identityStatus: '내부 증거 ID · 영구 주문/체결 ID 아님',
                fillIdentityStatus: '개별 체결 ID 미확인',
                approvalStatus: o.targetId
                    ? '기존 승인 연결 있음 · 관측값 자동 승인 아님'
                    : '미승인',
                identityConflict: variants.length > 1,
                references,
            };
        })
    );
}
export function filterTossTrialRows(
    rows,
    { account = '', search = '', sort = 'date', direction = -1 } = {}
) {
    const needle = search.trim().toLowerCase();
    const fields = ['date', 'symbol', 'quantity', 'amountUsd', 'kind'];
    if (!fields.includes(sort)) sort = 'date';
    return rows
        .filter(
            (r) =>
                (!account || r.accountId === account) &&
                (!needle ||
                    JSON.stringify([
                        r.evidenceId,
                        r.symbol,
                        r.kind,
                        r.type,
                        r.values,
                        r.location,
                        r.references,
                        r.approvalStatus,
                    ])
                        .toLowerCase()
                        .includes(needle))
        )
        .sort((a, b) => {
            const x = a[sort],
                y = b[sort];
            if (x == null) return y == null ? a.id.localeCompare(b.id) : 1;
            if (y == null) return -1;
            const d = ['quantity', 'amountUsd'].includes(sort)
                ? decimalDifference(x, y)
                : null;
            const result =
                d == null
                    ? String(x).localeCompare(String(y))
                    : /^-?0(?:\.0+)?$/.test(d)
                      ? 0
                      : d.startsWith('-')
                        ? -1
                        : 1;
            return result * direction || a.id.localeCompare(b.id);
        });
}

// Local administrator-opened checkpoint only. No trust escalation, approval or persistence.
export function projectTrialReviewReport(input) {
    if (
        input?.schemaVersion !== 2 ||
        !Array.isArray(input.orders) ||
        !Array.isArray(input.remainingEightRows) ||
        input.orders.length > 100 ||
        input.remainingEightRows.length > 100
    )
        throw Error('지원하는 토스 후속 검토 보고서 형식이 아닙니다.');
    return input.remainingEightRows.map((r) => {
        if (
            typeof r.caseId !== 'string' ||
            !/^[A-Z][A-Z0-9.-]{0,11}$/.test(r.symbol || '') ||
            typeof r.referenceDate !== 'string'
        )
            throw Error('검토 항목의 식별·날짜를 확인해 주세요.');
        const orders = input.orders
            .filter((o) => o.caseId === r.caseId)
            .map((o) => ({
                account: o.account,
                quantity: o.quantity,
                amount: o.purchaseAmountUsd,
                orderNo: o.orderNo,
                verified: o.uiSelectionUrlPanelVerified === true,
                sourceFiles: Array.isArray(o.evidenceFiles)
                    ? o.evidenceFiles.map(String)
                    : [],
                opaqueIdChanged: o.exactPriorOpaqueIdMatch === false,
            }));
        return {
            id: r.caseId,
            symbol: r.symbol,
            date: r.referenceDate,
            category: r.category,
            fact: r.availableFact,
            missing: r.missingEvidence,
            nextAction: r.nextAction,
            orders,
            uiLink:
                orders.length && orders.every((o) => o.verified)
                    ? '보고서상 연결 확인'
                    : '연결 확인 기록 없음',
            source: input.sourceEvidence?.objectKey || '보고서 내 출처 미기재',
            approval: '미승인',
            fillIdentity: '개별 체결 ID 미확인',
        };
    });
}
