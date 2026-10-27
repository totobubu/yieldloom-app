// A source menu is provenance, not proof of payment. Never infer payment from age.
export const dividendFields = {
    confirmationStatus: '배당 확정 상태',
    paymentStatus: '배당 지급 상태',
    paidAt: '확인된 실제 지급 일시',
};
const confirmationLabels = {
    CONFIRMED: '확정',
    UNCONFIRMED: '미확정',
    UNKNOWN: '미확인',
};
const paymentLabels = { PAID: '지급', UNPAID: '미지급', UNKNOWN: '미확인' };
const rawConfirmation = new Map([
    ['확정', 'CONFIRMED'],
    ['confirmed', 'CONFIRMED'],
    ['미확정', 'UNCONFIRMED'],
    ['unconfirmed', 'UNCONFIRMED'],
]);
const rawPayment = new Map([
    ['지급', 'PAID'],
    ['지급 완료', 'PAID'],
    ['지급완료', 'PAID'],
    ['paid', 'PAID'],
    ['미지급', 'UNPAID'],
    ['unpaid', 'UNPAID'],
]);
const fail = (message) => {
    throw new Error(message);
};
const rawValue = (raw, key) => {
    const value = raw[key];
    if (value == null) return null;
    if (typeof value !== 'string' || value.length > 300)
        fail('배당 원문 상태는 300자 이하의 실제 표시 문구로 입력해 주세요.');
    return value;
};
function status(value, raw, map, choices, label) {
    const observed = map.get(raw?.trim().toLowerCase()) || 'UNKNOWN';
    if (value != null && !Object.hasOwn(choices, value))
        fail(`${label} 상태를 확인해 주세요.`);
    if (value && value !== 'UNKNOWN' && value !== observed)
        fail(`${label} 상태와 확인된 원문 문구가 일치하지 않습니다.`);
    return observed;
}
export function normalizeDividendState(input, values) {
    if (input.type !== 'DIVIDEND') {
        if (Object.keys(dividendFields).some((f) => values[f] != null))
            fail('배당 상태·지급 일시는 배당 관측에만 입력할 수 있습니다.');
        return null;
    }
    const raw = input.dividendState ?? {};
    if (typeof raw !== 'object' || Array.isArray(raw))
        fail('배당 원문 상태 형식을 확인해 주세요.');
    const confirmationStatusRaw = rawValue(raw, 'confirmationStatusRaw'),
        paymentStatusRaw = rawValue(raw, 'paymentStatusRaw');
    const confirmationStatus = status(
        values.confirmationStatus,
        confirmationStatusRaw,
        rawConfirmation,
        confirmationLabels,
        '확정'
    );
    const paymentStatus = status(
        values.paymentStatus,
        paymentStatusRaw,
        rawPayment,
        paymentLabels,
        '지급'
    );
    if (confirmationStatus === 'UNCONFIRMED' && paymentStatus === 'PAID')
        fail('미확정과 지급 완료 원문이 모순됩니다. 원본을 확인해 주세요.');
    if (values.paidAt != null && paymentStatus !== 'PAID')
        fail(
            '미지급·지급 미확인 자료에는 실제 지급 일시를 확정할 수 없습니다.'
        );
    values.confirmationStatus = confirmationStatus;
    values.paymentStatus = paymentStatus;
    return {
        confirmationStatus,
        paymentStatus,
        confirmationStatusRaw,
        paymentStatusRaw,
        forecast: confirmationStatus === 'UNCONFIRMED',
        cashEligible:
            confirmationStatus === 'CONFIRMED' && paymentStatus === 'PAID',
    };
}
export function dividendState(observation) {
    if (observation.type !== 'DIVIDEND') return null;
    try {
        return normalizeDividendState(observation, { ...observation.values });
    } catch {
        return {
            confirmationStatus: 'UNKNOWN',
            paymentStatus: 'UNKNOWN',
            forecast: false,
            cashEligible: false,
        };
    }
}
export function dividendStatusLabel(observation) {
    const state = dividendState(observation);
    return state
        ? `${confirmationLabels[state.confirmationStatus]} · ${paymentLabels[state.paymentStatus]}`
        : null;
}
export function projectDividendState(observation) {
    if (observation.type !== 'DIVIDEND') return observation;
    const state = dividendState(observation);
    return { ...observation, dividendState: state, forecast: state.forecast };
}
function receiptMatch(row, observation) {
    if (
        row.accountId !== observation.accountId ||
        !['DEPOSIT', 'DIVIDEND'].includes(row.type)
    )
        return false;
    if (row.symbol && row.symbol !== observation.symbol) return false;
    const date = observation.values.paidAt?.slice(0, 10);
    // paymentDate can be scheduled; require the explicitly observed actual paidAt.
    if (!date || date !== row.date) return false;
    let currencies = 0;
    for (const [suffix, tolerance] of [
        ['Usd', 0.005],
        ['Krw', 0.5],
    ]) {
        const net = observation.values[`netDividend${suffix}`],
            cash = observation.values[`cash${suffix}`];
        if (net != null && cash != null && Math.abs(net - cash) > tolerance)
            return false;
        const observed = net ?? cash,
            received =
                row[
                    row.type === 'DIVIDEND'
                        ? `netDividend${suffix}`
                        : `cash${suffix}`
                ];
        if (observed == null || received == null) continue;
        if (
            !(observed > 0 && received > 0) ||
            Math.abs(observed - received) > tolerance
        )
            return false;
        currencies++;
    }
    return currencies > 0;
}
export function dividendReceiptCandidates(rows, observation) {
    if (!dividendState(observation)?.cashEligible) return [];
    return rows.filter((row) => receiptMatch(row, observation));
}
export function linkDividendReceipt(
    rows,
    observations,
    observation,
    body,
    actor,
    note,
    at,
    cutoff
) {
    if (!dividendState(observation)?.cashEligible)
        fail(
            '예상 배당·미지급・상태 미확인 자료는 확정 입금에 연결할 수 없습니다.'
        );
    const target = rows.find((row) => row.id === body.targetId);
    if (!target)
        fail(
            '배당은 새 입금으로 만들지 않습니다. 기존 입금 거래를 선택해 주세요.'
        );
    if (!receiptMatch(target, observation))
        fail(
            '계좌·티커·실제 지급일·통화별 입금액이 일치하는 기존 입금을 확인해 주세요.'
        );
    if (target.date > cutoff || observation.values.paidAt.slice(0, 10) > cutoff)
        fail('미래 지급을 실제 입금으로 연결할 수 없습니다.');
    if (
        observation.acceptedTargetId &&
        observation.acceptedTargetId !== target.id
    )
        fail('이미 연결된 배당 근거를 다른 입금에 중복 연결할 수 없습니다.');
    const receiptLink = {
        targetId: target.id,
        actor,
        note,
        at,
        status: 'CONFIRMED',
    };
    return {
        rows,
        observations: observations.map((o) =>
            o.id === observation.id
                ? {
                      ...o,
                      targetId: target.id,
                      acceptedTargetId: target.id,
                      receiptLink,
                  }
                : o
        ),
    };
}
