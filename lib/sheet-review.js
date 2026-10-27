import {
    comparisonFields,
    sourceValues,
    sourceKinds,
} from './sheet-reconciliation.js';
import { dividendState } from './sheet-dividend-state.js';

// A candidate alias only: never rewrites source symbols or combines transactions.
const symbolKey = (symbol) => (symbol === 'WPAY' ? 'TOPW' : symbol);
const eventKey = (accountId, type, symbol, date) =>
    JSON.stringify([accountId, type, symbolKey(symbol), date]);
const time = (value) =>
    typeof value === 'string' ? value.replace('T', ' ') : null;
const timestamp = (value) =>
    value.timePrecision === 'date'
        ? null
        : time(value.executedAt || value.transactionAt);
const zone = (value) =>
    ({ KST: 'Asia/Seoul', UTC: 'UTC', GMT: 'UTC' })[value] || value;
const stable = (value) =>
    Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === 'object'
          ? Object.fromEntries(
                Object.keys(value)
                    .sort()
                    .map((key) => [key, stable(value[key])])
            )
          : value;
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function identityMatches(row, observation) {
    if (
        observation.forecast ||
        row.accountId !== observation.accountId ||
        row.type !== observation.type ||
        symbolKey(row.symbol) !== symbolKey(observation.symbol)
    )
        return false;
    const values = observation.values || {};
    if (observation.type === 'DIVIDEND') {
        if (!dividendState(observation)?.cashEligible) return false;
        return values.paidAt?.slice(0, 10) === row.date;
    }
    if (row.date !== values.date) return false;
    const a = timestamp(row),
        b = timestamp(values);
    if (
        row.timeZone &&
        values.timeZone &&
        zone(row.timeZone) !== zone(values.timeZone)
    )
        return false;
    if (a && b && a !== b && a.slice(0, 16) !== b.slice(0, 16)) return false;
    if (a && b && a.length > 16 && b.length > 16 && a !== b) return false;
    // Different quantities can be a field conflict only with the same displayed
    // timestamp. Date-only observations must retain the quantity discriminator.
    if (
        row.quantity != null &&
        values.quantity != null &&
        row.quantity !== values.quantity &&
        !(a && b && a === b)
    )
        return false;
    return true;
}

export function reviewSources(row, observations) {
    const baseline = row.sourceValues ?? sourceValues(row);
    return comparisonFields.map((field) => {
        const sources = [];
        if (baseline[field] != null)
            sources.push({
                id: 'baseline',
                value: baseline[field],
                label: row.source?.spreadsheetId ? '구글 시트' : '최초 등록값',
                location:
                    `${row.source?.sheet || ''} ${row.source?.row || ''}`.trim(),
                eligible: true,
            });
        if (row[field] != null && !sameValue(row[field], baseline[field]))
            sources.push({
                id: 'current',
                value: row[field],
                label: '현재 장부값',
                location: row.id,
                eligible: true,
            });
        for (const observation of observations) {
            if (observation.values?.[field] == null) continue;
            sources.push({
                id: observation.id,
                value: observation.values[field],
                label: sourceKinds[observation.kind] || observation.kind,
                location: observation.location,
                eligible:
                    !observation.ambiguous &&
                    !observation.forecast &&
                    identityMatches(row, observation),
                alias: row.symbol !== observation.symbol,
                ambiguous: Boolean(observation.ambiguous),
            });
        }
        const conflict =
            new Set(
                sources
                    .filter((source) => !source.ambiguous)
                    .map((source) => JSON.stringify(source.value))
            ).size > 1;
        const decision = row.review?.decisions?.[field];
        const chosen = sources.find(
            (source) =>
                source.id === (decision?.sourceId || decision?.observationId)
        );
        const resolved = Boolean(
            decision &&
                chosen &&
                sameValue(chosen.value, row[field]) &&
                (!Object.hasOwn(decision, 'value') ||
                    sameValue(decision.value, row[field])) &&
                (!decision.reviewedObservationIds ||
                    sources.every(
                        (source) =>
                            source.ambiguous ||
                            ['baseline', 'current'].includes(source.id) ||
                            sameValue(source.value, row[field]) ||
                            decision.reviewedObservationIds.includes(source.id)
                    ))
        );
        return {
            field,
            current: row[field] ?? null,
            sources,
            conflict,
            resolved,
            decision,
            needsChoice:
                (conflict && !resolved) ||
                (row[field] == null &&
                    sources.some((source) => source.eligible)),
        };
    });
}

export function reviewSignature(row, observations) {
    return JSON.stringify(
        stable({
            id: row.id,
            baseline: row.sourceValues ?? sourceValues(row),
            values: sourceValues(row),
            decisions: row.review?.decisions || {},
            fieldStatus: row.fieldStatus || {},
            observations: observations
                .map((o) => ({
                    id: o.id,
                    values: o.values,
                    acceptedTargetId: o.acceptedTargetId || null,
                }))
                .sort((a, b) => a.id.localeCompare(b.id)),
        })
    );
}

export function buildLedgerReview(rows, observations) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const groups = new Map();
    for (const row of rows) {
        const key = eventKey(row.accountId, row.type, row.symbol, row.date);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }
    const linked = new Map(rows.map((row) => [row.id, []]));
    const counts = {
        sourceRecords: observations.length,
        matchedTransactions: 0,
        confirmedTransactions: 0,
        agreedTransactions: 0,
        conflictRows: 0,
        conflictFields: 0,
        unmatched: 0,
        ambiguous: 0,
        awaitingApproval: 0,
        missingValues: 0,
        outsideScope: 0,
    };
    for (const observation of observations) {
        if (
            observation.forecast ||
            (observation.type === 'DIVIDEND' &&
                !dividendState(observation)?.cashEligible)
        ) {
            counts.outsideScope++;
            continue;
        }
        const accepted = byId.get(observation.acceptedTargetId);
        const date =
            observation.type === 'DIVIDEND'
                ? observation.values?.paidAt?.slice(0, 10)
                : observation.values?.date;
        const candidates =
            accepted && accepted.accountId === observation.accountId
                ? [accepted]
                : (
                      groups.get(
                          eventKey(
                              observation.accountId,
                              observation.type,
                              observation.symbol,
                              date
                          )
                      ) || []
                  ).filter((row) => identityMatches(row, observation));
        if (!candidates.length) counts.unmatched++;
        else if (candidates.length > 1) counts.ambiguous++;
        if (candidates.length && !observation.acceptedTargetId)
            counts.awaitingApproval++;
        for (const row of candidates)
            linked
                .get(row.id)
                .push({ ...observation, ambiguous: candidates.length > 1 });
    }
    const byRow = new Map();
    for (const row of rows) {
        const proof = linked.get(row.id);
        const fields = reviewSources(row, proof);
        const unresolved = fields.filter(
            (field) => field.conflict && !field.resolved
        );
        const uniqueProof = proof.filter((item) => !item.ambiguous);
        if (uniqueProof.length) counts.matchedTransactions++;
        if (uniqueProof.some((item) => item.acceptedTargetId === row.id))
            counts.confirmedTransactions++;
        if (
            uniqueProof.length &&
            fields.every((field) => !field.conflict && !field.needsChoice) &&
            fields.some((field) => field.sources.length > 1)
        )
            counts.agreedTransactions++;
        if (unresolved.length) counts.conflictRows++;
        counts.conflictFields += unresolved.length;
        if (
            ['commission', 'fxFee'].some(
                (key) => row[`${key}Usd`] == null && row[`${key}Krw`] == null
            )
        )
            counts.missingValues++;
        byRow.set(row.id, {
            observations: proof,
            fields: new Map(fields.map((field) => [field.field, field])),
            unresolved: unresolved.length,
            signature: reviewSignature(row, proof),
        });
    }
    return { byRow, counts };
}

export function resolveRowEvidence(
    rows,
    observations,
    body,
    actor,
    at,
    cutoff
) {
    const row = rows.find((item) => item.id === body.id);
    if (!row) throw Error('승인할 거래를 찾지 못했습니다.');
    if (
        typeof body.note !== 'string' ||
        !body.note.trim() ||
        body.note.length > 2000
    )
        throw Error('관리자 확인 근거를 입력해 주세요.');
    if (
        !body.choices ||
        Array.isArray(body.choices) ||
        typeof body.choices !== 'object' ||
        !Object.keys(body.choices).length ||
        Object.keys(body.choices).length > comparisonFields.length
    )
        throw Error('채택할 필드를 선택해 주세요.');
    const model = buildLedgerReview(rows, observations).byRow.get(row.id);
    if (body.signature !== model.signature)
        throw Object.assign(
            Error(
                '대조값이 변경되었습니다. 최신 값을 확인한 후 다시 선택해 주세요.'
            ),
            { status: 409 }
        );
    const next = {
        ...row,
        sourceValues: row.sourceValues ?? sourceValues(row),
        sourceFieldStatus: row.sourceFieldStatus ?? { ...row.fieldStatus },
        fieldStatus: { ...row.fieldStatus },
        review: {
            ...row.review,
            decisions: { ...row.review?.decisions },
            history: [...(row.review?.history || [])],
        },
    };
    if (next.review.history.length >= 200)
        throw Error('행별 검토 이력이 한도에 도달했습니다.');
    const changes = [],
        used = new Set();
    for (const [field, sourceId] of Object.entries(body.choices)) {
        const fieldModel = model.fields.get(field);
        const source = fieldModel?.sources.find(
            (item) => item.id === sourceId && item.eligible
        );
        if (!source)
            throw Error(
                '이 거래에 연결 가능한 실제 출처 값만 선택해 주세요. 모호한 후보는 상세 대조에서 먼저 연결해 주세요.'
            );
        if (
            [
                'date',
                'exDate',
                'paymentDate',
                'transactionAt',
                'executedAt',
                'settledAt',
                'paidAt',
            ].includes(field) &&
            String(source.value).slice(0, 10) > cutoff
        )
            throw Error('미래 일시를 실제 거래로 승인할 수 없습니다.');
        changes.push({
            field,
            before: row[field] ?? null,
            original: next.sourceValues[field] ?? null,
            after: source.value,
            sourceId,
            source: source.label,
            location: source.location,
        });
        next[field] = source.value;
        const selectedStatus =
            sourceId === 'baseline'
                ? next.sourceFieldStatus[field]
                : sourceId === 'current'
                  ? row.fieldStatus?.[field]
                  : '확정';
        next.fieldStatus[field] = selectedStatus === '추정' ? '추정' : '확정';
        next.review.decisions[field] = {
            sourceId,
            value: source.value,
            observationId: ['baseline', 'current'].includes(sourceId)
                ? null
                : sourceId,
            actor,
            note: body.note.trim(),
            at,
            reviewedObservationIds: model.observations.map((item) => item.id),
        };
        if (!['baseline', 'current'].includes(sourceId)) used.add(sourceId);
    }
    if (
        changes.some(
            (change) =>
                ['cashUsd', 'cashKrw', 'date'].includes(change.field) &&
                !sameValue(change.before, change.after)
        )
    )
        next.capital = null;
    next.review.history.push({
        actor,
        note: body.note.trim(),
        at,
        action: 'resolve-fields',
        changes,
    });
    return {
        rows: rows.map((item) => (item.id === next.id ? next : item)),
        observations: observations.map((item) =>
            used.has(item.id)
                ? { ...item, targetId: row.id, acceptedTargetId: row.id }
                : item
        ),
    };
}
