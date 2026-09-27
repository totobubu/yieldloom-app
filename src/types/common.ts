/**
 * 공통 타입 정의
 */

// 통화 타입
export type Currency = 'KRW' | 'USD';

// 시장 타입
export type Market = 'NASDAQ' | 'NYSE' | 'BATS' | 'AMEX' | 'OTC';

// 배당 주기
export type DividendFrequency = '매월' | '분기' | '반기' | '매년' | '불규칙';

// 배당 그룹 (예: JJO, FND 등)
export type DividendGroup = string;

// 자산 타입
export type AssetType = '주식' | '현금' | '코인' | 'ETF';

// 거래 타입
export type TransactionType =
  | 'buy'           // 매수
  | 'sell'          // 매도
  | 'dividend'      // 배당금
  | 'deposit'       // 입금
  | 'withdrawal'    // 출금
  | 'exchange'      // 환전
  | 'interest'      // 이자
  | 'event'         // 이벤트
  | 'unknown';      // 알 수 없음

// 관계
export type Relationship = '본인' | '배우자' | '자녀' | '부모' | '기타';

// 종목 상태
export type InstrumentStatus = 'active' | 'upcoming' | 'delisted';
