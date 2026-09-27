// src/services/backtester/utils.js

export function addBusinessDays(utcDate, daysToAdd, holidays = []) {
    let currentDate = new Date(utcDate.getTime());
    let addedDays = 0;
    const holidaySet = new Set(holidays.map((h) => h.date || h)); // holidays.json 형식에 맞춤

    // --- [핵심 수정] ---
    // 만약 더할 날짜가 0일이고, 오늘이 휴일/주말이라면 다음 영업일을 찾아야 함
    if (daysToAdd === 0) {
        while (true) {
            const dayOfWeek = currentDate.getUTCDay();
            const dateString = currentDate.toISOString().split('T')[0];
            if (
                dayOfWeek !== 0 &&
                dayOfWeek !== 6 &&
                !holidaySet.has(dateString)
            ) {
                break; // 오늘이 영업일이면 루프 탈출
            }
            currentDate.setUTCDate(currentDate.getUTCDate() + 1); // 휴일이면 하루 증가
        }
        return currentDate;
    }

    // 기존 로직 (0일 이상 더할 때)
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

export const calculateCAGR = (totalReturn, years) => {
    if (1 + totalReturn <= 0 || years <= 0) return -1;
    return Math.pow(1 + totalReturn, 1 / years) - 1;
};
