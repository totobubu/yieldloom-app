import { validCalendarDate } from './portfolioCalendar.js';

export const MONTHLY_STATEMENT_MAX_BYTES = 32 * 1024;
const kind = 'yieldloom-monthly-dividends';
const requireValue = (condition, message) => {
    if (!condition) throw new Error(message);
};
const count = (value) =>
    Number.isSafeInteger(value) && value >= 0 && value <= 1000000;

// Export only aggregate values and an opaque scope digest, never account IDs or entries.
export function validateMonthlyStatement(value) {
    requireValue(
        value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            value.schemaVersion === 1 &&
            value.kind === kind,
        '지원하는 월간 결산 파일이 아닙니다.'
    );
    requireValue(
        typeof value.month === 'string' &&
            /^\d{4}-\d{2}$/.test(value.month) &&
            validCalendarDate(`${value.month}-01`) &&
            validCalendarDate(value.asOf) &&
            value.month <= value.asOf.slice(0, 7),
        '결산 월과 자료 확인일을 확인하세요.'
    );
    requireValue(
        typeof value.currency === 'string' && /^[A-Z]{3}$/.test(value.currency),
        '결산 통화를 확인하세요.'
    );
    requireValue(
        typeof value.scopeHash === 'string' &&
            /^[a-f0-9]{64}$/.test(value.scopeHash) &&
            count(value.accountCount) &&
            value.accountCount > 0,
        '결산 계좌 범위를 확인하세요.'
    );
    requireValue(
        count(value.recordCount) &&
            count(value.unknownCount) &&
            value.unknownCount <= value.recordCount &&
            count(value.excludedDateCount),
        '결산 기록 수를 확인하세요.'
    );
    const known = value.recordCount - value.unknownCount;
    requireValue(
        known === 0
            ? value.knownAmount === null
            : typeof value.knownAmount === 'number' &&
                  Number.isFinite(value.knownAmount) &&
                  Math.abs(value.knownAmount) <= 1e19,
        '결산 금액을 확인하세요. 기록 없음과 0원을 구분해야 합니다.'
    );
    return {
        schemaVersion: 1,
        kind,
        month: value.month,
        asOf: value.asOf,
        currency: value.currency,
        scopeHash: value.scopeHash,
        accountCount: value.accountCount,
        recordCount: value.recordCount,
        unknownCount: value.unknownCount,
        knownAmount: value.knownAmount,
        excludedDateCount: value.excludedDateCount,
    };
}

export function createMonthlyStatement({
    group,
    month,
    today,
    scopeHash,
    accountCount,
    rejected = 0,
}) {
    requireValue(group, '선택 통화의 배당 기록을 확인하세요.');
    return validateMonthlyStatement({
        schemaVersion: 1,
        kind,
        month,
        asOf: today,
        currency: group.currency,
        scopeHash,
        accountCount,
        recordCount: group.current.count,
        unknownCount: group.current.unknown,
        knownAmount: group.current.amount,
        excludedDateCount: rejected,
    });
}

export function parseMonthlyStatement(content) {
    requireValue(
        typeof content === 'string' &&
            new TextEncoder().encode(content).length <=
                MONTHLY_STATEMENT_MAX_BYTES,
        '결산 파일은 32KB 이하여야 합니다.'
    );
    let value;
    try {
        value = JSON.parse(content.replace(/^\uFEFF/, ''));
    } catch {
        throw new Error('JSON 결산 파일을 확인하세요.');
    }
    return validateMonthlyStatement(value);
}

export async function monthlyScopeHash(userId, familyId, accountIds) {
    requireValue(
        userId && familyId && accountIds.length,
        '결산 계좌 범위를 확인하세요.'
    );
    const bytes = new TextEncoder().encode(
        JSON.stringify([userId, familyId, [...new Set(accountIds)].sort()])
    );
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
}

export function compareMonthlyStatements(current, previous) {
    const a = validateMonthlyStatement(current),
        b = validateMonthlyStatement(previous);
    requireValue(
        a.scopeHash === b.scopeHash && a.accountCount === b.accountCount,
        '같은 로그인 사용자·가족·계좌 범위의 결산만 비교할 수 있습니다.'
    );
    requireValue(
        a.currency === b.currency,
        '같은 통화의 결산만 비교할 수 있습니다.'
    );
    requireValue(
        b.month < a.month,
        '현재 분석 월보다 이전 월의 결산을 선택하세요.'
    );
    const incomplete =
        a.month === a.asOf.slice(0, 7) ||
        b.month === b.asOf.slice(0, 7) ||
        a.unknownCount > 0 ||
        b.unknownCount > 0 ||
        a.recordCount === 0 ||
        b.recordCount === 0 ||
        a.excludedDateCount > 0 ||
        b.excludedDateCount > 0;
    const difference = incomplete ? null : a.knownAmount - b.knownAmount;
    return {
        difference,
        percent:
            difference !== null && b.knownAmount > 0
                ? (difference / b.knownAmount) * 100
                : null,
        reason: incomplete
            ? '진행 중인 달·기록 없음·금액 미확인·날짜 제외 기록이 있어 증감을 계산하지 않습니다.'
            : b.knownAmount <= 0
              ? '이전 결산 금액이 0 이하이므로 증감률을 계산하지 않습니다.'
              : '',
    };
}
