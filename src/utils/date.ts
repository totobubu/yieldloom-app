// src/utils/date.ts

/**
 * YY.MM.DD 형식의 문자열을 Date 객체로 변환
 * @param dateStr - YY.MM.DD 형식의 날짜 문자열
 * @returns Date 객체 또는 null
 */
export const parseYYMMDD = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('.').map((part) => parseInt(part.trim(), 10));
    if (parts.length !== 3 || parts.some(isNaN)) return null;

    let [year, month, day] = parts;

    const currentYearLastTwoDigits = new Date().getFullYear() % 100;
    if (year > currentYearLastTwoDigits + 1) {
        year += 1900;
    } else {
        year += 2000;
    }

    return new Date(year, month - 1, day);
};

/**
 * 개월 수를 년/월 형식으로 변환
 */
export interface MonthsToYearsResult {
    duration: string;
    date: string | null;
}

/**
 * 개월 수를 년/월 형식으로 변환하고 미래 날짜 계산
 * @param totalMonths - 총 개월 수
 * @param includeFutureDate - 미래 날짜 포함 여부
 * @returns 변환 결과 객체
 */
export function formatMonthsToYears(
    totalMonths: number,
    includeFutureDate = false
): MonthsToYearsResult {
    const defaultResult: MonthsToYearsResult = { duration: '계산 불가', date: null };

    if (totalMonths === -1) {
        return { duration: '달성 완료', date: null };
    }
    if (!isFinite(totalMonths) || totalMonths <= 0) {
        return defaultResult;
    }

    const years = Math.floor(totalMonths / 12);
    const months = Math.round(totalMonths % 12);

    let durationString = '';
    if (years > 0 && months > 0) {
        durationString = `${years}년 ${months}개월`;
    } else if (years > 0) {
        durationString = `${years}년`;
    } else {
        durationString = `${months}개월`;
    }

    if (!includeFutureDate) {
        return { duration: durationString, date: null };
    }

    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + Math.round(totalMonths));

    const futureYear = futureDate.getFullYear().toString().slice(-2);
    const futureMonth = futureDate.getMonth() + 1;

    return {
        duration: durationString,
        date: `(${futureYear}년 ${futureMonth}월)`,
    };
}
