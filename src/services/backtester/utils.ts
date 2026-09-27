// src/services/backtester/utils.ts

/**
 * 영업일 기준으로 날짜를 더함 (주말 및 공휴일 제외)
 * @param utcDate - 기준 날짜
 * @param daysToAdd - 더할 영업일 수
 * @param holidays - 공휴일 배열 (YYYY-MM-DD 문자열 또는 { date: string } 객체)
 * @returns 계산된 날짜
 */
export function addBusinessDays(
    utcDate: Date,
    daysToAdd: number,
    holidays: (string | { date: string })[] = []
): Date {
    let currentDate = new Date(utcDate.getTime());
    let addedDays = 0;
    const holidaySet = new Set(
        holidays.map((h) => (typeof h === 'string' ? h : h.date))
    );

    // 0일을 더할 경우, 현재 날짜가 영업일인지 확인
    if (daysToAdd === 0) {
        while (true) {
            const dayOfWeek = currentDate.getUTCDay();
            const dateString = currentDate.toISOString().split('T')[0];
            if (
                dayOfWeek !== 0 &&
                dayOfWeek !== 6 &&
                !holidaySet.has(dateString)
            ) {
                break;
            }
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
        return currentDate;
    }

    // daysToAdd만큼 영업일을 더함
    while (addedDays < daysToAdd) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        const dayOfWeek = currentDate.getUTCDay();
        const dateString = currentDate.toISOString().split('T')[0];
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(dateString)) {
            addedDays++;
        }
    }
    return currentDate;
}

/**
 * CAGR (연평균 복리 수익률) 계산
 * @param totalReturn - 총 수익률 (소수)
 * @param years - 투자 기간 (년)
 * @returns CAGR 값 또는 -1 (계산 불가)
 */
export const calculateCAGR = (totalReturn: number, years: number): number => {
    if (1 + totalReturn <= 0 || years <= 0) return -1;
    return Math.pow(1 + totalReturn, 1 / years) - 1;
};
