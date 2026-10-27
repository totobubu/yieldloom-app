import { accounts, numericFields, sheetDate } from './sheet-ledger.js';
import {
    dividendFields,
    normalizeDividendState,
    dividendReceiptCandidates,
    linkDividendReceipt,
} from './sheet-dividend-state.js';

export const sourceKinds = {
    MANUAL: '관리자 수동 입력',
    PDF: '기존 PDF 장부',
    TOSS_TRANSACTION: '토스 거래내역',
    TOSS_ORDER: '토스 주문내역',
    TOSS_EXPECTED_DIVIDEND: '토스 배당 상세 · 예상 배당금 메뉴',
};
export const eventTypes = [
    'BUY',
    'SELL',
    'DIVIDEND',
    'FEE',
    'DEPOSIT',
    'WITHDRAWAL',
    'FX',
];
export const extraFields = {
    ...dividendFields,
    transactionAt: '거래 일시',
    reservedAt: '예약 일시',
    orderedAt: '주문 일시',
    executedAt: '체결 일시',
    settledAt: '실제 결제 일시',
    scheduledSettlementDate: '예정 결제일',
    timeZone: '표시 시간대',
    settlementLabel: '원문 결제 안내',
    orderType: '주문 유형',
    orderAmountUsd: '주문 금액($)',
    marketPriceAtOrderUsd: '주문 당시 시장가($)',
    fxDirection: '환전 방향',
    timePrecision: '일시 정밀도',
    cashUsd: '입출금($)',
    cashKrw: '입출금(₩)',
    exchangedUsd: '환전 달러($)',
    usedKrw: '환전에 사용한 원화(₩)',
    fxFeeIncluded: '환전비용 포함 여부',
};
const temporalFields = [
    'transactionAt',
    'reservedAt',
    'orderedAt',
    'executedAt',
    'settledAt',
];
const moneyFields = [
    ...numericFields,
    'orderAmountUsd',
    'marketPriceAtOrderUsd',
];
export const comparisonFields = [
    'date',
    'exDate',
    'paymentDate',
    ...numericFields,
    ...Object.keys(extraFields),
];
const own = (obj, key) => Object.hasOwn(obj, key);
const fail = (message) => {
    throw new Error(message);
};
const text = (value, name, max = 1000) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
        fail(`${name}을 확인해 주세요.`);
    return value.trim();
};
function validDate(value) {
    return typeof value === 'string' && sheetDate(value) === value;
}
function validateValue(field, value) {
    if (value === null) return null;
    if (field === 'confirmationStatus') {
        if (!['CONFIRMED', 'UNCONFIRMED', 'UNKNOWN'].includes(value))
            fail('배당 확정 상태를 확인해 주세요.');
    } else if (field === 'paymentStatus') {
        if (!['PAID', 'UNPAID', 'UNKNOWN'].includes(value))
            fail('배당 지급 상태를 확인해 주세요.');
    } else if (field === 'paidAt' && validDate(value)) {
        return value;
    } else if (moneyFields.includes(field)) {
        if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > 1e15
        )
            fail(`${field}: 음수가 아닌 실제 관측 숫자를 입력해 주세요.`);
    } else if (temporalFields.includes(field) || field === 'paidAt') {
        // Never append seconds, a zone, or UTC conversion to a minute-only source.
        if (
            typeof value !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/.test(
                value
            ) ||
            !validDate(value.slice(0, 10))
        )
            fail(`${field}: 표시된 일시와 정밀도를 확인해 주세요.`);
    } else if (field === 'timeZone') {
        try {
            new Intl.DateTimeFormat('en', { timeZone: value });
        } catch {
            fail('화면에서 확인된 시간대를 입력하거나 미확인으로 두세요.');
        }
        if (typeof value !== 'string' || value.length > 80)
            fail('시간대를 확인해 주세요.');
    } else if (['settlementLabel', 'orderType'].includes(field)) {
        return text(value, field, 300);
    } else if (field === 'fxDirection') {
        if (!['KRW_TO_USD', 'USD_TO_KRW'].includes(value))
            fail('확인된 환전 방향을 입력해 주세요.');
    } else if (field === 'timePrecision') {
        if (!['date', 'minute', 'second', 'millisecond'].includes(value))
            fail('일시 정밀도를 확인해 주세요.');
    } else if (field === 'fxFeeIncluded') {
        if (typeof value !== 'boolean')
            fail('환전비용 포함 여부를 확인해 주세요.');
    } else if (!validDate(value)) fail(`${field}: 날짜를 확인해 주세요.`);
    return value;
}
export function sourceValues(row) {
    return Object.fromEntries(
        comparisonFields.filter((f) => own(row, f)).map((f) => [f, row[f]])
    );
}
export function normalizeObservation(input, { maxRawTextLength = 16000 } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        fail('대조 자료 형식을 확인해 주세요.');
    if (!own(sourceKinds, input.kind))
        fail('대조 자료의 출처를 확인해 주세요.');
    if (!accounts.some((a) => a.id === input.accountId))
        fail('남편/아내 계좌를 지정해 주세요.');
    if (!eventTypes.includes(input.type))
        fail('대조 자료의 거래유형을 확인해 주세요.');
    if (input.kind === 'TOSS_EXPECTED_DIVIDEND' && input.type !== 'DIVIDEND')
        fail('토스 배당 상세 자료는 배당유형으로 구분해 주세요.');
    const sourceId = text(input.sourceId, '출처 고유 ID', 180);
    const location = text(input.location, '원본 위치', 1000);
    const symbol = input.symbol ?? '';
    if (
        typeof symbol !== 'string' ||
        (symbol && !/^[A-Z][A-Z0-9.-]{0,11}$/.test(symbol))
    )
        fail('티커를 확인해 주세요.');
    if (['BUY', 'SELL', 'DIVIDEND'].includes(input.type) && !symbol)
        fail('주식/배당 자료에는 티커가 필요합니다.');
    if (
        !input.values ||
        typeof input.values !== 'object' ||
        Array.isArray(input.values)
    )
        fail('관측값(values)을 입력해 주세요.');
    const values = {};
    for (const [field, value] of Object.entries(input.values)) {
        if (!comparisonFields.includes(field))
            fail(`지원하지 않는 대조 필드: ${field}`);
        values[field] = validateValue(field, value);
    }
    const state = normalizeDividendState(input, values);
    if (!Object.values(values).some((v) => v !== null))
        fail('확인된 값이 없는 자료는 등록할 수 없습니다.');
    const rawText =
        input.rawText == null
            ? ''
            : text(input.rawText, '원문', maxRawTextLength);
    return {
        id: `${input.kind}:${input.accountId}:${sourceId}`,
        kind: input.kind,
        sourceId,
        accountId: input.accountId,
        type: input.type,
        symbol,
        location,
        rawText,
        values,
        targetId: null,
        forecast: state?.forecast || false,
        ...(state ? { dividendState: state } : {}),
        capture: '관리자가 제출한 대조 자료 · 브라우저 자동수집 여부 미검증',
    };
}
export function candidates(rows, observation) {
    if (observation.type === 'DIVIDEND')
        return dividendReceiptCandidates(rows, observation);
    if (observation.forecast || !observation.values.date) return [];
    return rows.filter(
        (r) =>
            r.accountId === observation.accountId &&
            r.type === observation.type &&
            r.symbol === observation.symbol &&
            r.date === observation.values.date &&
            (!r.transactionAt ||
                !observation.values.transactionAt ||
                r.transactionAt === observation.values.transactionAt) &&
            (observation.values.quantity == null ||
                r.quantity === observation.values.quantity)
    );
}
export function stageObservations(rows, existing, inputs) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100)
        fail('대조 자료는 한 번에 1~100건을 제출해 주세요.');
    const seen = new Map(existing.map((o) => [o.id, o]));
    const additions = [];
    let duplicates = 0;
    for (const input of inputs) {
        const item = normalizeObservation(input);
        const previous = seen.get(item.id);
        if (previous) {
            for (const f of [
                'kind',
                'sourceId',
                'accountId',
                'type',
                'symbol',
                'location',
                'rawText',
            ])
                if (JSON.stringify(previous[f]) !== JSON.stringify(item[f]))
                    fail(
                        '같은 출처 ID의 값이 다릅니다. 원본을 덮어쓰지 말고 별도 개정 ID로 등록해 주세요.'
                    );
            for (const f of new Set([
                ...Object.keys(previous.values),
                ...Object.keys(item.values),
            ]))
                if (previous.values[f] !== item.values[f])
                    fail(
                        '같은 출처 ID의 값이 다릅니다. 별도 개정 ID로 등록해 주세요.'
                    );
            duplicates++;
            continue;
        }
        const matches = candidates(rows, item);
        item.candidateIds = matches.map((r) => r.id);
        // This is only a suggestion. No ledger value changes until explicit acceptance.
        item.targetId = matches.length === 1 ? matches[0].id : null;
        seen.set(item.id, item);
        additions.push(item);
    }
    return { additions, duplicates };
}
export function compareEvidence(row, observations) {
    const linked = observations.filter(
        (o) =>
            o.targetId === row.id &&
            !o.forecast &&
            o.accountId === row.accountId
    );
    const baseline = row.sourceValues ?? sourceValues(row);
    return comparisonFields
        .map((field) => {
            const sources = linked
                .filter((o) => own(o.values, field) && o.values[field] !== null)
                .map((o) => ({
                    id: o.id,
                    kind: o.kind,
                    value: o.values[field],
                    location: o.location,
                }));
            const distinct = new Set(
                [baseline[field], ...sources.map((s) => s.value)]
                    .filter((v) => v != null)
                    .map((v) => JSON.stringify(v))
            );
            return {
                field,
                baseline: baseline[field] ?? null,
                current: row[field] ?? null,
                sources,
                conflict: distinct.size > 1,
                decision: row.review?.decisions?.[field] ?? null,
            };
        })
        .filter(
            (r) => r.baseline !== null || r.current !== null || r.sources.length
        );
}
function audit(row, actor, note, at, change) {
    const history = row.review?.history || [];
    if (history.length >= 200) fail('행별 검토 이력이 한도에 도달했습니다.');
    return {
        ...row.review,
        history: [...history, { actor, note, at, ...change }],
    };
}
export function acceptEvidence(rows, observations, body, actor, at, cutoff) {
    const observation = observations.find((o) => o.id === body.observationId);
    if (!observation) fail('대조 자료를 찾지 못했습니다.');
    const note = text(body.note, '확인 근거');
    if (observation.type === 'DIVIDEND')
        return linkDividendReceipt(
            rows,
            observations,
            observation,
            body,
            actor,
            note,
            at,
            cutoff
        );
    if (observation.forecast)
        fail('예상 배당은 실제 입금으로 확정할 수 없습니다.');
    if (
        !Array.isArray(body.fields) ||
        !body.fields.length ||
        body.fields.length > comparisonFields.length ||
        new Set(body.fields).size !== body.fields.length
    )
        fail('채택할 필드를 선택해 주세요.');
    for (const f of body.fields)
        if (
            !comparisonFields.includes(f) ||
            !own(observation.values, f) ||
            observation.values[f] == null
        )
            fail('확인된 출처 값만 채택할 수 있습니다.');
    let row = rows.find((r) => r.id === body.targetId);
    const isNew = body.targetId == null || body.targetId === '';
    if (!row && !isNew) fail('연결할 시험 거래를 찾지 못했습니다.');
    if (
        row &&
        (row.accountId !== observation.accountId ||
            row.type !== observation.type)
    )
        fail('다른 계좌 또는 거래유형에 연결할 수 없습니다.');
    if (
        observation.acceptedTargetId &&
        row &&
        observation.acceptedTargetId !== row.id
    )
        fail(
            '기존 연결을 다른 거래로 변경할 수 없습니다. 새 개정 자료로 검토해 주세요.'
        );
    if (isNew) {
        if (observation.acceptedTargetId)
            fail('이미 연결된 자료는 신규 거래로 중복 등록할 수 없습니다.');
        if (candidates(rows, observation).length && body.separateEvent !== true)
            fail(
                '같은 계좌의 거래 후보가 있습니다. 기존 거래에 연결하거나 별도 사건임을 확인해 주세요.'
            );
        if (
            !body.fields.includes('date') ||
            !validDate(observation.values.date)
        )
            fail('신규 거래에는 확인된 거래일을 선택해 주세요.');
        const id = `evidence:${observation.id}`;
        if (rows.some((r) => r.id === id)) fail('이미 등록한 대조 자료입니다.');
        row = {
            ...Object.fromEntries(moneyFields.map((f) => [f, null])),
            id,
            accountId: observation.accountId,
            type: observation.type,
            symbol: observation.symbol,
            date: observation.values.date,
            exDate: null,
            paymentDate: null,
            fundingSource: '미확인',
            reinvested: null,
            status: '미확인',
            needsReview: true,
            fieldStatus: {},
            evidence: [],
            sourceValues: {},
            source: {
                sheet: sourceKinds[observation.kind],
                row: null,
                observationId: observation.id,
            },
        };
    }
    const next = {
        ...row,
        sourceValues: row.sourceValues ?? sourceValues(row),
        fieldStatus: { ...row.fieldStatus },
        needsReview: true,
    };
    for (const f of body.fields) {
        next[f] = observation.values[f];
        next.fieldStatus[f] = '확정';
    }
    if (
        body.fields.some(
            (f) =>
                ['cashUsd', 'cashKrw', 'date'].includes(f) && next[f] !== row[f]
        )
    )
        next.capital = null;
    if (next.date > cutoff) fail('미래 사건을 실제 거래로 저장할 수 없습니다.');
    for (const f of ['transactionAt', 'executedAt', 'settledAt'])
        if (next[f] && next[f].slice(0, 10) > cutoff)
            fail('미래 일시를 실제 거래로 확정할 수 없습니다.');
    next.review = audit(row, actor, note, at, {
        observationId: observation.id,
        fields: body.fields,
    });
    next.review.decisions = { ...row.review?.decisions };
    for (const f of body.fields)
        next.review.decisions[f] = {
            observationId: observation.id,
            actor,
            note,
            at,
        };
    return {
        rows: isNew
            ? [...rows, next]
            : rows.map((r) => (r.id === next.id ? next : r)),
        observations: observations.map((o) =>
            o.id === observation.id
                ? { ...o, targetId: next.id, acceptedTargetId: next.id }
                : o
        ),
    };
}
export function classifyCash(rows, observations, body, actor, at) {
    const row = rows.find((r) => r.id === body.id);
    if (!row || !['DEPOSIT', 'WITHDRAWAL'].includes(row.type))
        fail('실제 입출금 거래만 원금 분류할 수 있습니다.');
    if (
        !['EXTERNAL', 'ACCOUNT_TRANSFER', 'UNKNOWN'].includes(body.scope) ||
        !['PRINCIPAL', 'DIVIDEND_PROFIT', 'MIXED', 'UNKNOWN'].includes(
            body.origin
        )
    )
        fail('입출금 범위와 자금 출처를 확인해 주세요.');
    const note = text(body.note, '분류 근거');
    if (
        !Array.isArray(body.evidenceIds) ||
        !body.evidenceIds.length ||
        body.evidenceIds.some(
            (id) =>
                !observations.some(
                    (o) =>
                        o.id === id &&
                        o.targetId === row.id &&
                        o.accountId === row.accountId &&
                        !o.forecast
                )
        )
    )
        fail('이 입출금에 연결된 실제 대조 근거가 필요합니다.');
    const peerAccountId =
        body.scope === 'ACCOUNT_TRANSFER' ? body.peerAccountId : null;
    if (
        body.scope === 'ACCOUNT_TRANSFER' &&
        (!accounts.some((a) => a.id === peerAccountId) ||
            peerAccountId === row.accountId)
    )
        fail('상대 계좌를 지정해 주세요.');
    const next = {
        ...row,
        capital: {
            scope: body.scope,
            origin: body.origin,
            peerAccountId,
            evidenceIds: [...new Set(body.evidenceIds)],
            note,
            actor,
            at,
        },
        review: audit(row, actor, note, at, {
            scope: body.scope,
            origin: body.origin,
            peerAccountId,
        }),
        needsReview: true,
    };
    return rows.map((r) => (r.id === row.id ? next : r));
}
export function createManualRow(input, requestId, actor, at, cutoff) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId || ''))
        fail('수동 거래 요청 ID를 확인해 주세요.');
    const observation = normalizeObservation({
        ...input,
        kind: 'MANUAL',
        sourceId: requestId,
        location: '관리자 수동 입력',
        ...(input.note?.trim() ? { rawText: input.note } : {}),
    });
    const fields = Object.keys(observation.values).filter(
        (f) => observation.values[f] !== null
    );
    const result = acceptEvidence(
        [],
        [observation],
        {
            observationId: observation.id,
            fields,
            note: input.note?.trim() || '관리자 수동 입력 · 원본 대조 전',
            targetId: null,
        },
        actor,
        at,
        cutoff
    );
    const row = result.rows[0];
    return {
        ...row,
        id: `manual:${requestId}`,
        sourceValues: sourceValues(row),
        status: '미확인',
        needsReview: true,
        source: {
            kind: 'manual',
            sheet: '수동 입력',
            row: null,
            requestId,
            actor,
            createdAt: at,
        },
        timePrecision: observation.values.transactionAt
            ? observation.values.transactionAt.includes('.')
                ? 'millisecond'
                : observation.values.transactionAt.length > 16
                  ? 'second'
                  : 'minute'
            : 'date',
        fieldStatus: Object.fromEntries(fields.map((f) => [f, '미확인'])),
    };
}
const round = (n) => Math.round(n * 1e8) / 1e8;
export function summarizeCapital(rows, accountId = null) {
    const events = rows.filter(
        (r) =>
            (!accountId || r.accountId === accountId) &&
            ['DEPOSIT', 'WITHDRAWAL'].includes(r.type)
    );
    const currencies = {};
    for (const currency of ['Usd', 'Krw']) {
        let externalNet = 0,
            confirmedPrincipal = 0,
            dividendReuseWithdrawals = 0,
            transferNet = 0,
            pending = 0,
            observed = 0;
        for (const r of events) {
            const value = r[`cash${currency}`],
                classification = r.capital;
            if (value == null) {
                pending++;
                continue;
            }
            observed++;
            const sign = r.type === 'DEPOSIT' ? 1 : -1;
            if (classification?.scope === 'EXTERNAL') {
                externalNet += sign * value;
                if (classification.origin === 'PRINCIPAL')
                    confirmedPrincipal += sign * value;
                else if (
                    r.type === 'WITHDRAWAL' &&
                    classification.origin === 'DIVIDEND_PROFIT'
                )
                    dividendReuseWithdrawals += value;
                else if (classification.origin !== 'DIVIDEND_PROFIT') pending++;
            } else if (classification?.scope === 'ACCOUNT_TRANSFER') {
                // Transfers never introduce new household principal; allocation remains separate.
                if (accountId) transferNet += sign * value;
                if (['UNKNOWN', 'MIXED'].includes(classification.origin))
                    pending++;
            } else pending++;
        }
        currencies[currency] = {
            externalNet: round(externalNet),
            confirmedPrincipal: round(confirmedPrincipal),
            dividendReuseWithdrawals: round(dividendReuseWithdrawals),
            transferNet: round(transferNet),
            pending,
            observed,
            complete: events.length > 0 && pending === 0,
        };
    }
    return { currencies, events: events.length };
}
