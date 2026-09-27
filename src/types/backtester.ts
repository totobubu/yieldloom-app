/**
 * 백테스팅 관련 타입 정의
 */

import type { Currency } from './common';
import type { PriceData } from './instrument';

/**
 * 백테스트 옵션
 */
export interface BacktestOptions {
  tickers: string[];
  weights: number[];
  startDate: string;
  endDate: string;
  initialInvestment: number;
  reinvestDividends: boolean;
  currency: Currency;
  includeTax?: boolean;
  taxRate?: number;
}

/**
 * 포트폴리오 항목
 */
export interface PortfolioItem {
  ticker: string;
  weight: number;
  allocation?: number;
}

/**
 * 백테스트 데이터
 */
export interface BacktestData {
  priceData: Record<string, PriceData[]>;
  dividendData: Record<string, Array<{ date: string; dividend: number }>>;
  exchangeRates?: Array<{ date: string; rate: number }>;
}

/**
 * 시뮬레이션 결과 (일별)
 */
export interface DailyResult {
  date: string;
  portfolioValue: number;
  cashValue: number;
  investedValue: number;
  totalDividends: number;
  shares: Record<string, number>;
  prices: Record<string, number>;
}

/**
 * 백테스트 결과
 */
export interface BacktestResult {
  portfolio: PortfolioItem[];
  startDate: string;
  endDate: string;
  initialInvestment: number;
  finalValue: number;
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  totalDividends: number;
  reinvestedDividends?: number;
  dailyResults: DailyResult[];
  maxDrawdown?: number;
  sharpeRatio?: number;
  volatility?: number;
}

/**
 * 집계된 통계
 */
export interface AggregatedStats {
  totalInvested: number;
  totalReturn: number;
  totalReturnPercent: number;
  annualizedReturn: number;
  totalDividends: number;
  dividendYield: number;
  maxDrawdown: number;
  bestDay: { date: string; return: number };
  worstDay: { date: string; return: number };
}
