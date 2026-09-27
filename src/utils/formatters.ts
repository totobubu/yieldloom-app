// src/utils/formatters.ts

import type { Currency } from '@/types';

/**
 * 숫자 값을 통화 형식의 문자열로 변환합니다.
 * @param value - 포맷팅할 숫자
 * @param currency - 'USD' 또는 'KRW'
 * @returns 포맷팅된 문자열
 */
export function formatCurrency(
    value: number | null | undefined,
    currency: Currency = 'USD'
): string {
    if (value === null || typeof value === 'undefined' || isNaN(value)) {
        return 'N/A';
    }
    const numberValue = Number(value);
    const options: Intl.NumberFormatOptions =
        currency === 'KRW'
            ? {
                  style: 'currency',
                  currency: 'KRW',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
              }
            : {
                  style: 'currency',
                  currency: 'USD',
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
              };

    const formatter = new Intl.NumberFormat(
        currency === 'KRW' ? 'ko-KR' : 'en-US',
        options
    );
    let formatted = formatter.format(numberValue);
    if (currency === 'USD' && formatted.includes('.')) {
        formatted = formatted.replace(/\.?0+$/, '');
    }
    return formatted;
}

/**
 * 큰 숫자를 T, B, M, K 또는 조, 억, 만 단위로 축약합니다.
 * @param value - 축약할 숫자
 * @param currency - 'USD' 또는 'KRW'
 * @returns 축약된 숫자 문자열 (통화 기호 없음)
 */
export function formatLargeNumber(
    value: number | null | undefined,
    currency: Currency = 'USD'
): string {
    if (value === null || typeof value === 'undefined' || isNaN(value))
        return 'N/A';
    const num = Number(value);
    const units: Record<string, number> =
        currency === 'KRW'
            ? { 경: 1.0e16, 조: 1.0e12, 억: 1.0e8, 만: 1.0e4 }
            : { T: 1.0e12, B: 1.0e9, M: 1.0e6, K: 1.0e3 };

    for (const [unit, threshold] of Object.entries(units)) {
        if (Math.abs(num) >= threshold) {
            return `${(num / threshold).toFixed(2)}${unit}`;
        }
    }
    return new Intl.NumberFormat(currency === 'KRW' ? 'ko-KR' : 'en-US').format(
        num
    );
}

/**
 * 숫자를 퍼센트 문자열로 변환합니다.
 * @param value - 비율 값 (예: 0.05)
 * @returns 퍼센트 문자열 (예: "5.00%")
 */
export function formatPercent(value: number | null | undefined): string {
    if (value === null || typeof value === 'undefined' || isNaN(value))
        return 'N/A';
    return `${(Number(value) * 100).toFixed(2)}%`;
}

/**
 * ECharts 툴팁 또는 라벨에 사용할 숫자 포맷터를 생성하는 고차 함수.
 * @param currency - 'USD' 또는 'KRW'
 * @param options - Intl.NumberFormat 옵션
 * @returns 숫자 포맷 함수
 */
export function createNumericFormatter(
    currency: Currency = 'USD',
    options: Intl.NumberFormatOptions = {}
): (value: number | null | undefined) => string {
    const defaultOptions: Intl.NumberFormatOptions =
        currency === 'KRW'
            ? {
                  style: 'currency',
                  currency: 'KRW',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
              }
            : {
                  style: 'currency',
                  currency: 'USD',
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 6,
              };

    const formatter = new Intl.NumberFormat(
        currency === 'KRW' ? 'ko-KR' : 'en-US',
        { ...defaultOptions, ...options }
    );
    return (value: number | null | undefined): string => {
        if (value === null || typeof value === 'undefined' || isNaN(value))
            return '';
        let formatted = formatter.format(value);
        if (currency === 'USD' && formatted.includes('.')) {
            formatted = formatted.replace(/\.?0+$/, '');
        }
        return formatted;
    };
}
