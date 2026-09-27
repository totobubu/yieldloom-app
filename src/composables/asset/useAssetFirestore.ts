// src/composables/asset/useAssetFirestore.ts
import { ref, type Ref } from 'vue';
import {
    collection,
    doc,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    deleteField,
    type DocumentData,
} from 'firebase/firestore';
import { db } from '@/firebase';
import type { FamilyMember, Account, Asset, Transaction } from '@/types/asset';

/**
 * Firestore 데이터 구조:
 *
 * userAssets/{userId}/familyMembers/{memberId}
 *   - name: string
 *   - relationship: string (본인, 배우자, 자녀, 부모 등)
 *
 * --------------------------------------------------
 *
 * userAssets/{userId}/familyMembers/{memberId}/accounts/{accountId}
 *   - name: string
 *   - brokerage: string
 *   - accountNumber: string
 *
 * --------------------------------------------------
 *
 * userAssets/{userId}/assets/{isin} or {currency} or {coinid}
 * - type: string (주식, 현금, 코인)
 * - isin?: string (주식일 경우 ISIN 코드)
 * - symbol?: string (주식 심볼)
 * - name?: string (자산명)
 * - currency?: string (KRW, USD 등)
 * - holdings: { [accountId]: { amount: number, avgPrice?: number } }
 * - notes?: string
 *
 * --------------------------------------------------
 *
 * userAssets/{userId}/assets/{isin}/transactions/{transactionId}
 * - tossTransactionId?: string (토스증권 거래내역서 발급번호)
 * - accountId: string (어느 계좌의 거래인지)
 * - date: timestamp (거래일자)
 * - brokerage?: string (증권사명)
 * - type: string (정규화된 타입: buy, sell, dividend, deposit, withdrawal, exchange, interest, event, unknown)
 * - rawType: string (원본 거래 타입)
 * - currency: string (거래 통화: "USD", "KRW")
 * - quantity?: number (거래수량)
 * - price?: number (KRW 기준 단가)
 * - amount: number (KRW 기준 거래대금, 총 금액)
 * - commission?: number (수수료)
 * - tax?: number (제세금)
 * - taxFree?: number (변제/연체합)
 * - balance?: number (잔고)
 * - balanceAmount?: number (잔액)
 * - notes?: string
 *
 * // USD 거래인 경우
 * - priceUSD?: number (USD 기준 단가)
 * - amountUSD?: number (USD 기준 거래대금, 총 금액)
 * - exchangeRate?: number (환율)
 * - commissionUSD?: number (USD 기준 수수료)
 * - taxUSD?: number (USD 기준 제세금)
 * - taxFreeUSD?: number (USD 기준 변제/연체합)
 * - balanceUSD?: number (USD 기준 잔고)
 * - balanceAmountUSD?: number (USD 기준 잔액)
 */

/**
 * 가족 멤버 관리
 */
export interface UseFamilyMembersReturn {
    familyMembers: Ref<FamilyMember[]>;
    isLoading: Ref<boolean>;
    loadFamilyMembers: (userId: string) => Promise<void>;
    addFamilyMember: (
        userId: string,
        memberData: Partial<FamilyMember>
    ) => Promise<string | undefined>;
    updateFamilyMember: (
        userId: string,
        memberId: string,
        memberData: Partial<FamilyMember>
    ) => Promise<void>;
    deleteFamilyMember: (userId: string, memberId: string) => Promise<void>;
}

export const useFamilyMembers = (): UseFamilyMembersReturn => {
    const familyMembers = ref<FamilyMember[]>([]);
    const isLoading = ref(false);

    const loadFamilyMembers = async (userId: string): Promise<void> => {
        if (!userId) return;
        console.log('📥 loadFamilyMembers called with userId:', userId);
        isLoading.value = true;
        try {
            const membersRef = collection(
                db,
                `userAssets/${userId}/familyMembers`
            );
            const snapshot = await getDocs(membersRef);
            const data = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as FamilyMember[];
            console.log('📊 Loaded data:', data);
            familyMembers.value = data;
            console.log('✅ familyMembers.value updated:', familyMembers.value);
        } catch (error) {
            console.error('가족 멤버 불러오기 실패:', error);
        } finally {
            isLoading.value = false;
        }
    };

    const addFamilyMember = async (
        userId: string,
        memberData: Partial<FamilyMember>
    ): Promise<string | undefined> => {
        if (!userId) return;
        try {
            const membersRef = collection(
                db,
                `userAssets/${userId}/familyMembers`
            );
            const docRef = await addDoc(membersRef, {
                ...memberData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('가족 멤버 추가 실패:', error);
            throw error;
        }
    };

    const updateFamilyMember = async (
        userId: string,
        memberId: string,
        memberData: Partial<FamilyMember>
    ): Promise<void> => {
        if (!userId) return;
        try {
            const memberRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}`
            );
            await updateDoc(memberRef, memberData as DocumentData);
        } catch (error) {
            console.error('가족 멤버 수정 실패:', error);
            throw error;
        }
    };

    const deleteFamilyMember = async (
        userId: string,
        memberId: string
    ): Promise<void> => {
        if (!userId) return;
        try {
            // 서브컬렉션도 함께 삭제해야 함 (Firestore는 자동으로 서브컬렉션을 삭제하지 않음)
            const memberRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}`
            );
            await deleteDoc(memberRef);
        } catch (error) {
            console.error('가족 멤버 삭제 실패:', error);
            throw error;
        }
    };

    return {
        familyMembers,
        isLoading,
        loadFamilyMembers,
        addFamilyMember,
        updateFamilyMember,
        deleteFamilyMember,
    };
};

/**
 * 증권사 관리
 */
export interface Brokerage {
    id: string;
    name: string;
    [key: string]: any;
}

export interface UseBrokeragesReturn {
    isLoading: Ref<boolean>;
    loadBrokerages: (userId: string, memberId: string) => Promise<Brokerage[]>;
    addBrokerage: (
        userId: string,
        memberId: string,
        brokerageData: Partial<Brokerage>
    ) => Promise<string | undefined>;
    updateBrokerage: (
        userId: string,
        memberId: string,
        brokerageId: string,
        brokerageData: Partial<Brokerage>
    ) => Promise<void>;
    deleteBrokerage: (
        userId: string,
        memberId: string,
        brokerageId: string
    ) => Promise<void>;
}

export const useBrokerages = (): UseBrokeragesReturn => {
    const isLoading = ref(false);

    const loadBrokerages = async (
        userId: string,
        memberId: string
    ): Promise<Brokerage[]> => {
        if (!userId || !memberId) return [];
        isLoading.value = true;
        try {
            const brokeragesRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages`
            );
            const snapshot = await getDocs(brokeragesRef);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Brokerage[];
        } catch (error) {
            console.error('증권사 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const addBrokerage = async (
        userId: string,
        memberId: string,
        brokerageData: Partial<Brokerage>
    ): Promise<string | undefined> => {
        if (!userId || !memberId) return;
        try {
            const brokeragesRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages`
            );
            const docRef = await addDoc(brokeragesRef, {
                ...brokerageData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('증권사 추가 실패:', error);
            throw error;
        }
    };

    const updateBrokerage = async (
        userId: string,
        memberId: string,
        brokerageId: string,
        brokerageData: Partial<Brokerage>
    ): Promise<void> => {
        if (!userId || !memberId) return;
        try {
            const brokerageRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}`
            );
            await updateDoc(brokerageRef, brokerageData as DocumentData);
        } catch (error) {
            console.error('증권사 수정 실패:', error);
            throw error;
        }
    };

    const deleteBrokerage = async (
        userId: string,
        memberId: string,
        brokerageId: string
    ): Promise<void> => {
        if (!userId || !memberId) return;
        try {
            const brokerageRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/brokerages/${brokerageId}`
            );
            await deleteDoc(brokerageRef);
        } catch (error) {
            console.error('증권사 삭제 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadBrokerages,
        addBrokerage,
        updateBrokerage,
        deleteBrokerage,
    };
};

/**
 * 계좌 관리
 */
export interface UseAccountsReturn {
    isLoading: Ref<boolean>;
    loadAccounts: (userId: string, memberId: string) => Promise<Account[]>;
    addAccount: (
        userId: string,
        memberId: string,
        accountData: Partial<Account>
    ) => Promise<string | undefined>;
    updateAccount: (
        userId: string,
        memberId: string,
        accountId: string,
        accountData: Partial<Account>
    ) => Promise<void>;
    deleteAccount: (
        userId: string,
        memberId: string,
        accountId: string
    ) => Promise<void>;
}

export const useAccounts = (): UseAccountsReturn => {
    const isLoading = ref(false);

    const loadAccounts = async (
        userId: string,
        memberId: string
    ): Promise<Account[]> => {
        if (!userId || !memberId) return [];
        isLoading.value = true;
        try {
            const accountsRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts`
            );
            const snapshot = await getDocs(accountsRef);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Account[];
        } catch (error) {
            console.error('계좌 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const addAccount = async (
        userId: string,
        memberId: string,
        accountData: Partial<Account>
    ): Promise<string | undefined> => {
        if (!userId || !memberId) return;
        try {
            const accountsRef = collection(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts`
            );
            const docRef = await addDoc(accountsRef, {
                ...accountData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('계좌 추가 실패:', error);
            throw error;
        }
    };

    const updateAccount = async (
        userId: string,
        memberId: string,
        accountId: string,
        accountData: Partial<Account>
    ): Promise<void> => {
        if (!userId || !memberId) return;
        try {
            const accountRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts/${accountId}`
            );
            await updateDoc(accountRef, accountData as DocumentData);
        } catch (error) {
            console.error('계좌 수정 실패:', error);
            throw error;
        }
    };

    const deleteAccount = async (
        userId: string,
        memberId: string,
        accountId: string
    ): Promise<void> => {
        if (!userId || !memberId) return;
        try {
            const accountRef = doc(
                db,
                `userAssets/${userId}/familyMembers/${memberId}/accounts/${accountId}`
            );
            await deleteDoc(accountRef);
        } catch (error) {
            console.error('계좌 삭제 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadAccounts,
        addAccount,
        updateAccount,
        deleteAccount,
    };
};

/**
 * 자산 항목 관리 (Asset-Centric Structure)
 * Assets are stored at: userAssets/{userId}/assets/{assetId}
 * where assetId is ISIN for stocks or currency code for cash
 */
export interface UseAssetsReturn {
    isLoading: Ref<boolean>;
    loadAssets: (userId: string) => Promise<Asset[]>;
    loadStocks: (userId: string) => Promise<Asset[]>;
    loadCash: (userId: string) => Promise<Asset[]>;
    loadCoins: (userId: string) => Promise<Asset[]>;
    addAsset: (
        userId: string,
        assetData: Partial<Asset>
    ) => Promise<string | undefined>;
    updateAsset: (
        userId: string,
        assetId: string,
        assetData: Partial<Asset>
    ) => Promise<void>;
    deleteAsset: (userId: string, assetId: string) => Promise<void>;
    deleteAssetHolding: (
        userId: string,
        assetId: string,
        accountId: string
    ) => Promise<void>;
}

export const useAssets = (): UseAssetsReturn => {
    const isLoading = ref(false);

    const loadAssets = async (userId: string): Promise<Asset[]> => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const snapshot = await getDocs(assetsRef);
            console.log(
                '🔍 [loadAssets] Firebase에서 가져온 문서 수:',
                snapshot.docs.length
            );
            console.log(
                '🔍 [loadAssets] 문서 ID 목록:',
                snapshot.docs.map((doc) => doc.id)
            );
            const assets = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Asset[];
            console.log('🔍 [loadAssets] 변환된 자산 수:', assets.length);
            return assets;
        } catch (error) {
            console.error('자산 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const loadStocks = async (userId: string): Promise<Asset[]> => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const q = query(assetsRef, where('type', '==', '주식'));
            const snapshot = await getDocs(q);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Asset[];
        } catch (error) {
            console.error('주식 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const loadCash = async (userId: string): Promise<Asset[]> => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const q = query(assetsRef, where('type', '==', '현금'));
            const snapshot = await getDocs(q);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Asset[];
        } catch (error) {
            console.error('현금 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const loadCoins = async (userId: string): Promise<Asset[]> => {
        if (!userId) return [];
        isLoading.value = true;
        try {
            const assetsRef = collection(db, `userAssets/${userId}/assets`);
            const q = query(assetsRef, where('type', '==', '코인'));
            const snapshot = await getDocs(q);
            return snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Asset[];
        } catch (error) {
            console.error('코인 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const addAsset = async (
        userId: string,
        assetData: Partial<Asset>
    ): Promise<string | undefined> => {
        if (!userId) return;
        try {
            // Determine asset ID based on type
            let assetId: string | undefined;
            if (assetData.type === '주식') {
                if (assetData.isin) {
                    assetId = assetData.isin;
                } else if (assetData.symbol) {
                    assetId = `STOCK_${assetData.symbol}`;
                }
            } else if (assetData.type === '현금' && assetData.currency) {
                assetId = `CASH_${assetData.currency}`;
            } else if (assetData.type === '코인' && assetData.symbol) {
                assetId = `COIN_${assetData.symbol}`;
            }

            if (!assetId) {
                throw new Error(
                    'Invalid asset data: missing isin, currency, or symbol'
                );
            }

            const assetRef = doc(db, `userAssets/${userId}/assets`, assetId);

            // Remove undefined fields from assetData
            const sanitizedData = Object.fromEntries(
                Object.entries(assetData).filter(([_, v]) => v !== undefined)
            );

            // Use setDoc with merge to update if exists
            await setDoc(
                assetRef,
                {
                    ...sanitizedData,
                    updatedAt: new Date(),
                },
                { merge: true }
            );

            return assetId;
        } catch (error) {
            console.error('자산 추가 실패:', error);
            throw error;
        }
    };

    const updateAsset = async (
        userId: string,
        assetId: string,
        assetData: Partial<Asset>
    ): Promise<void> => {
        if (!userId || !assetId) return;
        try {
            const assetRef = doc(db, `userAssets/${userId}/assets/${assetId}`);
            await updateDoc(assetRef, {
                ...assetData,
                updatedAt: new Date(),
            } as DocumentData);
        } catch (error) {
            console.error('자산 수정 실패:', error);
            throw error;
        }
    };

    const deleteAsset = async (
        userId: string,
        assetId: string
    ): Promise<void> => {
        if (!userId || !assetId) return;
        try {
            // Note: This doesn't delete subcollections automatically
            // You may need to delete transactions separately or use Cloud Functions
            const assetRef = doc(db, `userAssets/${userId}/assets/${assetId}`);
            await deleteDoc(assetRef);
        } catch (error) {
            console.error('자산 삭제 실패:', error);
            throw error;
        }
    };

    const deleteAssetHolding = async (
        userId: string,
        assetId: string,
        accountId: string
    ): Promise<void> => {
        if (!userId || !assetId || !accountId) return;
        try {
            const assetRef = doc(db, `userAssets/${userId}/assets/${assetId}`);
            await updateDoc(assetRef, {
                [`holdings.${accountId}`]: deleteField(),
                updatedAt: new Date(),
            });
        } catch (error) {
            console.error('자산 보유 내역 삭제 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadAssets,
        addAsset,
        updateAsset,
        deleteAsset,
        deleteAssetHolding,
        loadStocks,
        loadCash,
        loadCoins,
    };
};

/**
 * 거래 내역 관리 (Asset-Centric Structure)
 * Transactions are stored at: userAssets/{userId}/assets/{assetId}/transactions/{txId}
 * Each transaction includes accountId to track which account it belongs to
 */
export interface UseTransactionsReturn {
    isLoading: Ref<boolean>;
    loadTransactions: (
        userId: string,
        assetId: string,
        accountId?: string | null
    ) => Promise<Transaction[]>;
    addTransaction: (
        userId: string,
        assetId: string,
        transactionData: Partial<Transaction>
    ) => Promise<string | undefined>;
}

export const useTransactions = (): UseTransactionsReturn => {
    const isLoading = ref(false);

    const loadTransactions = async (
        userId: string,
        assetId: string,
        accountId: string | null = null
    ): Promise<Transaction[]> => {
        if (!userId || !assetId) return [];
        isLoading.value = true;
        try {
            const transactionsRef = collection(
                db,
                `userAssets/${userId}/assets/${assetId}/transactions`
            );
            const snapshot = await getDocs(transactionsRef);
            let transactions = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            })) as Transaction[];

            // Filter by accountId if provided
            if (accountId) {
                transactions = transactions.filter(
                    (tx) => tx.accountId === accountId
                );
            }

            return transactions;
        } catch (error) {
            console.error('거래 내역 불러오기 실패:', error);
            return [];
        } finally {
            isLoading.value = false;
        }
    };

    const addTransaction = async (
        userId: string,
        assetId: string,
        transactionData: Partial<Transaction>
    ): Promise<string | undefined> => {
        if (!userId || !assetId) return;
        if (!transactionData.accountId) {
            throw new Error('Transaction must include accountId');
        }

        try {
            const transactionsRef = collection(
                db,
                `userAssets/${userId}/assets/${assetId}/transactions`
            );
            const docRef = await addDoc(transactionsRef, {
                ...transactionData,
                createdAt: new Date(),
            });
            return docRef.id;
        } catch (error) {
            console.error('거래 내역 추가 실패:', error);
            throw error;
        }
    };

    return {
        isLoading,
        loadTransactions,
        addTransaction,
    };
};
