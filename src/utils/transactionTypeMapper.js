// src/utils/transactionTypeMapper.js
/**
 * 거래 타입 정규화 및 매핑 유틸리티
 */

/**
 * 정규화된 거래 타입 상수
 */
export const TRANSACTION_TYPES = {
    // 주식 거래
    BUY: 'buy',
    SELL: 'sell',

    // 배당/이자
    DIVIDEND: 'dividend',
    INTEREST: 'interest',

    // 입출금
    DEPOSIT: 'deposit',
    WITHDRAWAL: 'withdrawal',

    // 환전
    EXCHANGE: 'exchange',
    SPLIT: 'split',

    // 기타
    EVENT: 'event',
    TRANSFER: 'transfer',
    UNKNOWN: 'unknown',
};

/**
 * 증권사별 거래 타입 매핑
 */
export const BROKERAGE_TYPE_MAPPING = {
    토스증권: {
        구매: TRANSACTION_TYPES.BUY,
        판매: TRANSACTION_TYPES.SELL,
        배당: TRANSACTION_TYPES.DIVIDEND,
        외화증권배당금입금: TRANSACTION_TYPES.DIVIDEND,
        환전외화입금: TRANSACTION_TYPES.EXCHANGE,
        환전원화출금: TRANSACTION_TYPES.EXCHANGE,
        환전외화입금취소: TRANSACTION_TYPES.EXCHANGE,
        이체입금: TRANSACTION_TYPES.DEPOSIT,
        이체출금: TRANSACTION_TYPES.WITHDRAWAL,
        오픈뱅킹입금: TRANSACTION_TYPES.DEPOSIT,
        이자입금: TRANSACTION_TYPES.INTEREST,
        출석체크이벤트입고: TRANSACTION_TYPES.EVENT,
        해외주식이벤트입고: TRANSACTION_TYPES.EVENT,
        외화주식병합단주대금입금: TRANSACTION_TYPES.SPLIT,
    },
    삼성증권: {
        매수: TRANSACTION_TYPES.BUY,
        매도: TRANSACTION_TYPES.SELL,
        배당금입금: TRANSACTION_TYPES.DIVIDEND,
        현금배당금: TRANSACTION_TYPES.DIVIDEND,
        이자: TRANSACTION_TYPES.INTEREST,
        입금: TRANSACTION_TYPES.DEPOSIT,
        출금: TRANSACTION_TYPES.WITHDRAWAL,
    },
    // 다른 증권사 추가 가능
};

/**
 * 거래 타입 정규화
 * @param {string} rawType - 원본 거래 타입
 * @param {string} brokerage - 증권사명
 * @returns {string} 정규화된 거래 타입
 */
export function normalizeTransactionType(rawType, brokerage) {
    if (!rawType) {
        console.warn('Transaction type is empty');
        return TRANSACTION_TYPES.UNKNOWN;
    }

    const mapping = BROKERAGE_TYPE_MAPPING[brokerage];

    if (mapping && mapping[rawType]) {
        return mapping[rawType];
    }

    // 매핑되지 않은 경우 로그 남기고 UNKNOWN 반환
    console.warn(`Unknown transaction type: "${rawType}" from "${brokerage}"`);
    return TRANSACTION_TYPES.UNKNOWN;
}

/**
 * 거래 타입 한글 라벨
 */
export const TRANSACTION_TYPE_LABELS = {
    [TRANSACTION_TYPES.BUY]: '매수',
    [TRANSACTION_TYPES.SELL]: '매도',
    [TRANSACTION_TYPES.DIVIDEND]: '배당',
    [TRANSACTION_TYPES.INTEREST]: '이자',
    [TRANSACTION_TYPES.DEPOSIT]: '입금',
    [TRANSACTION_TYPES.WITHDRAWAL]: '출금',
    [TRANSACTION_TYPES.EXCHANGE]: '환전',
    [TRANSACTION_TYPES.EVENT]: '이벤트',
    [TRANSACTION_TYPES.TRANSFER]: '이체',
    [TRANSACTION_TYPES.UNKNOWN]: '미분류',
};

/**
 * 거래 타입 라벨 가져오기
 * @param {string} type - 정규화된 거래 타입
 * @param {string} rawType - 원본 거래 타입 (unknown일 때 표시용)
 * @returns {string} 한글 라벨
 */
export function getTransactionTypeLabel(type, rawType = null) {
    // unknown인 경우 원본 타입을 그대로 반환
    if (type === TRANSACTION_TYPES.UNKNOWN && rawType) {
        return rawType;
    }
    return TRANSACTION_TYPE_LABELS[type] || '미분류';
}
