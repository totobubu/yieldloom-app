/**
 * 캘린더 관련 타입 정의
 */

import type { Currency, DividendFrequency } from './common';

/**
 * 캘린더 이벤트 (배당)
 */
export interface CalendarEvent {
  ticker: string;
  koName?: string;
  frequency?: DividendFrequency;
  group?: string;
  amount: number;
  date: string;
  currency: Currency;
  isEtf: boolean;
}

/**
 * 날짜별 배당 데이터
 */
export type DividendsByDate = Record<string, CalendarEvent[]>;

/**
 * 월별 데이터 (YYYY-MM)
 */
export type MonthlyData = Map<string, CalendarEvent[]>;

/**
 * 티커 속성 정보
 */
export interface TickerProperties {
  currency: Currency;
  isEtf: boolean;
  koName?: string;
}

/**
 * 캘린더 메타데이터
 */
export interface CalendarMetadata {
  totalMonths: number;
  totalDates: number;
  dateRange: {
    start: string;
    end: string;
  };
  months: string[];
}

/**
 * 캘린더 캐시 데이터
 */
export interface CalendarCacheData {
  events: CalendarEvent[];
  tickerProperties: Array<[string, TickerProperties]>;
}
