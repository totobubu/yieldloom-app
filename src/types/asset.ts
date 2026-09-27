/**
 * 자산 관리 관련 타입 정의
 */

import type { Currency, AssetType, TransactionType, Relationship } from './common';
import { Timestamp } from 'firebase/firestore';

/**
 * 가족 멤버
 */
export interface FamilyMember {
  id: string;
  name: string;
  relationship: Relationship;
}

/**
 * 증권 계좌
 */
export interface Account {
  id: string;
  memberId: string;
  name: string;
  brokerage: string;
  accountNumber?: string;
}

/**
 * 계좌별 보유 정보
 */
export interface Holdings {
  [accountId: string]: {
    amount: number;
    avgPrice?: number;
  };
}

/**
 * 자산
 */
export interface Asset {
  id: string;
  type: AssetType;
  isin?: string;
  symbol?: string;
  name?: string;
  currency?: Currency;
  holdings: Holdings;
  notes?: string;
  koNameApprovalStatus?: 'pending' | 'approved' | 'rejected';
}

/**
 * 거래내역
 */
export interface Transaction {
  id: string;
  assetId: string;
  tossTransactionId?: string;
  accountId: string;
  date: Timestamp | Date;
  brokerage?: string;
  type: TransactionType;
  rawType?: string;
  currency: Currency;
  quantity?: number;
  price?: number;
  amount?: number;
  commission?: number;
  tax?: number;
  balance?: number;
  balanceAmount?: number;
  notes?: string;

  // USD 거래인 경우
  priceUSD?: number;
  amountUSD?: number;
  exchangeRate?: number;
  commissionUSD?: number;
  taxUSD?: number;
}

/**
 * 북마크
 */
export interface Bookmark {
  symbol: string;
  isin: string;
  market: string;
  currency: Currency;
  avgPrice?: number;
  quantity?: number;
  accumulatedDividend?: number;
  targetAsset?: number;
  isEtf?: boolean;
}

/**
 * 북마크 맵
 */
export type BookmarksMap = Record<string, Bookmark>;
