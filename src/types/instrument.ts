/**
 * 종목 (Instrument) 관련 타입 정의
 */

import type { Currency, Market, DividendFrequency, InstrumentStatus } from './common';

/**
 * 종목 정보 (NAV 데이터)
 */
export interface Instrument {
  symbol: string;
  koName?: string;
  longName?: string;
  company?: string;
  ipoDate?: string;
  frequency?: DividendFrequency;
  sharesOutstanding?: boolean;
  isin: string;
  market: Market;
  yfSymbol?: string;
  currency: Currency;
  logo?: string;
  dataPaths?: string[];
  periods?: string[];
  group?: string;
  status?: InstrumentStatus;
}

/**
 * 가격 데이터 (일별)
 */
export interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dividends?: number;
  splits?: number;
}

/**
 * 배당 정보
 */
export interface DividendInfo {
  ticker: string;
  koName?: string;
  frequency?: DividendFrequency;
  group?: string;
  amount: number;
  date?: string;
  currency?: Currency;
  isEtf?: boolean;
}

/**
 * ETF 보유종목
 */
export interface Holding {
  ticker: string;
  name?: string;
  weight: number;
  shares?: number;
}

/**
 * Symbol-ISIN 매핑
 */
export interface SymbolMapping {
  symbol: string;
  isin: string;
  market: Market;
  currency: Currency;
}
