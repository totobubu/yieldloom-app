// src/utils/dividendParser.js

/**
 * @deprecated This utility is deprecated with the new amount structure (V2).
 * The new structure uses:
 * - amount: Always a number (final split-adjusted value)
 * - amountFixed: Actual received amount
 * - amountSplitAdjustments: Array of {date, ratio, factor, amountAfterSplit}
 *
 * This parser is kept for backward compatibility with old string-based dividend amounts.
 *
 * 배당금 문자열에서 최종 계산값과 원래 배당금을 추출합니다.
 *
 * @param {string|number} dividendAmount - 배당금 (문자열 또는 숫자)
 * @returns {{ finalAmount: number, originalAmount: number | null, displayText: string }}
 *   - finalAmount: 최종 계산된 배당금 (차트/계산에 사용)
 *   - originalAmount: 원래 배당금 (툴팁 표시용, 없으면 null)
 *   - displayText: 툴팁에 표시할 텍스트
 *
 * @example
 * parseDividendAmount("₩1,266 (1.05:1 → 1.05:1 → 5:1 == ₩180)")
 * // returns { finalAmount: 180, originalAmount: 1266, displayText: "₩180 (= ₩1,266)" }
 *
 * parseDividendAmount(500)
 * // returns { finalAmount: 500, originalAmount: null, displayText: "₩500" }
 */
export function parseDividendAmount(dividendAmount) {
    // 숫자인 경우 그대로 반환
    if (typeof dividendAmount === 'number') {
        return {
            finalAmount: dividendAmount,
            originalAmount: null,
            displayText: null,
        };
    }

    const amountStr = String(dividendAmount).trim();
    
    // 원칙: "₩129 (7.387:1 = ₩953)" - amountOriginal이 앞에, 총비율:1 = 최종값 형식
    let finalAmount = null;
    let originalAmount = null;
    
    // "= ₩953" 패턴으로 최종값 추출 (괄호 안의 마지막 값)
    const finalMatch = amountStr.match(/=\s*₩?([\d,]+\.?\d*)(?:\s*\))?$/);
    if (finalMatch) {
        finalAmount = parseFloat(finalMatch[1].replace(/,/g, ''));
        // 원래값은 괄호 앞의 숫자
        const originalMatch = amountStr.match(/^₩?([\d,]+\.?\d*)\s*\(/);
        if (originalMatch) {
            originalAmount = parseFloat(originalMatch[1].replace(/,/g, ''));
        }
    }
    
    // 형식을 찾지 못한 경우, 전체 문자열에서 첫 번째 숫자를 최종값으로 사용
    if (finalAmount === null) {
        const numberMatch = amountStr.match(/₩?([\d,]+\.?\d*)/);
        if (numberMatch) {
            finalAmount = parseFloat(numberMatch[1].replace(/,/g, ''));
        }
    }
    
    // 숫자를 찾을 수 없으면 0 반환
    if (finalAmount === null || isNaN(finalAmount)) {
        return {
            finalAmount: 0,
            originalAmount: null,
            displayText: null,
        };
    }
    
    // 툴팁 표시 텍스트 생성
    let displayText = null;
    if (originalAmount !== null && originalAmount !== finalAmount) {
        // 원래 배당금과 최종 계산값이 다른 경우
        displayText = `(= ₩${originalAmount.toLocaleString('ko-KR')})`;
    }
    
    return {
        finalAmount,
        originalAmount,
        displayText,
    };
}

/**
 * 배당 내역 배열에서 배당금을 파싱하여 최종 계산값을 반환합니다.
 * 
 * @param {Array} dividendHistory - 배당 내역 배열
 * @returns {Array} 파싱된 배당 내역 배열 (finalAmount 필드 추가)
 */
export function parseDividendHistory(dividendHistory) {
    if (!dividendHistory || !Array.isArray(dividendHistory)) {
        return [];
    }
    
    return dividendHistory.map((item) => {
        const parsed = parseDividendAmount(item['배당금']);
        return {
            ...item,
            finalAmount: parsed.finalAmount,
            originalAmount: parsed.originalAmount,
            displayText: parsed.displayText,
        };
    });
}

